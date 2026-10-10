// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {ScleraV2} from "../src/ScleraV2.sol";
import {IERC20, IERC165, IReceiver} from "../src/Sclera.sol";
import {MockIdentityRegistry} from "./fixtures/MockIdentityRegistry.sol";
import {MockToken, FeeToken} from "./Sclera.t.sol";

/// Version 1's whole suite, run against version 2 with the beneficiary replaced by the burn
/// address. Every v1 property must still hold. The tests at the bottom cover the two changes.
contract ScleraV2Test is Test {
    ScleraV2 internal sc;
    MockToken internal tok;

    uint256 internal attestorKey = 0xA77E5702;
    address internal attestor;

    uint256 internal rogueKey = 0xBADBADBAD;

    address internal agent = address(0xA9E17);
    /// The burn address every slash goes to. Fixed in the bytecode, so it is a constant here too.
    address internal constant sink = 0x000000000000000000000000000000000000dEaD;
    address internal stranger = address(0x5712A6E2);

    uint256 internal constant AGENT_ID = 10182;
    uint128 internal constant BOND = 100e6;

    bytes32 internal constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)"
    );

    /// @dev Read from the contract once, here, then reused. Signing inside a test must not make an
    ///      external call: `vm.expectRevert` binds to the next call it sees, so a `DOMAIN_SEPARATOR()`
    ///      read while building the report gets consumed as "the call that should have reverted" and
    ///      the test passes against a contract that never ran. That cost 12 false failures once.
    bytes32 internal domainSeparator;

    MockIdentityRegistry reg;

    function setUp() public {
        attestor = vm.addr(attestorKey);
        reg = new MockIdentityRegistry();
        reg.setOwner(AGENT_ID, agent);
        sc = new ScleraV2(attestor, address(reg));
        tok = new MockToken();
        domainSeparator = sc.DOMAIN_SEPARATOR();

        tok.mint(agent, 1_000e6);
        vm.prank(agent);
        tok.approve(address(sc), type(uint256).max);

        // Start well clear of block 0 so `windowStart < postedAt` is expressible.
        vm.roll(1_000);
    }

    /* ----------------------------------------------------------------- helpers */

    function _post() internal returns (uint64 postedAt) {
        vm.prank(agent);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
        return uint64(block.number);
    }

    function _sign(uint256 key, ScleraV2.Verdict memory v) internal view returns (bytes memory) {
        return _signFor(domainSeparator, key, v);
    }

    function _signFor(bytes32 domain, uint256 key, ScleraV2.Verdict memory v)
        internal
        pure
        returns (bytes memory)
    {
        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, v.agentId, v.windowStart, v.windowEnd, v.sampleSize, v.trueCount, v.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domain, structHash));
        (uint8 vb, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return abi.encodePacked(r, s, vb);
    }

    function _report(uint256 key, ScleraV2.Verdict memory v) internal view returns (bytes memory) {
        return abi.encode(v, _sign(key, v));
    }

    function _verdict(uint64 start, uint32 sample, uint32 trueCount, uint64 nonce)
        internal
        view
        returns (ScleraV2.Verdict memory)
    {
        return ScleraV2.Verdict({
            agentId: AGENT_ID,
            windowStart: start,
            windowEnd: uint64(block.number),
            sampleSize: sample,
            trueCount: trueCount,
            nonce: nonce
        });
    }

    /* -------------------------------------------------------------------- post */

    function test_post_locksAndRecords() public {
        uint64 at = _post();

        ScleraV2.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(b.agent, agent);
        assertEq(b.token, address(tok));
        assertEq(uint256(b.amount), BOND);
        assertEq(b.minTruthRateBps, 8000);
        assertEq(b.windowBlocks, 100);
        assertEq(b.minSampleSize, 5);
        assertEq(b.postedAt, at);
        assertEq(uint8(b.state), uint8(ScleraV2.State.Active));

        assertEq(tok.balanceOf(address(sc)), BOND);
        assertEq(tok.balanceOf(agent), 1_000e6 - BOND);
        assertEq(sc.maturesAt(AGENT_ID), at + 100);
    }

    function test_post_rejectsDuplicate() public {
        _post();
        vm.prank(agent);
        vm.expectRevert(ScleraV2.BondExists.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
    }

    function test_post_rejectsBadTerms() public {
        vm.startPrank(agent);
        vm.expectRevert(ScleraV2.ZeroAgent.selector);
        sc.postBond(0, address(tok), BOND, 8000, 100, 5);
        vm.expectRevert(ScleraV2.ZeroAmount.selector);
        sc.postBond(AGENT_ID, address(tok), 0, 8000, 100, 5);
        vm.expectRevert(ScleraV2.BadRate.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 10_001, 100, 5);
        vm.expectRevert(ScleraV2.BadWindow.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 0, 5);
        vm.expectRevert(ScleraV2.BadSample.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 0);
        vm.stopPrank();
    }

    function test_post_refusesFeeOnTransferToken() public {
        FeeToken fee = new FeeToken();
        fee.mint(agent, 1_000e6);
        vm.startPrank(agent);
        fee.approve(address(sc), type(uint256).max);
        vm.expectRevert(ScleraV2.TransferFailed.selector);
        sc.postBond(AGENT_ID, address(fee), BOND, 8000, 100, 5);
        vm.stopPrank();
    }

    function test_constructor_refusesZeroAddresses() public {
        vm.expectRevert(ScleraV2.ZeroAgent.selector);
        new ScleraV2(address(0), address(reg));
    }

    /* ------------------------------------------------------------ the forwarder */

    /// The gate the forwarder actually applies before it will call `onReport`. OpenZeppelin's
    /// `ERC165Checker` needs 0x01ffc9a7 true and 0xffffffff false, then the interface itself.
    function test_supportsInterface_matchesWhatTheForwarderAsks() public view {
        assertTrue(sc.supportsInterface(type(IReceiver).interfaceId));
        assertTrue(sc.supportsInterface(type(IERC165).interfaceId));
        assertFalse(sc.supportsInterface(0xffffffff));
        assertFalse(sc.supportsInterface(0xdeadbeef));
    }

    /* ------------------------------------------------------------------ verdict */

    function test_verdict_aboveFloorKeepsTheBond() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        ScleraV2.Verdict memory v = _verdict(at, 10, 9, 1); // 90% against a 80% floor
        vm.expectEmit(true, false, false, true, address(sc));
        emit ScleraV2.VerdictAccepted(AGENT_ID, 10, 9, 9000, 1);
        sc.onReport("", _report(attestorKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(tok.balanceOf(address(sc)), BOND);
        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_belowFloorSlashesToBeneficiary() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        // The measured case: 1 true out of 42.
        ScleraV2.Verdict memory v = _verdict(at, 42, 1, 1);
        sc.onReport("", _report(attestorKey, v));

        ScleraV2.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(ScleraV2.State.Slashed));
        assertEq(uint256(b.amount), 0);
        assertEq(tok.balanceOf(sink), BOND);
        assertEq(tok.balanceOf(address(sc)), 0);
    }

    function test_verdict_exactlyAtFloorIsNotASlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 10, 8, 1); // exactly 8000 bps
        sc.onReport("", _report(attestorKey, v));
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(tok.balanceOf(sink), 0);
    }

    /// The attack the permissionless forwarder makes free. Anyone can reach `onReport`, so the
    /// signature is the only thing standing between a forged verdict and somebody's bond.
    function test_verdict_forgedSignatureCannotSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);

        vm.prank(stranger);
        vm.expectRevert(ScleraV2.BadSignature.selector);
        sc.onReport("", _report(rogueKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(tok.balanceOf(sink), 0);
        assertEq(tok.balanceOf(address(sc)), BOND);
    }

    function test_verdict_garbageSignatureLengthRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);
        vm.expectRevert(ScleraV2.BadSignature.selector);
        sc.onReport("", abi.encode(v, hex"1234"));
    }

    /// Every signature has a mirrored encoding with `s` reflected across the curve order and `v`
    /// flipped, and `ecrecover` accepts both. That is a second valid signature over the same
    /// verdict, so the high half is refused outright rather than left for the nonce to catch.
    function test_verdict_malleableSignatureRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);

        bytes memory good = _sign(attestorKey, v);
        bytes32 r;
        bytes32 s;
        uint8 vb;
        assembly {
            r := mload(add(good, 0x20))
            s := mload(add(good, 0x40))
            vb := byte(0, mload(add(good, 0x60)))
        }

        uint256 n = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;
        bytes32 flippedS = bytes32(n - uint256(s));
        uint8 flippedV = vb == 27 ? 28 : 27;

        // Sanity: the mirrored pair really does recover the same signer, so this test is about the
        // guard rather than about an invalid signature.
        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, v.agentId, v.windowStart, v.windowEnd, v.sampleSize, v.trueCount, v.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        assertEq(ecrecover(digest, flippedV, r, flippedS), attestor, "mirror did not recover the attestor");

        bytes memory report = abi.encode(v, abi.encodePacked(r, flippedS, flippedV));
        vm.expectRevert(ScleraV2.BadSignature.selector);
        sc.onReport("", report);

        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_badVByteRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);

        bytes memory good = _sign(attestorKey, v);
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(good, 0x20))
            s := mload(add(good, 0x40))
        }
        bytes memory report = abi.encode(v, abi.encodePacked(r, s, uint8(29)));
        vm.expectRevert(ScleraV2.BadSignature.selector);
        sc.onReport("", report);
    }

    /// A signature is valid for one deployment on one chain. Lifting it to another must fail, which
    /// is what the EIP-712 domain is for.
    function test_verdict_signatureDoesNotCrossDeployments() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);
        bytes memory report = _report(attestorKey, v);

        ScleraV2 other = new ScleraV2(attestor, address(reg));
        MockToken t2 = new MockToken();
        t2.mint(agent, 1_000e6);
        vm.startPrank(agent);
        t2.approve(address(other), type(uint256).max);
        other.postBond(AGENT_ID, address(t2), BOND, 8000, 100, 5);
        vm.stopPrank();

        vm.expectRevert(ScleraV2.BadSignature.selector);
        other.onReport("", report);
    }

    function test_verdict_replayRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 10, 9, 1);
        sc.onReport("", _report(attestorKey, v));

        vm.expectRevert(ScleraV2.StaleVerdict.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_lowerNonceRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 10, 9, 5)));

        vm.expectRevert(ScleraV2.StaleVerdict.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 10, 9, 4)));
    }

    /// The forward-looking rule, enforced in the contract rather than trusted to the workflow.
    function test_verdict_windowBeforePostedAtRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at - 1, 42, 0, 1);

        vm.expectRevert(ScleraV2.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));

        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_futureWindowEndRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 42, 0, 1);
        v.windowEnd = uint64(block.number + 1);

        vm.expectRevert(ScleraV2.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_invertedWindowRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at + 5, 42, 0, 1);
        v.windowEnd = at + 1;

        vm.expectRevert(ScleraV2.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    /// One bad receipt out of one is a 0% rate and it is also noise. The floor on sample size is
    /// what keeps the bond a commitment rather than a coin flip.
    function test_verdict_sampleBelowMinimumCannotSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 4, 0, 1); // minSampleSize is 5

        vm.expectRevert(ScleraV2.SampleTooSmall.selector);
        sc.onReport("", _report(attestorKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(tok.balanceOf(sink), 0);
    }

    /// A too-small sample still burns its nonce, so the same number cannot be reused later for a
    /// verdict that would slash.
    function test_verdict_smallSampleStillConsumesTheNonce() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        vm.expectRevert(ScleraV2.SampleTooSmall.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 4, 0, 7)));

        assertEq(sc.bonds(AGENT_ID).lastNonce, 0, "a reverted report must not record its nonce");
    }

    function test_verdict_trueCountAboveSampleRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        ScleraV2.Verdict memory v = _verdict(at, 10, 11, 1);

        vm.expectRevert(ScleraV2.BadSample.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_noActiveBondRefused() public {
        ScleraV2.Verdict memory v = _verdict(uint64(block.number), 10, 9, 1);
        vm.expectRevert(ScleraV2.WrongState.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_afterSlashRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 1)));

        vm.expectRevert(ScleraV2.WrongState.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 2)));
    }

    /* ----------------------------------------------------------------- release */

    function test_release_refusedWhileWindowOpen() public {
        _post();
        vm.roll(block.number + 99);
        vm.expectRevert(ScleraV2.WindowOpen.selector);
        sc.release(AGENT_ID);
    }

    function test_release_returnsBondAtMaturity() public {
        _post();
        vm.roll(block.number + 100);

        sc.release(AGENT_ID);

        ScleraV2.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(ScleraV2.State.Released));
        assertEq(uint256(b.amount), 0);
        assertEq(tok.balanceOf(agent), 1_000e6);
        assertEq(tok.balanceOf(address(sc)), 0);
    }

    /// Anyone may call it because the money can only go to the agent that posted it.
    function test_release_callableByStrangerButPaysTheAgent() public {
        _post();
        vm.roll(block.number + 100);

        vm.prank(stranger);
        sc.release(AGENT_ID);

        assertEq(tok.balanceOf(agent), 1_000e6);
        assertEq(tok.balanceOf(stranger), 0);
    }

    function test_release_refusedAfterSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 1)));

        vm.roll(block.number + 200);
        vm.expectRevert(ScleraV2.WrongState.selector);
        sc.release(AGENT_ID);
    }

    function test_release_refusedTwice() public {
        _post();
        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        vm.expectRevert(ScleraV2.WrongState.selector);
        sc.release(AGENT_ID);
    }

    function test_release_unknownBond() public {
        vm.expectRevert(ScleraV2.NoSuchBond.selector);
        sc.release(999);
    }

    function test_release_failedTransferReverts() public {
        _post();
        vm.roll(block.number + 100);
        tok.setFailTransfers(true);
        vm.expectRevert(ScleraV2.TransferFailed.selector);
        sc.release(AGENT_ID);
    }

    /* -------------------------------------------------------------------- fuzz */

    /// The rate is integer division and the only thing that must never happen is a slash when the
    /// agent met its commitment.
    function testFuzz_slashOnlyBelowFloor(uint32 sample, uint32 trueCount, uint16 floorBps) public {
        sample = uint32(bound(sample, 5, 100_000));
        trueCount = uint32(bound(trueCount, 0, sample));
        floorBps = uint16(bound(floorBps, 0, 10_000));

        vm.prank(agent);
        sc.postBond(AGENT_ID, address(tok), BOND, floorBps, 100, 5);
        uint64 at = uint64(block.number);
        vm.roll(block.number + 10);

        sc.onReport("", _report(attestorKey, _verdict(at, sample, trueCount, 1)));

        uint16 rate = uint16((uint256(trueCount) * 10_000) / sample);
        bool slashed = sc.bonds(AGENT_ID).state == ScleraV2.State.Slashed;
        assertEq(slashed, rate < floorBps, "slash disagreed with the committed floor");
        assertEq(tok.balanceOf(sink), slashed ? BOND : 0);
    }

    function testFuzz_windowStartNeverBeforePostedAt(uint64 start) public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        start = uint64(bound(start, 0, at - 1));

        ScleraV2.Verdict memory v = _verdict(start, 42, 0, 1);
        vm.expectRevert(ScleraV2.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
        assertEq(tok.balanceOf(sink), 0);
    }

    /* ------------------------------------------------- finding 9: agent ownership */

    /// A bond must be the AGENT's stake. Without this the whole thesis is a description of intent
    /// rather than a fact about the caller.
    function test_postBond_strangerCannotBondSomebodyElsesAgent() public {
        address stranger = address(0xBEEF);
        tok.mint(stranger, 1_000e6);
        vm.prank(stranger);
        tok.approve(address(sc), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(ScleraV2.NotAgentOwner.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
    }

    /// The squat this closes: a stranger taking the only bond slot for one atomic unit, after which
    /// the real owner could never bond that agent again.
    function test_postBond_strangerCannotSquatTheSlot() public {
        address stranger = address(0xBEEF);
        tok.mint(stranger, 1_000e6);
        vm.prank(stranger);
        tok.approve(address(sc), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(ScleraV2.NotAgentOwner.selector);
        sc.postBond(AGENT_ID, address(tok), 1, 0, 100, 5);

        // The owner is still able to bond, which is the property that was broken.
        uint64 at = _post();
        assertEq(sc.bonds(AGENT_ID).agent, agent, "the owner must still be able to bond");
        assertGt(at, 0);
    }

    /// A stranger must not be able to fake a bond that can never be slashed. minTruthRateBps = 0 is
    /// the specific shape that made a bond meaningless, so it is named in a test.
    function test_postBond_unslashableBondCannotBeCreatedByAStranger() public {
        address stranger = address(0xBEEF);
        tok.mint(stranger, 10e6);
        vm.prank(stranger);
        tok.approve(address(sc), type(uint256).max);

        vm.prank(stranger);
        vm.expectRevert(ScleraV2.NotAgentOwner.selector);
        sc.postBond(AGENT_ID, address(tok), 1, 0, 100, 5);

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.None), "no bond may exist");
    }

    /// An unregistered agent has no owner, and the registry's own revert is what stops it. Asserted
    /// so a future mock that returns address(0) instead cannot make this pass wrongly.
    function test_postBond_unregisteredAgentCannotBeBonded() public {
        uint256 ghost = 999_999;
        vm.prank(agent);
        vm.expectRevert(MockIdentityRegistry.NonexistentToken.selector);
        sc.postBond(ghost, address(tok), BOND, 8000, 100, 5);
    }

    /// The registry address is fixed at deploy and there is no setter, so authority over who may bond
    /// cannot be moved after the fact.
    function test_identityRegistryIsImmutable() public view {
        assertEq(sc.identityRegistry(), address(reg));
    }

    function test_constructorRefusesZeroIdentityRegistry() public {
        vm.expectRevert(ScleraV2.ZeroAgent.selector);
        new ScleraV2(attestor, address(0));
    }

    /* ============================================================ version 2 changes */

    /// Change 1: the beneficiary is a constant burn address, not a constructor argument.
    function test_v2_slashBeneficiaryIsTheBurnAddress() public view {
        assertEq(sc.slashBeneficiary(), 0x000000000000000000000000000000000000dEaD);
        assertTrue(sc.slashBeneficiary() != attestor, "the attestor must never receive a slash");
    }

    /// Change 1, end to end: a slash moves the stake to the burn address and to nobody else.
    function test_v2_slashBurnsAndPaysNobodyInTheDecisionPath() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 1)));
        assertEq(tok.balanceOf(0x000000000000000000000000000000000000dEaD), BOND);
        assertEq(tok.balanceOf(attestor), 0, "attestor paid by a slash");
        assertEq(tok.balanceOf(address(this)), 0, "caller paid by a slash");
        assertEq(tok.balanceOf(address(sc)), 0);
    }

    /// Change 2: after a clean release the owner can bond the same agent again.
    function test_v2_rebondAfterRelease() public {
        _post();
        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        vm.roll(block.number + 5);
        uint64 at2 = _post();
        ScleraV2.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(ScleraV2.State.Active));
        assertEq(b.postedAt, at2);
        assertEq(uint256(b.amount), BOND);
        assertEq(sc.postCount(AGENT_ID), 2);
        assertEq(tok.balanceOf(address(sc)), BOND);
    }

    /// Change 2: a slashed agent may also make a new commitment. The old one stays slashed in the
    /// event log. Nothing is refunded.
    function test_v2_rebondAfterSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 1)));
        vm.roll(block.number + 1);
        _post();
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
        assertEq(tok.balanceOf(sink), BOND, "the first stake stays burned");
        assertEq(sc.postCount(AGENT_ID), 2);
    }

    /// Change 2 must not loosen the one-active-bond rule.
    function test_v2_secondBondWhileActiveStillRefused() public {
        _post();
        vm.roll(block.number + 50);
        vm.prank(agent);
        vm.expectRevert(ScleraV2.BondExists.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
    }

    /// Change 2's main risk: a verdict signed while the first bond was live, never submitted, then
    /// replayed against the second bond. Its window starts before the new postedAt, so it is refused.
    function test_v2_verdictForAnEarlierBondCannotSlashALaterOne() public {
        uint64 at = _post();
        vm.roll(block.number + 100);
        ScleraV2.Verdict memory old = _verdict(at, 42, 0, 7);
        bytes memory oldReport = _report(attestorKey, old);
        sc.release(AGENT_ID);
        vm.roll(block.number + 1);
        _post();
        vm.roll(block.number + 10);
        vm.expectRevert(ScleraV2.WindowMismatch.selector);
        sc.onReport("", oldReport);
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Active));
    }

    /// Change 2: nonces stay monotonic across bonds, so a fresh window cannot reuse a spent nonce.
    function test_v2_nonceCarriesAcrossBonds() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 40, 5)));
        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        vm.roll(block.number + 1);
        uint64 at2 = _post();
        vm.roll(block.number + 10);
        vm.expectRevert(ScleraV2.StaleVerdict.selector);
        sc.onReport("", _report(attestorKey, _verdict(at2, 42, 0, 5)));
        sc.onReport("", _report(attestorKey, _verdict(at2, 42, 0, 6)));
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(ScleraV2.State.Slashed));
    }

    /// The owner check still applies to a re-bond, so a stranger cannot take over after a release.
    function test_v2_strangerCannotRebondAfterRelease() public {
        _post();
        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        address stranger2 = address(0xBEEF);
        tok.mint(stranger2, 10e6);
        vm.startPrank(stranger2);
        tok.approve(address(sc), type(uint256).max);
        vm.expectRevert(ScleraV2.NotAgentOwner.selector);
        sc.postBond(AGENT_ID, address(tok), 1, 0, 100, 5);
        vm.stopPrank();
    }
}
