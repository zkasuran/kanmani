// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

/// @notice Minimal EIP-3009 surface. USDC on Monad answers both of these, verified by
///         calling `authorizationState(0,0)` and reading `DOMAIN_SEPARATOR()` on chain 143.
interface IERC3009 {
    function transferWithAuthorization(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external;
}

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

/// @title Aqueous
/// @notice Escrow for agent work. Money is held until the work lands, and the receipt is emitted
///         by the settlement itself rather than written afterwards by something that could disagree.
///
/// The whole point: we measured 68 agent reputation documents on Monad where every one was
/// cryptographically perfect and 2 of the cited payments existed on the chain the document named.
/// That is a plumbing problem rather than a lying problem. If the money moves through here, the
/// receipt names the chain the money actually moved on, because the same transaction does both.
///
/// Deliberate properties, each one a thing a reader should be able to check rather than trust:
///  - Immutable. No proxy, no upgrade path, no admin. Nothing here can take an escrowed balance.
///  - Token agnostic. Amounts are base units, so USDC (6 decimals) and any other ERC-20 both work
///    without a hardcoded scale. Formatting is the caller's problem, which is where decimals belong.
///  - The buyer can always get their money back after the deadline, with no counterparty signature.
///  - The agent can always claim after delivering plus a dispute window, so a silent buyer cannot
///    strand a delivered job. Both sides have an exit that does not depend on the other answering.
contract Aqueous {
    /* ------------------------------------------------------------------ types */

    enum State {
        None, // never created
        Open, // funded, waiting on the agent
        Delivered, // agent marked delivery, dispute window running
        Settled, // paid out
        Refunded // returned to the buyer
    }

    /// @dev Field order is deliberate. Monad warms storage per 128-slot page rather than per slot,
    ///      so a job packed into consecutive slots costs one cold page instead of several. uint128
    ///      is far beyond any real USDC amount (2^128 base units at 6 decimals), so the packing
    ///      costs nothing real.
    struct Job {
        address buyer; //  slot 0, 20 bytes
        uint64 deadline; //  slot 0, +8
        State state; //  slot 0, +1
        address agent; //  slot 1, 20 bytes
        uint64 deliveredAt; //  slot 1, +8
        address token; //  slot 2
        uint128 amount; //  slot 3, 16 bytes  (the ceiling for a metered job)
        uint128 pricePerUnit; //  slot 3, +16  (zero means a flat job, not metered)
        bytes32 termsHash; //  slot 4
        bytes32 deliverableHash; //  slot 5
    }

    /// @dev Grouped so the create functions stay under the stack limit. Fourteen loose parameters
    ///      hit "stack too deep", and a struct is the honest fix rather than turning on via-ir to
    ///      paper over a signature that was too wide to read anyway.
    struct Terms {
        address agent;
        address token;
        uint128 amount; // the ceiling for a metered job
        uint128 pricePerUnit; // zero means a flat job
        uint64 deadline;
        bytes32 termsHash;
        bytes32 salt;
    }

    /// @dev An EIP-3009 authorisation, exactly as the token expects it.
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
        bytes32 nonce;
        uint8 v;
        bytes32 r;
        bytes32 s;
    }

    /* --------------------------------------------------------------- storage */

    mapping(bytes32 => Job) private _jobs;

    /// @notice How long after delivery the buyer has to release or dispute before the agent can
    ///         claim. Fixed at deploy and public, so neither side can be surprised by it.
    uint64 public immutable claimWindow;

    /// @dev Reentrancy is already prevented by writing the terminal state before any transfer
    ///      (checks, effects, interactions). This guard is belt and braces on the paths that move
    ///      money, because the cost is one slot and the failure mode is losing escrowed funds.
    uint256 private _entered;

    /* ---------------------------------------------------------------- events */

    event JobCreated(
        bytes32 indexed jobId,
        address indexed buyer,
        address indexed agent,
        address token,
        uint256 amount,
        uint256 pricePerUnit,
        uint64 deadline,
        bytes32 termsHash
    );

