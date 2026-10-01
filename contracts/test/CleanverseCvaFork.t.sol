// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";

struct RuleV2 {
    bytes2 allowedGroup;
    bytes2 allowedSubGroup;
    uint8 minTier;
    uint8 minSubTier;
    uint256 poolCountryBitmap;
}

interface ICvaPolicy {
    function getRulesV2(address token) external view returns (RuleV2[] memory);
}

interface ICva {
    function policy() external view returns (address);
    function decimals() external view returns (uint8);
}

/// @notice The whitelist requirement for settling in aUSDC, encoded as an assertion against the REAL
///         Cleanverse CVA Policy on Monad, forked locally. This is the on-chain half of flagship 6.1.
///
/// The question 6.1 answers: once aUSDC (a Cleanverse Verified Asset) is the escrowed token, who needs
/// a Cleanverse Verified Identity for an open and a settle to go through? aUSDC gates every transfer
/// through its own policy, not through the gate's own Compliance Validator, so this test reads that
/// policy directly rather than the gate.
///
/// Read live on 2026-10-01 with `cast call`, reproduced by `scripts/cleanverse-cva-sim.sh`:
///  - aUSDC.policy() is the CVA Policy below, the same address on chain 143 and chain 10143.
///  - getRulesV2(aUSDC) is one rule, minTier 5, no group, no country. So a party is compliant only
///    with a CVI of tier 5 or higher.
///  - canTransfer checks BOTH the sender and the recipient and reverts 0xa6725971(offender) for the
///    first party with no CVI. Our buyer, gate and Aqueous addresses hold no CVI, so every aUSDC hop
///    reverts. Only the one tier 20 testnet worker passes.
///
///   mainnet: forge test --match-contract CleanverseCvaForkTest --fork-url https://rpc.monad.xyz
///   testnet: forge test --match-contract CleanverseCvaForkTest --fork-url https://testnet-rpc.monad.xyz
///
/// Skips itself rather than passing quietly when no fork URL is set.
contract CleanverseCvaForkTest is Test {
    /// @dev Hardcoded, so a silent redeploy at a new address fails this test instead of passing
    ///      against a different contract.
    address internal constant AUSDC = 0xaC0893567D43C3E7e6e35a72803df05416C1f20D;
    address internal constant POLICY = 0x36489bE45fa84f70a0c2BDB11D824Be608CB12Dd;
    address internal constant BUYER = 0xDB6c6340342e71A63cD11Ebac2185204b7777777;
    address internal constant WORKER = 0xaA514cD6573f95DdD0df78ec1Fdcb8dA05E70936;

    /// @dev The policy's own compliance-block error, one address naming the first party with no CVI.
    bytes4 internal constant NOT_COMPLIANT = 0xa6725971;

    modifier onlyForked() {
        if (AUSDC.code.length == 0) {
            emit log("skipped: no fork URL, run with --fork-url https://rpc.monad.xyz");
            return;
        }
        _;
    }

    /// @dev Read canTransfer without reverting the test. Returns the clean bool when it passes, else
    ///      the revert selector and the address the policy named as non-compliant.
    function _canTransfer(address from, address to)
        internal
        view
        returns (bool ok, bool passed, bytes4 selector, address offender)
    {
        (bool success, bytes memory ret) =
            POLICY.staticcall(abi.encodeWithSignature("canTransfer(address,address,address,uint256)", AUSDC, from, to, 1));
        if (success) {
            passed = true;
            ok = abi.decode(ret, (bool));
            return (ok, passed, bytes4(0), address(0));
        }
        if (ret.length >= 4) {
            assembly {
                selector := mload(add(ret, 0x20))
            }
        }
        if (ret.length >= 36) {
            bytes32 word;
            assembly {
                word := mload(add(ret, 0x24))
            }
            offender = address(uint160(uint256(word)));
        }
    }

    function test_cvaRoutesThroughThePolicyAndTheRuleIsMinTier5() public onlyForked {
        assertEq(ICva(AUSDC).policy(), POLICY, "aUSDC must gate transfers through the known CVA Policy");
        assertEq(ICva(AUSDC).decimals(), 6, "aUSDC is 6 decimals, like AUSD, not 18");

        RuleV2[] memory rules = ICvaPolicy(POLICY).getRulesV2(AUSDC);
        assertEq(rules.length, 1, "aUSDC carries exactly one rule");
        assertEq(rules[0].minTier, 5, "the rule requires a CVI of tier 5 or higher");
        assertEq(rules[0].allowedGroup, bytes2(0), "no group restriction");
        assertEq(rules[0].poolCountryBitmap, 0, "no country restriction");
    }

    function test_ourBuyerIsNotWhitelistedSoEveryHopWouldRevert() public onlyForked {
        // The buyer EOA holds no CVI on either chain, so it is blocked as the sender of the first hop.
        (, bool passed, bytes4 selector, address offender) = _canTransfer(BUYER, WORKER);
        assertEq(passed, false, "a transfer from the un-whitelisted buyer must not pass");
        assertEq(selector, NOT_COMPLIANT, "the policy blocks it with its own compliance error");
        assertEq(offender, BUYER, "and names the buyer as the non-compliant party");
    }

    function test_bothSenderAndRecipientAreChecked() public onlyForked {
        if (block.chainid == 10143) {
            // Testnet carries the tier 20 worker, so both sides can be shown directly.
            address fresh = address(0xBEEF);
            (bool ok, bool passed,,) = _canTransfer(WORKER, WORKER);
            assertEq(passed && ok, true, "a compliant holder to itself passes");

            (, bool passTo, bytes4 selTo, address offTo) = _canTransfer(WORKER, fresh);
            assertEq(passTo, false, "a compliant sender to an un-whitelisted recipient is blocked");
            assertEq(selTo, NOT_COMPLIANT, "blocked by compliance");
            assertEq(offTo, fresh, "the recipient is the party named, proving 'to' is checked");

            (, bool passFrom,, address offFrom) = _canTransfer(fresh, WORKER);
            assertEq(passFrom, false, "an un-whitelisted sender is blocked even to a compliant recipient");
            assertEq(offFrom, fresh, "the sender is named, proving 'from' is checked");
        } else {
            // Mainnet holds no CVI for any address we control, so the deterministic fact here is that
            // the sender is checked first: our buyer is named for a transfer out of it.
            (, bool passed,, address offender) = _canTransfer(BUYER, WORKER);
            assertEq(passed, false, "un-whitelisted sender blocked");
            assertEq(offender, BUYER, "the sender is checked");
        }
    }
}
