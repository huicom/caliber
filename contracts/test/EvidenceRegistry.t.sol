// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";

contract EvidenceRegistryTest is Test {
    EvidenceRegistry public registry;

    // Anvil/Foundry default test key (account #0). Public, deterministic.
    uint256 constant SIGNER_KEY = 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;
    address constant SIGNER_ADDR = 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266;
    // Account #1 — used as a wrong signer.
    uint256 constant BAD_KEY = 0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d;

    bytes32 constant METHODOLOGY_VERSION = bytes32("2.0.1");
    bytes32 constant ARC_CHAIN = bytes32("arc");

    address constant RELAYER = address(0x4E1A);

    bytes32 constant EIP712_DOMAIN_TYPEHASH = keccak256(
        "EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"
    );

    bytes32 constant EVIDENCE_ATTESTATION_TYPEHASH = keccak256(
        "EvidenceAttestation(bytes32 chain,uint256 paymentId,uint256 agentId,bytes32 specHash,bytes32 responseHash,uint8 verdict,uint8 verifyingTier,bytes32 buyerSig,bytes32 sellerSig,bytes32 methodologyVersion,uint64 timestamp,uint256 nonce)"
    );

    event EvidenceAttested(
        uint256 indexed agentId,
        uint256 indexed paymentId,
        bytes32 specHash,
        bytes32 responseHash,
        uint8 verdict,
        uint8 verifyingTier,
        bytes32 attestationHash
    );

    function setUp() public {
        registry = new EvidenceRegistry(SIGNER_ADDR, METHODOLOGY_VERSION);
    }

    // ---- helpers ----------------------------------------------------------

    function _build(uint8 verdict, uint8 verifyingTier, uint256 agentId, uint256 nonce)
        internal
        pure
        returns (EvidenceRegistry.EvidenceAttestation memory)
    {
        return EvidenceRegistry.EvidenceAttestation({
            chain: ARC_CHAIN,
            paymentId: 777,
            agentId: agentId,
            specHash: keccak256("spec"),
            responseHash: keccak256("response"),
            verdict: verdict,
            verifyingTier: verifyingTier,
            buyerSig: keccak256("buyerSpecSig"),
            sellerSig: keccak256("sellerSpecSig"),
            methodologyVersion: METHODOLOGY_VERSION,
            timestamp: uint64(1_750_000_000),
            nonce: nonce
        });
    }

    function _domainSeparator() internal view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes("Caliber")),
                keccak256(bytes("1")),
                block.chainid,
                address(registry)
            )
        );
    }

    function _structHash(EvidenceRegistry.EvidenceAttestation memory att) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                EVIDENCE_ATTESTATION_TYPEHASH,
                att.chain,
                att.paymentId,
                att.agentId,
                att.specHash,
                att.responseHash,
                att.verdict,
                att.verifyingTier,
                att.buyerSig,
                att.sellerSig,
                att.methodologyVersion,
                att.timestamp,
                att.nonce
            )
        );
    }

    function _digest(EvidenceRegistry.EvidenceAttestation memory att) internal view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", _domainSeparator(), _structHash(att)));
    }

    function _sign(uint256 key, EvidenceRegistry.EvidenceAttestation memory att)
        internal
        view
        returns (bytes memory)
    {
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, _digest(att));
        return abi.encodePacked(r, s, v);
    }

    // ---- acceptance -------------------------------------------------------

    function test_ValidAttestEmitsEvent() public {
        EvidenceRegistry.EvidenceAttestation memory att = _build(1, 2, 42, 1);
        bytes memory sig = _sign(SIGNER_KEY, att);
        bytes32 expectedHash = _digest(att);

        // Permissionless relay: a third party submits the signed attestation.
        vm.expectEmit(true, true, false, true, address(registry));
        emit EvidenceAttested(42, 777, att.specHash, att.responseHash, 1, 2, expectedHash);

        vm.prank(RELAYER);
        registry.attest(att, sig);

        assertEq(registry.lastNonce(42), 1);
    }

    function test_HashAttestationMatchesOffchainDigest() public view {
        EvidenceRegistry.EvidenceAttestation memory att = _build(0, 3, 7, 5);
        // Contract view must equal the digest computed independently here.
        assertEq(registry.hashAttestation(att), _digest(att));
        // And the contract's domain separator matches the locally computed one.
        assertEq(registry.domainSeparator(), _domainSeparator());
    }

    // ---- rejection --------------------------------------------------------

    function test_Revert_WrongSigner() public {
        EvidenceRegistry.EvidenceAttestation memory att = _build(0, 0, 42, 1);
        bytes memory badSig = _sign(BAD_KEY, att);
        vm.expectRevert("Invalid signer");
        registry.attest(att, badSig);
    }

    function test_Revert_NonceReplay() public {
        EvidenceRegistry.EvidenceAttestation memory att = _build(0, 0, 42, 1);
        registry.attest(att, _sign(SIGNER_KEY, att));
        // Same nonce again → replay.
        vm.expectRevert("Nonce replay");
        registry.attest(att, _sign(SIGNER_KEY, att));
    }

    function test_Revert_NonIncreasingNonce() public {
        EvidenceRegistry.EvidenceAttestation memory a2 = _build(0, 0, 42, 2);
        registry.attest(a2, _sign(SIGNER_KEY, a2));
        // Lower nonce after a higher one → reject.
        EvidenceRegistry.EvidenceAttestation memory a1 = _build(0, 0, 42, 1);
        vm.expectRevert("Nonce replay");
        registry.attest(a1, _sign(SIGNER_KEY, a1));
    }

    function test_IncreasingNonceOk() public {
        EvidenceRegistry.EvidenceAttestation memory a1 = _build(0, 0, 42, 1);
        registry.attest(a1, _sign(SIGNER_KEY, a1));
        EvidenceRegistry.EvidenceAttestation memory a2 = _build(1, 1, 42, 5);
        registry.attest(a2, _sign(SIGNER_KEY, a2));
        assertEq(registry.lastNonce(42), 5);
    }

    function test_PerAgentNonceIndependent() public {
        // agentId 42 advances to nonce 9; agentId 43 can still start at 1.
        EvidenceRegistry.EvidenceAttestation memory a = _build(0, 0, 42, 9);
        registry.attest(a, _sign(SIGNER_KEY, a));
        EvidenceRegistry.EvidenceAttestation memory b = _build(0, 0, 43, 1);
        registry.attest(b, _sign(SIGNER_KEY, b));
        assertEq(registry.lastNonce(42), 9);
        assertEq(registry.lastNonce(43), 1);
    }

    function test_Revert_VerdictTooHigh() public {
        EvidenceRegistry.EvidenceAttestation memory att = _build(3, 0, 42, 1);
        bytes memory sig = _sign(SIGNER_KEY, att);
        vm.expectRevert("Bad verdict");
        registry.attest(att, sig);
    }

    function test_Revert_TierTooHigh() public {
        EvidenceRegistry.EvidenceAttestation memory att = _build(0, 4, 42, 1);
        bytes memory sig = _sign(SIGNER_KEY, att);
        vm.expectRevert("Bad tier");
        registry.attest(att, sig);
    }

    // ---- admin ------------------------------------------------------------

    function test_Constructor() public view {
        assertEq(registry.signer(), SIGNER_ADDR);
        assertEq(registry.methodologyVersion(), METHODOLOGY_VERSION);
        assertEq(registry.owner(), address(this));
    }

    function test_SetSigner_OnlyOwner() public {
        address newSigner = address(0xBEEF);
        registry.setSigner(newSigner);
        assertEq(registry.signer(), newSigner);
    }

    function test_Revert_SetSigner_NotOwner() public {
        vm.prank(address(0xB0B));
        vm.expectRevert("Only owner");
        registry.setSigner(address(0xBEEF));
    }

    function test_SetMethodologyVersion_OnlyOwner() public {
        registry.setMethodologyVersion(bytes32("2.1.0"));
        assertEq(registry.methodologyVersion(), bytes32("2.1.0"));
    }

    function test_Revert_SetMethodologyVersion_NotOwner() public {
        vm.prank(address(0xB0B));
        vm.expectRevert("Only owner");
        registry.setMethodologyVersion(bytes32("2.1.0"));
    }

    function test_AttestAfterSignerRotation() public {
        // Rotate to account #1; old signer's sig now fails, new one works.
        address newSigner = vm.addr(BAD_KEY);
        registry.setSigner(newSigner);

        EvidenceRegistry.EvidenceAttestation memory att = _build(0, 0, 99, 1);
        vm.expectRevert("Invalid signer");
        registry.attest(att, _sign(SIGNER_KEY, att));

        registry.attest(att, _sign(BAD_KEY, att));
        assertEq(registry.lastNonce(99), 1);
    }
}
