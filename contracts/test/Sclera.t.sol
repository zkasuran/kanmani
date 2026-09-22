// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Sclera, IERC20, IERC165, IReceiver} from "../src/Sclera.sol";

/// @dev A plain ERC-20. Nothing clever, because what is under test is Sclera's accounting.
contract MockToken is IERC20 {
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    bool public failTransfers;

    function setFailTransfers(bool v) external {
        failTransfers = v;
    }

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) public virtual returns (bool) {
        if (failTransfers) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) public virtual returns (bool) {
        if (failTransfers) return false;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

/// @dev Takes a cut on the way in. Sclera must refuse it at post time rather than record a bond
///      it does not hold.
contract FeeToken is MockToken {
    function transferFrom(address from, address to, uint256 amount) public override returns (bool) {
        uint256 fee = amount / 100;
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount - fee;
        return true;
    }
}

contract ScleraTest is Test {
    Sclera internal sc;
    MockToken internal tok;

    uint256 internal attestorKey = 0xA77E5702;
    address internal attestor;

    uint256 internal rogueKey = 0xBADBADBAD;

    address internal agent = address(0xA9E17);
    address internal sink = address(0x5104);
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

    function setUp() public {
        attestor = vm.addr(attestorKey);
        sc = new Sclera(attestor, sink);
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

    function _sign(uint256 key, Sclera.Verdict memory v) internal view returns (bytes memory) {
        return _signFor(domainSeparator, key, v);
    }

    function _signFor(bytes32 domain, uint256 key, Sclera.Verdict memory v)
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

    function _report(uint256 key, Sclera.Verdict memory v) internal view returns (bytes memory) {
        return abi.encode(v, _sign(key, v));
    }

    function _verdict(uint64 start, uint32 sample, uint32 trueCount, uint64 nonce)
        internal
        view
        returns (Sclera.Verdict memory)
    {
        return Sclera.Verdict({
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

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(b.agent, agent);
        assertEq(b.token, address(tok));
        assertEq(uint256(b.amount), BOND);
        assertEq(b.minTruthRateBps, 8000);
        assertEq(b.windowBlocks, 100);
        assertEq(b.minSampleSize, 5);
        assertEq(b.postedAt, at);
        assertEq(uint8(b.state), uint8(Sclera.State.Active));

        assertEq(tok.balanceOf(address(sc)), BOND);
        assertEq(tok.balanceOf(agent), 1_000e6 - BOND);
        assertEq(sc.maturesAt(AGENT_ID), at + 100);
    }

    function test_post_rejectsDuplicate() public {
        _post();
        vm.prank(agent);
        vm.expectRevert(Sclera.BondExists.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
    }

    function test_post_rejectsBadTerms() public {
        vm.startPrank(agent);
        vm.expectRevert(Sclera.ZeroAgent.selector);
        sc.postBond(0, address(tok), BOND, 8000, 100, 5);
        vm.expectRevert(Sclera.ZeroAmount.selector);
        sc.postBond(AGENT_ID, address(tok), 0, 8000, 100, 5);
        vm.expectRevert(Sclera.BadRate.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 10_001, 100, 5);
        vm.expectRevert(Sclera.BadWindow.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 0, 5);
        vm.expectRevert(Sclera.BadSample.selector);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 0);
        vm.stopPrank();
    }

    function test_post_refusesFeeOnTransferToken() public {
        FeeToken fee = new FeeToken();
        fee.mint(agent, 1_000e6);
        vm.startPrank(agent);
        fee.approve(address(sc), type(uint256).max);
        vm.expectRevert(Sclera.TransferFailed.selector);
        sc.postBond(AGENT_ID, address(fee), BOND, 8000, 100, 5);
        vm.stopPrank();
    }

    function test_constructor_refusesZeroAddresses() public {
        vm.expectRevert(Sclera.ZeroAgent.selector);
        new Sclera(address(0), sink);
        vm.expectRevert(Sclera.ZeroAgent.selector);
        new Sclera(attestor, address(0));
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

        Sclera.Verdict memory v = _verdict(at, 10, 9, 1); // 90% against a 80% floor
        vm.expectEmit(true, false, false, true, address(sc));
        emit Sclera.VerdictAccepted(AGENT_ID, 10, 9, 9000, 1);
        sc.onReport("", _report(attestorKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(Sclera.State.Active));
        assertEq(tok.balanceOf(address(sc)), BOND);
        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_belowFloorSlashesToBeneficiary() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        // The measured case: 1 true out of 42.
        Sclera.Verdict memory v = _verdict(at, 42, 1, 1);
        sc.onReport("", _report(attestorKey, v));

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Slashed));
        assertEq(uint256(b.amount), 0);
        assertEq(tok.balanceOf(sink), BOND);
        assertEq(tok.balanceOf(address(sc)), 0);
    }

    function test_verdict_exactlyAtFloorIsNotASlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 10, 8, 1); // exactly 8000 bps
        sc.onReport("", _report(attestorKey, v));
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(Sclera.State.Active));
        assertEq(tok.balanceOf(sink), 0);
    }

    /// The attack the permissionless forwarder makes free. Anyone can reach `onReport`, so the
    /// signature is the only thing standing between a forged verdict and somebody's bond.
    function test_verdict_forgedSignatureCannotSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);

        vm.prank(stranger);
        vm.expectRevert(Sclera.BadSignature.selector);
        sc.onReport("", _report(rogueKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(Sclera.State.Active));
        assertEq(tok.balanceOf(sink), 0);
        assertEq(tok.balanceOf(address(sc)), BOND);
    }

    function test_verdict_garbageSignatureLengthRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);
        vm.expectRevert(Sclera.BadSignature.selector);
        sc.onReport("", abi.encode(v, hex"1234"));
    }

    /// Every signature has a mirrored encoding with `s` reflected across the curve order and `v`
    /// flipped, and `ecrecover` accepts both. That is a second valid signature over the same
    /// verdict, so the high half is refused outright rather than left for the nonce to catch.
    function test_verdict_malleableSignatureRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);

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
        vm.expectRevert(Sclera.BadSignature.selector);
        sc.onReport("", report);

        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_badVByteRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);

        bytes memory good = _sign(attestorKey, v);
        bytes32 r;
        bytes32 s;
        assembly {
            r := mload(add(good, 0x20))
            s := mload(add(good, 0x40))
        }
        bytes memory report = abi.encode(v, abi.encodePacked(r, s, uint8(29)));
        vm.expectRevert(Sclera.BadSignature.selector);
        sc.onReport("", report);
    }

    /// A signature is valid for one deployment on one chain. Lifting it to another must fail, which
    /// is what the EIP-712 domain is for.
    function test_verdict_signatureDoesNotCrossDeployments() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);
        bytes memory report = _report(attestorKey, v);

        Sclera other = new Sclera(attestor, sink);
        MockToken t2 = new MockToken();
        t2.mint(agent, 1_000e6);
        vm.startPrank(agent);
        t2.approve(address(other), type(uint256).max);
        other.postBond(AGENT_ID, address(t2), BOND, 8000, 100, 5);
        vm.stopPrank();

        vm.expectRevert(Sclera.BadSignature.selector);
        other.onReport("", report);
    }

    function test_verdict_replayRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 10, 9, 1);
        sc.onReport("", _report(attestorKey, v));

        vm.expectRevert(Sclera.StaleVerdict.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_lowerNonceRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 10, 9, 5)));

        vm.expectRevert(Sclera.StaleVerdict.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 10, 9, 4)));
    }

    /// The forward-looking rule, enforced in the contract rather than trusted to the workflow.
    function test_verdict_windowBeforePostedAtRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at - 1, 42, 0, 1);

        vm.expectRevert(Sclera.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));

        assertEq(tok.balanceOf(sink), 0);
    }

    function test_verdict_futureWindowEndRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 42, 0, 1);
        v.windowEnd = uint64(block.number + 1);

        vm.expectRevert(Sclera.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_invertedWindowRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at + 5, 42, 0, 1);
        v.windowEnd = at + 1;

        vm.expectRevert(Sclera.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    /// One bad receipt out of one is a 0% rate and it is also noise. The floor on sample size is
    /// what keeps the bond a commitment rather than a coin flip.
    function test_verdict_sampleBelowMinimumCannotSlash() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 4, 0, 1); // minSampleSize is 5

        vm.expectRevert(Sclera.SampleTooSmall.selector);
        sc.onReport("", _report(attestorKey, v));

        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(Sclera.State.Active));
        assertEq(tok.balanceOf(sink), 0);
    }

    /// A too-small sample still burns its nonce, so the same number cannot be reused later for a
    /// verdict that would slash.
    function test_verdict_smallSampleStillConsumesTheNonce() public {
        uint64 at = _post();
        vm.roll(block.number + 10);

        vm.expectRevert(Sclera.SampleTooSmall.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 4, 0, 7)));

        assertEq(sc.bonds(AGENT_ID).lastNonce, 0, "a reverted report must not record its nonce");
    }

    function test_verdict_trueCountAboveSampleRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        Sclera.Verdict memory v = _verdict(at, 10, 11, 1);

        vm.expectRevert(Sclera.BadSample.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_noActiveBondRefused() public {
        Sclera.Verdict memory v = _verdict(uint64(block.number), 10, 9, 1);
        vm.expectRevert(Sclera.WrongState.selector);
        sc.onReport("", _report(attestorKey, v));
    }

    function test_verdict_afterSlashRefused() public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 1)));

        vm.expectRevert(Sclera.WrongState.selector);
        sc.onReport("", _report(attestorKey, _verdict(at, 42, 1, 2)));
    }

    /* ----------------------------------------------------------------- release */

    function test_release_refusedWhileWindowOpen() public {
        _post();
        vm.roll(block.number + 99);
        vm.expectRevert(Sclera.WindowOpen.selector);
        sc.release(AGENT_ID);
    }

    function test_release_returnsBondAtMaturity() public {
        _post();
        vm.roll(block.number + 100);

        sc.release(AGENT_ID);

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Released));
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
        vm.expectRevert(Sclera.WrongState.selector);
        sc.release(AGENT_ID);
    }

    function test_release_refusedTwice() public {
        _post();
        vm.roll(block.number + 100);
        sc.release(AGENT_ID);
        vm.expectRevert(Sclera.WrongState.selector);
        sc.release(AGENT_ID);
    }

    function test_release_unknownBond() public {
        vm.expectRevert(Sclera.NoSuchBond.selector);
        sc.release(999);
    }

    function test_release_failedTransferReverts() public {
        _post();
        vm.roll(block.number + 100);
        tok.setFailTransfers(true);
        vm.expectRevert(Sclera.TransferFailed.selector);
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
        bool slashed = sc.bonds(AGENT_ID).state == Sclera.State.Slashed;
        assertEq(slashed, rate < floorBps, "slash disagreed with the committed floor");
        assertEq(tok.balanceOf(sink), slashed ? BOND : 0);
    }

    function testFuzz_windowStartNeverBeforePostedAt(uint64 start) public {
        uint64 at = _post();
        vm.roll(block.number + 10);
        start = uint64(bound(start, 0, at - 1));

        Sclera.Verdict memory v = _verdict(start, 42, 0, 1);
        vm.expectRevert(Sclera.WindowMismatch.selector);
        sc.onReport("", _report(attestorKey, v));
        assertEq(tok.balanceOf(sink), 0);
    }
}
