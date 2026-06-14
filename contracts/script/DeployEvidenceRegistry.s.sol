// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";

/// @notice Deploys EvidenceRegistry (Steward Phase 2, WS-2). Additive — does
///         NOT touch the existing v2.0.1 Caliber contracts (Guardrail 1).
///         Custodies no funds. Targets Arc Testnet (Guardrail 6).
///
///   forge script script/DeployEvidenceRegistry.s.sol --rpc-url "$ARC_RPC_URL" --broadcast
///
/// signer_ = the Caliber RATING signer (env SIGNER_ADDRESS — must match the
/// address derived from RATING_SIGNER_PRIVATE_KEY), so the same key that signs
/// rating attestations also signs Steward evidence attestations.
/// methodologyVersion_ = bytes32("2.0.1").
contract DeployEvidenceRegistry is Script {
    bytes32 constant METHODOLOGY_VERSION = bytes32("2.0.1");

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address signerAddr = vm.envAddress("SIGNER_ADDRESS");
        require(signerAddr != address(0), "SIGNER_ADDRESS unset");

        vm.startBroadcast(deployerKey);
        EvidenceRegistry registry = new EvidenceRegistry(signerAddr, METHODOLOGY_VERSION);
        vm.stopBroadcast();

        console2.log("EvidenceRegistry deployed at:", address(registry));
        console2.log("  signer:", signerAddr);
        console2.log("  methodologyVersion: 2.0.1");
        console2.log("  owner (deployer):", vm.addr(deployerKey));
        console2.log("---");
        console2.log("Set EVIDENCE_REGISTRY_ADDRESS in .env to the address above.");
    }
}
