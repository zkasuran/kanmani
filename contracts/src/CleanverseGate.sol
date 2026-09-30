// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Aqueous, IERC20} from "./Aqueous.sol";

/// @notice The Cleanverse Compliance Validator surface this gate calls.
///
/// Read live from Monad on 2026-09-23. The validator is an ERC-1967 proxy at
/// `0xA64529732B52EFFD2B245320E88226D72c23b788`, deployed at that same CREATE2 address on both
/// mainnet (chain 143) and testnet (chain 10143). `complianceVerify(pool, user)` answers as a view
/// (an `eth_call` returns without a transaction) and returns a plain bool: true when `user` holds a
/// valid, active CVI that satisfies the compliance rule configured for `pool`, false otherwise. For a
/// `pool` the validator does not recognise it reverts `PoolNotRegistered()` (selector `0x739f4185`),
/// which this gate treats as unknown rather than as a pass. Cleanverse's own name for this interface
/// is `IAPassComplianceValidator`; the identity primitive is CVI, the on-chain field label is apass.
interface IComplianceValidator {
    function complianceVerify(address pool, address user) external view returns (bool);
}

/// @notice The one ERC-20 method the escrow's own `IERC20` does not expose. Aqueous never approves, so
///         its interface omits it. The gate approves the escrow before each `createJob`, so it needs it.
interface IERC20Approve {
    function approve(address spender, uint256 amount) external returns (bool);
}

