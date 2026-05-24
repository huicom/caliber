// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {RatingVerifier} from "../src/RatingVerifier.sol";
import {RatingGateway} from "../src/RatingGateway.sol";
import {CaliberEscrow} from "../src/CaliberEscrow.sol";
import {MockERC20, MockERC8183} from "./mocks/Mocks.sol";

contract CaliberEscrowTest is Test {
    RatingVerifier public verifier;
    RatingGateway public gateway;
    CaliberEscrow public escrow;
    MockERC20 public usdc;
    MockERC8183 public erc8183;

    // Anvil/Foundry default test key (account #0). Public, deterministic,
    // universally used for local testing. Never send real funds to this address.
    uint256 constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SIGNER_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    bytes32 constant METHODOLOGY_VERSION = bytes32("2.0.0");
    bytes32 constant ARC_CHAIN = bytes32("arc");

    uint8 constant TIER_ESTABLISHED = 0;
    uint8 constant TIER_PROVEN = 1;
    uint8 constant TIER_EMERGING = 2;
    uint8 constant TIER_PROVISIONAL = 3;
    uint8 constant TIER_WATCH = 4;
    uint8 constant TIER_INACTIVE = 5;

    address constant CLIENT = address(0x4000);
    address constant PROVIDER = address(0x5000);
    address constant EVALUATOR = address(0x6000);

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
        escrow = new CaliberEscrow(
            address(verifier),
            address(erc8183),
            address(usdc),
            address(gateway),
            SIGNER_ADDR
        );

        usdc.setBalance(CLIENT, 1_000_000_000);
        vm.prank(CLIENT);
        usdc.approve(address(gateway), 1_000_000_000);
    }

    // ----- helpers ------------------------------------------------------

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Caliber")),
                keccak256(bytes("1")),
                block.chainid,
                address(verifier)
            )
        );
    }

    function _structHash(RatingVerifier.RatingAttestation memory att) internal pure returns (bytes32) {
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

    function _sign(RatingVerifier.RatingAttestation memory att) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), _structHash(att)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attest(uint8 tier, uint8 score, uint8 flags, uint256 nonce)
        internal
        view
        returns (RatingVerifier.RatingAttestation memory att, bytes memory sig)
    {
        att = RatingVerifier.RatingAttestation({
            chain: ARC_CHAIN,
            agentId: 42,
            agentAddress: PROVIDER,
            tier: tier,
            score: score,
            interactionCount: 50,
            flags: flags,
            methodologyVersion: METHODOLOGY_VERSION,
            asOf: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
        sig = _sign(att);
    }

    /// Walk a job through: gated post → set budget → fund. Returns jobId.
    function _gatedFundedJob(uint256 budget, uint8 gateAttestTier) internal returns (uint256 jobId) {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(gateAttestTier, 75, 0, 1);
        vm.prank(CLIENT);
        jobId = gateway.postGatedJob(
            PROVIDER, EVALUATOR, block.timestamp + 7 days, "test", budget, att, sig, TIER_PROVISIONAL, 0
        );
        vm.prank(PROVIDER);
        erc8183.setBudget(jobId, budget, "");
        vm.prank(CLIENT);
        gateway.fundJob(jobId);
    }

    // ============================================================
    // requiredBond formula (tier-stepped)
    // ============================================================

    function test_RequiredBond_Established_50bps() public view {
        // 1000 USDC × 0.5% = 5 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, TIER_ESTABLISHED);
        assertEq(bond, 5_000_000);
    }

    function test_RequiredBond_Proven_150bps() public view {
        // 1000 × 1.5% = 15 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, TIER_PROVEN);
        assertEq(bond, 15_000_000);
    }

    function test_RequiredBond_Emerging_500bps() public view {
        // 1000 × 5% = 50 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, TIER_EMERGING);
        assertEq(bond, 50_000_000);
    }

    function test_RequiredBond_Provisional_1500bps() public view {
        // 1000 × 15% = 150 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, TIER_PROVISIONAL);
        assertEq(bond, 150_000_000);
    }

    function test_RequiredBond_Watch_returns_0() public view {
        assertEq(escrow.requiredBond(1_000_000_000, TIER_WATCH), 0);
    }

    function test_RequiredBond_Inactive_returns_0() public view {
        assertEq(escrow.requiredBond(1_000_000_000, TIER_INACTIVE), 0);
    }

    // ============================================================
    // postBond
    // ============================================================

    function test_PostBond_HappyPath_Established() public {
        uint256 budget = 1_000_000_000;
        uint256 jobId = _gatedFundedJob(budget, TIER_ESTABLISHED);
        uint256 expectedBond = escrow.requiredBond(budget, TIER_ESTABLISHED);

        usdc.setBalance(PROVIDER, expectedBond);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), expectedBond);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_ESTABLISHED, 85, 0, 2);

        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        (address poster, address client, uint256 amount, uint8 status) = escrow.bonds(jobId);
        assertEq(poster, PROVIDER);
        assertEq(client, CLIENT);
        assertEq(amount, expectedBond);
        assertEq(status, 0);
        assertEq(usdc.balanceOf(address(escrow)), expectedBond);
    }

    function test_Revert_PostBond_Watch_NotBondable() public {
        // Realistic scenario: agent passed the gate as Proven, but their
        // tier dropped to Watch by the time they tried to post bond.
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_WATCH, 50, 0, 2);
        vm.prank(PROVIDER);
        vm.expectRevert("Tier not bondable");
        escrow.postBond(jobId, att, sig);
    }

    function test_Revert_PostBond_Inactive_NotBondable() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_INACTIVE, 0, 0, 2);
        vm.prank(PROVIDER);
        vm.expectRevert("Tier not bondable");
        escrow.postBond(jobId, att, sig);
    }

    function test_Revert_PostBond_NotProvider() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_PROVEN, 70, 0, 2);
        address impostor = address(0xB0B);
        usdc.setBalance(impostor, 100e18);
        vm.prank(impostor);
        usdc.approve(address(escrow), 100e18);
        vm.prank(impostor);
        vm.expectRevert("Caller must be agent");
        escrow.postBond(jobId, att, sig);
    }

    function test_Revert_PostBond_Duplicate() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, TIER_PROVEN);
        usdc.setBalance(PROVIDER, bondAmt * 2);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt * 2);

        (RatingVerifier.RatingAttestation memory a1, bytes memory s1) = _attest(TIER_PROVEN, 70, 0, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, a1, s1);

        (RatingVerifier.RatingAttestation memory a2, bytes memory s2) = _attest(TIER_PROVEN, 70, 0, 3);
        vm.prank(PROVIDER);
        vm.expectRevert("Bond already posted");
        escrow.postBond(jobId, a2, s2);
    }

    // ============================================================
    // release + slash lifecycle
    // ============================================================

    function test_Release_HappyPath() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, TIER_PROVEN);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_PROVEN, 70, 0, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_COMPLETED());

        uint256 providerBalBefore = usdc.balanceOf(PROVIDER);
        vm.prank(address(0xCAFE));
        escrow.release(jobId);
        assertEq(usdc.balanceOf(PROVIDER), providerBalBefore + bondAmt);
        (, , , uint8 status) = escrow.bonds(jobId);
        assertEq(status, 1);
    }

    function test_Slash_OnRejected() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, TIER_PROVEN);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_PROVEN, 70, 0, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_REJECTED());

        uint256 clientBalBefore = usdc.balanceOf(CLIENT);
        vm.prank(address(0xCAFE));
        escrow.slash(jobId);
        assertEq(usdc.balanceOf(CLIENT), clientBalBefore + bondAmt);
        (, , , uint8 status) = escrow.bonds(jobId);
        assertEq(status, 2);
    }

    function test_Revert_DoubleRelease() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000, TIER_PROVEN);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, TIER_PROVEN);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(TIER_PROVEN, 70, 0, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_COMPLETED());
        escrow.release(jobId);

        vm.expectRevert("Bond not active");
        escrow.release(jobId);
    }

    // ============================================================
    // Configurable bond table (owner-only setter)
    // ============================================================

    function test_SetBondBpsForTier_OwnerCanChange() public {
        vm.prank(SIGNER_ADDR);
        escrow.setBondBpsForTier(TIER_PROVEN, 200);
        assertEq(escrow.bondBpsByTier(TIER_PROVEN), 200);
        // requiredBond reflects the new rate
        assertEq(escrow.requiredBond(1_000_000_000, TIER_PROVEN), 20_000_000);
    }

    function test_Revert_SetBondBps_NotOwner() public {
        vm.prank(address(0xB0B));
        vm.expectRevert("Only owner");
        escrow.setBondBpsForTier(TIER_PROVEN, 200);
    }

    function test_Revert_SetBondBps_AboveCap() public {
        // Cap is MAX_BOND_BPS (5000 = 50%). Anything above reverts.
        vm.prank(SIGNER_ADDR);
        vm.expectRevert("Bond rate too high");
        escrow.setBondBpsForTier(TIER_PROVEN, 5001);
    }

    function test_Revert_SetBondBps_InvalidTier() public {
        vm.prank(SIGNER_ADDR);
        vm.expectRevert("Invalid tier");
        escrow.setBondBpsForTier(99, 100);
    }

    function test_OwnerCanEnableWatchBondability() public {
        // Owner unrefuses Watch by setting a non-zero rate. Useful for ops.
        vm.prank(SIGNER_ADDR);
        escrow.setBondBpsForTier(TIER_WATCH, 2500); // 25%
        assertEq(escrow.requiredBond(1_000_000_000, TIER_WATCH), 250_000_000);
    }

    function test_OwnerTransfer() public {
        address newOwner = address(0xC0FFEE);
        vm.prank(SIGNER_ADDR);
        escrow.transferOwner(newOwner);
        assertEq(escrow.owner(), newOwner);
        // Old owner can no longer set rates
        vm.prank(SIGNER_ADDR);
        vm.expectRevert("Only owner");
        escrow.setBondBpsForTier(TIER_PROVEN, 200);
    }
}
