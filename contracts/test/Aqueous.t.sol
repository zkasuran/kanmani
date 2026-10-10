// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Aqueous, IERC20, IERC3009} from "../src/Aqueous.sol";

/// @dev A plain ERC-20 with the EIP-3009 surface Aqueous uses. `transferWithAuthorization` here
///      does no signature checking on purpose: the real token does that and a mock that pretends
///      to verify signatures tests the mock rather than the contract. What we assert is that
///      Aqueous credits the authorisation's `from` rather than `msg.sender`.
contract MockUSDC is IERC20, IERC3009 {
    string public name = "USD Coin";
    uint8 public decimals = 6; // 6, not 18. The whole point of reading it at runtime.

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

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

    function receiveWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8,
        bytes32,
        bytes32
    ) external {
        require(msg.sender == to, "caller must be payee");
        require(block.timestamp > validAfter, "auth: too early");
        require(block.timestamp < validBefore, "auth: expired");
        require(!authorizationState[from][nonce], "auth: nonce used"); // replay guard
        authorizationState[from][nonce] = true;
        balanceOf[from] -= value;
        balanceOf[to] += value;
    }
}

/// @dev Tries to re-enter `release` from inside the payout transfer.
contract ReentrantToken is MockUSDC {
    Aqueous public target;
    bytes32 public jobId;
    bool public armed;

    function arm(Aqueous t, bytes32 id) external {
        target = t;
        jobId = id;
        armed = true;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (armed) {
            armed = false; // one shot, so a failed re-entry does not loop
            target.release(jobId); // should revert and take the outer call with it
        }
        return super.transfer(to, amount);
    }
}

/// @dev Records the job state at the moment the payout transfer calls back, which is the only way
///      to test checks-effects-interactions ordering INDEPENDENTLY of the reentrancy guard.
///      Found by mutation testing: breaking CEI left all 28 tests green, because the guard caught
///      the attack instead. A guard is a second line of defence, not evidence the first one exists.
contract StateSpyToken is MockUSDC {
    Aqueous public target;
    bytes32 public jobId;
    uint8 public stateAtCallback = 255; // 255 means the callback never happened

    function watch(Aqueous t, bytes32 id) external {
        target = t;
        jobId = id;
    }

    function transfer(address to, uint256 amount) public override returns (bool) {
        if (address(target) != address(0)) {
            stateAtCallback = uint8(target.jobs(jobId).state);
        }
        return super.transfer(to, amount);
    }
}

