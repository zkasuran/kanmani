// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IIdentityRegistryOwner {
    function ownerOf(uint256 tokenId) external view returns (address);
}

/// @title AgentPasskey
/// @notice Binds an ERC-8004 agent to a passkey held in its operator's device. It also lets any contract
///         ask "did the passkey bound to this agent approve this?" Both checks run on Monad's native
///         P256 precompile at 0x0100 (EIP-7951), so a WebAuthn signature from a phone or laptop secure
///         element is verified on chain for about 7,000 gas instead of ~300,000 in Solidity.
///
/// @dev Why an agent needs this. An ERC-8004 agent is owned by an address, which is usually a hot key
///      on a server. Anyone who takes that key takes the agent. A passkey is non-exportable: the private
///      key never leaves the authenticator and every use needs the person present (and, here, verified
///      by biometric or PIN). Binding one to the agent gives it a second authority that a server
///      compromise does not hand over, which another contract can require before it acts for the agent.
///
///      What binding proves and nothing more:
///        - the agent's current owner sent the bind (msg.sender == ownerOf) plus
///        - the holder of the passkey signed a challenge naming this chain, this contract, this agent,
///          this key, this owner and a fresh nonce, with user verification. Proof of possession, not
///          identity: it says a device approved, not who holds it.
///
///      A binding follows the owner, not the token. If the agent is transferred, `keyOf` stops returning
///      the old key, because the new owner never approved it. Nothing needs to be cleared by hand.
///
///      Signature malleability is not guarded by a low-s rule, deliberately. Authenticators emit high-s
///      about half the time, so a low-s rule would reject real passkeys. Replay is stopped by the
///      challenge instead: `bind` consumes a per-agent nonce and `verify` leaves replay protection to the
///      caller's own challenge, as every WebAuthn relying party does.
contract AgentPasskey {
    address internal constant P256_VERIFY = address(0x0100);
    bytes32 internal constant BIND_DOMAIN = keccak256("kanmani.agent-passkey.bind.v1");

    /// @dev authenticatorData flags. UP = user present, UV = user verified (biometric or PIN).
    uint8 internal constant FLAG_UP = 0x01;
    uint8 internal constant FLAG_UV = 0x04;

    IIdentityRegistryOwner public immutable identityRegistry;

    struct Key {
        uint256 qx;
        uint256 qy;
        /// The owner who bound it. The binding only counts while this is still the owner.
        address owner;
        uint64 boundAtBlock;
    }

    /// @notice A WebAuthn assertion as `navigator.credentials.get` returns it, with the two indices a
    ///         client finds by string search so the contract never parses JSON.
    struct Assertion {
        bytes authenticatorData;
        string clientDataJSON;
        /// Offset of `"challenge":"` in clientDataJSON.
        uint256 challengeIndex;
        /// Offset of `"type":"webauthn.get"` in clientDataJSON.
        uint256 typeIndex;
        uint256 r;
        uint256 s;
    }

    mapping(uint256 => Key) internal _keys;
    /// @notice Consumed by every bind and unbind, so a bind signature works exactly once.
    mapping(uint256 => uint256) public nonces;

    event PasskeyBound(uint256 indexed agentId, address indexed owner, uint256 qx, uint256 qy, uint256 nonce);
    event PasskeyUnbound(uint256 indexed agentId, address indexed owner);

    error NotAgentOwner();
    error BadAssertion();
    error NotBound();

    constructor(address registry) {
        identityRegistry = IIdentityRegistryOwner(registry);
    }

    /* ------------------------------------------------------------------ binding */

    /// @notice The challenge the passkey must sign to be bound to `agentId` as `qx`,`qy` by `owner`.
    ///         `owner` is passed rather than read so a client can build it before the owner is known to
    ///         this call; `bind` recomputes it with msg.sender, so a mismatch simply fails.
    function bindChallenge(uint256 agentId, uint256 qx, uint256 qy, address owner) public view returns (bytes32) {
        return keccak256(abi.encode(BIND_DOMAIN, block.chainid, address(this), agentId, qx, qy, owner, nonces[agentId]));
    }

    /// @notice Bind the passkey `qx`,`qy` to an agent you own. Replaces any earlier binding.
    function bind(uint256 agentId, uint256 qx, uint256 qy, Assertion calldata a) external {
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        bytes32 challenge = bindChallenge(agentId, qx, qy, msg.sender);
        if (!_verify(challenge, qx, qy, a)) revert BadAssertion();
        uint256 n = nonces[agentId]++;
        _keys[agentId] = Key(qx, qy, msg.sender, uint64(block.number));
        emit PasskeyBound(agentId, msg.sender, qx, qy, n);
    }

    /// @notice Remove the binding. Owner only; needs no passkey, so a lost device never locks an agent.
    function unbind(uint256 agentId) external {
        if (identityRegistry.ownerOf(agentId) != msg.sender) revert NotAgentOwner();
        if (_keys[agentId].owner == address(0)) revert NotBound();
        delete _keys[agentId];
        nonces[agentId]++;
        emit PasskeyUnbound(agentId, msg.sender);
    }

    /// @notice The passkey bound to an agent, if the owner who bound it still owns the agent.
    function keyOf(uint256 agentId) public view returns (bool bound, uint256 qx, uint256 qy, uint64 boundAtBlock) {
        Key memory k = _keys[agentId];
        if (k.owner == address(0) || _ownerOrZero(agentId) != k.owner) return (false, 0, 0, 0);
        return (true, k.qx, k.qy, k.boundAtBlock);
    }

    /* ------------------------------------------------------------------ the primitive */

    /// @notice Did the passkey bound to `agentId` approve `challenge`, with the user verified?
    ///         For other contracts. The caller owns replay protection: put a nonce, a deadline and its
    ///         own address inside `challenge`.
    function verify(uint256 agentId, bytes32 challenge, Assertion calldata a) external view returns (bool) {
        (bool bound, uint256 qx, uint256 qy,) = keyOf(agentId);
        return bound && _verify(challenge, qx, qy, a);
    }

    /// @notice The same check against an explicit key, for a caller that tracks keys itself.
    function verifyWith(bytes32 challenge, uint256 qx, uint256 qy, Assertion calldata a) external view returns (bool) {
        return _verify(challenge, qx, qy, a);
    }

    /* ------------------------------------------------------------------ internals */

    function _ownerOrZero(uint256 agentId) internal view returns (address o) {
        // ownerOf reverts for a burned or unknown id; that means "no current owner", not an error here.
        try identityRegistry.ownerOf(agentId) returns (address x) {
            o = x;
        } catch {}
    }

    /// @dev WebAuthn Level 3 §7.2 steps that matter on chain: type is webauthn.get, the challenge is ours,
    ///      the user was present and verified. The signature is over authData || sha256(clientData).
    function _verify(bytes32 challenge, uint256 qx, uint256 qy, Assertion calldata a) internal view returns (bool) {
        bytes calldata ad = a.authenticatorData;
        if (ad.length < 37) return false;
        uint8 flags = uint8(ad[32]);
        if (flags & FLAG_UP == 0 || flags & FLAG_UV == 0) return false;

        bytes memory cd = bytes(a.clientDataJSON);
        if (!_at(cd, a.typeIndex, bytes('"type":"webauthn.get"'))) return false;
        if (!_at(cd, a.challengeIndex, abi.encodePacked('"challenge":"', _base64url(challenge), '"'))) return false;

        bytes32 digest = sha256(abi.encodePacked(ad, sha256(cd)));
        (bool ok, bytes memory out) = P256_VERIFY.staticcall(abi.encode(digest, a.r, a.s, qx, qy));
        return ok && out.length == 32 && abi.decode(out, (uint256)) == 1;
    }

    /// @dev Is `needle` at `at` in `hay`?
    function _at(bytes memory hay, uint256 at, bytes memory needle) internal pure returns (bool) {
        if (at > hay.length || hay.length - at < needle.length) return false;
        for (uint256 i; i < needle.length; ++i) {
            if (hay[at + i] != needle[i]) return false;
        }
        return true;
    }

    /// @dev base64url of 32 bytes without padding: 43 characters, what browsers put in clientDataJSON.
    function _base64url(bytes32 v) internal pure returns (bytes memory out) {
        bytes memory t = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        bytes memory b = abi.encodePacked(v);
        out = new bytes(43);
        uint256 o;
        for (uint256 i; i < 30; i += 3) {
            uint256 n = (uint256(uint8(b[i])) << 16) | (uint256(uint8(b[i + 1])) << 8) | uint256(uint8(b[i + 2]));
            out[o++] = t[(n >> 18) & 63];
            out[o++] = t[(n >> 12) & 63];
            out[o++] = t[(n >> 6) & 63];
            out[o++] = t[n & 63];
        }
        // last two bytes: 16 bits -> 3 characters
        uint256 m = (uint256(uint8(b[30])) << 8) | uint256(uint8(b[31]));
        out[o++] = t[(m >> 10) & 63];
        out[o++] = t[(m >> 4) & 63];
        out[o] = t[(m << 2) & 63];
    }
}
