// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CleanverseGate, IComplianceValidator} from "../src/CleanverseGate.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {MockToken, FeeToken} from "./Sclera.t.sol";

/// @dev A stand-in for the Cleanverse Compliance Validator, built to mirror the behaviour read live
///      from Monad on 2026-09-23. `complianceVerify(pool, user)` returns a bool for a pool it knows
///     and reverts `PoolNotRegistered()` for one it does not, which is the real `0x739f4185` the
///      mainnet validator returned for an unregistered pool. That revert is what the gate must read as
///      unknown, never as a pass.
contract MockValidator is IComplianceValidator {
    mapping(address => bool) public registered;
    mapping(address => bool) public cleared;

    error PoolNotRegistered();

    function register(address pool) external {
        registered[pool] = true;
    }

    function setCleared(address user, bool v) external {
        cleared[user] = v;
    }

    function complianceVerify(address pool, address user) external view returns (bool) {
        if (!registered[pool]) revert PoolNotRegistered();
        return cleared[user];
    }
}

/// @dev A validator whose answer is not decodable as a bool, so the gate must fall to unknown.
contract ShortAnswerValidator is IComplianceValidator {
    function complianceVerify(address, address) external pure returns (bool) {
        assembly {
            // Return 4 bytes, fewer than the 32 the gate needs to decode a bool.
            mstore(0, 0x01)
            return(0, 4)
        }
    }
}

/// @dev A validator that returns a full 32-byte word that is neither 0 nor 1. `abi.decode(_,(bool))`
///      panics on this, so the gate must read the word directly and report Unknown rather than revert.
contract DirtyBoolValidator is IComplianceValidator {
    function complianceVerify(address, address) external pure returns (bool) {
        assembly {
            mstore(0, 2)
            return(0, 32)
        }
    }
}

/// @dev A CVA-shaped token that re-checks the recipient's clearance inside its own transfer. It exists
///      to show the second half of the coupling: even if a caller reached a raw transfer, the asset
///      itself refuses an uncleared recipient. This is the documented CVA property, not the gate's.
contract MockCvaToken is MockToken {
    MockValidator public immutable val;

    error RecipientNotVerified();

    constructor(MockValidator v) {
        val = v;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (!val.cleared(to)) revert RecipientNotVerified();
        return super.transfer(to, amount);
    }
}

