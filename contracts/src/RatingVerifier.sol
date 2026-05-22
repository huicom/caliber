// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

/// @title RatingVerifier — Caliber v2.0 attestation verifier
/// @notice EIP-712 verifier for the Caliber Rating v2.0 attestation. The
///         struct shape changed from v1 (PD/LGD/confidence bps) to v2
///         (tier ordinal + score + interaction count + flags bitfield).
///         Methodology change is reflected in the EIP-712 typehash so
///         old v1 signatures cannot be replayed against this contract.
contract RatingVerifier is EIP712 {
    using ECDSA for bytes32;

    // ----- Attestation type ------------------------------------------------

    /// @dev v2 typehash. Changed: pdBps + lgdBps + confidence (3 fields)
    ///      replaced by tier + score + interactionCount + flags (4 fields).
    ///      The new typehash means v1 signatures no longer verify here.
    bytes32 private constant RATING_ATTESTATION_TYPEHASH = keccak256(
        "RatingAttestation(bytes32 chain,uint256 agentId,address agentAddress,uint8 tier,uint8 score,uint16 interactionCount,uint8 flags,bytes32 methodologyVersion,uint64 asOf,uint64 validUntil,uint256 nonce)"
    );

    /// @notice Caliber Rating v2.0 attestation.
    /// @dev `tier` is a 6-value enum encoded as uint8 (0=Established, 5=Inactive).
    ///      `score` is the 0-100 composite score.
    ///      `interactionCount` is the number of on-chain interactions that
    ///        backed the rating; consumers can use it to set freshness or
    ///        minimum-history requirements above the methodology's defaults.
    ///      `flags` is a uint8 bitfield (5 flags currently defined; see
    ///        Caliber Rating v2.0 methodology §"Risk flags").
    struct RatingAttestation {
        bytes32 chain;
        uint256 agentId;
        address agentAddress;
        uint8 tier;
        uint8 score;
        uint16 interactionCount;
        uint8 flags;
        bytes32 methodologyVersion;
        uint64 asOf;
        uint64 validUntil;
        uint256 nonce;
    }

    // ----- Storage ---------------------------------------------------------

    address private immutable _signer;

    bytes32 private _methodologyVersion;
    bytes32 private _previousMethodologyVersion;

    /// @dev Per-(chain, agentId) nonce. The signer issues monotonically
    ///      increasing nonces; the contract refuses replays.
    mapping(bytes32 => uint256) public lastUsedNonce;

    // ----- Events ----------------------------------------------------------

    event MethodologyVersionUpdated(bytes32 newVersion, bytes32 previousVersion);

    // ----- Constructor -----------------------------------------------------

    constructor(address signer_, bytes32 methodologyVersion_)
        EIP712("Caliber", "1")
    {
        require(signer_ != address(0), "Zero signer");
        _signer = signer_;
        _methodologyVersion = methodologyVersion_;
    }

    // ----- Verification ----------------------------------------------------

    /// @notice Verify an attestation and enforce caller-supplied thresholds.
    /// @param att          The signed attestation.
    /// @param signature    The signer's EIP-712 signature over `att`.
    /// @param maxTierAllowed   Highest tier ordinal the caller will accept.
    ///                         Tier ordinals: 0=Established, 1=Proven,
    ///                         2=Emerging, 3=Provisional, 4=Watch,
    ///                         5=Inactive. Caller passes the WEAKEST tier
    ///                         they'll accept; verifier reverts if the
    ///                         agent's tier is weaker (numerically higher).
    /// @param blockingFlagMask Bitmask of flags that, if set on the
    ///                         attestation, cause an immediate revert.
    ///                         Caller chooses which flags are dealbreakers
    ///                         for their flow (e.g. setting it to 0x1F
    ///                         refuses any flagged agent; setting it to
    ///                         0x10 refuses only Dormancy).
    function requireMinRating(
        RatingAttestation calldata att,
        bytes calldata signature,
        uint8 maxTierAllowed,
        uint8 blockingFlagMask
    ) external {
        require(att.tier <= maxTierAllowed, "Tier too weak");
        require((att.flags & blockingFlagMask) == 0, "Blocking flag set");
        require(block.timestamp <= att.validUntil, "Attestation expired");
        require(
            att.methodologyVersion == _methodologyVersion
                || att.methodologyVersion == _previousMethodologyVersion,
            "Wrong methodology version"
        );

        bytes32 agentKey = keccak256(abi.encodePacked(att.chain, att.agentId));
        require(att.nonce > lastUsedNonce[agentKey], "Nonce replay");
        lastUsedNonce[agentKey] = att.nonce;

        bytes32 structHash = keccak256(
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
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = digest.recover(signature);
        require(recovered == _signer, "Invalid signer");
    }

    // ----- Views -----------------------------------------------------------

    function signer() external view returns (address) {
        return _signer;
    }

    function methodologyVersion() external view returns (bytes32) {
        return _methodologyVersion;
    }

    function previousMethodologyVersion() external view returns (bytes32) {
        return _previousMethodologyVersion;
    }

    // ----- Admin -----------------------------------------------------------

    /// @notice Bump the methodology version. The previous version stays
    ///         valid for the 30-day governance window (methodology §9).
    function setMethodologyVersion(bytes32 newVersion) external {
        require(msg.sender == _signer, "Only signer");
        _previousMethodologyVersion = _methodologyVersion;
        _methodologyVersion = newVersion;
        emit MethodologyVersionUpdated(newVersion, _previousMethodologyVersion);
    }
}