/// @title CleanverseGate
/// @notice A settlement gate that will not pay a worker until that worker's wallet carries a verified
///         Cleanverse Verified Identity (CVI) credential on Monad.
///
/// The product already holds money until a condition is met. Aqueous escrows a hire and pays out only
/// when the buyer releases. This gate makes a verified identity part of that condition, so identity is
/// coupled to the asset movement rather than bolted alongside it. The bounty it answers rewards
/// exactly that coupling.
///
/// **How the coupling is structural rather than optional.** The gate opens each hire through Aqueous
/// as both the buyer and the agent of record, so the gate is the only party that can move the
/// escrowed balance. Aqueous checks `msg.sender == buyer` on release and refund and
/// `msg.sender == agent` on the agent claim path and here that party is this contract in every case.
/// There is no route by which the escrow pays anyone except through this gate and the gate's only
/// outbound path to a worker is `settle`, which verifies CVI first. So the funds cannot reach an
/// unverified wallet. Removing the identity layer is not a configuration change here, it is a rewrite.
///
/// **The check is on-chain, so it needs no key and no server.** `complianceVerify` is a contract call
/// against the real Cleanverse validator on Monad. The alternative, an off-chain attestation the gate
/// recovers a signature over, would move the trust boundary to a signing key. Cleanverse publishes the
/// on-chain validator instead, so the gate reads it directly and there is no attestor key to protect.
///
/// **Unknown is never a pass.** A bond-holding gate that treats a failed identity read as approval is
/// worse than one with no check, because it looks safe. When the validator reverts, has no code or
/// answers with fewer than 32 bytes, `settle` reverts `CviUnknown` and no money moves. The three
/// states the gate can observe are Verified, Unverified and Unknown. Only Verified releases.
///
/// **CVA is the asset that moves.** In the compliant deployment `token` is a Cleanverse Verified Asset
/// such as Access USDC (`aUSDC`, 6 decimals, live at `0xaC0893567D43C3E7e6e35a72803df05416C1f20D` on
/// chain 143). A CVA re-checks the recipient's CVI inside its own transfer, so the worker payout is
/// guarded twice: once here with a clear reason before any balance leaves escrow and again by the
/// asset itself. The gate is token agnostic in code because the escrow it wraps is.
///
/// Immutable. No proxy, no upgrade path, no admin, no pause. The validator and the escrow are fixed at
/// construction. Nothing here can redirect a settlement or seize an escrowed balance.
contract CleanverseGate {
    /* ------------------------------------------------------------------ types */

    enum Status {
        None, // never opened
        Funded, // escrowed through Aqueous, waiting on settlement or refund
        Settled, // the worker was paid after a passing CVI check
        Refunded // returned to the buyer after the deadline
    }

    /// @notice What the gate observed when it last asked the validator about a wallet.
    /// @dev Unknown is deliberately its own state and is never folded into Unverified. Unverified is a
    ///      compliance answer (this wallet is not cleared). Unknown is an operational one (the check
    ///      could not be made). Both block a payout and a caller that cannot tell them apart cannot
    ///      tell a rejected worker from an unreachable validator.
    enum CviState {
        Unknown,
        Unverified,
        Verified
    }

    /// @dev Field order is deliberate. Monad warms storage a 128-slot page at a time rather than a
    ///      slot at a time, so keeping a record in consecutive slots costs one cold page. uint128 is
    ///      far past any real settlement at 6 decimals, so matching Aqueous on the amount type is free.
    struct Record {
        address buyer; //   slot 0, 20 bytes  the party whose funds these are, who alone can settle
        uint64 deadline; // slot 0, +8        after this the buyer can be refunded
        Status status; //   slot 0, +1
        address worker; //  slot 1, 20 bytes  the wallet that must carry a CVI to be paid
        address token; //   slot 2, 20 bytes  the CVA (or any ERC-20) held by the escrow
        uint128 amount; //  slot 3, 16 bytes  base units, the escrow's decimals are the caller's problem
    }

    /* --------------------------------------------------------------- storage */

    mapping(bytes32 => Record) private _records;

    /// @dev Belt and braces on the paths that move money. The status machine already blocks a second
    ///      settlement, so this is a second guard for a property the first one has, at the cost of one
    ///      slot, because the failure mode is losing custody of somebody else's escrow.
    uint256 private _entered;

    /* --------------------------------------------------------------- immutable */

    /// @notice The Aqueous escrow this gate wraps. Fixed at construction so it cannot be repointed at a
    ///         look-alike escrow after a worker trusts the deployment.
    Aqueous public immutable escrow;

    /// @notice The Cleanverse Compliance Validator. The only contract whose answer gates a payout and
    ///         it is set once. A settable validator would let one address turn every check into a pass.
    IComplianceValidator public immutable validator;

    /// @notice The address Cleanverse checks when this gate is registered as a compliance pool.
    ///
    /// Register Compliance Pool requires an EIP-191 signature from the pool's `owner()`. A gate with no
    /// owner cannot be registered at all, so the first deploy on 2026-09-30 could never settle.
    /// This is an identity for that one check and nothing else: it is immutable, no function
    /// in this contract reads it and it holds no power over any job, balance or rule. The
    /// "no admin path" property is unchanged.
    address public immutable owner;

    /* ---------------------------------------------------------------- events */

    /// @notice A hire was escrowed through the gate.
    event GateOpened(
        bytes32 indexed jobId, address indexed buyer, address indexed worker, address token, uint256 amount, uint64 deadline
    );

    /// @notice A worker was paid after a passing CVI check. This is the receipt for a compliant
    ///         settlement, emitted by the transfer path itself so it cannot disagree with what moved.
    event GateSettled(bytes32 indexed jobId, address indexed worker, address token, uint256 amount);

    /// @notice The escrow was returned to the buyer after the deadline, with no worker payout.
    event GateRefunded(bytes32 indexed jobId, address indexed buyer, address token, uint256 amount);

    /* ---------------------------------------------------------------- errors */

    error ZeroWorker();
    error ZeroToken();
    error ZeroAmount();
    error ZeroEscrow();
    error ZeroValidator();
    error DeadlineInPast();
    error DeadlineNotReached();
    error NotFunded();
    error NotBuyer();
    error TransferFailed();
    error Reentrancy();
    /// @dev The validator answered and the wallet is not cleared to receive.
    error CviNotVerified();
    /// @dev The validator could not be read (reverted, no code or a short answer). Fail closed.
    error CviUnknown();

    /* ------------------------------------------------------------- modifiers */

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(Aqueous escrow_, IComplianceValidator validator_) {
        if (address(escrow_) == address(0)) revert ZeroEscrow();
        if (address(validator_) == address(0)) revert ZeroValidator();
        escrow = escrow_;
        validator = validator_;
        owner = msg.sender;
    }

    /* ----------------------------------------------------------------- views */

    function records(bytes32 jobId) external view returns (Record memory) {
        return _records[jobId];
    }

    /// @notice The gate's own job id for a hire, derived so a client can compute it before sending.
    /// @dev The buyer and the worker are folded into the Aqueous salt below, so two buyers cannot
    ///      collide on the same id even though every gated Aqueous job shares this contract as both
    ///      its buyer and its agent.
    function jobIdFor(address buyer, address worker, bytes32 salt) public view returns (bytes32) {
        return escrow.jobIdFor(address(this), address(this), _innerSalt(buyer, worker, salt));
    }

    /// @notice What the validator says about a worker's CVI right now, as a three-state answer.
    ///
    /// This is the read a UI uses to show a worker as cleared, not cleared or not checkable before a
    /// settlement is attempted. It never reverts, so the Unknown state is observable rather than thrown.
    function cviStatus(address worker) external view returns (CviState) {
        (bool ok, bool verified) = _readCvi(worker);
        if (!ok) return CviState.Unknown;
        return verified ? CviState.Verified : CviState.Unverified;
    }

    /* -------------------------------------------------------------- lifecycle */

    /// @notice Escrow a hire through the gate. The buyer names the worker up front and funds the
    ///         escrow. The gate opens the Aqueous job as its own buyer and agent, so from here only the
    ///         gate can move the money and only `settle` can send it to the worker.
    ///
    /// @param worker   the wallet that must carry a CVI before it can be paid
    /// @param token    the CVA (or ERC-20) escrowed. In the compliant deployment this is a CVA.
    /// @param amount   base units held in escrow
    /// @param deadline unix seconds after which the buyer can be refunded if no settlement happened
    /// @param termsHash a commitment to the off-chain terms, passed through to the Aqueous receipt
    /// @param salt     the buyer's nonce, so one buyer can run many hires for one worker
    ///
    /// The caller must have approved this gate for `amount` of `token` first.
    function open(
        address worker,
        address token,
        uint128 amount,
        uint64 deadline,
        bytes32 termsHash,
        bytes32 salt
    ) external nonReentrant returns (bytes32 jobId) {
        if (worker == address(0)) revert ZeroWorker();
        if (token == address(0)) revert ZeroToken();
        if (amount == 0) revert ZeroAmount();
        if (deadline <= block.timestamp) revert DeadlineInPast();

        // Pull the escrow from the buyer into the gate, then hand it to Aqueous. The exact-received
        // check refuses a fee-on-transfer token here rather than recording a balance the gate never got.
        uint256 balanceBefore = IERC20(token).balanceOf(address(this));
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        if (IERC20(token).balanceOf(address(this)) - balanceBefore != amount) revert TransferFailed();

        // Approve exactly this amount, so a leftover allowance cannot be spent by a later job.
        if (!IERC20Approve(token).approve(address(escrow), amount)) revert TransferFailed();

        // The gate is the Aqueous buyer and agent. pricePerUnit is zero, so this is a flat job and a
        // release pays out the whole amount to the agent, which is this gate.
        Aqueous.Terms memory terms = Aqueous.Terms({
            agent: address(this),
            token: token,
            amount: amount,
            pricePerUnit: 0,
            deadline: deadline,
            termsHash: termsHash,
            salt: _innerSalt(msg.sender, worker, salt)
        });
        jobId = escrow.createJob(terms);

        _records[jobId] = Record({
            buyer: msg.sender,
            deadline: deadline,
            status: Status.Funded,
            worker: worker,
            token: token,
            amount: amount
        });

        emit GateOpened(jobId, msg.sender, worker, token, amount, deadline);
    }

    /// @notice Verify the worker's CVI, then release the escrow to the worker. This is the only path by
    ///         which a gated hire pays out and it will not proceed for an unverified or unknown wallet.
    ///
    /// Only the buyer can settle, matching Aqueous where release is the buyer's decision. The CVI check
    /// runs before any balance moves, so an unverified worker leaves the escrow untouched and the buyer
    /// can still be refunded after the deadline.
    function settle(bytes32 jobId) external nonReentrant {
        Record storage r = _records[jobId];
        if (r.status != Status.Funded) revert NotFunded();
        if (msg.sender != r.buyer) revert NotBuyer();

        // The whole point of the contract. The worker, not the caller, is the wallet that must be
        // cleared and an unreadable validator is a refusal rather than a pass.
        _requireVerified(r.worker);

        address token = r.token;
        address worker = r.worker;
        uint256 amount = r.amount;

        r.status = Status.Settled; // effects before interactions

        // Draw the escrow out of Aqueous to this gate (the gate is the buyer releasing to itself as
        // agent), then hand it to the worker. With a CVA the second transfer re-checks the CVI itself.
        escrow.release(jobId);
        if (!IERC20(token).transfer(worker, amount)) revert TransferFailed();

        emit GateSettled(jobId, worker, token, amount);
    }

    /// @notice Return the escrow to the buyer after the deadline, when no compliant settlement ran.
    /// @dev Anyone may call it, because the money can only go to the recorded buyer. That keeps a
    ///      refund from being stranded by a buyer who no longer holds the gas token.
    function refund(bytes32 jobId) external nonReentrant {
        Record storage r = _records[jobId];
        if (r.status != Status.Funded) revert NotFunded();
        if (block.timestamp <= r.deadline) revert DeadlineNotReached();

        address token = r.token;
        address buyer = r.buyer;
        uint256 amount = r.amount;

        r.status = Status.Refunded; // effects before interactions

        escrow.refund(jobId);
        if (!IERC20(token).transfer(buyer, amount)) revert TransferFailed();

        emit GateRefunded(jobId, buyer, token, amount);
    }

    /* ---------------------------------------------------------------- internal */

    /// @dev The one place the validator is asked. It calls `complianceVerify(pool, user)` where the
    ///      pool is this gate. The gate must be registered as a compliance pool with Cleanverse for
    ///      the validator to resolve it; until it is, the call reverts and every settlement is refused,
    ///      which is the safe direction. Reverting `CviNotVerified` and `CviUnknown` are kept distinct
    ///      so a rejected worker and an unreadable validator do not look the same on chain.
    function _requireVerified(address worker) private view {
        (bool ok, bool verified) = _readCvi(worker);
        if (!ok) revert CviUnknown();
        if (!verified) revert CviNotVerified();
    }

    /// @dev A low-level staticcall rather than a typed call, so the three outcomes are handled
    ///      explicitly: the validator reverts or has no code (ok is false), it answers with fewer than
    ///      32 bytes (ok is false) or it returns a decodable bool. A typed call would collapse the
    ///      first two into a bare revert and lose the Unknown state the gate is built to expose.
    ///
    ///      The returned word is read directly rather than through `abi.decode(ret,(bool))`, because
    ///      the ABI decoder panics on a bool that is not exactly 0 or 1. A validator that returns a
    ///      dirty word would then turn a status read into a revert, which is the one thing the Unknown
    ///      state exists to prevent, so a dirty value reads as Unknown (ok false) instead.
    function _readCvi(address worker) private view returns (bool ok, bool verified) {
        (bool success, bytes memory ret) = address(validator).staticcall(
            abi.encodeWithSelector(IComplianceValidator.complianceVerify.selector, address(this), worker)
        );
        if (!success || ret.length < 32) return (false, false);
        bytes32 word;
        assembly {
            word := mload(add(ret, 32))
        }
        if (word == bytes32(0)) return (true, false);
        if (word == bytes32(uint256(1))) return (true, true);
        return (false, false);
    }

    /// @dev The Aqueous salt for a gated job. Folding in the buyer and the worker means two buyers
    ///      using the same outer salt do not land on the same Aqueous job id, even though every gated
    ///      job shares this gate as both buyer and agent.
    function _innerSalt(address buyer, address worker, bytes32 salt) private pure returns (bytes32) {
        return keccak256(abi.encode("kanmani.cleanverse-gate.v1", buyer, worker, salt));
    }
}
