// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

/// @title TestUSDC
/// @notice A USDC-shaped ERC-20 with EIP-3009, for Monad TESTNET only.
///
/// This exists because of one measured fact: **there is no USDC on Monad testnet.**
/// `eth_getCode` at `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` returns `0x` on chain 10143,
/// and so does AUSD at its own address. Neither do the ERC-8004 registries. A testnet
/// deployment of Aqueous therefore has nothing to escrow unless we bring a token.
///
/// It is shaped to match real USDC where that matters to Aqueous:
///  - **6 decimals**, not 18. Amounts are base units, so a client that hardcodes 18 is wrong by 1e12.
///  - `transferWithAuthorization` with a **real `ecrecover` check** against a real EIP-712 domain.
///    A mock that skips the signature check tests the mock, so this does not skip it.
///  - the same `TransferWithAuthorization` typehash, so a signature built for real USDC is built
///    the same way here and the relayed path is genuinely exercised rather than simulated.
///
/// It is deliberately NOT shaped like USDC in the ways that would make it dangerous:
///  - `mint` is open to anyone, because a testnet token nobody can obtain is useless to a judge.
///  - the name and symbol say what it is. Nothing here should ever be mistaken for money.
///  - **the constructor refuses to deploy on Monad mainnet.** See below.
contract TestUSDC {
    /* ------------------------------------------------------------------ metadata */

    string public constant name = "Kanmani Test USD";
    string public constant symbol = "tUSDC";

    /// @dev 6, matching real USDC. The single highest-risk constant in this repo: a caller that
    ///      assumes 18 is off by a factor of a trillion and it fails silently rather than loudly.
    uint8 public constant decimals = 6;

    /// @dev One mint is capped so a fat-fingered call cannot mint a number that makes every
    ///      balance in a UI unreadable. Call it again for more. There is no supply cap.
    uint256 public constant MAX_MINT = 1_000_000e6;

    /* ------------------------------------------------------------------- storage */

    uint256 public totalSupply;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    /// @notice EIP-3009 replay guard. True once an authorisation nonce has been used.
    mapping(address => mapping(bytes32 => bool)) public authorizationState;

    /* -------------------------------------------------------------------- EIP-712 */

    bytes32 private constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    bytes32 private constant EIP712_DOMAIN_TYPEHASH =
        keccak256("EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)");

    /// @dev Cached, plus the chain id it was built for. A domain separator baked in at deploy is
    ///      wrong after a chain splits and the fix is cheap, so do it rather than assume.
    bytes32 private immutable _CACHED_DOMAIN_SEPARATOR;
    uint256 private immutable _CACHED_CHAIN_ID;

    /* -------------------------------------------------------------------- events */

    event Transfer(address indexed from, address indexed to, uint256 value);
    event Approval(address indexed owner, address indexed spender, uint256 value);
    event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce);

    /* -------------------------------------------------------------------- errors */

    error MainnetRefused();
    error MintTooLarge();
    error AuthorizationNotYetValid();
    error AuthorizationExpired();
    error AuthorizationAlreadyUsed();
    error InvalidSignature();

    /// @dev **Refuses to exist on Monad mainnet.**
    ///
    /// Real USDC is deployed on chain 143. A contract called "Test USD" with an open mint has no
    /// business sharing a chain with it and the cost of someone confusing the two is somebody's
    /// money. A revert here is a guarantee rather than a convention: this bytecode cannot be put
    /// on 143 by a wrong `--rpc-url`, a stale env var or a copied command.
    constructor() {
        if (block.chainid == 143) revert MainnetRefused();
        _CACHED_CHAIN_ID = block.chainid;
        _CACHED_DOMAIN_SEPARATOR = _buildDomainSeparator();
    }

    /* --------------------------------------------------------------------- views */

    /// @notice The EIP-712 domain a signer must use. Read it from here rather than rebuilding it,
    ///         which is also how the fork tests treat real USDC.
    function DOMAIN_SEPARATOR() public view returns (bytes32) {
        if (block.chainid == _CACHED_CHAIN_ID) return _CACHED_DOMAIN_SEPARATOR;
        return _buildDomainSeparator();
    }

    function _buildDomainSeparator() private view returns (bytes32) {
        return keccak256(
            abi.encode(
                EIP712_DOMAIN_TYPEHASH,
                keccak256(bytes(name)),
                keccak256(bytes("1")),
                block.chainid,
                address(this)
            )
        );
    }

    /* ---------------------------------------------------------------------- mint */

    /// @notice Open faucet. Anyone may mint to anyone, because this is a testnet token and a judge
    ///         needs to be able to get some without asking us for it.
    function mint(address to, uint256 amount) external {
        if (amount > MAX_MINT) revert MintTooLarge();
        totalSupply += amount;
        balanceOf[to] += amount;
        emit Transfer(address(0), to, amount);
    }

    /* ------------------------------------------------------------------- ERC-20 */

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        emit Approval(msg.sender, spender, amount);
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        _transfer(msg.sender, to, amount);
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        _transfer(from, to, amount);
        return true;
    }

    /// @dev Exact transfer, no fee, no rebase. Aqueous refuses any token that credits less than it
    ///      was asked for, so a fee here would make the escrow reject this token at creation.
    function _transfer(address from, address to, uint256 amount) private {
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        emit Transfer(from, to, amount);
    }

    /* ------------------------------------------------------------------ EIP-3009 */

    /// @notice Move `value` from `from` on the strength of their signature, submitted by anyone.
    ///
    /// This is the path Aqueous depends on: the buyer signs one message and never needs the chain's
    /// gas token and whoever relays it pays the gas. The signature check below is the real thing,
    /// so a relayer that alters the terms produces a different nonce and is rejected here rather
    /// than by anything Aqueous does.
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
    ) external {
        if (block.timestamp <= validAfter) revert AuthorizationNotYetValid();
        if (block.timestamp >= validBefore) revert AuthorizationExpired();
        if (authorizationState[from][nonce]) revert AuthorizationAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", DOMAIN_SEPARATOR(), structHash));

        address signer = ecrecover(digest, v, r, s);
        if (signer == address(0) || signer != from) revert InvalidSignature();

        authorizationState[from][nonce] = true;
        emit AuthorizationUsed(from, nonce);

        _transfer(from, to, value);
    }
}