contract AqueousTest is Test {
    Aqueous internal esc;
    MockUSDC internal usdc;

    address internal buyer = address(0xB0B);
    address internal agent = address(0xA6E7);
    address internal relayer = address(0xBEEF); // pays gas, gets no rights
    address internal stranger = address(0x5747);

    uint64 internal constant CLAIM_WINDOW = 3 days;
    uint128 internal constant AMOUNT = 10_000_000; // 10 USDC at 6 decimals
    bytes32 internal constant SALT = keccak256("job-1");
    bytes32 internal constant TERMS = keccak256("do the thing");

    function setUp() public {
        esc = new Aqueous(CLAIM_WINDOW);
        usdc = new MockUSDC();
        usdc.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        usdc.approve(address(esc), type(uint256).max);
    }

    /* ------------------------------------------------------------- helpers */

    function _terms(uint128 amount, uint128 pricePerUnit, bytes32 salt)
        internal
        view
        returns (Aqueous.Terms memory)
    {
        return Aqueous.Terms({
            agent: agent,
            token: address(usdc),
            amount: amount,
            pricePerUnit: pricePerUnit,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: TERMS,
            salt: salt
        });
    }

    function _open() internal returns (bytes32 id) {
        vm.prank(buyer);
        id = esc.createJob(_terms(AMOUNT, 0, SALT));
    }

    /* ------------------------------------------------------- happy lifecycle */

    function test_createHoldsTheMoney() public {
        uint256 before = usdc.balanceOf(buyer);
        bytes32 id = _open();

        assertEq(usdc.balanceOf(address(esc)), AMOUNT, "escrow holds it");
        assertEq(usdc.balanceOf(buyer), before - AMOUNT, "buyer paid it");
        assertEq(uint8(esc.jobs(id).state), uint8(Aqueous.State.Open));
        assertEq(esc.jobs(id).buyer, buyer);
    }

    function test_deliverThenRelease() public {
        bytes32 id = _open();

        vm.prank(agent);
        esc.deliver(id, keccak256("output"));
        assertEq(uint8(esc.jobs(id).state), uint8(Aqueous.State.Delivered));

        vm.prank(buyer);
        esc.release(id);

        assertEq(usdc.balanceOf(agent), AMOUNT, "agent paid");
        assertEq(usdc.balanceOf(address(esc)), 0, "escrow empty");
        assertEq(uint8(esc.jobs(id).state), uint8(Aqueous.State.Settled));
    }

    /* --------------------------------------------------------- the exits */

    function test_refundAfterDeadline() public {
        bytes32 id = _open();
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        esc.refund(id);

        assertEq(usdc.balanceOf(buyer), before + AMOUNT, "buyer whole again");
        assertEq(uint8(esc.jobs(id).state), uint8(Aqueous.State.Refunded));
    }

    function test_refundBlockedBeforeDeadline() public {
        bytes32 id = _open();
        vm.prank(buyer);
        vm.expectRevert(Aqueous.DeadlineNotPassed.selector);
        esc.refund(id);
    }

    /// A delivered job is not refundable. Otherwise a buyer takes the work and the money back.
    function test_refundBlockedOnceDelivered() public {
        bytes32 id = _open();
        vm.prank(agent);
        esc.deliver(id, keccak256("output"));

        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.WrongState.selector);
        esc.refund(id);
    }

    /// The agent's exit. Without it a silent buyer strands a delivered job forever.
    function test_agentClaimsAfterWindow() public {
        bytes32 id = _open();
        vm.prank(agent);
        esc.deliver(id, keccak256("output"));

        vm.warp(block.timestamp + CLAIM_WINDOW + 1);
        vm.prank(agent);
        esc.claimDelivered(id);

        assertEq(usdc.balanceOf(agent), AMOUNT, "agent got paid without the buyer");
    }

    function test_agentCannotClaimInsideWindow() public {
        bytes32 id = _open();
        vm.prank(agent);
        esc.deliver(id, keccak256("output"));

        vm.warp(block.timestamp + CLAIM_WINDOW - 1);
        vm.prank(agent);
        vm.expectRevert(Aqueous.ClaimWindowOpen.selector);
        esc.claimDelivered(id);
    }

    /* ------------------------------------------------------------- metering */

    /// The honesty test of this contract: the unspent remainder goes back, in the same transaction.
    function test_meteredReturnsTheRemainder() public {
        uint128 price = 1_000_000; // 1 USDC per unit, ceiling of 10
        vm.prank(buyer);
        bytes32 id = esc.createJob(_terms(AMOUNT, price, SALT));

        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        esc.settleMetered(id, 3); // used 3 of 10

        assertEq(usdc.balanceOf(agent), 3_000_000, "agent paid for 3 units");
        assertEq(usdc.balanceOf(buyer), buyerBefore + 7_000_000, "7 returned");
        assertEq(usdc.balanceOf(address(esc)), 0, "nothing retained");
    }

    /// An over-reported unit count must never pay out more than was escrowed.
    function test_meteredOvershootCapsAtEscrow() public {
        uint128 price = 1_000_000;
        vm.prank(buyer);
        bytes32 id = esc.createJob(_terms(AMOUNT, price, SALT));

        vm.prank(buyer);
        esc.settleMetered(id, 9_999_999); // absurd

        assertEq(usdc.balanceOf(agent), AMOUNT, "capped at the ceiling");
        assertEq(usdc.balanceOf(address(esc)), 0);
    }

    function test_quoteMatchesSettlement() public {
        uint128 price = 1_000_000;
        vm.prank(buyer);
        bytes32 id = esc.createJob(_terms(AMOUNT, price, SALT));

        (uint256 paid, uint256 back) = esc.quote(id, 4);
        assertEq(paid, 4_000_000);
        assertEq(back, 6_000_000);

        vm.prank(buyer);
        esc.settleMetered(id, 4);
        assertEq(usdc.balanceOf(agent), paid, "quote told the truth");
    }

    function test_flatJobCannotBeMetered() public {
        bytes32 id = _open(); // pricePerUnit 0
        vm.prank(buyer);
        vm.expectRevert(Aqueous.NotMetered.selector);
        esc.settleMetered(id, 1);
    }

    /* ------------------------------------------------------ access and state */

    function test_onlyBuyerReleases() public {
        bytes32 id = _open();
        vm.prank(stranger);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.release(id);

        vm.prank(agent);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.release(id);
    }

    function test_onlyAgentDelivers() public {
        bytes32 id = _open();
        vm.prank(buyer);
        vm.expectRevert(Aqueous.NotAgent.selector);
        esc.deliver(id, keccak256("x"));
    }

    function test_noDoubleRelease() public {
        bytes32 id = _open();
        vm.prank(buyer);
        esc.release(id);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.WrongState.selector);
        esc.release(id);
    }

    function test_noDoubleRefund() public {
        bytes32 id = _open();
        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        esc.refund(id);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.WrongState.selector);
        esc.refund(id);
    }

    function test_deliverAfterDeadlineRejected() public {
        bytes32 id = _open();
        vm.warp(block.timestamp + 8 days);
        vm.prank(agent);
        vm.expectRevert(Aqueous.DeadlinePassed.selector);
        esc.deliver(id, keccak256("late"));
    }

    function test_unknownJobReverts() public {
        vm.expectRevert(Aqueous.NoSuchJob.selector);
        esc.release(keccak256("never existed"));
    }

    function test_rejectsZeroAmountAndZeroAgent() public {
        Aqueous.Terms memory t = _terms(0, 0, SALT);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.ZeroAmount.selector);
        esc.createJob(t);

        t = _terms(AMOUNT, 0, SALT);
        t.agent = address(0);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.ZeroAgent.selector);
        esc.createJob(t);
    }

    function test_rejectsPastDeadline() public {
        Aqueous.Terms memory t = _terms(AMOUNT, 0, SALT);
        t.deadline = uint64(block.timestamp);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.DeadlinePassed.selector);
        esc.createJob(t);
    }

    function test_sameSaltTwiceReverts() public {
        _open();
        vm.prank(buyer);
        vm.expectRevert(Aqueous.JobExists.selector);
        esc.createJob(_terms(AMOUNT, 0, SALT));
    }

    /// Ids are derived from the buyer, so nobody can squat an id another buyer intended to use.
    function test_idsAreNamespacedPerBuyer() public {
        bytes32 mine = esc.jobIdFor(buyer, agent, SALT);
        bytes32 theirs = esc.jobIdFor(stranger, agent, SALT);
        assertTrue(mine != theirs, "same salt, different buyers, different ids");

        usdc.mint(stranger, AMOUNT);
        vm.prank(stranger);
        usdc.approve(address(esc), type(uint256).max);
        vm.prank(stranger);
        esc.createJob(_terms(AMOUNT, 0, SALT)); // does not collide

        _open(); // still available to the real buyer
    }

    /* ---------------------------------------------------- the facilitator path */

    /// The buyer is the authorisation's `from`. The relayer pays gas and gets nothing.
    function test_authorizationCreditsTheSignerNotTheRelayer() public {
        Aqueous.Terms memory t = _terms(AMOUNT, 0, SALT);
        Aqueous.Authorization memory a = Aqueous.Authorization({
            from: buyer,
            validAfter: 0,
            validBefore: block.timestamp + 1 hours,
            v: 27,
            r: bytes32(0),
            s: bytes32(0)
        });

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        assertEq(esc.jobs(id).buyer, buyer, "signer owns the job");
        assertEq(usdc.balanceOf(address(esc)), AMOUNT);

        // and the relayer cannot touch it
        vm.prank(relayer);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.release(id);

        vm.prank(buyer);
        esc.release(id);
        assertEq(usdc.balanceOf(agent), AMOUNT);
    }

    function test_expiredAuthorizationRejected() public {
        Aqueous.Terms memory t = _terms(AMOUNT, 0, SALT);
        Aqueous.Authorization memory a = Aqueous.Authorization({
            from: buyer,
            validAfter: 0,
            validBefore: block.timestamp, // already expired
            v: 27,
            r: bytes32(0),
            s: bytes32(0)
        });
        vm.prank(relayer);
        vm.expectRevert("auth: expired");
        esc.createJobWithAuthorization(t, a);
    }

    /* ------------------------------------------------------------ reentrancy */

    /// The state is terminal before any transfer, so a token that calls back finds a settled job.
    function test_reentrantTokenCannotDoubleSpend() public {
        ReentrantToken bad = new ReentrantToken();
        bad.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        bad.approve(address(esc), type(uint256).max);

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: address(bad),
            amount: AMOUNT,
            pricePerUnit: 0,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: TERMS,
            salt: SALT
        });
        vm.prank(buyer);
        bytes32 id = esc.createJob(t);

        bad.arm(esc, id);
        vm.prank(buyer);
        vm.expectRevert(); // the inner release reverts, taking the outer call with it
        esc.release(id);

        // nothing moved, the job is still open, the money is still escrowed
        assertEq(uint8(esc.jobs(id).state), uint8(Aqueous.State.Open));
        assertEq(bad.balanceOf(address(esc)), AMOUNT);
        assertEq(bad.balanceOf(agent), 0);
    }

    /// A token that returns false rather than reverting must not be read as success.
    function test_failedTransferReverts() public {
        bytes32 id = _open();
        usdc.setFailTransfers(true);
        vm.prank(buyer);
        vm.expectRevert(Aqueous.TransferFailed.selector);
        esc.release(id);
    }

    /// Effects land BEFORE interactions, proven without relying on the guard.
    ///
    /// This test exists because mutation testing caught a hole: moving the state write after the
    /// transfers left every other test green, since `nonReentrant` blocked the attack anyway. The
    /// guard is the second line of defence. This asserts the first one is actually there.
    function test_stateIsTerminalBeforeAnyTransfer() public {
        StateSpyToken spy = new StateSpyToken();
        spy.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        spy.approve(address(esc), type(uint256).max);

        Aqueous.Terms memory t = _terms(AMOUNT, 0, SALT);
        t.token = address(spy);
        vm.prank(buyer);
        bytes32 id = esc.createJob(t);

        spy.watch(esc, id);
        vm.prank(buyer);
        esc.release(id);

        assertEq(spy.stateAtCallback(), uint8(Aqueous.State.Settled), "job was settled before money moved");
    }

    /// Same property on the refund path, which has its own ordering.
    function test_refundStateIsTerminalBeforeTransfer() public {
        StateSpyToken spy = new StateSpyToken();
        spy.mint(buyer, 1_000_000_000);
        vm.prank(buyer);
        spy.approve(address(esc), type(uint256).max);

        Aqueous.Terms memory t = _terms(AMOUNT, 0, SALT);
        t.token = address(spy);
        vm.prank(buyer);
        bytes32 id = esc.createJob(t);

        spy.watch(esc, id);
        vm.warp(block.timestamp + 8 days);
        vm.prank(buyer);
        esc.refund(id);

        assertEq(spy.stateAtCallback(), uint8(Aqueous.State.Refunded), "job was refunded before money moved");
    }

    /* ----------------------------------------------------------------- fuzz */

    /// Across any escrow, price and unit count: the agent plus the buyer always receive exactly
    /// what was escrowed and the contract keeps nothing.
    function testFuzz_meteredConservesValue(uint128 amount, uint128 price, uint256 units) public {
        amount = uint128(bound(amount, 1, 1e24));
        price = uint128(bound(price, 1, 1e18));
        units = bound(units, 0, 1e12);

        usdc.mint(buyer, amount);
        vm.prank(buyer);
        bytes32 id = esc.createJob(_terms(amount, price, keccak256(abi.encode(amount, price, units))));

        uint256 agentBefore = usdc.balanceOf(agent);
        uint256 buyerBefore = usdc.balanceOf(buyer);

        vm.prank(buyer);
        esc.settleMetered(id, units);

        uint256 toAgent = usdc.balanceOf(agent) - agentBefore;
        uint256 toBuyer = usdc.balanceOf(buyer) - buyerBefore;

        assertEq(toAgent + toBuyer, amount, "value conserved");
        assertLe(toAgent, amount, "never pays out more than escrowed");
        assertEq(usdc.balanceOf(address(esc)), 0, "contract retains nothing");
    }

    /// No caller who is neither buyer nor agent can ever move a job.
    function testFuzz_strangersCannotTouchAJob(address who) public {
        vm.assume(who != buyer && who != agent && who != address(0));
        bytes32 id = _open();

        vm.prank(who);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.release(id);

        vm.prank(who);
        vm.expectRevert(Aqueous.NotAgent.selector);
        esc.deliver(id, keccak256("x"));

        vm.warp(block.timestamp + 8 days);
        vm.prank(who);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.refund(id);
    }
}
