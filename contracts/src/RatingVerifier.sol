// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ECDSA} from "openzeppelin-contracts/contracts/utils/cryptography/ECDSA.sol";
import {EIP712} from "openzeppelin-contracts/contracts/utils/cryptography/EIP712.sol";

contract RatingVerifier is EIP712 {
    using ECDSA for bytes32;

    bytes32 private constant RATING_ATTESTATION_TYPEHASH = keccak256(
        "RatingAttestation(bytes32 chain,uint256 agentId,address agentAddress,uint8 tier,uint16 pdBps,uint8 confidence,bytes32 methodologyVersion,uint64 asOf,uint64 validUntil,uint256 nonce)"
    );

    struct RatingAttestation {
        bytes32 chain;
        uint256 agentId;
        address agentAddress;
        uint8 tier;
        uint16 pdBps;
        uint8 confidence;
        bytes32 methodologyVersion;
        uint64 asOf;
        uint64 validUntil;
        uint256 nonce;
    }

    address private immutable _signer;

    bytes32 private _methodologyVersion;
    bytes32 private _previousMethodologyVersion;

    mapping(bytes32 => uint256) public lastUsedNonce;

    event MethodologyVersionUpdated(bytes32 newVersion, bytes32 previousVersion);

    constructor(address signer_, bytes32 methodologyVersion_)
        EIP712("Caliber", "1")
    {
        require(signer_ != address(0), "Zero signer");
        _signer = signer_;
        _methodologyVersion = methodologyVersion_;
    }

    function requireMinRating(
        RatingAttestation calldata att,
        bytes calldata signature,
        uint8 maxTierAllowed,
        uint8 minConfidenceAllowed
    ) external {
        require(att.tier <= maxTierAllowed, "Rating too low");
        require(att.confidence <= minConfidenceAllowed, "Confidence too low");
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
                att.pdBps,
                att.confidence,
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

    function signer() external view returns (address) {
        return _signer;
    }

    function methodologyVersion() external view returns (bytes32) {
        return _methodologyVersion;
    }

    function previousMethodologyVersion() external view returns (bytes32) {
        return _previousMethodologyVersion;
    }

    function setMethodologyVersion(bytes32 newVersion) external {
        require(msg.sender == _signer, "Only signer");
        _previousMethodologyVersion = _methodologyVersion;
        _methodologyVersion = newVersion;
        emit MethodologyVersionUpdated(newVersion, _previousMethodologyVersion);
    }
}
