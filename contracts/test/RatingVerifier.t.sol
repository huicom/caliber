// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {RatingVerifier} from "../src/RatingVerifier.sol";
import {RatingGateway} from "../src/RatingGateway.sol";
import {MockERC20, MockERC8183} from "./mocks/Mocks.sol";

contract RatingVerifierTest is Test {
    RatingVerifier public verifier;
    RatingGateway public gateway;
    MockERC20 public usdc;
    MockERC8183 public erc8183;

    uint256 constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SIGNER_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    bytes32 constant METHODOLOGY_VERSION = bytes32("2.0.0");
    bytes32 constant ARC_CHAIN = bytes32("arc");

    // Tier ordinals (mirror engine TIER_ORDINAL)
    uint8 constant TIER_ESTABLISHED = 0;
    uint8 constant TIER_PROVEN = 1;
    uint8 constant TIER_EMERGING = 2;
    uint8 constant TIER_PROVISIONAL = 3;
    uint8 constant TIER_WATCH = 4;
    uint8 constant TIER_INACTIVE = 5;

    // Flag bits
    uint8 constant FLAG_CP_CONC = 0x01;
    uint8 constant FLAG_VAL_CONC = 0x02;
    uint8 constant FLAG_SYBIL = 0x04;
    uint8 constant FLAG_VOLUME = 0x08;
    uint8 constant FLAG_DORMANCY = 0x10;
    uint8 constant FLAG_MASK_ALL = 0x1F;

    address constant PROVIDER = address(0x1000);
    address constant USER = address(0x2000);
    address constant EVALUATOR = address(0x3000);

    bytes32 constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 constant RATING_ATTESTATION_TYPEHASH = keccak256(
        "RatingAttestation(bytes32 chain,uint256 agentId,address agentAddress,uint8 tier,uint8 score,uint16 interactionCount,uint8 flags,bytes32 methodologyVersion,uint64 asOf,uint64 validUntil,uint256 nonce)"
    );

    function setUp() public {
        verifier = new RatingVerifier(SIGNER_ADDR, METHODOLOGY_VERSION);
        usdc = new MockERC20();
        erc8183 = new MockERC8183();
        gateway = new RatingGateway(address(verifier), address(erc8183), address(usdc));

        usdc.setBalance(USER, 1000e18);
        vm.prank(USER);
        usdc.approve(address(gateway), 1000e18);
    }

    function _buildAttest(
        uint8 tier,
        uint8 score,
        uint8 flags,
        uint64 validUntil,
        bytes32 methodologyVersion,
        address agentAddress,
        uint256 nonce
    ) internal view returns (RatingVerifier.RatingAttestation memory) {
        return RatingVerifier.RatingAttestation({
            chain: ARC_CHAIN,
            agentId: 42,
            agentAddress: agentAddress,
            tier: tier,
            score: score,
            interactionCount: 50,
            flags: flags,
            methodologyVersion: methodologyVersion,
            asOf: uint64(block.timestamp),
            validUntil: validUntil,
            nonce: nonce
        });
    }

    function _computeDomainSeparator() internal view returns (bytes32) {
        bytes32 nameHash = keccak256(bytes("Caliber"));
        bytes32 versionHash = keccak256(bytes("1"));
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                nameHash,
                versionHash,
                block.chainid,
                address(verifier)
            )
        );
    }

    function _computeStructHash(RatingVerifier.RatingAttestation memory att) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                RATING_ATTESTATION_TYPEHASH,
                att.chain,
                att.agentId,
                att.agentAddress,
                att.tier,
                att.score,
                att.interactionCount,
                att.flags,
                att.methodologyVersion,
                att.asOf,
                att.validUntil,
                att.nonce
            )
        );
    }

    function _signAttest(RatingVerifier.RatingAttestation memory att) internal view returns (bytes memory) {
        bytes32 domainSeparator = _computeDomainSeparator();
        bytes32 structHash = _computeStructHash(att);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _buildValidAttest(uint8 tier, uint8 score, uint8 flags)
        internal
        view
        returns (RatingVerifier.RatingAttestation memory att, bytes memory sig)
    {
        att = _buildAttest(tier, score, flags, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1);
        sig = _signAttest(att);
    }

    // ============================================================
    // Acceptance tests
    // ============================================================

    function test_ValidAttestationAccepted() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_EMERGING, 60, 0);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_AcceptsStrongerTierThanThreshold() public {
        // Caller will accept ≤ Emerging. Agent is Proven (stronger). Pass.
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    // ============================================================
    // Rejection tests
    // ============================================================

    function test_Revert_TierTooWeak() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVISIONAL, 40, 0);
        vm.expectRevert("Tier too weak");
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_Revert_BlockingFlagSet() public {
        // Caller refuses anything with the Dormancy flag; agent has it.
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) =
            _buildValidAttest(TIER_PROVEN, 70, FLAG_DORMANCY);
        vm.expectRevert("Blocking flag set");
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_DORMANCY);
    }

    function test_FlagPassesIfNotInMask() public {
        // Agent has Volume flag; caller's mask only blocks Dormancy. Pass.
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) =
            _buildValidAttest(TIER_PROVEN, 70, FLAG_VOLUME);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_DORMANCY);
    }

    function test_Revert_AttestationExpired() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(
            TIER_PROVEN, 70, 0, uint64(block.timestamp - 1), METHODOLOGY_VERSION, PROVIDER, 1
        );
        bytes memory sig = _signAttest(att);
        vm.expectRevert("Attestation expired");
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_Revert_WrongMethodologyVersion() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(
            TIER_PROVEN, 70, 0, uint64(block.timestamp + 1 hours), bytes32("3.0.0"), PROVIDER, 1
        );
        bytes memory sig = _signAttest(att);
        vm.expectRevert("Wrong methodology version");
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_Revert_ProviderMismatch() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        vm.prank(USER);
        vm.expectRevert("Provider mismatch");
        gateway.postGatedJob(
            address(0xBAD), EVALUATOR, block.timestamp + 7 days, "test", 100e18, att, sig, TIER_PROVISIONAL, 0
        );
    }

    function test_Revert_WrongSigner() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(
            TIER_PROVEN, 70, 0, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1
        );
        uint256 badKey = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        bytes32 ds = _computeDomainSeparator();
        bytes32 sh = _computeStructHash(att);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ds, sh));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(badKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);
        vm.expectRevert("Invalid signer");
        verifier.requireMinRating(att, badSig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_Revert_NonceReplay() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
        vm.expectRevert("Nonce replay");
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    // ============================================================
    // Gateway integration
    // ============================================================

    function test_HappyPath_PostGatedJob() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(
            PROVIDER, EVALUATOR, block.timestamp + 7 days, "test", 100e18, att, sig, TIER_EMERGING, FLAG_MASK_ALL
        );
        assertEq(jobId, 1);
        assertEq(gateway.jobPoster(jobId), USER);
        assertEq(usdc.balances(address(gateway)), 100e18);
    }

    function test_FundJob() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(
            PROVIDER, EVALUATOR, block.timestamp + 7 days, "test", 100e18, att, sig, TIER_EMERGING, FLAG_MASK_ALL
        );
        vm.prank(PROVIDER);
        erc8183.setBudget(jobId, 100e18, "");
        vm.prank(USER);
        gateway.fundJob(jobId);
        (, , , , , , , uint8 status, ) = erc8183.getJob(jobId);
        assertEq(status, 1);
    }

    function test_Revert_NotPosterCanFund() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(TIER_PROVEN, 70, 0);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(
            PROVIDER, EVALUATOR, block.timestamp + 7 days, "test", 100e18, att, sig, TIER_EMERGING, FLAG_MASK_ALL
        );
        vm.prank(address(0xB0B));
        vm.expectRevert("Not poster");
        gateway.fundJob(jobId);
    }

    // ============================================================
    // Methodology version transition
    // ============================================================

    function test_MethodologyVersionTransition() public {
        vm.prank(SIGNER_ADDR);
        verifier.setMethodologyVersion(bytes32("2.1.0"));

        // Old version still accepted during transition
        RatingVerifier.RatingAttestation memory att = _buildAttest(
            TIER_PROVEN, 70, 0, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1
        );
        bytes memory sig = _signAttest(att);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);

        // New version also accepted
        att = _buildAttest(
            TIER_PROVEN, 70, 0, uint64(block.timestamp + 1 hours), bytes32("2.1.0"), PROVIDER, 2
        );
        sig = _signAttest(att);
        verifier.requireMinRating(att, sig, TIER_EMERGING, FLAG_MASK_ALL);
    }

    function test_Revert_OnlySignerCanUpdateVersion() public {
        vm.prank(address(0xB0B));
        vm.expectRevert("Only signer");
        verifier.setMethodologyVersion(bytes32("2.1.0"));
    }
}
