// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RatingVerifier} from "./RatingVerifier.sol";
import {IERC8183} from "./interfaces/IERC8183.sol";
import {IERC20} from "./interfaces/IERC20.sol";

/// @title RatingGateway — Caliber-gated job posting
/// @notice A thin wrapper over ERC-8183 createJob() that requires a fresh
///         Caliber Rating v2.0 attestation passing caller-supplied tier
///         and blocking-flag thresholds before any escrow movement. Posts
///         that fail the gate revert before USDC is transferred.
contract RatingGateway {
    RatingVerifier public immutable verifier;
    IERC8183 public immutable agenticCommerce;
    IERC20 public immutable usdc;

    /// @dev Tracks the true job poster (msg.sender on postGatedJob). The
    ///      on-chain ERC-8183 job lists `client = address(this)`, so
    ///      downstream contracts like CaliberEscrow need this lookup to
    ///      resolve who to slash a bond to.
    mapping(uint256 => address) public jobPoster;

    event JobPostedWithRating(
        uint256 indexed jobId,
        address indexed poster,
        uint256 agentId,
        uint8 tier,
        uint8 score,
        uint8 flags,
        bytes32 methodologyVersion
    );

    constructor(address verifier_, address agenticCommerce_, address usdc_) {
        require(verifier_ != address(0), "Zero verifier");
        require(agenticCommerce_ != address(0), "Zero agenticCommerce");
        require(usdc_ != address(0), "Zero usdc");
        verifier = RatingVerifier(verifier_);
        agenticCommerce = IERC8183(agenticCommerce_);
        usdc = IERC20(usdc_);
    }

    /// @notice Post a Caliber-gated job.
    /// @param maxTierAllowed   Weakest tier ordinal the poster will accept
    ///                         (0=Established, 5=Inactive). The verifier
    ///                         reverts if att.tier > maxTierAllowed.
    /// @param blockingFlagMask Flags that disqualify an agent (bitwise OR).
    ///                         A poster who wants to refuse any flagged
    ///                         agent passes 0x1F (all 5 flag bits).
    function postGatedJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        uint256 budget,
        RatingVerifier.RatingAttestation calldata att,
        bytes calldata signature,
        uint8 maxTierAllowed,
        uint8 blockingFlagMask
    ) external returns (uint256 jobId) {
        verifier.requireMinRating(att, signature, maxTierAllowed, blockingFlagMask);
        require(provider == att.agentAddress, "Provider mismatch");

        require(usdc.transferFrom(msg.sender, address(this), budget), "USDC transfer failed");
        require(usdc.approve(address(agenticCommerce), budget), "USDC approve failed");

        jobId = agenticCommerce.createJob(provider, evaluator, expiredAt, description, address(0));
        jobPoster[jobId] = msg.sender;

        emit JobPostedWithRating(
            jobId,
            msg.sender,
            att.agentId,
            att.tier,
            att.score,
            att.flags,
            att.methodologyVersion
        );
    }

    function fundJob(uint256 jobId) external {
        require(msg.sender == jobPoster[jobId], "Not poster");
        agenticCommerce.fund(jobId, "");
    }
}
