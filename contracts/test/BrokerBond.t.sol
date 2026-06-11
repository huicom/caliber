// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test} from "forge-std/Test.sol";
import {BrokerBond} from "../src/BrokerBond.sol";
import {MockERC20, MockAgenticCommerceStruct} from "./mocks/Mocks.sol";

contract BrokerBondTest is Test {
    BrokerBond public bondContract;
    MockERC20 public usdc;
    MockAgenticCommerceStruct public erc8183;

    address constant OWNER = address(0x0A11CE);
    address constant BROKER = address(0xB0B);
    address constant REQUESTER = address(0x4E9);
    address constant PROVIDER = address(0x9D0);
    address constant CLIENT = address(0xC11E);
    address constant EVALUATOR = address(0xE7A);
    address constant THIRD_PARTY = address(0x7777);

    uint256 constant BUDGET = 1_000_000_000; // 1000 USDC (6 decimals)
    uint256 constant BOND = 15_000_000; // 15 USDC (Silver 150bps of 1000)

    function setUp() public {
        usdc = new MockERC20();
        erc8183 = new MockAgenticCommerceStruct();
        bondContract = new BrokerBond(address(erc8183), address(usdc), OWNER);

        // Fund the broker generously and pre-approve the bond contract.
        usdc.setBalance(BROKER, 1_000_000_000_000);
        vm.prank(BROKER);
        usdc.approve(address(bondContract), type(uint256).max);
    }

    // ----- helpers -------------------------------------------------------

    function _fundedJob(address provider, uint256 budget) internal returns (uint256 jobId) {
        vm.prank(CLIENT);
        jobId = erc8183.createJob(provider, EVALUATOR, block.timestamp + 1 days, "demo", address(0));
        vm.prank(provider);
        erc8183.setBudget(jobId, budget, "");
        vm.prank(CLIENT);
        erc8183.fund(jobId, "");
    }

    function _postBond(uint256 jobId) internal returns (uint256 bondId) {
        vm.prank(BROKER);
        bondId = bondContract.postBond(jobId, REQUESTER, PROVIDER, BOND);
    }

    // ----- postBond ------------------------------------------------------

    function test_PostBond_HappyPath() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 brokerBefore = usdc.balanceOf(BROKER);

        vm.expectEmit(true, true, true, true);
        emit BrokerBond.BondPosted(1, jobId, BROKER, REQUESTER, PROVIDER, BOND);
        uint256 bondId = _postBond(jobId);

        assertEq(bondId, 1);
        assertEq(usdc.balanceOf(address(bondContract)), BOND);
        assertEq(usdc.balanceOf(BROKER), brokerBefore - BOND);
        assertEq(bondContract.bondIdForJob(jobId), bondId);

        BrokerBond.Bond memory b = bondContract.getBond(bondId);
        assertEq(b.jobId, jobId);
        assertEq(b.broker, BROKER);
        assertEq(b.requester, REQUESTER);
        assertEq(b.provider, PROVIDER);
        assertEq(b.amount, BOND);
        assertEq(b.status, bondContract.BOND_ACTIVE());
    }

    function test_PostBond_RevertProviderMismatch() public {
        uint256 jobId = _fundedJob(address(0xDEAD), BUDGET); // different provider
        vm.prank(BROKER);
        vm.expectRevert("Provider mismatch");
        bondContract.postBond(jobId, REQUESTER, PROVIDER, BOND);
    }

    function test_PostBond_RevertUnknownJob() public {
        vm.prank(BROKER);
        vm.expectRevert("Unknown job");
        bondContract.postBond(999, REQUESTER, PROVIDER, BOND);
    }

    function test_PostBond_RevertJobPastFunded() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        erc8183.setStatus(jobId, erc8183.STATUS_SUBMITTED());
        vm.prank(BROKER);
        vm.expectRevert("Job past funded");
        bondContract.postBond(jobId, REQUESTER, PROVIDER, BOND);
    }

    function test_PostBond_RevertZeroAmount() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        vm.prank(BROKER);
        vm.expectRevert("Zero amount");
        bondContract.postBond(jobId, REQUESTER, PROVIDER, 0);
    }

    function test_PostBond_RevertDoubleBond() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        _postBond(jobId);
        vm.prank(BROKER);
        vm.expectRevert("Job already bonded");
        bondContract.postBond(jobId, REQUESTER, PROVIDER, BOND);
    }

    function test_PostBond_RevertWhenPaused() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        vm.prank(OWNER);
        bondContract.setPaused(true);
        vm.prank(BROKER);
        vm.expectRevert("Paused");
        bondContract.postBond(jobId, REQUESTER, PROVIDER, BOND);
    }

    // ----- release -------------------------------------------------------

    function test_Release_OnCompleted() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        uint256 brokerBefore = usdc.balanceOf(BROKER);

        erc8183.setStatus(jobId, erc8183.STATUS_COMPLETED());
        bondContract.release(bondId); // anyone

        assertEq(usdc.balanceOf(BROKER), brokerBefore + BOND);
        assertEq(usdc.balanceOf(address(bondContract)), 0);
        assertEq(bondContract.getBond(bondId).status, bondContract.BOND_RELEASED());
    }

    function test_Release_RevertWhenInFlight() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        vm.expectRevert("Job not completed");
        bondContract.release(bondId);

        erc8183.setStatus(jobId, erc8183.STATUS_SUBMITTED());
        vm.expectRevert("Job not completed");
        bondContract.release(bondId);
    }

    function test_Release_RevertWhenAlreadyReleased() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        erc8183.setStatus(jobId, erc8183.STATUS_COMPLETED());
        bondContract.release(bondId);
        vm.expectRevert("Bond not active");
        bondContract.release(bondId);
    }

    // ----- slash ---------------------------------------------------------

    function test_Slash_OnRejected() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        uint256 reqBefore = usdc.balanceOf(REQUESTER);

        erc8183.setStatus(jobId, erc8183.STATUS_REJECTED());
        bondContract.slash(bondId); // anyone

        assertEq(usdc.balanceOf(REQUESTER), reqBefore + BOND);
        assertEq(bondContract.getBond(bondId).status, bondContract.BOND_SLASHED());
    }

    function test_Slash_OnExpired() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        erc8183.setStatus(jobId, erc8183.STATUS_EXPIRED());
        bondContract.slash(bondId);
        assertEq(usdc.balanceOf(REQUESTER), BOND);
    }

    function test_Slash_RevertWhenCompleted() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        erc8183.setStatus(jobId, erc8183.STATUS_COMPLETED());
        vm.expectRevert("Job not slashable");
        bondContract.slash(bondId);
    }

    function test_Slash_RevertWhenAlreadySlashed() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        erc8183.setStatus(jobId, erc8183.STATUS_REJECTED());
        bondContract.slash(bondId);
        vm.expectRevert("Bond not active");
        bondContract.slash(bondId);
    }

    // ----- permissionless + pause invariants -----------------------------

    function test_Permissionless_ThirdPartyCanSlash() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        erc8183.setStatus(jobId, erc8183.STATUS_REJECTED());
        vm.prank(THIRD_PARTY);
        bondContract.slash(bondId);
        assertEq(usdc.balanceOf(REQUESTER), BOND);
    }

    function test_SettlementAllowedWhilePaused() public {
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        uint256 bondId = _postBond(jobId);
        vm.prank(OWNER);
        bondContract.setPaused(true);
        erc8183.setStatus(jobId, erc8183.STATUS_COMPLETED());
        bondContract.release(bondId); // pause must not trap funds
        assertEq(bondContract.getBond(bondId).status, bondContract.BOND_RELEASED());
    }

    function test_SetPaused_OnlyOwner() public {
        vm.prank(BROKER);
        vm.expectRevert("Only owner");
        bondContract.setPaused(true);
    }

    // ----- fuzz ----------------------------------------------------------

    function testFuzz_PostBond_Amount(uint256 amount) public {
        amount = bound(amount, 1, 1_000_000_000_000);
        uint256 jobId = _fundedJob(PROVIDER, BUDGET);
        vm.prank(BROKER);
        uint256 bondId = bondContract.postBond(jobId, REQUESTER, PROVIDER, amount);
        assertEq(usdc.balanceOf(address(bondContract)), amount);

        erc8183.setStatus(jobId, erc8183.STATUS_REJECTED());
        bondContract.slash(bondId);
        assertEq(usdc.balanceOf(REQUESTER), amount);
    }
}
