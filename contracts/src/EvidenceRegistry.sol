// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

/// @title EvidenceRegistry — Steward evidence attestation recorder (Phase 2, WS-2)
/// @notice Records Steward evidence attestations on-chain: the event is the
///         on-chain record, the full payload (specs, response bytes) stays
///         off-chain. This contract custodies NO funds — it is purely an
///         EIP-712 signature verifier + event emitter.
///
///         The Steward signer (the same key Caliber uses for rating
///         attestations) signs an EvidenceAttestation after an outcome is
///         resolved. Anyone may relay that signed attestation to `attest`;
///         the signature is the authorization — only the registered signer's
///         signature is accepted. A monotonic per-agent nonce prevents replay.
///
///         The EIP-712 domain ("Caliber" / "1") and the typehash field order
///         match `packages/steward-core/src/eip712.ts` EVIDENCE_ATTESTATION_TYPES
///         exactly so off-chain `evidenceAttestationHash` lines up with the
///         on-chain `hashAttestation` digest.
contract EvidenceRegistry is EIP712 {
    using ECDSA for bytes32;

    // ----- Attestation type ------------------------------------------------

    /// @dev Field order MUST match EVIDENCE_ATTESTATION_TYPES in steward-core.
    bytes32 private constant EVIDENCE_ATTESTATION_TYPEHASH = keccak256(
        "EvidenceAttestation(bytes32 chain,uint256 paymentId,uint256 agentId,bytes32 specHash,bytes32 responseHash,uint8 verdict,uint8 verifyingTier,bytes32 buyerSig,bytes32 sellerSig,bytes32 methodologyVersion,uint64 timestamp,uint256 nonce)"
    );

    /// @notice A resolved-outcome evidence attestation.
    /// @dev `verdict`       0 = conforms, 1 = breach, 2 = inconclusive.
    ///      `verifyingTier` 0..3 — which judge Tier resolved the verdict.
    ///      `buyerSig`/`sellerSig` are keccak commitments to the spec sigs.
    struct EvidenceAttestation {
        bytes32 chain;
        uint256 paymentId;
        uint256 agentId;
        bytes32 specHash;
        bytes32 responseHash;
        uint8 verdict;
        uint8 verifyingTier;
        bytes32 buyerSig;
        bytes32 sellerSig;
        bytes32 methodologyVersion;
        uint64 timestamp;
        uint256 nonce;
    }

    // ----- Storage ---------------------------------------------------------

    /// @notice The authorized attestation signer.
    address public signer;

    /// @notice The methodology version this registry stamps/expects.
    bytes32 public methodologyVersion;

    /// @notice Governance owner — can rotate the signer and methodology version.
    address public owner;

    /// @notice Per-agent monotonic nonce. The signer issues strictly increasing
    ///         nonces per agentId; the contract refuses non-increasing nonces.
    ///         Per-agent (not global) matches how Caliber rating attestations
    ///         nonce per (chain, agentId).
    mapping(uint256 => uint256) public lastNonce;

    // ----- Events ----------------------------------------------------------

    /// @notice Emitted once per accepted evidence attestation. This event is the
    ///         on-chain record; the full payload lives off-chain.
    event EvidenceAttested(
        uint256 indexed agentId,
        uint256 indexed paymentId,
        bytes32 specHash,
        bytes32 responseHash,
        uint8 verdict,
        uint8 verifyingTier,
        bytes32 attestationHash
    );

    event SignerUpdated(address indexed previousSigner, address indexed newSigner);
    event MethodologyVersionUpdated(bytes32 previousVersion, bytes32 newVersion);

    // ----- Constructor -----------------------------------------------------

    constructor(address signer_, bytes32 methodologyVersion_)
        EIP712("Caliber", "1")
    {
        require(signer_ != address(0), "Zero signer");
        signer = signer_;
        methodologyVersion = methodologyVersion_;
        owner = msg.sender;
    }

    // ----- Attestation -----------------------------------------------------

    /// @notice Record a signed evidence attestation on-chain.
    /// @param att        The signer-issued attestation.
    /// @param signature  The signer's EIP-712 signature over `att`.
    /// @dev Permissionless: the signature is the authorization. Reverts unless
    ///      the signature recovers to `signer`, the verdict/tier are in range,
    ///      and the nonce strictly exceeds the agent's last recorded nonce.
    function attest(EvidenceAttestation calldata att, bytes calldata signature) external {
        require(att.verdict <= 2, "Bad verdict");
        require(att.verifyingTier <= 3, "Bad tier");

        require(att.nonce > lastNonce[att.agentId], "Nonce replay");
        lastNonce[att.agentId] = att.nonce;

        bytes32 digest = _digest(att);
        address recovered = digest.recover(signature);
        require(recovered == signer, "Invalid signer");

        emit EvidenceAttested(
            att.agentId,
            att.paymentId,
            att.specHash,
            att.responseHash,
            att.verdict,
            att.verifyingTier,
            digest
        );
    }

    // ----- Views -----------------------------------------------------------

    /// @notice The EIP-712 digest of an attestation. Mirrors off-chain
    ///         `evidenceAttestationHash` for verification parity.
    function hashAttestation(EvidenceAttestation calldata att) external view returns (bytes32) {
        return _digest(att);
    }

    /// @notice The EIP-712 domain separator (for off-chain parity checks).
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ----- Internal --------------------------------------------------------

    function _digest(EvidenceAttestation calldata att) internal view returns (bytes32) {
        bytes32 structHash = keccak256(
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
        return _hashTypedDataV4(structHash);
    }

    // ----- Admin -----------------------------------------------------------

    modifier onlyOwner() {
        require(msg.sender == owner, "Only owner");
        _;
    }

    /// @notice Rotate the authorized signer.
    function setSigner(address newSigner) external onlyOwner {
        require(newSigner != address(0), "Zero signer");
        emit SignerUpdated(signer, newSigner);
        signer = newSigner;
    }

    /// @notice Bump the methodology version.
    function setMethodologyVersion(bytes32 newVersion) external onlyOwner {
        emit MethodologyVersionUpdated(methodologyVersion, newVersion);
        methodologyVersion = newVersion;
    }
}
