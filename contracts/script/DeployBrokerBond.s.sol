// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {BrokerBond} from "../src/BrokerBond.sol";

/// @notice Deploys BrokerBond (Lepton Phase 2). Additive — does NOT touch the
///         existing v2.0.1 Caliber contracts. Targets Arc Testnet.
///
///   forge script script/DeployBrokerBond.s.sol --rpc-url "$ARC_RPC_URL" --broadcast
///
/// 18 Foundry unit/fuzz tests cover post/release/slash/expired/double/in-flight/
/// permissionless/pause. Owner can only pause new bonds; it can never move bonded funds. Default
/// owner = the broker wallet (BROKER_ADDRESS) so the same operator that posts
/// bonds can pause issuance in an emergency; override with BROKERBOND_OWNER.
contract DeployBrokerBond is Script {
    address constant AGENTIC_COMMERCE = 0x0747EEf0706327138c69792bF28Cd525089e4583;
    address constant USDC = 0x3600000000000000000000000000000000000000;

    function run() external {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address ownerAddr = vm.envOr("BROKERBOND_OWNER", vm.envOr("BROKER_ADDRESS", deployer));

        vm.startBroadcast(deployerKey);
        BrokerBond bond = new BrokerBond(AGENTIC_COMMERCE, USDC, ownerAddr);
        vm.stopBroadcast();

        console2.log("BrokerBond deployed at:", address(bond));
        console2.log("  agenticCommerce:", AGENTIC_COMMERCE);
        console2.log("  usdc:", USDC);
        console2.log("  owner:", ownerAddr);
        console2.log("---");
        console2.log("Set BROKERBOND_ADDRESS in .env to the address above.");
    }
}
