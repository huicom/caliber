// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RatingVerifier} from "./RatingVerifier.sol";
import {IERC8183} from "./interfaces/IERC8183.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @dev Minimal interface to RatingGateway.jobPoster(). CaliberEscrow only
/// supports gated jobs in v0; non-gated AgenticCommerce jobs (where
/// client = the human poster) are out of scope and not bondable here.
interface IRatingGatewayJobPoster {
    function jobPoster(uint256 jobId) external view returns (address);
}

/// @title CaliberEscrow — performance bonds priced by Caliber rating
/// @notice An agent posts a bond proportional to its own performance-default
///         risk (`bond = budget × PD × LGD`). The bond is released on job
///         completion or slashed to the original poster on rejection/expiry.
///         Permissionless release/slash — the contract reads ERC-8183 truth.
contract CaliberEscrow {
    RatingVerifier public immutable verifier;
    IERC8183 public immutable agenticCommerce;
    IERC20 public immutable usdc;
    address public immutable ratingGateway;

    // Status codes mirror the ERC-8183 reference implementation used on Arc.
    uint8 public constant STATUS_OPEN = 0;
    uint8 public constant STATUS_FUNDED = 1;
    uint8 public constant STATUS_SUBMITTED = 2;
    uint8 public constant STATUS_COMPLETED = 3;
    uint8 public constant STATUS_REJECTED = 4;
    uint8 public constant STATUS_EXPIRED = 5;

    uint8 public constant BOND_ACTIVE = 0;
    uint8 public constant BOND_RELEASED = 1;
    uint8 public constant BOND_SLASHED = 2;

    // bond = budget × pdBps × lgdBps / (10_000 × 10_000)
    uint256 public constant BPS_SQUARED = 100_000_000;

    // At-most-permissive bounds when calling verifier.requireMinRating().
    // The escrow contract itself doesn't enforce a tier/confidence threshold
    // — that's the gateway's job for the underlying job. The bond just needs
    // valid signature + fresh attestation + correct methodology.
    uint8 private constant TIER_ANY = 8;        // Caliber-D
    uint8 private constant CONFIDENCE_ANY = 2;  // low

    struct Bond {
        address poster;   // agent who locked collateral (msg.sender at postBond)
        address client;   // human poster who gets paid on slash
        uint256 amount;   // USDC locked (6 decimals)
        uint8 status;     // BOND_*
    }

    mapping(uint256 => Bond) public bonds;

    event BondPosted(
        uint256 indexed jobId,
        address indexed poster,
        address indexed client,
        uint256 amount,
        uint256 agentId,
        uint8 tier,
        uint16 pdBps,
        uint16 lgdBps
    );
    event BondReleased(uint256 indexed jobId, address indexed to, uint256 amount);
    event BondSlashed(uint256 indexed jobId, address indexed to, uint256 amount);

    constructor(
        address verifier_,
        address agenticCommerce_,
        address usdc_,
        address ratingGateway_
    ) {
        require(verifier_ != address(0), "Zero verifier");
        require(agenticCommerce_ != address(0), "Zero agenticCommerce");
        require(usdc_ != address(0), "Zero usdc");
        require(ratingGateway_ != address(0), "Zero ratingGateway");
        verifier = RatingVerifier(verifier_);
        agenticCommerce = IERC8183(agenticCommerce_);
        usdc = IERC20(usdc_);
        ratingGateway = ratingGateway_;
    }

    /// @notice Pure formula. Useful for UIs to preview the bond size before
    ///         the user commits the wallet popup.
    function requiredBond(uint256 budget, uint16 pdBps, uint16 lgdBps)
        public
        pure
        returns (uint256)
    {
        return budget * uint256(pdBps) * uint256(lgdBps) / BPS_SQUARED;
    }

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

        // Verify the attestation. Domain, signer, methodology, nonce, expiry
        // are all checked by the verifier. We pass TIER_ANY / CONFIDENCE_ANY
        // because the escrow doesn't gate on tier — it just prices the bond.
        verifier.requireMinRating(att, signature, TIER_ANY, CONFIDENCE_ANY);

        // Read on-chain job truth. The provider must match the attesting
        // agent, the budget must be set, and the job must not be past funded.
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

        // v0 only supports gated jobs — the human poster is recorded on the
        // RatingGateway. Non-gated jobs (client = some EOA, not the gateway)
        // are not bondable here.
        require(jobClient == ratingGateway, "Not a gated job");
        address realPoster = IRatingGatewayJobPoster(ratingGateway).jobPoster(jobId);
        require(realPoster != address(0), "Unknown poster");

        uint256 amount = requiredBond(budget, att.pdBps, att.lgdBps);
        require(amount > 0, "Bond is zero");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Bond transfer failed");

        bonds[jobId] = Bond({
            poster: msg.sender,
            client: realPoster,
            amount: amount,
            status: BOND_ACTIVE
        });

        emit BondPosted(jobId, msg.sender, realPoster, amount, att.agentId, att.tier, att.pdBps, att.lgdBps);
    }

    /// @notice Permissionless. Returns the bond to the agent if the underlying
    ///         job reached the Completed state on ERC-8183.
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
}