    event Delivered(bytes32 indexed jobId, bytes32 deliverableHash, uint64 at);

    /// @notice THE RECEIPT. Emitted by the transfer itself, on the chain the transfer happened on.
    /// @param paid   what actually moved to the agent
    /// @param returned what went back to the buyer, non-zero only on a metered settlement
    event Settled(
        bytes32 indexed jobId,
        address indexed agent,
        address token,
        uint256 paid,
        uint256 returned,
        uint256 units,
        address settledBy
    );

    event Refunded(bytes32 indexed jobId, address indexed buyer, address token, uint256 amount);

    /* ---------------------------------------------------------------- errors */

    error JobExists();
    error NoSuchJob();
    error WrongState();
    error NotBuyer();
    error NotAgent();
    error DeadlinePassed();
    error DeadlineNotPassed();
    error ClaimWindowOpen();
    error NotMetered();
    error ZeroAmount();
    error ZeroAgent();
    error TransferFailed();
    error Reentrancy();

    /* ------------------------------------------------------------- modifiers */

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(uint64 claimWindow_) {
        claimWindow = claimWindow_;
    }

    /* ----------------------------------------------------------------- views */

    function jobs(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice Job ids are derived, never supplied, so one buyer cannot squat another's id.
    ///         Deterministic on purpose: a client can compute the id before it sends anything.
    function jobIdFor(address buyer, address agent, bytes32 salt) public pure returns (bytes32) {
        return keccak256(abi.encode(buyer, agent, salt));
    }

    /// @notice What a metered settlement would pay and return for a given unit count.
    ///         Exposed so a caller can check the arithmetic before signing anything.
    function quote(bytes32 jobId, uint256 units) external view returns (uint256 paid, uint256 returned) {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.pricePerUnit == 0) revert NotMetered();
        return _split(j.amount, j.pricePerUnit, units);
    }

    /* -------------------------------------------------------------- creation */

    /// @notice Create a job, pulling the escrow from the caller. Needs a prior `approve`.
    function createJob(Terms calldata t) external nonReentrant returns (bytes32 jobId) {
        jobId = _open(msg.sender, t);
        if (!IERC20(t.token).transferFrom(msg.sender, address(this), t.amount)) revert TransferFailed();
    }

    /// @notice Create a job from a buyer's EIP-3009 authorisation, submitted by anyone.
    ///
    /// This is the path that matters. The buyer signs one message and never needs the chain's gas
    /// token; whoever relays it pays the gas. That is the only shape in which hiring an agent works
    /// for someone who does not already hold MON.
    ///
    /// The buyer is the authorisation's `from`, never `msg.sender`, so the relayer gets no rights
    /// over the job it paid gas for.
    function createJobWithAuthorization(Terms calldata t, Authorization calldata a)
        external
        nonReentrant
        returns (bytes32 jobId)
    {
        jobId = _open(a.from, t);

        // The token verifies the signature, the nonce and the window. A bad authorisation reverts
        // in there, which is the correct place for it: we never reimplement signature checking.
        IERC3009(t.token).transferWithAuthorization(
            a.from, address(this), t.amount, a.validAfter, a.validBefore, a.nonce, a.v, a.r, a.s
        );
    }

    /* -------------------------------------------------------------- lifecycle */

    /// @notice Agent marks the work delivered and commits to what was delivered.
    function deliver(bytes32 jobId, bytes32 deliverableHash) external {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open) revert WrongState();
        if (msg.sender != j.agent) revert NotAgent();
        if (block.timestamp > j.deadline) revert DeadlinePassed();

        j.state = State.Delivered;
        j.deliveredAt = uint64(block.timestamp);
        j.deliverableHash = deliverableHash;

