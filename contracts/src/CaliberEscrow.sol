// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RatingVerifier} from "./RatingVerifier.sol";
import {IERC8183} from "./interfaces/IERC8183.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal interface to RatingGateway.jobPoster(). CaliberEscrow only
/// supports gated jobs in v2.0; non-gated AgenticCommerce jobs (where
/// client = the human poster directly) are out of scope.
interface IRatingGatewayJobPoster {
    function jobPoster(uint256 jobId) external view returns (address);
}

/// @title CaliberEscrow — performance bonds priced by Caliber tier
/// @notice An agent posts a USDC bond proportional to their own Caliber tier
///         when they accept a gated job. The v2.0 formula is tier-stepped
///         (Established=0.5%, Proven=1.5%, Emerging=5%, Provisional=15%,
///         Watch+Inactive refused at gate). Bond returns to agent on job
///         completion, slashes to the original poster on rejection/expiry.
///         Bond rates per tier are owner-configurable, event-logged, and
///         capped at 50% of budget. Material rate changes follow the 30-day
///         methodology governance rule (§9).
contract CaliberEscrow {
    RatingVerifier public immutable verifier;
    IERC8183 public immutable agenticCommerce;
    IERC20 public immutable usdc;
    address public immutable ratingGateway;
    address public owner;

    // ----- ERC-8183 status codes (mirror reference deployment) -----------
    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_FUNDED = 1;
    uint8 public constant STATUS_SUBMITTED = 2;
    uint8 public constant STATUS_COMPLETED = 3;
    uint8 public constant STATUS_REJECTED = 4;
    uint8 public constant STATUS_EXPIRED = 5;

    // ----- Bond status ---------------------------------------------------
    uint8 public constant BOND_ACTIVE = 0;
    uint8 public constant BOND_RELEASED = 1;
    uint8 public constant BOND_SLASHED = 2;

    // ----- Tier ordinals (mirror engine TIER_ORDINAL) --------------------
    uint8 public constant TIER_ESTABLISHED = 0;
    uint8 public constant TIER_PROVEN = 1;
    uint8 public constant TIER_EMERGING = 2;
    uint8 public constant TIER_PROVISIONAL = 3;
    uint8 public constant TIER_WATCH = 4;
    uint8 public constant TIER_INACTIVE = 5;
    uint8 public constant TIER_COUNT = 6;

    /// @dev Safety cap on bond rate per tier — 50% of budget. Any owner
    ///      setter call above this reverts; protects against an owner-key
    ///      compromise from setting punitive bond rates.
    uint16 public constant MAX_BOND_BPS = 5000;

    /// @dev Sentinel for "tier is refused" (no bondable rate). Watch and
    ///      Inactive default to this. Stored as 0 bps so requiredBond()
    ///      returns 0 and postBond() reverts on the BOND_TIER_NOT_BONDABLE
    ///      check below.
    uint16 public constant BOND_BPS_REFUSED = 0;

    /// @dev Per-tier bond rate in basis points. Initial values set in the
    ///      constructor. Owner-settable per tier via setBondBpsForTier().
    uint16[TIER_COUNT] public bondBpsByTier;

    struct Bond {
        address poster;   // agent who locked the collateral
        address client;   // human poster who gets paid on slash
        uint256 amount;   // USDC locked (6 decimals)
        uint8 status;     // BOND_*
    }

    mapping(uint256 => Bond) public bonds;

    // ----- Events --------------------------------------------------------

    event BondPosted(
        uint256 indexed jobId,
        address indexed poster,
        address indexed client,
        uint256 amount,
        uint256 agentId,
        uint8 tier,
        uint8 score
    );
    event BondReleased(uint256 indexed jobId, address indexed to, uint256 amount);
    event BondSlashed(uint256 indexed jobId, address indexed to, uint256 amount);
    event BondBpsByTierUpdated(uint8 tier, uint16 previousBps, uint16 newBps, uint256 timestamp);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    // ----- Constructor ---------------------------------------------------

    constructor(
        address verifier_,
        address agenticCommerce_,
        address usdc_,
        address ratingGateway_,
        address owner_
    ) {
        require(verifier_ != address(0), "Zero verifier");
        require(agenticCommerce_ != address(0), "Zero agenticCommerce");
        require(usdc_ != address(0), "Zero usdc");
        require(ratingGateway_ != address(0), "Zero ratingGateway");
        require(owner_ != address(0), "Zero owner");
        verifier = RatingVerifier(verifier_);
        agenticCommerce = IERC8183(agenticCommerce_);
        usdc = IERC20(usdc_);
        ratingGateway = ratingGateway_;
        owner = owner_;

        // Initial bond table (methodology v2.0 launch values).
        // Established: 0.5%, Proven: 1.5%, Emerging: 5%, Provisional: 15%.
        // Watch + Inactive default to BOND_BPS_REFUSED (0 → not bondable).
        bondBpsByTier[TIER_ESTABLISHED] = 50;
        bondBpsByTier[TIER_PROVEN] = 150;
        bondBpsByTier[TIER_EMERGING] = 500;
        bondBpsByTier[TIER_PROVISIONAL] = 1500;
        bondBpsByTier[TIER_WATCH] = BOND_BPS_REFUSED;
        bondBpsByTier[TIER_INACTIVE] = BOND_BPS_REFUSED;
    }

    // ----- Views ---------------------------------------------------------

    /// @notice Pure formula. Useful for UIs to preview the bond size before
    ///         the user commits the wallet popup. Returns 0 for refused
    ///         tiers; postBond() reverts on those.
    function requiredBond(uint256 budget, uint8 tier) public view returns (uint256) {
        require(tier < TIER_COUNT, "Invalid tier");
        return (budget * uint256(bondBpsByTier[tier])) / 10_000;
    }

    /// @notice Returns the full v2.0 bond table for UI rendering.
    function bondTable() external view returns (uint16[TIER_COUNT] memory) {
        return bondBpsByTier;
    }

    // ----- Core ----------------------------------------------------------

    /// @notice Agent calls this with a fresh attestation of their own rating
    ///         and a wallet that already approved the bond amount to this
    ///         contract. The agent must be the provider on the on-chain job.
    function postBond(
        uint256 jobId,
        RatingVerifier.RatingAttestation calldata att,
        bytes calldata signature
    ) external {
        require(bonds[jobId].poster == address(0), "Bond already posted");
        require(msg.sender == att.agentAddress, "Caller must be agent");
        require(att.tier < TIER_COUNT, "Invalid tier ordinal");

        // Verify the attestation. Domain, signer, methodology, nonce, expiry
        // are all checked by the verifier. Pass max tier ordinal (Inactive=5)
        // and 0 mask — the escrow doesn't gate on tier; it just prices the
        // bond. Bondability is enforced by the BOND_BPS_REFUSED check below.
        verifier.requireMinRating(att, signature, TIER_INACTIVE, 0);

        // Read on-chain job truth.
        (
            ,
            address jobClient,
            address provider,
            ,
            ,
            uint256 budget,
            ,
            uint8 status,

        ) = agenticCommerce.getJob(jobId);
        require(provider == msg.sender, "Not provider for job");
        require(budget > 0, "Budget not set");
        require(status <= STATUS_FUNDED, "Job past funded");

        // v2.0 only supports gated jobs.
        require(jobClient == ratingGateway, "Not a gated job");
        address realPoster = IRatingGatewayJobPoster(ratingGateway).jobPoster(jobId);
        require(realPoster != address(0), "Unknown poster");

        // Refused tier → bps is 0 → revert with a clear message.
        require(bondBpsByTier[att.tier] > 0, "Tier not bondable");

        uint256 amount = requiredBond(budget, att.tier);
        require(amount > 0, "Bond is zero");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Bond transfer failed");

        bonds[jobId] = Bond({
            poster: msg.sender,
            client: realPoster,
            amount: amount,
            status: BOND_ACTIVE
        });

        emit BondPosted(jobId, msg.sender, realPoster, amount, att.agentId, att.tier, att.score);
    }

    /// @notice Permissionless. Returns the bond to the agent if the
    ///         underlying job reached Completed on ERC-8183.
    function release(uint256 jobId) external {
        Bond storage bond = bonds[jobId];
        require(bond.poster != address(0), "No bond");
        require(bond.status == BOND_ACTIVE, "Bond not active");

        (, , , , , , , uint8 status, ) = agenticCommerce.getJob(jobId);
        require(status == STATUS_COMPLETED, "Job not completed");

        bond.status = BOND_RELEASED;
        uint256 amount = bond.amount;
        require(usdc.transfer(bond.poster, amount), "Release failed");
        emit BondReleased(jobId, bond.poster, amount);
    }

    /// @notice Permissionless. Slashes the bond to the original poster if the
    ///         underlying job reached Rejected or Expired on ERC-8183.
    function slash(uint256 jobId) external {
        Bond storage bond = bonds[jobId];
        require(bond.poster != address(0), "No bond");
        require(bond.status == BOND_ACTIVE, "Bond not active");

        (, , , , , , , uint8 status, ) = agenticCommerce.getJob(jobId);
        require(status == STATUS_REJECTED || status == STATUS_EXPIRED, "Job not slashable");

        bond.status = BOND_SLASHED;
        uint256 amount = bond.amount;
        require(usdc.transfer(bond.client, amount), "Slash failed");
        emit BondSlashed(jobId, bond.client, amount);
    }

    // ----- Admin ---------------------------------------------------------

    /// @notice Update the bond rate for a single tier.
    /// @dev Capped at MAX_BOND_BPS (50% of budget). Material changes to the
    ///      bond table follow methodology §9 governance (30-day notice).
    function setBondBpsForTier(uint8 tier, uint16 newBps) external {
        require(msg.sender == owner, "Only owner");
        require(tier < TIER_COUNT, "Invalid tier");
        require(newBps <= MAX_BOND_BPS, "Bond rate too high");
        uint16 previous = bondBpsByTier[tier];
        bondBpsByTier[tier] = newBps;
        emit BondBpsByTierUpdated(tier, previous, newBps, block.timestamp);
    }

    function transferOwner(address newOwner) external {
        require(msg.sender == owner, "Only owner");
        require(newOwner != address(0), "Zero owner");
        address previous = owner;
        owner = newOwner;
        emit OwnerTransferred(previous, newOwner);
    }
}
