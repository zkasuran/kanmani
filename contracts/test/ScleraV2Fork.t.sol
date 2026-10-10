// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ScleraV2} from "../src/ScleraV2.sol";
import {IERC20} from "../src/Sclera.sol";

/// Version 2 against Monad mainnet state: the real ERC-8004 Identity Registry, real Circle USDC and
/// a real agent owner. The unit suite proves the logic. This proves the two things only the live
/// chain can: that Circle USDC accepts a transfer to the burn address, and that the real registry
/// gates a re-bond the same way it gates the first one.
///
///   MONAD_RPC=https://rpc.monad.xyz forge test --match-contract ScleraV2Fork
contract ScleraV2ForkTest is Test {
    address constant REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;
    address constant BURN = 0x000000000000000000000000000000000000dEaD;
    uint256 constant AGENT_ID = 10252; // Kanmani's own agent, so the owner is a wallet we control
    uint128 constant AMOUNT = 10_000; // 0.01 USDC

    uint256 attestorKey = 0xA77E5702;
    ScleraV2 sc;
    address owner;

    bytes32 constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)"
    );

    function setUp() public {
        vm.createSelectFork(vm.envOr("MONAD_RPC", string("https://rpc.monad.xyz")));
        sc = new ScleraV2(vm.addr(attestorKey), REGISTRY);
        (bool ok, bytes memory ret) = REGISTRY.staticcall(abi.encodeWithSignature("ownerOf(uint256)", AGENT_ID));
        require(ok, "ownerOf failed");
        owner = abi.decode(ret, (address));
        require(IERC20(USDC).balanceOf(owner) >= 2 * AMOUNT, "owner needs 0.02 USDC on the fork");
        vm.prank(owner);
        (ok,) = USDC.call(abi.encodeWithSignature("approve(address,uint256)", address(sc), uint256(type(uint128).max)));
        require(ok, "approve failed");
    }

    function _report(uint64 start, uint32 sample, uint32 trueCount, uint64 nonce) internal view returns (bytes memory) {
        ScleraV2.Verdict memory v = ScleraV2.Verdict(AGENT_ID, start, uint64(block.number), sample, trueCount, nonce);
        bytes32 sh = keccak256(abi.encode(VERDICT_TYPEHASH, v.agentId, v.windowStart, v.windowEnd, v.sampleSize, v.trueCount, v.nonce));
        (uint8 vb, bytes32 r, bytes32 s) = vm.sign(attestorKey, keccak256(abi.encodePacked("\x19\x01", sc.DOMAIN_SEPARATOR(), sh)));
        return abi.encode(v, abi.encodePacked(r, s, vb));
    }

    function test_fork_slashBurnsRealUsdcThenOwnerRebonds() public {
        uint256 burnBefore = IERC20(USDC).balanceOf(BURN);
        uint256 ownerBefore = IERC20(USDC).balanceOf(owner);

        vm.prank(owner);
        sc.postBond(AGENT_ID, USDC, AMOUNT, 8000, 100, 5);
        uint64 at = uint64(block.number);

        vm.roll(block.number + 10);
        sc.onReport("", _report(at, 10, 1, 1));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Slashed));
        assertEq(IERC20(USDC).balanceOf(BURN) - burnBefore, AMOUNT, "Circle USDC must accept the burn transfer");
        assertEq(ownerBefore - IERC20(USDC).balanceOf(owner), AMOUNT);

        // The real registry still gates the re-bond: a stranger is refused, the owner is not.
        vm.prank(address(0xBEEF));
        vm.expectRevert(ScleraV2.NotAgentOwner.selector);
        sc.postBond(AGENT_ID, USDC, 1, 0, 100, 5);

        vm.roll(block.number + 1);
        vm.prank(owner);
        sc.postBond(AGENT_ID, USDC, AMOUNT, 8000, 100, 5);
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(sc.postCount(AGENT_ID), 2);

        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        assertEq(ownerBefore - IERC20(USDC).balanceOf(owner), AMOUNT, "second bond came back in full");
    }
}
