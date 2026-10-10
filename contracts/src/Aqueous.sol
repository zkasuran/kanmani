// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

/// @notice Minimal EIP-3009 surface. USDC on Monad answers both of these, verified by
///         calling `authorizationState(0,0)` and reading `DOMAIN_SEPARATOR()` on chain 143.
interface IERC3009 {
    function receiveWithAuthorization(
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
    function balanceOf(address account) external view returns (uint256);
}

/// @title Aqueous
/// @notice Escrow for agent work. Money is held until the work lands and the receipt is emitted
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
    ///      hit "stack too deep" and a struct is the honest fix rather than turning on via-ir to
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

    /// @dev An EIP-3009 authorisation, minus the nonce.
    ///
    /// **The nonce is NOT supplied by the caller. It is derived from the job terms.** An EIP-3009
    /// signature only covers `(from, to, value, validAfter, validBefore, nonce)`, so it says nothing
    /// about which agent gets paid, the deadline, the price or the terms. Letting the submitter choose
    /// those meant a relayer holding a valid authorisation could name itself as the agent, deliver
    /// nothing and claim the buyer's escrow after the dispute window. Refund could not save the buyer
    /// because delivery moves the job out of `Open`.
    ///
    /// Deriving the nonce from the terms binds all of it with no extra signature: change any field and
    /// the nonce changes, so the token's own signature check rejects it.
    struct Authorization {
        address from;
        uint256 validAfter;
        uint256 validBefore;
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

    /* -------------------------------------------------------------- EIP-712 */

    /// The buyer signs these instead of sending a transaction, so a buyer who holds no MON can
    /// finish a job as well as start one. See the `*WithAuthorization` functions.
    ///
    /// **No nonce, on purpose.** Every action these authorise moves the job to a terminal state,
    /// so the state machine is already the replay guard: a second submission of the same signature
    /// finds the job Settled or Refunded and reverts with `WrongState`. A nonce would be a second
    /// mechanism for a property the first one already has, plus a storage slot per buyer.

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    bytes32 private constant RELEASE_TYPEHASH =
        keccak256("Release(bytes32 jobId,uint256 validBefore)");

    bytes32 private constant SETTLE_METERED_TYPEHASH =
        keccak256("SettleMetered(bytes32 jobId,uint256 units,uint256 validBefore)");

    bytes32 private constant REFUND_TYPEHASH =
        keccak256("Refund(bytes32 jobId,uint256 validBefore)");

    /// @dev Cached, plus the chain id it was built for. A separator baked in at deploy is wrong
    ///      after a chain splits and rebuilding costs a comparison, so do it rather than assume.
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    /// @dev Half the secp256k1 curve order. A signature with `s` above this is the second, equally
    ///      valid encoding of the same signature. Rejecting it is not load-bearing here, because
    ///      nothing stores or keys on a signature, but a fund-holding contract should not accept
    ///      two spellings of one authorisation when refusing one costs a comparison.
    uint256 private constant SECP256K1_HALF_N =
        0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0;


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
    error AuthorizationExpired();
    error InvalidSignature();