        emit Delivered(jobId, deliverableHash, uint64(block.timestamp));
    }

    /// @notice Buyer accepts and pays the full escrowed amount.
    function release(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open && j.state != State.Delivered) revert WrongState();
        if (msg.sender != j.buyer) revert NotBuyer();

        _settle(jobId, j, j.amount, 0, 0);
    }

    /// @notice Buyer settles a metered job for the units actually consumed. The unspent remainder
    ///         goes back to the buyer in the same transaction.
    ///
    /// Returning the remainder is the honesty test of this contract. Keeping it would be invisible
    /// to most buyers and it is exactly the class of thing this project exists to make visible.
    function settleMetered(bytes32 jobId, uint256 units) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open && j.state != State.Delivered) revert WrongState();
        if (msg.sender != j.buyer) revert NotBuyer();
        if (j.pricePerUnit == 0) revert NotMetered();

        (uint256 paid, uint256 returned) = _split(j.amount, j.pricePerUnit, units);
        _settle(jobId, j, paid, returned, units);
    }

    /// @notice Agent claims a delivered job the buyer never answered on.
    ///         Without this a silent buyer strands a delivered job forever.
    function claimDelivered(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Delivered) revert WrongState();
        if (msg.sender != j.agent) revert NotAgent();
        if (block.timestamp < uint256(j.deliveredAt) + claimWindow) revert ClaimWindowOpen();

        _settle(jobId, j, j.amount, 0, 0);
    }

    /// @notice Buyer reclaims an undelivered job after the deadline. No agent signature needed,
    ///         so a dead agent cannot hold a buyer's money.
    function refund(bytes32 jobId) external nonReentrant {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open) revert WrongState();
        if (msg.sender != j.buyer) revert NotBuyer();
        if (block.timestamp <= j.deadline) revert DeadlineNotPassed();

        address token = j.token;
        address buyer = j.buyer;
        uint256 amount = j.amount;

        j.state = State.Refunded; // effects before interactions

        if (!IERC20(token).transfer(buyer, amount)) revert TransferFailed();
        emit Refunded(jobId, buyer, token, amount);
    }

    /* ---------------------------------------------------------------- internal */

    function _open(address buyer, Terms calldata t) private returns (bytes32 jobId) {
        if (t.amount == 0) revert ZeroAmount();
        if (t.agent == address(0)) revert ZeroAgent();
        if (t.deadline <= block.timestamp) revert DeadlinePassed();

        jobId = jobIdFor(buyer, t.agent, t.salt);
        Job storage j = _jobs[jobId];
        if (j.state != State.None) revert JobExists();

        j.buyer = buyer;
        j.deadline = t.deadline;
        j.state = State.Open;
        j.agent = t.agent;
        j.token = t.token;
        j.amount = t.amount;
        j.pricePerUnit = t.pricePerUnit;
        j.termsHash = t.termsHash;

        emit JobCreated(
            jobId, buyer, t.agent, t.token, t.amount, t.pricePerUnit, t.deadline, t.termsHash
        );
    }

    /// @dev One place that moves money out, so the receipt cannot disagree with the transfer.
    function _settle(bytes32 jobId, Job storage j, uint256 paid, uint256 refundAmount, uint256 units)
        private
    {
        address token = j.token;
        address agent = j.agent;
        address buyer = j.buyer;

        j.state = State.Settled; // effects before interactions

        if (paid > 0 && !IERC20(token).transfer(agent, paid)) revert TransferFailed();
        if (refundAmount > 0 && !IERC20(token).transfer(buyer, refundAmount)) revert TransferFailed();

        emit Settled(jobId, agent, token, paid, refundAmount, units, msg.sender);
    }

    /// @dev `upto` semantics: the escrow is a ceiling, the settlement is the actual usage, and
    ///      anything unspent is the buyer's. Capped so an over-reported unit count cannot pay out
    ///      more than was escrowed.
    function _split(uint128 amount, uint128 pricePerUnit, uint256 units)
        private
        pure
        returns (uint256 paid, uint256 refundAmount)
    {
        paid = units * uint256(pricePerUnit);
        if (paid > amount) paid = amount;
        refundAmount = uint256(amount) - paid;
    }
}
