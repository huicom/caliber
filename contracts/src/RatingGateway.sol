// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {RatingVerifier} from "./RatingVerifier.sol";
import {IERC8183} from "./interfaces/IERC8183.sol";
import {IERC20} from "./interfaces/IERC20.sol";

contract RatingGateway {
    RatingVerifier public immutable verifier;
    IERC8183 public immutable agenticCommerce;
    IERC20 public immutable usdc;

    mapping(uint256 => address) public jobPoster;

    event JobPostedWithRating(
        uint256 indexed jobId,
        address indexed poster,
        uint256 agentId,
        uint8 tier,
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

    function postGatedJob(
        address provider,
        address evaluator,
        uint256 expiredAt,
        string calldata description,
        uint256 budget,
        RatingVerifier.RatingAttestation calldata att,
        bytes calldata signature,
        uint8 maxTierAllowed,
        uint8 minConfidenceAllowed
    ) external returns (uint256 jobId) {
        verifier.requireMinRating(att, signature, maxTierAllowed, minConfidenceAllowed);
        require(provider == att.agentAddress, "Provider mismatch");

        require(usdc.transferFrom(msg.sender, address(this), budget), "USDC transfer failed");
        require(usdc.approve(address(agenticCommerce), budget), "USDC approve failed");

        jobId = agenticCommerce.createJob(provider, evaluator, expiredAt, description, address(0));
        jobPoster[jobId] = msg.sender;

        emit JobPostedWithRating(jobId, msg.sender, att.agentId, att.tier, att.methodologyVersion);
    }

    function fundJob(uint256 jobId) external {
        require(msg.sender == jobPoster[jobId], "Not poster");
        agenticCommerce.fund(jobId, "");
    }
}
