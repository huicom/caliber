// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {IERC20} from "./interfaces/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev The deployed Arc AgenticCommerce returns getJob() as a single struct
///      (tuple), NOT as 9 flat values — these ABI-encode differently. We declare
///      the struct form here so the on-chain decode matches the real contract.
///      (The shared IERC8183.sol uses the flat form for CaliberEscrow; we keep a
///      local interface rather than change that and disturb the v2.0.1 contracts.)
interface IAgenticCommerceJobs {
    struct Job {
        uint256 id;
        address client;
        address provider;
        address evaluator;
        string description;
        uint256 budget;
        uint256 expiredAt;
        uint8 status;
        address hook;
    }

    function getJob(uint256 jobId) external view returns (Job memory);
}

/// @title BrokerBond — performance bonds posted by the Caliber Labs Broker
/// @notice Lepton-only, purely additive. The Broker is a reference *consumer*
///         of Caliber (a matchmaker agent), NOT part of rating issuance —
///         Caliber rates; this product consumes ratings. The Broker posts a
///         USDC bond per match, sized OFF-CHAIN by the matched provider's
///         Caliber tier. The bond returns to the broker if the underlying
///         ERC-8183 job completes, and slashes to the requester if the job is
///         rejected or expires.
///
///         Resolution is PERMISSIONLESS: anyone can call release()/slash()
///         once the on-chain job state is terminal, so no trusted operator is
///         required to honor the outcome. The owner can only pause NEW bonds;
///         it can never move or seize bonded funds.
contract BrokerBond is ReentrancyGuard {
    IAgenticCommerceJobs public immutable agenticCommerce;
    IERC20 public immutable usdc;
    address public owner;
    /// @dev Pauses postBond() only. release()/slash() are always permitted so
    ///      a pause can never trap funds.
    bool public paused;

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

    struct Bond {
        uint256 jobId;
        address broker;
        address requester;
        address provider;
        uint256 amount; // USDC, 6 decimals
        uint8 status; // BOND_*
    }

    uint256 public bondCount;
    mapping(uint256 => Bond) public bonds;
    /// @dev jobId => active bondId (0 = none). Prevents two live bonds on one job.
    mapping(uint256 => uint256) public bondIdForJob;

    // ----- Events --------------------------------------------------------

    event BondPosted(
        uint256 indexed bondId,
        uint256 indexed jobId,
        address indexed broker,
        address requester,
        address provider,
        uint256 amount
    );
    event BondReleased(uint256 indexed bondId, uint256 indexed jobId, address indexed to, uint256 amount);
    event BondSlashed(uint256 indexed bondId, uint256 indexed jobId, address indexed to, uint256 amount);
    event PausedSet(bool paused);
    event OwnerTransferred(address indexed previousOwner, address indexed newOwner);

    // ----- Constructor ---------------------------------------------------

    constructor(address agenticCommerce_, address usdc_, address owner_) {
        require(agenticCommerce_ != address(0), "Zero agenticCommerce");
        require(usdc_ != address(0), "Zero usdc");
        require(owner_ != address(0), "Zero owner");
        agenticCommerce = IAgenticCommerceJobs(agenticCommerce_);
        usdc = IERC20(usdc_);
        owner = owner_;
    }

    // ----- Core ----------------------------------------------------------

    /// @notice Broker posts a bond for a match. Pulls `amount` USDC from the
    ///         caller (the broker, which must have approved this contract).
    ///         Requires the job to exist, be no further than Funded, and its
    ///         on-chain provider to equal `provider`. Bond *sizing* is the
    ///         broker's off-chain decision; this only custodies the amount.
    function postBond(uint256 jobId, address requester, address provider, uint256 amount)
        external
        nonReentrant
        returns (uint256 bondId)
    {
        require(!paused, "Paused");
        require(requester != address(0), "Zero requester");
        require(provider != address(0), "Zero provider");
        require(amount > 0, "Zero amount");
        require(bondIdForJob[jobId] == 0, "Job already bonded");

        IAgenticCommerceJobs.Job memory job = agenticCommerce.getJob(jobId);
        require(job.provider != address(0), "Unknown job");
        require(job.provider == provider, "Provider mismatch");
        require(job.status <= STATUS_FUNDED, "Job past funded");
        require(job.budget > 0, "Job not funded");

        require(usdc.transferFrom(msg.sender, address(this), amount), "Bond transfer failed");

        bondId = ++bondCount;
        bonds[bondId] = Bond({
            jobId: jobId,
            broker: msg.sender,
            requester: requester,
            provider: provider,
            amount: amount,
            status: BOND_ACTIVE
        });
        bondIdForJob[jobId] = bondId;

        emit BondPosted(bondId, jobId, msg.sender, requester, provider, amount);
    }

    /// @notice Permissionless. Returns the bond to the broker once the
    ///         underlying job reached Completed on ERC-8183.
    function release(uint256 bondId) external nonReentrant {
        Bond storage bond = bonds[bondId];
        require(bond.broker != address(0), "No bond");
        require(bond.status == BOND_ACTIVE, "Bond not active");

        require(agenticCommerce.getJob(bond.jobId).status == STATUS_COMPLETED, "Job not completed");

        bond.status = BOND_RELEASED;
        uint256 amount = bond.amount;
        require(usdc.transfer(bond.broker, amount), "Release failed");
        emit BondReleased(bondId, bond.jobId, bond.broker, amount);
    }

    /// @notice Permissionless. Slashes the bond to the requester once the
    ///         underlying job reached Rejected or Expired on ERC-8183.
    function slash(uint256 bondId) external nonReentrant {
        Bond storage bond = bonds[bondId];
        require(bond.broker != address(0), "No bond");
        require(bond.status == BOND_ACTIVE, "Bond not active");

        uint8 status = agenticCommerce.getJob(bond.jobId).status;
        require(status == STATUS_REJECTED || status == STATUS_EXPIRED, "Job not slashable");

        bond.status = BOND_SLASHED;
        uint256 amount = bond.amount;
        require(usdc.transfer(bond.requester, amount), "Slash failed");
        emit BondSlashed(bondId, bond.jobId, bond.requester, amount);
    }

    // ----- Views ---------------------------------------------------------

    function getBond(uint256 bondId) external view returns (Bond memory) {
        return bonds[bondId];
    }

    // ----- Admin (pause new bonds only; never touches bonded funds) ------

    function setPaused(bool paused_) external {
        require(msg.sender == owner, "Only owner");
        paused = paused_;
        emit PausedSet(paused_);
    }

    function transferOwner(address newOwner) external {
        require(msg.sender == owner, "Only owner");
        require(newOwner != address(0), "Zero owner");
        emit OwnerTransferred(owner, newOwner);
        owner = newOwner;
    }
}