    /* ------------------------------------------------------------- modifiers */

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(uint64 claimWindow_) {
        claimWindow = claimWindow_;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    /* ----------------------------------------------------------------- views */

    function jobs(bytes32 jobId) external view returns (Job memory) {
        return _jobs[jobId];
    }

    /// @notice The EIP-712 domain for this deployment. It binds `chainId` and this contract's own
    ///         address, so a signature made for the testnet deployment is useless on mainnet and
    ///         vice versa.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    /// @notice The exact digest to sign for a gasless release. Sign this, hand it to any relayer.
    ///
    /// **`releaseWithAuthorization` calls this same function**, rather than rebuilding the digest
    /// from the same parts. Two copies of an EIP-712 layout drift and when they do the symptom is
    /// every valid signature being rejected, which reads like a broken signer rather than a broken
    /// contract. Mutation testing found exactly that gap here: the units field was removed from one
    /// copy and the adversarial test still passed, because it was then failing on a digest mismatch
    /// instead of on the property it claimed to check.
    function releaseDigest(bytes32 jobId, uint256 validBefore) public view returns (bytes32) {
        return _digest(keccak256(abi.encode(RELEASE_TYPEHASH, jobId, validBefore)));
    }

    /// @notice The digest for a gasless metered settlement. `units` is inside it, so a relayer
    ///         cannot settle for a different number than the buyer signed for.
    function settleMeteredDigest(bytes32 jobId, uint256 units, uint256 validBefore)
        public
        view
        returns (bytes32)
    {
        return _digest(keccak256(abi.encode(SETTLE_METERED_TYPEHASH, jobId, units, validBefore)));
    }

    /// @notice The digest for a gasless refund.
    function refundDigest(bytes32 jobId, uint256 validBefore) public view returns (bytes32) {
        return _digest(keccak256(abi.encode(REFUND_TYPEHASH, jobId, validBefore)));
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

    /// @notice The EIP-3009 nonce a buyer must sign for a given set of terms.
    ///
    /// Call this, sign a `ReceiveWithAuthorization` using the result as the nonce and the
    /// authorisation is then only usable for exactly these terms. A relayer that alters the agent,
    /// the deadline, the price or anything else produces a different nonce, so the token rejects the
    /// signature.
    function authNonceFor(Terms calldata t) public pure returns (bytes32) {
        return keccak256(abi.encode("kanmani.aqueous.v1", t));
    }

    /// @notice Create a job, pulling the escrow from the caller. Needs a prior `approve`.
    function createJob(Terms calldata t) external nonReentrant returns (bytes32 jobId) {
        jobId = _open(msg.sender, t);
        uint256 before = _balance(t.token);
        if (!IERC20(t.token).transferFrom(msg.sender, address(this), t.amount)) revert TransferFailed();
        _requireExactlyReceived(t.token, before, t.amount);
    }

    /// @notice Create a job from a buyer's EIP-3009 authorisation, submitted by anyone.
    ///
    /// This is the path that matters. The buyer signs one message and never needs the chain's gas
    /// token; whoever relays it pays the gas. That is the only shape in which hiring an agent works
    /// for someone who does not already hold MON.
    ///
    /// The buyer is the authorisation's `from`, never `msg.sender`, so the relayer gets no rights
    /// over the job it paid gas for. **And the nonce is derived from the terms rather than supplied**,
    /// so the relayer cannot change what the buyer agreed to. See `Authorization`.
    ///
    /// **The authorisation is a `ReceiveWithAuthorization`**, which the token lets only the payee
    /// (`to`, this contract) redeem, so the escrow cannot be funded except from inside this call and
    /// cannot be front-run away from the job it belongs to.
    function createJobWithAuthorization(Terms calldata t, Authorization calldata a)
        external
        nonReentrant
        returns (bytes32 jobId)
    {
        jobId = _open(a.from, t);

        uint256 before = _balance(t.token);

        // receiveWithAuthorization, NOT transferWithAuthorization: the token also enforces
        // msg.sender == to, so this contract is the only party that can redeem the buyer's
        // authorisation, which keeps funding atomic with job creation. With the transfer variant the
        // signed authorisation is a bearer instrument anyone could submit straight to the token,
        // moving the escrow in with no job created and no recovery path. The token still verifies the
        // signature, the nonce and the window; a bad authorisation reverts in there, which is the
        // correct place for it: we never reimplement signature checking.
        IERC3009(t.token).receiveWithAuthorization(
            a.from,
            address(this),
            t.amount,
            a.validAfter,
            a.validBefore,
            authNonceFor(t), // binds every term to the signature
            a.v,
            a.r,
            a.s
        );

        _requireExactlyReceived(t.token, before, t.amount);
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
        _release(jobId, msg.sender);
    }

    /// @notice Buyer settles a metered job for the units actually consumed. The unspent remainder
    ///         goes back to the buyer in the same transaction.
    ///
    /// Returning the remainder is the honesty test of this contract. Keeping it would be invisible
    /// to most buyers and it is exactly the class of thing this project exists to make visible.
    function settleMetered(bytes32 jobId, uint256 units) external nonReentrant {
        _settleMetered(jobId, units, msg.sender);
    }

    /* ----------------------------------------------- the same three, gasless */

    /// @notice Release on the strength of the buyer's signature, submitted and paid for by anyone.
    ///
    /// **This is the other half of the gasless story and it was missing for a while.**
    /// `createJobWithAuthorization` let a buyer with no MON start a job. Finishing one still
    /// needed their own transaction, so a buyer who genuinely held nothing could fund an escrow
    /// and then not release it, not settle it and not refund it. Their only remaining move was to
    /// wait out the claim window and let the agent take the whole amount. A gasless entrance with
    /// no gasless exit is worse than no gasless entrance, because it strands people mid-flow.
    ///
    /// Sign the digest from `releaseDigest`. The relayer gets no rights: it pays gas and nothing
    /// else and the signature only authorises this one job.
    function releaseWithAuthorization(bytes32 jobId, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        _requireNotExpired(validBefore);
        _release(jobId, _recover(releaseDigest(jobId, validBefore), v, r, s));
    }

    /// @notice Metered settlement on the buyer's signature. The unit count is signed, so a relayer
    ///         cannot settle for a different number than the buyer agreed to.
    function settleMeteredWithAuthorization(
        bytes32 jobId,
        uint256 units,
        uint256 validBefore,
        uint8 v,
        bytes32 r,
        bytes32 s
    ) external nonReentrant {
        _requireNotExpired(validBefore);
        _settleMetered(jobId, units, _recover(settleMeteredDigest(jobId, units, validBefore), v, r, s));
    }

    /// @notice Refund on the buyer's signature, after the deadline. Completes the set: a buyer who
    ///         never holds the gas token can still get their money back from a dead agent.
    function refundWithAuthorization(bytes32 jobId, uint256 validBefore, uint8 v, bytes32 r, bytes32 s)
        external
        nonReentrant
    {
        _requireNotExpired(validBefore);
        _refund(jobId, _recover(refundDigest(jobId, validBefore), v, r, s));
    }

    /* ------------------------------------------------------------ lifecycle */

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
        _refund(jobId, msg.sender);
    }

    /* ---------------------------------------------------------------- internal */

    /// @dev One implementation per buyer action, taking the AUTHORISED party explicitly rather
    ///      than reading `msg.sender`. That is what lets a signature stand in for a transaction
    ///      without either path drifting from the other: there is only one set of checks.
    function _release(bytes32 jobId, address who) private {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open && j.state != State.Delivered) revert WrongState();
        if (who != j.buyer) revert NotBuyer();

        _settle(jobId, j, j.amount, 0, 0);
    }

