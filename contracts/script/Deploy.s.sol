// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {RatingVerifier} from "../src/RatingVerifier.sol";
import {RatingGateway} from "../src/RatingGateway.sol";
import {CaliberEscrow} from "../src/CaliberEscrow.sol";

contract DeployArcTestnet is Script {
    bytes32 constant METHODOLOGY_VERSION = bytes32("1.0.0");

    address constant SIGNER = 0x0000000000000000000000000000000000000000;
    address constant AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address signerAddr = vm.envOr("SIGNER_ADDRESS", SIGNER);

        vm.startBroadcast(deployerKey);

        // 1. RatingVerifier — new struct includes lgdBps (typehash bumped).
        RatingVerifier verifier = new RatingVerifier(signerAddr, METHODOLOGY_VERSION);
        console2.log("RatingVerifier deployed at:", address(verifier));

        // 2. RatingGateway — recompiled against the new struct.
        RatingGateway gateway = new RatingGateway(address(verifier), AGENTIC_COMMERCE, USDC);
        console2.log("RatingGateway deployed at:", address(gateway));

        // 3. CaliberEscrow — agent-posted performance bond, priced by Caliber
        //    rating from the signed attestation (bond = budget * pd * lgd).
        CaliberEscrow escrow = new CaliberEscrow(
            address(verifier),
            AGENTIC_COMMERCE,
            USDC,
            address(gateway)
        );
        console2.log("CaliberEscrow deployed at:", address(escrow));

        vm.stopBroadcast();

        console2.log("---");
        console2.log("Add to indexer/shared/chain-config.ts + web/src/lib/contracts/addresses.ts:");
        console2.log("ratingVerifier:", address(verifier));
        console2.log("ratingGateway:", address(gateway));
        console2.log("caliberEscrow:", address(escrow));
    }
}