contract CleanverseGateTest is Test {
    Aqueous internal escrow;
    MockValidator internal validator;
    CleanverseGate internal gate;
    MockToken internal tok;

    address internal buyer = address(0xB0B);
    address internal worker = address(0x0202);
    address internal stranger = address(0x5712A6E2);

    uint128 internal constant AMOUNT = 100e6;
    uint64 internal deadline;
    bytes32 internal constant SALT = keccak256("hire-1");
    bytes32 internal constant TERMS = keccak256("terms-1");

    function setUp() public {
        // Move off block 1 so a deadline in the past is expressible and the refund path can be reached.
        vm.warp(1_000_000);
        deadline = uint64(block.timestamp + 1 days);

        escrow = new Aqueous(100); // 100-second claim window, unused here because the gate releases
        validator = new MockValidator();
        gate = new CleanverseGate(escrow, validator);

        // The gate is the compliance pool. Off chain this is the Register Compliance Pool step; here
        // it is one call. Without it the validator reverts and the gate refuses every settlement.
        validator.register(address(gate));

        tok = new MockToken();
        tok.mint(buyer, 1_000e6);
        vm.prank(buyer);
        tok.approve(address(gate), type(uint256).max);
    }

    /* ----------------------------------------------------------------- helpers */

    function _open() internal returns (bytes32 jobId) {
        vm.prank(buyer);
        return gate.open(worker, address(tok), AMOUNT, deadline, TERMS, SALT);
    }

    /* -------------------------------------------------------------------- open */

    function test_open_escrowsThroughAqueousAsBuyerAndAgent() public {
        bytes32 jobId = _open();

        CleanverseGate.Record memory r = gate.records(jobId);
        assertEq(r.buyer, buyer);
        assertEq(r.worker, worker);
        assertEq(r.token, address(tok));
        assertEq(uint256(r.amount), AMOUNT);
        assertEq(uint8(r.status), uint8(CleanverseGate.Status.Funded));

        // The money is in Aqueous, held under the gate as both buyer and agent and the gate holds
        // none of it between calls.
        Aqueous.Job memory j = escrow.jobs(jobId);
        assertEq(j.buyer, address(gate));
        assertEq(j.agent, address(gate));
        assertEq(uint256(j.amount), AMOUNT);
        assertEq(tok.balanceOf(address(escrow)), AMOUNT);
        assertEq(tok.balanceOf(address(gate)), 0);
        assertEq(tok.balanceOf(buyer), 1_000e6 - AMOUNT);
        assertEq(gate.jobIdFor(buyer, worker, SALT), jobId);
    }

    function test_open_rejectsBadTerms() public {
        vm.startPrank(buyer);
        vm.expectRevert(CleanverseGate.ZeroWorker.selector);
        gate.open(address(0), address(tok), AMOUNT, deadline, TERMS, SALT);
        vm.expectRevert(CleanverseGate.ZeroToken.selector);
        gate.open(worker, address(0), AMOUNT, deadline, TERMS, SALT);
        vm.expectRevert(CleanverseGate.ZeroAmount.selector);
        gate.open(worker, address(tok), 0, deadline, TERMS, SALT);
        vm.expectRevert(CleanverseGate.DeadlineInPast.selector);
        gate.open(worker, address(tok), AMOUNT, uint64(block.timestamp), TERMS, SALT);
        vm.stopPrank();
    }

    function test_open_refusesFeeOnTransferToken() public {
        FeeToken fee = new FeeToken();
        fee.mint(buyer, 1_000e6);
        vm.startPrank(buyer);
        fee.approve(address(gate), type(uint256).max);
        vm.expectRevert(CleanverseGate.TransferFailed.selector);
        gate.open(worker, address(fee), AMOUNT, deadline, TERMS, SALT);
        vm.stopPrank();
    }

    function test_constructor_refusesZeroDependencies() public {
        vm.expectRevert(CleanverseGate.ZeroEscrow.selector);
        new CleanverseGate(Aqueous(address(0)), validator);
        vm.expectRevert(CleanverseGate.ZeroValidator.selector);
        new CleanverseGate(escrow, IComplianceValidator(address(0)));
    }

    /* ----------------------------------------------------- the coupling itself */

    /// A verified worker settles. This is one half of the property the bounty is scored on.
    function test_settle_verifiedWorkerIsPaid() public {
        validator.setCleared(worker, true);
        bytes32 jobId = _open();

        vm.expectEmit(true, true, false, true, address(gate));
        emit CleanverseGate.GateSettled(jobId, worker, address(tok), AMOUNT);

        vm.prank(buyer);
        gate.settle(jobId);

        assertEq(tok.balanceOf(worker), AMOUNT);
        assertEq(tok.balanceOf(address(escrow)), 0);
        assertEq(tok.balanceOf(address(gate)), 0);
        assertEq(uint8(gate.records(jobId).status), uint8(CleanverseGate.Status.Settled));
        assertEq(uint8(escrow.jobs(jobId).state), uint8(Aqueous.State.Settled));
    }

    /// An unverified worker cannot settle. This is the other half and the money must stay put.
    function test_settle_unverifiedWorkerReverts() public {
        validator.setCleared(worker, false);
        bytes32 jobId = _open();

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviNotVerified.selector);
        gate.settle(jobId);

        assertEq(tok.balanceOf(worker), 0);
        assertEq(tok.balanceOf(address(escrow)), AMOUNT);
        assertEq(uint8(gate.records(jobId).status), uint8(CleanverseGate.Status.Funded));
        assertEq(uint8(escrow.jobs(jobId).state), uint8(Aqueous.State.Open));
    }

    /// A validator that cannot be read is unknown and unknown never settles. Here the gate points at
    /// an address with no code, which is what a wrong or undeployed validator looks like.
    function test_settle_unknownValidatorWithNoCodeFailsClosed() public {
        CleanverseGate lost = new CleanverseGate(escrow, IComplianceValidator(address(0xDEAD)));
        vm.prank(buyer);
        tok.approve(address(lost), type(uint256).max);
        vm.prank(buyer);
        bytes32 jobId = lost.open(worker, address(tok), AMOUNT, deadline, TERMS, SALT);

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviUnknown.selector);
        lost.settle(jobId);

        assertEq(tok.balanceOf(worker), 0);
        assertEq(lost.cviStatus(worker) == CleanverseGate.CviState.Unknown, true);
    }

    /// A validator that reverts because the pool is not registered is unknown too, not a rejection.
    /// This is the real mainnet behaviour: an unregistered pool reverts PoolNotRegistered.
    function test_settle_unregisteredPoolIsUnknownNotVerified() public {
        MockValidator fresh = new MockValidator(); // gate never registered here
        CleanverseGate ungated = new CleanverseGate(escrow, fresh);
        fresh.setCleared(worker, true); // worker is cleared, but the pool is unknown to the validator
        vm.prank(buyer);
        tok.approve(address(ungated), type(uint256).max);
        vm.prank(buyer);
        bytes32 jobId = ungated.open(worker, address(tok), AMOUNT, deadline, TERMS, SALT);

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviUnknown.selector);
        ungated.settle(jobId);

        assertEq(ungated.cviStatus(worker) == CleanverseGate.CviState.Unknown, true);
    }

    /// A validator that answers with fewer than 32 bytes is unknown, not a truthy pass.
    function test_settle_shortAnswerIsUnknown() public {
        CleanverseGate g2 = new CleanverseGate(escrow, new ShortAnswerValidator());
        vm.prank(buyer);
        tok.approve(address(g2), type(uint256).max);
        vm.prank(buyer);
        bytes32 jobId = g2.open(worker, address(tok), AMOUNT, deadline, TERMS, SALT);

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviUnknown.selector);
        g2.settle(jobId);
        assertEq(g2.cviStatus(worker) == CleanverseGate.CviState.Unknown, true);
    }

    /// A validator that returns a dirty bool (a 32-byte word that is not 0 or 1) must read as Unknown,
    /// never panic. `cviStatus` is documented to never revert. abi.decode(_,(bool)) would break
    /// that. This fails against the pre-fix decode.
    function test_settle_dirtyBoolIsUnknownNotPanic() public {
        CleanverseGate g2 = new CleanverseGate(escrow, new DirtyBoolValidator());
        // The status view answers Unknown instead of reverting with a Panic.
        assertEq(g2.cviStatus(worker) == CleanverseGate.CviState.Unknown, true);

        vm.prank(buyer);
        tok.approve(address(g2), type(uint256).max);
        vm.prank(buyer);
        bytes32 jobId = g2.open(worker, address(tok), AMOUNT, deadline, TERMS, SALT);
        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviUnknown.selector);
        g2.settle(jobId);
    }

    /// The subject of the check is the worker, never the caller. A verified buyer must not be able to
    /// settle to an unverified worker.
    function test_settle_verifiesTheWorkerNotTheCaller() public {
        validator.setCleared(buyer, true); // the caller is cleared
        validator.setCleared(worker, false); // the recipient is not
        bytes32 jobId = _open();

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.CviNotVerified.selector);
        gate.settle(jobId);

        assertEq(tok.balanceOf(worker), 0);
    }

    /// Only the buyer settles, matching Aqueous where release is the buyer's decision.
    function test_settle_onlyBuyer() public {
        validator.setCleared(worker, true);
        bytes32 jobId = _open();

        vm.prank(stranger);
        vm.expectRevert(CleanverseGate.NotBuyer.selector);
        gate.settle(jobId);
    }

    /// Settling twice is refused by the gate's own guard, with the gate's own error, before Aqueous is
    /// ever reached. Dropping that guard is one of the mutations and this is the test that catches it.
    function test_settle_cannotSettleTwice() public {
        validator.setCleared(worker, true);
        bytes32 jobId = _open();

        vm.prank(buyer);
        gate.settle(jobId);

        vm.prank(buyer);
        vm.expectRevert(CleanverseGate.NotFunded.selector);
        gate.settle(jobId);
    }

    /* ---------------------------------------------------------------- refund */

    function test_refund_afterDeadlineReturnsToBuyer() public {
        bytes32 jobId = _open();
        vm.warp(deadline + 1);

        vm.expectEmit(true, true, false, true, address(gate));
        emit CleanverseGate.GateRefunded(jobId, buyer, address(tok), AMOUNT);
        gate.refund(jobId); // anyone may call, the money can only reach the buyer

        assertEq(tok.balanceOf(buyer), 1_000e6);
        assertEq(tok.balanceOf(address(escrow)), 0);
        assertEq(uint8(gate.records(jobId).status), uint8(CleanverseGate.Status.Refunded));
        assertEq(uint8(escrow.jobs(jobId).state), uint8(Aqueous.State.Refunded));
    }

    function test_refund_beforeDeadlineReverts() public {
        bytes32 jobId = _open();
        vm.expectRevert(CleanverseGate.DeadlineNotReached.selector);
        gate.refund(jobId);
    }

    function test_refund_refusedAfterSettle() public {
        validator.setCleared(worker, true);
        bytes32 jobId = _open();
        vm.prank(buyer);
        gate.settle(jobId);

        vm.warp(deadline + 1);
        vm.expectRevert(CleanverseGate.NotFunded.selector);
        gate.refund(jobId);
    }

    /* ---------------------------------------------------------------- views */

    function test_cviStatus_reportsThreeStates() public {
        assertEq(gate.cviStatus(worker) == CleanverseGate.CviState.Unverified, true);
        validator.setCleared(worker, true);
        assertEq(gate.cviStatus(worker) == CleanverseGate.CviState.Verified, true);
        // A gate whose pool the validator does not know reports Unknown, not Unverified.
        CleanverseGate ungated = new CleanverseGate(escrow, new MockValidator());
        assertEq(ungated.cviStatus(worker) == CleanverseGate.CviState.Unknown, true);
    }

    /* -------------------------------------------------- the CVA-level backstop */

    /// The asset is the second half of the coupling. A CVA re-checks the recipient inside its own
    /// transfer, so an uncleared worker is refused by the token even on a raw transfer.
    function test_cvaTokenAlsoRefusesUnclearedRecipient() public {
        MockCvaToken cva = new MockCvaToken(validator);
        cva.mint(address(this), 10e6);
        validator.setCleared(worker, false);
        vm.expectRevert(MockCvaToken.RecipientNotVerified.selector);
        cva.transfer(worker, 1e6);

        validator.setCleared(worker, true);
        assertTrue(cva.transfer(worker, 1e6));
        assertEq(cva.balanceOf(worker), 1e6);
    }

    /* -------------------------------------------------------------------- fuzz */

    /// However large the escrow, a cleared worker receives exactly it and an uncleared one receives
    /// nothing and the escrow is only ever emptied on the cleared path.
    function testFuzz_onlyClearedWorkerIsEverPaid(uint128 amount, bool clear) public {
        amount = uint128(bound(amount, 1, 1_000e6));
        validator.setCleared(worker, clear);

        vm.prank(buyer);
        bytes32 jobId = gate.open(worker, address(tok), amount, deadline, TERMS, keccak256(abi.encode(amount, clear)));

        vm.prank(buyer);
        if (clear) {
            gate.settle(jobId);
            assertEq(tok.balanceOf(worker), amount);
            assertEq(tok.balanceOf(address(escrow)), 0);
        } else {
            vm.expectRevert(CleanverseGate.CviNotVerified.selector);
            gate.settle(jobId);
            assertEq(tok.balanceOf(worker), 0);
            assertEq(tok.balanceOf(address(escrow)), amount);
        }
    }
}


/// The owner exists only so Cleanverse can check a registration signature. It must be the deployer
/// and it must not gate anything: a stranger and the owner get exactly the same answers.
contract CleanverseGateOwnerTest is Test {
    function test_ownerIsTheDeployerAndImmutable() public {
        Aqueous escrow = new Aqueous(1 days);
        address deployer = address(0xB0B);
        vm.prank(deployer);
        CleanverseGate g = new CleanverseGate(escrow, IComplianceValidator(address(0xDEAD)));
        assertEq(g.owner(), deployer);
    }
}
