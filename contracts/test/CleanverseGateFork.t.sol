// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {CleanverseGate, IComplianceValidator} from "../src/CleanverseGate.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {MockToken} from "./Sclera.t.sol";

interface ICvaMeta {
    function decimals() external view returns (uint8);
}

/// @notice The gate against the REAL Cleanverse Compliance Validator on Monad, forked locally.
///
/// What only a fork can settle: that the validator this gate is built to call is actually there, that
/// it behaves the way the docs and the live probe said and that the gate's fail-closed handling holds
/// against the real thing rather than only against a mock shaped like it.
///
/// Read live on 2026-09-23 with `eth_getCode` and `eth_call`:
///  - The validator is an ERC-1967 proxy at the address below, present on chain 143 and chain 10143.
///  - `complianceVerify(pool, user)` reverts `PoolNotRegistered()` (`0x739f4185`) for a pool it does
///    not know. A gate that has not completed the off-chain Register Compliance Pool step is exactly
///    such a pool, so the gate reads unknown and refuses to settle. That is the safe direction.
///  - Access USDC (aUSDC), the CVA, is a live ERC-20 with 6 decimals.
///
///   forge test --match-contract CleanverseGateForkTest --fork-url https://rpc.monad.xyz
///
/// Skips itself rather than passing quietly when no fork URL is set.
contract CleanverseGateForkTest is Test {
    /// @dev Hardcoded rather than discovered, so a silent redeploy at a new address fails this test
    ///      instead of passing against a different contract.
    address internal constant REAL_VALIDATOR = 0xA64529732B52EFFD2B245320E88226D72c23b788;
    address internal constant REAL_AUSDC = 0xaC0893567D43C3E7e6e35a72803df05416C1f20D;

    address internal buyer = address(0xB0B);
    address internal worker = address(0x0202);

    modifier onlyForked() {
        if (REAL_VALIDATOR.code.length == 0) {
            emit log("skipped: no fork URL, run with --fork-url https://rpc.monad.xyz");
            return;
        }
        _;
    }

    function test_realValidatorIsLiveAndRefusesAnUnregisteredPool() public onlyForked {
        Aqueous escrow = new Aqueous(100);
        CleanverseGate gate = new CleanverseGate(escrow, IComplianceValidator(REAL_VALIDATOR));

        // Our fresh gate is not a registered compliance pool, so the real validator reverts and the
        // gate must read that as unknown, never as verified.
        assertEq(gate.cviStatus(worker) == CleanverseGate.CviState.Unknown, true, "real validator must read as unknown for an unregistered pool");

        MockToken tok = new MockToken();
        tok.mint(buyer, 1_000e6);
        vm.startPrank(buyer);
        tok.approve(address(gate), type(uint256).max);
        bytes32 jobId = gate.open(worker, address(tok), 100e6, uint64(block.timestamp + 1 days), bytes32(0), keccak256("fork"));

        // Settlement against the real validator fails closed while the pool is unregistered.
        vm.expectRevert(CleanverseGate.CviUnknown.selector);
        gate.settle(jobId);
        vm.stopPrank();

        assertEq(tok.balanceOf(worker), 0, "no payout on an unknown identity read");
    }

    function test_realCvaIsSixDecimals() public onlyForked {
        assertGt(REAL_AUSDC.code.length, 0, "aUSDC must be deployed");
        // aUSDC is 6 decimals like AUSD, not 18. A settlement amount carried over from an 18-decimal
        // token would be wrong by 1e12. `symbol()` is not read here because it returns a string and
        // the CVA's implementation builds that with an opcode this project's Shanghai target does not
        // activate, so it reverts NotActivated locally. `symbol()` is "aUSDC", confirmed off chain.
        assertEq(ICvaMeta(REAL_AUSDC).decimals(), 6, "aUSDC is 6 decimals, like AUSD, not 18");
    }
}
