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
    bytes32 constant METHODOLOGY_VERSION = bytes32("1.0.0");
    bytes32 constant ARC_CHAIN = bytes32("arc");

    address constant PROVIDER = address(0x1000);
    address constant USER = address(0x2000);
    address constant EVALUATOR = address(0x3000);

    bytes32 constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 constant RATING_ATTESTATION_TYPEHASH = keccak256(
        "RatingAttestation(bytes32 chain,uint256 agentId,address agentAddress,uint8 tier,uint16 pdBps,uint16 lgdBps,uint8 confidence,bytes32 methodologyVersion,uint64 asOf,uint64 validUntil,uint256 nonce)"
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
        uint8 confidence,
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
            pdBps: 150,
            lgdBps: 3000,
            confidence: confidence,
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
                att.pdBps,
                att.lgdBps,
                att.confidence,
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

    function _buildValidAttest(uint8 tier, uint8 confidence) internal view returns (RatingVerifier.RatingAttestation memory att, bytes memory sig) {
        att = _buildAttest(tier, confidence, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1);
        sig = _signAttest(att);
    }

    // TEST 1: Valid attestation accepted
    function test_ValidAttestationAccepted() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 2: Tier too low rejected
    function test_Revert_TierTooLow() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(4, 1);
        vm.expectRevert("Rating too low");
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 3: Confidence too low rejected
    function test_Revert_ConfidenceTooLow() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 2);
        vm.expectRevert("Confidence too low");
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 4: Expired attestation rejected
    function test_Revert_AttestationExpired() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(3, 1, uint64(block.timestamp - 1), METHODOLOGY_VERSION, PROVIDER, 1);
        bytes memory sig = _signAttest(att);
        vm.expectRevert("Attestation expired");
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 5: Wrong methodology version rejected
    function test_Revert_WrongMethodologyVersion() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(3, 1, uint64(block.timestamp + 1 hours), bytes32("2.0.0"), PROVIDER, 1);
        bytes memory sig = _signAttest(att);
        vm.expectRevert("Wrong methodology version");
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 6: Wrong agentAddress rejected
    function test_Revert_ProviderMismatch() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        vm.expectRevert("Provider mismatch");
        gateway.postGatedJob(address(0xBAD), EVALUATOR, block.timestamp + 7 days, "test job", 100e18, att, sig, 3, 1);
    }

    // TEST 7: Wrong signer rejected
    function test_Revert_WrongSigner() public {
        RatingVerifier.RatingAttestation memory att = _buildAttest(3, 1, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1);
        uint256 badKey = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;
        bytes32 domainSeparator = _computeDomainSeparator();
        bytes32 structHash = _computeStructHash(att);
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(badKey, digest);
        bytes memory badSig = abi.encodePacked(r, s, v);
        vm.expectRevert("Invalid signer");
        verifier.requireMinRating(att, badSig, 3, 1);
    }

    // TEST 8: Nonce replay rejected
    function test_Revert_NonceReplay() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        verifier.requireMinRating(att, sig, 3, 1);
        vm.expectRevert("Nonce replay");
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 9: Happy path — full postGatedJob flow
    function test_HappyPath_PostGatedJob() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(PROVIDER, EVALUATOR, block.timestamp + 7 days, "test job", 100e18, att, sig, 3, 1);

        assertEq(jobId, 1);
        assertEq(gateway.jobPoster(jobId), USER);

        // verify ERC8183 state
        (uint256 id, address client, address provider, , , uint256 budget, , uint8 status, ) = erc8183.getJob(jobId);
        assertEq(id, jobId);
        assertEq(client, address(gateway));
        assertEq(provider, PROVIDER);
        assertEq(status, 0); // Open
        assertEq(budget, 0); // budget not set yet

        // verify USDC moved
        assertEq(usdc.balances(address(gateway)), 100e18);
    }

    // TEST 10: fundJob after postGatedJob
    function test_FundJob() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(PROVIDER, EVALUATOR, block.timestamp + 7 days, "test job", 100e18, att, sig, 3, 1);

        // agent sets budget
        vm.prank(PROVIDER);
        erc8183.setBudget(jobId, 100e18, "");

        // poster funds
        vm.prank(USER);
        gateway.fundJob(jobId);

        (, , , , , , , uint8 status, ) = erc8183.getJob(jobId);
        assertEq(status, 1); // Funded
        assertTrue(erc8183.fundedCalled(jobId, address(gateway)));
    }

    // TEST 11: Only poster can fund
    function test_Revert_NotPosterCanFund() public {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _buildValidAttest(3, 1);
        vm.prank(USER);
        uint256 jobId = gateway.postGatedJob(PROVIDER, EVALUATOR, block.timestamp + 7 days, "test job", 100e18, att, sig, 3, 1);

        vm.prank(address(0xB0B));
        vm.expectRevert("Not poster");
        gateway.fundJob(jobId);
    }

    // TEST 12: Methodology version transition (previous version accepted)
    function test_MethodologyVersionTransition() public {
        // Update to new version
        vm.prank(SIGNER_ADDR);
        verifier.setMethodologyVersion(bytes32("1.1.0"));

        // Old version should be accepted
        RatingVerifier.RatingAttestation memory att = _buildAttest(3, 1, uint64(block.timestamp + 1 hours), METHODOLOGY_VERSION, PROVIDER, 1);
        bytes memory sig = _signAttest(att);
        verifier.requireMinRating(att, sig, 3, 1); // should not revert

        // New version should also be accepted
        att = _buildAttest(3, 1, uint64(block.timestamp + 1 hours), bytes32("1.1.0"), PROVIDER, 2);
        sig = _signAttest(att);
        verifier.requireMinRating(att, sig, 3, 1);
    }

    // TEST 13: Only signer can update methodology version
    function test_Revert_OnlySignerCanUpdateVersion() public {
        vm.prank(address(0xB0B));
        vm.expectRevert("Only signer");
        verifier.setMethodologyVersion(bytes32("1.1.0"));
    }
}
