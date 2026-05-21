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

    uint256 constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SIGNER_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    bytes32 constant METHODOLOGY_VERSION = bytes32("1.0.0");
    bytes32 constant ARC_CHAIN = bytes32("arc");

    address constant CLIENT = address(0x4000);   // human posting jobs
    address constant PROVIDER = address(0x5000); // agent EOA
    address constant EVALUATOR = address(0x6000);

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
        escrow = new CaliberEscrow(
            address(verifier),
            address(erc8183),
            address(usdc),
            address(gateway)
        );

        // Client funds 1000 USDC and approves the gateway.
        usdc.setBalance(CLIENT, 1_000_000_000); // 1000 USDC, 6 decimals
        vm.prank(CLIENT);
        usdc.approve(address(gateway), 1_000_000_000);
    }

    /* ──────────────────────────────────────────────────────────────────────
     * Helpers
     * ────────────────────────────────────────────────────────────────────── */

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

    function _sign(RatingVerifier.RatingAttestation memory att) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), _structHash(att)));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(SIGNER_KEY, digest);
        return abi.encodePacked(r, s, v);
    }

    function _attest(uint8 tier, uint16 pdBps, uint16 lgdBps, uint256 nonce)
        internal
        view
        returns (RatingVerifier.RatingAttestation memory att, bytes memory sig)
    {
        att = RatingVerifier.RatingAttestation({
            chain: ARC_CHAIN,
            agentId: 42,
            agentAddress: PROVIDER,
            tier: tier,
            pdBps: pdBps,
            lgdBps: lgdBps,
            confidence: 1, // medium
            methodologyVersion: METHODOLOGY_VERSION,
            asOf: uint64(block.timestamp),
            validUntil: uint64(block.timestamp + 1 hours),
            nonce: nonce
        });
        sig = _sign(att);
    }

    /// Walks a job through: gated post → set budget → fund. Returns jobId.
    function _gatedFundedJob(uint256 budget) internal returns (uint256 jobId) {
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 1);
        vm.prank(CLIENT);
        jobId = gateway.postGatedJob(
            PROVIDER,
            EVALUATOR,
            block.timestamp + 7 days,
            "test",
            budget,
            att,
            sig,
            3, // maxTierAllowed (Caliber-BBB)
            1  // minConfidenceAllowed (medium)
        );
        vm.prank(PROVIDER);
        erc8183.setBudget(jobId, budget, "");
        vm.prank(CLIENT);
        gateway.fundJob(jobId);
    }

    /* ──────────────────────────────────────────────────────────────────────
     * Tests — requiredBond formula
     * ────────────────────────────────────────────────────────────────────── */

    function test_RequiredBond_AAA_Budget1000() public view {
        // PD 0.4% = 40bps, LGD 15% = 1500bps, budget 1000 USDC (6dec)
        // expected: 1_000_000_000 * 40 * 1500 / 100_000_000 = 600_000 wei = 0.6 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, 40, 1500);
        assertEq(bond, 600_000);
    }

    function test_RequiredBond_BBB_Budget1000() public view {
        // PD 4% = 400bps, LGD 30% = 3000bps, budget 1000 USDC
        // expected: 1_000_000_000 * 400 * 3000 / 100_000_000 = 12_000_000 wei = 12 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, 400, 3000);
        assertEq(bond, 12_000_000);
    }

    function test_RequiredBond_CCC_Budget1000() public view {
        // PD 30% = 3000bps, LGD 50% = 5000bps, budget 1000 USDC
        // expected: 1_000_000_000 * 3000 * 5000 / 100_000_000 = 150_000_000 wei = 150 USDC
        uint256 bond = escrow.requiredBond(1_000_000_000, 3000, 5000);
        assertEq(bond, 150_000_000);
    }

    /* ──────────────────────────────────────────────────────────────────────
     * Tests — postBond
     * ────────────────────────────────────────────────────────────────────── */

    function test_PostBond_HappyPath() public {
        uint256 budget = 1_000_000_000; // 1000 USDC
        uint256 jobId = _gatedFundedJob(budget);

        // Fund agent + approve bond
        uint256 expectedBond = escrow.requiredBond(budget, 400, 3000); // BBB
        usdc.setBalance(PROVIDER, expectedBond);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), expectedBond);

        // Fresh attestation (nonce > the one used for the job, which was 1)
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);

        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        (address poster, address client, uint256 amount, uint8 status) = escrow.bonds(jobId);
        assertEq(poster, PROVIDER);
        assertEq(client, CLIENT);
        assertEq(amount, expectedBond);
        assertEq(status, 0); // BOND_ACTIVE
        assertEq(usdc.balanceOf(address(escrow)), expectedBond);
    }

    function test_Revert_PostBond_NotProvider() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);

        // Some other address signs nothing on PROVIDER's behalf
        address impostor = address(0xB0B);
        usdc.setBalance(impostor, 100e18);
        vm.prank(impostor);
        usdc.approve(address(escrow), 100e18);

        // The attestation is for PROVIDER; impostor calling will trip the
        // "Caller must be agent" check first.
        vm.prank(impostor);
        vm.expectRevert("Caller must be agent");
        escrow.postBond(jobId, att, sig);
    }

    function test_Revert_PostBond_Duplicate() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt * 2);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt * 2);

        (RatingVerifier.RatingAttestation memory a1, bytes memory s1) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, a1, s1);

        // Second post with fresh nonce should still fail with "already posted"
        (RatingVerifier.RatingAttestation memory a2, bytes memory s2) = _attest(3, 400, 3000, 3);
        vm.prank(PROVIDER);
        vm.expectRevert("Bond already posted");
        escrow.postBond(jobId, a2, s2);
    }

    function test_Revert_PostBond_ZeroBudget() public {
        // Skip the budget-set step in the helper — create job without budget.
        (RatingVerifier.RatingAttestation memory ag, bytes memory sg) = _attest(3, 400, 3000, 1);
        vm.prank(CLIENT);
        uint256 jobId = gateway.postGatedJob(
            PROVIDER, EVALUATOR, block.timestamp + 7 days, "no-budget", 1_000_000_000, ag, sg, 3, 1
        );
        // budget NOT set on ERC-8183 yet.

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        vm.expectRevert("Budget not set");
        escrow.postBond(jobId, att, sig);
    }

    /* ──────────────────────────────────────────────────────────────────────
     * Tests — release
     * ────────────────────────────────────────────────────────────────────── */

    function test_Release_HappyPath() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        // Simulate ERC-8183 transitioning to Completed
        erc8183.setStatus(jobId, escrow.STATUS_COMPLETED());

        uint256 providerBalBefore = usdc.balanceOf(PROVIDER);
        // Anyone can call release; use a random caller.
        vm.prank(address(0xCAFE));
        escrow.release(jobId);

        assertEq(usdc.balanceOf(PROVIDER), providerBalBefore + bondAmt);
        (, , , uint8 status) = escrow.bonds(jobId);
        assertEq(status, 1); // BOND_RELEASED
    }

    function test_Revert_Release_NotCompleted() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        // Still STATUS_FUNDED — should refuse release
        vm.expectRevert("Job not completed");
        escrow.release(jobId);
    }

    /* ──────────────────────────────────────────────────────────────────────
     * Tests — slash
     * ────────────────────────────────────────────────────────────────────── */

    function test_Slash_OnRejected() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_REJECTED());

        uint256 clientBalBefore = usdc.balanceOf(CLIENT);
        vm.prank(address(0xCAFE));
        escrow.slash(jobId);

        assertEq(usdc.balanceOf(CLIENT), clientBalBefore + bondAmt);
        (, , , uint8 status) = escrow.bonds(jobId);
        assertEq(status, 2); // BOND_SLASHED
    }

    function test_Slash_OnExpired() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_EXPIRED());

        uint256 clientBalBefore = usdc.balanceOf(CLIENT);
        escrow.slash(jobId);

        assertEq(usdc.balanceOf(CLIENT), clientBalBefore + bondAmt);
    }

    function test_Revert_DoubleRelease() public {
        uint256 jobId = _gatedFundedJob(1_000_000_000);
        uint256 bondAmt = escrow.requiredBond(1_000_000_000, 400, 3000);
        usdc.setBalance(PROVIDER, bondAmt);
        vm.prank(PROVIDER);
        usdc.approve(address(escrow), bondAmt);

        (RatingVerifier.RatingAttestation memory att, bytes memory sig) = _attest(3, 400, 3000, 2);
        vm.prank(PROVIDER);
        escrow.postBond(jobId, att, sig);

        erc8183.setStatus(jobId, escrow.STATUS_COMPLETED());
        escrow.release(jobId);

        vm.expectRevert("Bond not active");
        escrow.release(jobId);
    }
}
