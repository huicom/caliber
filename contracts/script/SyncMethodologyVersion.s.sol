// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {RatingVerifier} from "../src/RatingVerifier.sol";

/// @notice Bump the on-chain methodology version on the deployed RatingVerifier.
///
/// `RatingVerifier.setMethodologyVersion(newVersion)` (signer-only) shifts the
/// current version into `_previousMethodologyVersion` and sets the new one as
/// current. After the call the verifier accepts BOTH the new current version and
/// the immediately-previous version — the 30-day dual-version governance window
/// (methodology §Governance).
///
/// v2.1.0 bump (2026-06-14): adverse-evidence factor. The verifier currently
/// holds current=bytes32("2.0.0") with the signer stamping "2.0.1" (accepted via
/// the prior 2.0.x dual window). Calling this with NEW_METHODOLOGY_VERSION="2.1.0"
/// makes current="2.1.0", previous="2.0.0".
///
/// IMPORTANT — the dual-version window we actually want is 2.1.0 ↔ 2.0.1.
/// Because setMethodologyVersion only retains ONE previous slot, and the current
/// on-chain current is "2.0.0", a single call would leave previous="2.0.0" (not
/// "2.0.1"). To land previous="2.0.1" exactly, call this script TWICE:
///   1) NEW_METHODOLOGY_VERSION="2.0.1"  → current=2.0.1, previous=2.0.0
///   2) NEW_METHODOLOGY_VERSION="2.1.0"  → current=2.1.0, previous=2.0.1
/// The signer was already stamping 2.0.1 during the 2.0.x window, so step (1)
/// changes nothing operationally for in-flight attestations.
///
/// Env:
///   RATING_SIGNER_PRIVATE_KEY — the verifier's signer key (RatingVerifier.signer()).
///                               setMethodologyVersion is signer-only; the deployer
///                               key is NOT the signer on the Arc deployment. Falls
///                               back to DEPLOYER_PRIVATE_KEY only if unset.
///   RATING_VERIFIER_ADDRESS   — deployed verifier (defaults to the Arc address).
///   NEW_METHODOLOGY_VERSION   — the version string to set as current (e.g. "2.1.0").
contract SyncMethodologyVersion is Script {
    address constant DEFAULT_VERIFIER = 0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8;

    function run() external {
        uint256 signerKey = vm.envOr(
            "RATING_SIGNER_PRIVATE_KEY",
            vm.envUint("DEPLOYER_PRIVATE_KEY")
        );
        address verifierAddr = vm.envOr("RATING_VERIFIER_ADDRESS", DEFAULT_VERIFIER);
        string memory newVersionStr = vm.envString("NEW_METHODOLOGY_VERSION");
        bytes32 newVersion = bytes32(bytes(newVersionStr));

        RatingVerifier verifier = RatingVerifier(verifierAddr);

        bytes32 before = verifier.methodologyVersion();
        bytes32 beforePrev = verifier.previousMethodologyVersion();
        console2.log("Verifier:", verifierAddr);
        console2.log("Before  current :", vm.toString(before));
        console2.log("Before  previous:", vm.toString(beforePrev));
        console2.log("Setting current :", newVersionStr);

        vm.startBroadcast(signerKey);
        verifier.setMethodologyVersion(newVersion);
        vm.stopBroadcast();

        bytes32 afterCur = verifier.methodologyVersion();
        bytes32 afterPrev = verifier.previousMethodologyVersion();
        console2.log("After   current :", vm.toString(afterCur));
        console2.log("After   previous:", vm.toString(afterPrev));
    }
}
