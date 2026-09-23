// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

interface IERC20 {
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function balanceOf(address account) external view returns (uint256);
}

/// @notice The one function this contract needs from the ERC-8004 Identity Registry, which is an
///         ERC-721. Declared rather than imported so there is no dependency on their package, and
///         narrow on purpose: this contract reads ownership and is given no ability to change it.
///
///         `ownerOf` REVERTS for a token that does not exist, which is the behaviour we want. A bond
///         against an agent that was never registered should fail, and letting the registry's own
///         revert do that is better than reimplementing existence here.
interface IIdentityRegistry {
    function ownerOf(uint256 tokenId) external view returns (address);
}

interface IERC165 {
    function supportsInterface(bytes4 interfaceId) external view returns (bool);
}

/// @notice The Chainlink CRE receiver interface, copied from
///         `chainlink-evm/contracts/cre/src/v1/interfaces/IReceiver.sol` rather than imported, so
///         this contract has no dependency on their package version. Read from source on
///         2026-09-22: `onReport(bytes,bytes)` plus ERC-165.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title Sclera
/// @notice A bond an agent posts against its own future claim-truth rate.
///
/// The measurement this exists for: on Monad we read 85 payment claims across 11 agents and one
/// agent published 41 receipts that do not resolve out of 42, across 12 separate days. Hash
/// integrity is not claim truth. Every one of those documents was cryptographically perfect.
///
/// So the bond is a price on a claim about future behaviour. An agent locks tokens and commits to
/// a minimum share of its own published payment claims resolving true, measured over a block
/// window with a minimum sample. If it falls below, the bond is forfeit. If the window matures
/// without that happening, the agent takes its money back.
///
/// Three decisions worth stating, because each one had an alternative that looks reasonable:
///
///  - **Forward looking, never retroactive.** Only feedbacks recorded after `postedAt` count. The
///    alternative was paying a finder to surface a historical lie, which needs somebody to
///    adjudicate each filing and rewards inventing them. Nobody would post a bond that can be
///    slashed for what they did before they posted it.
///  - **The verdict carries its own authorisation.** The CRE forwarder on Monad mainnet is
///    `MockKeystoneForwarder 1.0.0` and its `report` function is permissionless by design, so
///    `msg.sender == forwarder` authorises the entire world. This contract recovers the signer from
///    the report and requires an attestor fixed at construction. The forwarder is transport.
///  - **Refusals are events, not just reverts.** The mock forwarder catches a receiver revert and
///    records `success = false` rather than bubbling it, so a bad signature would otherwise be
///    invisible on chain. Every rejection emits.
///
/// Immutable. No proxy, no upgrade path, no admin, no pause. Nothing here can take a posted bond
/// except the rule the agent agreed to when it posted.
contract Sclera is IReceiver {
    /* ------------------------------------------------------------------ types */

    enum State {
        None, // never posted
        Active, // locked, window running
        Slashed, // forfeit, the commitment was missed
        Released // matured and withdrawn
    }

    /// @dev Packed to sit in consecutive slots. Monad warms storage per 128-slot page rather than
    ///      per slot, so keeping a bond contiguous costs one cold page. uint128 is far beyond any
    ///      real bond at 6 decimals.
    struct Bond {
        address agent; //      slot 0, 20 bytes
        uint64 postedAt; //    slot 0, +8  block number, the retroactivity floor
        State state; //        slot 0, +1
        address token; //      slot 1, 20 bytes
        uint64 windowBlocks; // slot 1, +8
        uint128 amount; //     slot 2, 16 bytes
        uint16 minTruthRateBps; // slot 2, +2   0..10000
        uint32 minSampleSize; //   slot 2, +4
        uint64 lastNonce; //       slot 2, +8   monotonic, replay floor
    }

    /// @notice What the workflow asserts. Signed by the attestor, never trusted from the caller.
    /// @dev `windowStart` and `windowEnd` are block numbers on this chain. `sampleSize` counts the
    ///      agent's payment claims recorded in that window and `trueCount` how many resolved true.
    ///      `unknown` is deliberately absent: a claim nobody could decide is not evidence either
    ///      way and must never be counted as a failure. The workflow excludes it from the sample.
    struct Verdict {
        uint256 agentId;
        uint64 windowStart;
        uint64 windowEnd;
        uint32 sampleSize;
        uint32 trueCount;
        uint64 nonce;
    }

    /* ----------------------------------------------------------------- storage */

    mapping(uint256 => Bond) private _bonds;

    uint8 private _entered;

    /* --------------------------------------------------------------- immutable */

    /// @notice The only key whose signature moves money here. Set once, at construction.
    address public immutable attestor;

    /// @notice Where a forfeit bond goes. A slashed bond is not compensation, because a receipt
    ///         that does not resolve harms nobody this contract can identify on chain. It is a
    ///         deposit the agent loses. Sending it to a party fixed at deploy time keeps anyone
    ///         from profiting by triggering a slash, which is the griefing incentive to avoid.
    address public immutable slashBeneficiary;

    /// @notice The ERC-8004 Identity Registry this contract reads ownership from.
    ///
    /// A constructor argument rather than a constant because the registries are per-chain
    /// singletons at one address on every mainnet AND at a different address on Monad testnet, so a
    /// hardcoded value would be correct in production and untestable everywhere else.
    address public immutable identityRegistry;

    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    bytes32 private constant _VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)"
    );

    uint16 internal constant BPS = 10_000;

    /* ------------------------------------------------------------------ events */

    event BondPosted(
        uint256 indexed agentId,
        address indexed agent,
        address token,
        uint256 amount,
        uint16 minTruthRateBps,
        uint64 windowBlocks,
        uint32 minSampleSize,
        uint64 postedAt
    );

    /// @notice A verdict was accepted and the commitment held.
    event VerdictAccepted(
        uint256 indexed agentId, uint32 sampleSize, uint32 trueCount, uint16 truthRateBps, uint64 nonce
    );

    event BondSlashed(
        uint256 indexed agentId,
        address indexed to,
        address token,
        uint256 amount,
        uint16 truthRateBps,
        uint16 minTruthRateBps,
        uint32 sampleSize
    );

    event BondReleased(uint256 indexed agentId, address indexed agent, address token, uint256 amount);

    /// @notice A report reached this contract and was refused.
    /// @dev This exists because the mock forwarder swallows a receiver revert into `success=false`
    ///      and emits its own event with no reason. Without this, a forged report would be
    ///      indistinguishable on chain from one that never arrived.
    // `ReportRefused` was removed rather than kept unused. It was emitted immediately before a
    // revert on every refusal path, so a revert discarded the log and no such event could ever be
    // observed: the contract appeared to publish why a report was refused and published nothing. The
    // custom errors below carry the same information in revert data, where a caller can actually read
    // it. See docs/17-CONTRACT-AUDIT.md Finding 10.

    /* ------------------------------------------------------------------ errors */

    error BondExists();
    error NoSuchBond();
    error WrongState();
    error NotAgent();
    error NotAgentOwner();
    error ZeroAmount();
    error ZeroAgent();
    error WindowOpen();
    error TransferFailed();
    error Reentrancy();
    error BadRate();
    error BadWindow();
    error BadSample();
    error BadSignature();
    error StaleVerdict();
    error WindowMismatch();
    error SampleTooSmall();

    /* --------------------------------------------------------------- modifiers */

    modifier nonReentrant() {
        if (_entered == 1) revert Reentrancy();
        _entered = 1;
        _;
        _entered = 0;
    }

    constructor(address attestor_, address slashBeneficiary_, address identityRegistry_) {
        if (attestor_ == address(0) || slashBeneficiary_ == address(0) || identityRegistry_ == address(0)) {
            revert ZeroAgent();
        }
        attestor = attestor_;
        slashBeneficiary = slashBeneficiary_;
        identityRegistry = identityRegistry_;
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    /* ------------------------------------------------------------------- views */

    function bonds(uint256 agentId) external view returns (Bond memory) {
        return _bonds[agentId];
    }

    /// @notice Block at which an active bond may be released if it has not been slashed.
    function maturesAt(uint256 agentId) external view returns (uint64) {
        Bond storage b = _bonds[agentId];
        if (b.state == State.None) revert NoSuchBond();
        return b.postedAt + b.windowBlocks;
    }

    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        return block.chainid == _CACHED_CHAIN_ID ? _CACHED_DOMAIN_SEPARATOR : _buildDomainSeparator();
    }

    /// @inheritdoc IERC165
    /// @dev The production `KeystoneForwarder` gates on this before it will call `onReport`, so a
    ///      receiver that answers wrong is unreachable there. Implemented for that path.
    ///
    ///      It is NOT a safety boundary on Monad today. The mock the simulator writes through does
    ///      not perform the check at all: forked against mainnet, that forwarder called `onReport`
    ///      on a receiver whose `supportsInterface` returns false, and on one with no
    ///      `supportsInterface` at all, never calling it in either case. The `develop` source for
    ///      the mock does contain an `ERC165Checker` call in `route`, so the deployed bytecode and
    ///      the published source disagree. Measured, not assumed. See `ScleraFork.t.sol`.
    function supportsInterface(bytes4 interfaceId) public pure override returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }

    /* -------------------------------------------------------------------- post */

    /// @notice Lock a bond against an agent's future claim-truth rate.
    ///
    /// @param agentId          the ERC-8004 agent id this bond speaks for
    /// @param token            ERC-20 held for the life of the bond
    /// @param amount           base units, so the token's own decimals are the caller's problem
    /// @param minTruthRateBps  the floor being committed to, in basis points
    /// @param windowBlocks     how long the commitment runs before it can be released
    /// @param minSampleSize    below this many decided claims, a verdict cannot slash
    ///
    /// `minSampleSize` is not a formality. One unresolved receipt out of one is a 0% truth rate and
    /// it is also noise. Slashing on it would make the bond a coin flip rather than a commitment.
    function postBond(
        uint256 agentId,
        address token,
        uint128 amount,
        uint16 minTruthRateBps,
        uint64 windowBlocks,
        uint32 minSampleSize
    ) external nonReentrant {
        if (agentId == 0) revert ZeroAgent();
        if (amount == 0) revert ZeroAmount();
        if (minTruthRateBps > BPS) revert BadRate();
        if (windowBlocks == 0) revert BadWindow();
        if (minSampleSize == 0) revert BadSample();

        Bond storage b = _bonds[agentId];
        if (b.state != State.None) revert BondExists();

        // The whole point of the contract, enforced rather than assumed.
        //
        // Without this, anyone could post a bond against anyone's agent. That is not theft, because
        // `release` pays whoever posted, but it makes a bond prove nothing: a stranger could bond
        // any agent with `minTruthRateBps = 0`, which no verdict can fall below, and the agent would
        // read as bonded to anybody looking. "An agent stakes against its own promise" has to be a
        // fact about the caller, not a description of the intended use.
        //
        // It also closes the squat: one bond per agent forever meant a stranger could take the slot
        // for the cost of one atomic unit and the real owner could never bond again.
        //
        // `ownerOf` reverts for an unregistered agent, which is the outcome we want and is why there
        // is no existence check of our own here.
        if (IIdentityRegistry(identityRegistry).ownerOf(agentId) != msg.sender) revert NotAgentOwner();

        b.agent = msg.sender;
        b.postedAt = uint64(block.number);
        b.state = State.Active;
        b.token = token;
        b.windowBlocks = windowBlocks;
        b.amount = amount;
        b.minTruthRateBps = minTruthRateBps;
        b.minSampleSize = minSampleSize;

        uint256 before = _balance(token);
        if (!IERC20(token).transferFrom(msg.sender, address(this), amount)) revert TransferFailed();
        _requireExactlyReceived(token, before, amount);

        emit BondPosted(
            agentId, msg.sender, token, amount, minTruthRateBps, windowBlocks, minSampleSize, uint64(block.number)
        );
    }

    /* ------------------------------------------------------------------ report */

    /// @inheritdoc IReceiver
    /// @notice Take a signed verdict from the CRE workflow and act on it.
    ///
    /// `metadata` is the forwarder's own framing and is deliberately ignored: it names a workflow
    /// and an execution, neither of which this contract can verify on a chain where the forwarder
    /// validates nothing. Authorisation comes from the attestor's signature over the verdict.
    function onReport(bytes calldata, bytes calldata report) external override nonReentrant {
        (Verdict memory v, bytes memory signature) = abi.decode(report, (Verdict, bytes));

        Bond storage b = _bonds[v.agentId];
        if (b.state != State.Active) {
            revert WrongState();
        }

        if (!_signedByAttestor(v, signature)) {
            revert BadSignature();
        }

        // Monotonic per agent, so a replayed or reordered report cannot re-decide a settled window.
        if (v.nonce <= b.lastNonce) {
            revert StaleVerdict();
        }

        // The window has to sit inside what was committed to. `windowStart` at or after `postedAt`
        // is the whole forward-looking rule, enforced here rather than trusted to the workflow.
        if (v.windowStart < b.postedAt || v.windowEnd < v.windowStart || v.windowEnd > block.number) {
            revert WindowMismatch();
        }

        if (v.trueCount > v.sampleSize) {
            revert BadSample();
        }

        b.lastNonce = v.nonce;

        if (v.sampleSize < b.minSampleSize) {
            revert SampleTooSmall();
        }

        uint16 rateBps = uint16((uint256(v.trueCount) * BPS) / v.sampleSize);

        if (rateBps >= b.minTruthRateBps) {
            emit VerdictAccepted(v.agentId, v.sampleSize, v.trueCount, rateBps, v.nonce);
            return;
        }

        // Below the floor it committed to. Effects before interaction, same as everywhere else.
        address token = b.token;
        uint256 amount = b.amount;
        uint16 minRate = b.minTruthRateBps;
        b.state = State.Slashed;
        b.amount = 0;

        emit BondSlashed(v.agentId, slashBeneficiary, token, amount, rateBps, minRate, v.sampleSize);
        if (!IERC20(token).transfer(slashBeneficiary, amount)) revert TransferFailed();
    }

    /* ----------------------------------------------------------------- release */

    /// @notice Take the bond back once the window has run without a slash.
    /// @dev Anyone may call it, because the money can only go to the agent that posted it. That
    ///      keeps a bond from being stranded by an agent that has lost its key to the gas token.
    function release(uint256 agentId) external nonReentrant {
        Bond storage b = _bonds[agentId];
        if (b.state == State.None) revert NoSuchBond();
        if (b.state != State.Active) revert WrongState();
        if (block.number < uint256(b.postedAt) + uint256(b.windowBlocks)) revert WindowOpen();

        address agent = b.agent;
        address token = b.token;
        uint256 amount = b.amount;
        b.state = State.Released;
        b.amount = 0;

        emit BondReleased(agentId, agent, token, amount);
        if (!IERC20(token).transfer(agent, amount)) revert TransferFailed();
    }

    /* -------------------------------------------------------- signature guts */

    function _signedByAttestor(Verdict memory v, bytes memory signature) private view returns (bool) {
        if (signature.length != 65) return false;

        bytes32 structHash = keccak256(
            abi.encode(_VERDICT_TYPEHASH, v.agentId, v.windowStart, v.windowEnd, v.sampleSize, v.trueCount, v.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));

        bytes32 r;
        bytes32 s;
        uint8 vByte;
        assembly {
            r := mload(add(signature, 0x20))
            s := mload(add(signature, 0x40))
            vByte := byte(0, mload(add(signature, 0x60)))
        }

        // Reject the high-s half of the curve. Every signature has a second valid encoding with
        // `s` mirrored, so accepting both would let the same verdict arrive twice under two
        // different signatures. The nonce already blocks the replay; this closes the door earlier.
        if (uint256(s) > 0x7FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF5D576E7357A4501DDFE92F46681B20A0) return false;

        // Conventional, and redundant on purpose. `ecrecover` already returns the zero address for
        // any `v` outside {27, 28}, so the zero check below catches this on its own. Deleting this
        // line is the one mutation the test suite cannot detect, because the two paths are
        // behaviourally identical. Kept for a reader who should not have to know that.
        if (vByte != 27 && vByte != 28) return false;

        address signer = ecrecover(digest, vByte, r, s);
        return signer != address(0) && signer == attestor;
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)"),
                keccak256(bytes("Sclera")),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /* ----------------------------------------------------------------- helpers */

    function _balance(address token) private view returns (uint256) {
        return IERC20(token).balanceOf(address(this));
    }

    /// @dev Refuse any token that does not deliver exactly what was asked for. A fee-on-transfer
    ///      token credits less than `amount` while the bond records the full figure, so the last
    ///      bond out becomes unpayable and this contract has no admin recovery.
    function _requireExactlyReceived(address token, uint256 balanceBefore, uint256 amount) private view {
        if (_balance(token) - balanceBefore != amount) revert TransferFailed();
    }
}