    function _settleMetered(bytes32 jobId, uint256 units, address who) private {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open && j.state != State.Delivered) revert WrongState();
        if (who != j.buyer) revert NotBuyer();
        if (j.pricePerUnit == 0) revert NotMetered();

        (uint256 paid, uint256 returned) = _split(j.amount, j.pricePerUnit, units);
        _settle(jobId, j, paid, returned, units);
    }

    function _refund(bytes32 jobId, address who) private {
        Job storage j = _jobs[jobId];
        if (j.state == State.None) revert NoSuchJob();
        if (j.state != State.Open) revert WrongState();
        if (who != j.buyer) revert NotBuyer();
        if (block.timestamp <= j.deadline) revert DeadlineNotPassed();

        address token = j.token;
        address buyer = j.buyer;
        uint256 amount = j.amount;

        j.state = State.Refunded; // effects before interactions

        if (!IERC20(token).transfer(buyer, amount)) revert TransferFailed();
        emit Refunded(jobId, buyer, token, amount);
    }

    /* -------------------------------------------------------- signature guts */

    function _requireNotExpired(uint256 validBefore) private view {
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
    }

    function _digest(bytes32 structHash) private view returns (bytes32) {
        return keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256("Aqueous"),
                keccak256("1"),
                block.chainid,
                address(this)
            )
        );
    }

    /// @dev `ecrecover` returns the zero address for a malformed signature rather than reverting,
    ///      so a caller that forgets to check it treats garbage as a valid signer. Every failure
    ///      mode is turned into a revert here: bad `v`, the high-`s` twin of a signature and the
    ///      zero address.
    function _recover(bytes32 digest, uint8 v, bytes32 r, bytes32 s) private pure returns (address) {
        if (uint256(s) > SECP256K1_HALF_N) revert InvalidSignature();
        if (v != 27 && v != 28) revert InvalidSignature();
        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0)) revert InvalidSignature();
        return signer;
    }

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

    function _balance(address token) private view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @dev Refuse any token that does not deliver exactly what was asked for.
    ///
    /// A fee-on-transfer or rebasing token credits the contract less than `amount` while the job
    /// records the full `amount`. Do that twice and the contract owes more than it holds, so the
    /// last job out is unpayable and this contract is immutable with no admin recovery. Refusing at
    /// creation is the only safe answer: a clean revert beats accounting that is quietly wrong.
    function _requireExactlyReceived(address token, uint256 balanceBefore, uint256 amount) private view {
        if (_balance(token) - balanceBefore != amount) revert TransferFailed();
    }

    /// @dev `upto` semantics: the escrow is a ceiling, the settlement is the actual usage and
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
