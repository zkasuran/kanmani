// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import {AgentPasskey} from "../src/AgentPasskey.sol";
import {MockIdentityRegistry} from "./fixtures/MockIdentityRegistry.sol";

/// @dev Runs under `FOUNDRY_PROFILE=p256` (evm osaka), where revm implements the P256 precompile at
///      0x0100 exactly as Monad does (EIP-7951). Under the default shanghai profile there is no
///      precompile, every verification fails and `test_precompileIsLive` says why instead of the rest
///      failing mysteriously.
///
///      Assertions are built the way an authenticator builds them: authenticatorData with a real rpId
///      hash and flags, clientDataJSON in browser field order plus a P256 signature over
///      authenticatorData || sha256(clientDataJSON). The challenge is base64url-encoded by the forge
///      cheatcode, not by the contract, so the contract's encoder is tested rather than trusted.
contract AgentPasskeyTest is Test {
    AgentPasskey ap;
    MockIdentityRegistry reg;

    uint256 constant PK = 0xA11CE5;
    uint256 constant OTHER_PK = 0xB0B;
    uint256 qx;
    uint256 qy;
    address owner = address(0xA0);
    uint256 constant AGENT = 10256;

    bytes32 constant RPID_HASH = sha256("kanmani.xyz");

    function setUp() public {
        reg = new MockIdentityRegistry();
        ap = new AgentPasskey(address(reg));
        reg.setOwner(AGENT, owner);
        (qx, qy) = vm.publicKeyP256(PK);
        // No precompile at 0x0100 in this EVM spec: skip loudly rather than fail for the wrong reason.
        (bool ok, bytes memory out) = address(0x100).staticcall(new bytes(160));
        if (!(ok && out.length == 0 && _hasPrecompile())) vm.skip(true, "P256 precompile absent: run FOUNDRY_PROFILE=p256");
    }

    function _hasPrecompile() internal view returns (bool) {
        bytes32 d = sha256("probe");
        (bytes32 r, bytes32 s) = vm.signP256(PK, d);
        (uint256 x, uint256 y) = vm.publicKeyP256(PK);
        (bool ok, bytes memory out) = address(0x100).staticcall(abi.encode(d, r, s, x, y));
        return ok && out.length == 32;
    }

    /* --------------------------------------------------------------- helpers */

    function _b64url(bytes32 c) internal pure returns (string memory s) {
        s = vm.toBase64URL(abi.encodePacked(c));
        // forge pads; browsers do not. 32 bytes -> 44 chars with one '=', drop it.
        bytes memory b = bytes(s);
        if (b.length == 44 && b[43] == "=") {
            bytes memory t = new bytes(43);
            for (uint256 i; i < 43; ++i) t[i] = b[i];
            s = string(t);
        }
    }

    function _assert(uint256 key, bytes32 challenge, uint8 flags, string memory type_)
        internal
        view
        returns (AgentPasskey.Assertion memory a)
    {
        bytes memory ad = abi.encodePacked(RPID_HASH, flags, uint32(7));
        string memory prefix = string.concat('{"type":"', type_, '",');
        string memory cd = string.concat(prefix, '"challenge":"', _b64url(challenge), '","origin":"https://kanmani.xyz","crossOrigin":false}');
        bytes32 digest = sha256(abi.encodePacked(ad, sha256(bytes(cd))));
        (bytes32 r, bytes32 s) = vm.signP256(key, digest);
        a = AgentPasskey.Assertion(ad, cd, bytes(prefix).length, 1, uint256(r), uint256(s));
    }

    /// @dev Memory structs alias on assignment, so a tamper test needs a real copy.
    function _copy(AgentPasskey.Assertion memory a) internal pure returns (AgentPasskey.Assertion memory) {
        return AgentPasskey.Assertion(a.authenticatorData, a.clientDataJSON, a.challengeIndex, a.typeIndex, a.r, a.s);
    }

    function _bindAs(address who, uint256 key) internal returns (AgentPasskey.Assertion memory a) {
        (uint256 x, uint256 y) = vm.publicKeyP256(key);
        a = _assert(key, ap.bindChallenge(AGENT, x, y, who), 0x05, "webauthn.get");
        vm.prank(who);
        ap.bind(AGENT, x, y, a);
    }

    /* --------------------------------------------------------------- the precompile itself */

    function test_precompileIsLive() public view {
        bytes32 d = sha256("probe");
        (bytes32 r, bytes32 s) = vm.signP256(PK, d);
        (bool ok, bytes memory out) = address(0x100).staticcall(abi.encode(d, r, s, qx, qy));
        assertTrue(ok);
        assertEq(out.length, 32, "no P256 precompile: run with FOUNDRY_PROFILE=p256 (evm osaka)");
        assertEq(abi.decode(out, (uint256)), 1);
    }

    /* --------------------------------------------------------------- bind */

    function test_ownerBindsWithAVerifiedPasskey() public {
        vm.expectEmit(true, true, false, true);
        emit AgentPasskey.PasskeyBound(AGENT, owner, qx, qy, 0);
        _bindAs(owner, PK);
        (bool bound, uint256 x, uint256 y, uint64 at) = ap.keyOf(AGENT);
        assertTrue(bound);
        assertEq(x, qx);
        assertEq(y, qy);
        assertEq(at, block.number);
        assertEq(ap.nonces(AGENT), 1);
    }

    function test_onlyTheOwnerCanBind() public {
        AgentPasskey.Assertion memory a = _assert(PK, ap.bindChallenge(AGENT, qx, qy, address(0xBAD)), 0x05, "webauthn.get");
        vm.prank(address(0xBAD));
        vm.expectRevert(AgentPasskey.NotAgentOwner.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_theKeyMustSignItsOwnBinding() public {
        // Signed by a different passkey than the one being bound: possession not proven.
        AgentPasskey.Assertion memory a = _assert(OTHER_PK, ap.bindChallenge(AGENT, qx, qy, owner), 0x05, "webauthn.get");
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_aBindSignatureWorksExactlyOnce() public {
        AgentPasskey.Assertion memory a = _bindAs(owner, PK);
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_aSignatureForAnotherAgentOwnerOrChainIsRefused() public {
        reg.setOwner(1, owner);
        AgentPasskey.Assertion memory forOther = _assert(PK, ap.bindChallenge(1, qx, qy, owner), 0x05, "webauthn.get");
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, forOther);

        AgentPasskey.Assertion memory forOtherOwner = _assert(PK, ap.bindChallenge(AGENT, qx, qy, address(0xC0)), 0x05, "webauthn.get");
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, forOtherOwner);

        AgentPasskey.Assertion memory a = _assert(PK, ap.bindChallenge(AGENT, qx, qy, owner), 0x05, "webauthn.get");
        vm.chainId(1);
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_userVerificationIsRequired() public {
        AgentPasskey.Assertion memory a = _assert(PK, ap.bindChallenge(AGENT, qx, qy, owner), 0x01, "webauthn.get");
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_aRegistrationCeremonyIsNotAnAssertion() public {
        AgentPasskey.Assertion memory a = _assert(PK, ap.bindChallenge(AGENT, qx, qy, owner), 0x05, "webauthn.create");
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.BadAssertion.selector);
        ap.bind(AGENT, qx, qy, a);
    }

    function test_tamperingWithAnyPartBreaksIt() public view {
        bytes32 c = ap.bindChallenge(AGENT, qx, qy, owner);
        AgentPasskey.Assertion memory a = _assert(PK, c, 0x05, "webauthn.get");
        AgentPasskey.Assertion memory t = _copy(a);

        t.authenticatorData = abi.encodePacked(RPID_HASH, uint8(0x05), uint32(8));
        assertFalse(ap.verifyWith(c, qx, qy, t), "counter changed");
        t = _copy(a);
        t.clientDataJSON = string.concat(a.clientDataJSON, " ");
        assertFalse(ap.verifyWith(c, qx, qy, t), "clientData changed");
        t = _copy(a);
        t.s = a.s ^ 1;
        assertFalse(ap.verifyWith(c, qx, qy, t), "s changed");
        t = _copy(a);
        t.challengeIndex = a.challengeIndex + 1;
        assertFalse(ap.verifyWith(c, qx, qy, t), "index moved");
        t = _copy(a);
        t.challengeIndex = type(uint256).max;
        assertFalse(ap.verifyWith(c, qx, qy, t), "index overflow");
        t = _copy(a);
        t.authenticatorData = hex"00";
        assertFalse(ap.verifyWith(c, qx, qy, t), "short authData");
        assertFalse(ap.verifyWith(c, qx, qy + 1, a), "key off curve");
        assertTrue(ap.verifyWith(c, qx, qy, a), "the untouched one still verifies");
    }

    /* --------------------------------------------------------------- lifecycle */

    function test_aTransferredAgentNoLongerReadsAsBound() public {
        _bindAs(owner, PK);
        reg.setOwner(AGENT, address(0xC0));
        (bool bound,,,) = ap.keyOf(AGENT);
        assertFalse(bound, "the new owner never approved this key");
        reg.setOwner(AGENT, owner);
        (bound,,,) = ap.keyOf(AGENT);
        assertTrue(bound, "and it counts again if the agent comes back");
    }

    function test_unbindIsOwnerOnlyNeedsNoPasskeyAndConsumesTheNonce() public {
        _bindAs(owner, PK);
        vm.prank(address(0xBAD));
        vm.expectRevert(AgentPasskey.NotAgentOwner.selector);
        ap.unbind(AGENT);
        vm.prank(owner);
        ap.unbind(AGENT);
        (bool bound,,,) = ap.keyOf(AGENT);
        assertFalse(bound);
        assertEq(ap.nonces(AGENT), 2);
        vm.prank(owner);
        vm.expectRevert(AgentPasskey.NotBound.selector);
        ap.unbind(AGENT);
    }

    function test_rebindingReplacesTheKey() public {
        _bindAs(owner, PK);
        _bindAs(owner, OTHER_PK);
        (, uint256 x,,) = ap.keyOf(AGENT);
        (uint256 ox,) = vm.publicKeyP256(OTHER_PK);
        assertEq(x, ox);
    }

    /* --------------------------------------------------------------- the primitive for other contracts */

    function test_verifyAnswersForTheBoundKeyOnly() public {
        _bindAs(owner, PK);
        bytes32 action = keccak256("release payment 42 before block 999");
        assertTrue(ap.verify(AGENT, action, _assert(PK, action, 0x05, "webauthn.get")));
        assertFalse(ap.verify(AGENT, action, _assert(OTHER_PK, action, 0x05, "webauthn.get")), "another passkey");
        assertFalse(ap.verify(AGENT, keccak256("other"), _assert(PK, action, 0x05, "webauthn.get")), "another challenge");
        assertFalse(ap.verify(7, action, _assert(PK, action, 0x05, "webauthn.get")), "an unbound agent");
    }

    function test_highSSignaturesFromRealAuthenticatorsAreAccepted() public view {
        // Flip s to n - s: the same signature in its other form. Authenticators emit either.
        uint256 n = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
        bytes32 c = keccak256("either s");
        AgentPasskey.Assertion memory a = _assert(PK, c, 0x05, "webauthn.get");
        a.s = n - a.s;
        assertTrue(ap.verifyWith(c, qx, qy, a));
    }

    function test_verificationCostsAboutOnePrecompileCall() public view {
        bytes32 c = keccak256("gas");
        AgentPasskey.Assertion memory a = _assert(PK, c, 0x05, "webauthn.get");
        uint256 g = gasleft();
        ap.verifyWith(c, qx, qy, a);
        g -= gasleft();
        console.log("verifyWith gas", g);
        assertLt(g, 60_000, "a Solidity P256 verifier costs ~300k; the precompile path should be far under");
    }

    /* --------------------------------------------------------------- fuzz */

    function testFuzz_anyChallengeRoundTripsThroughTheEncoder(bytes32 c) public view {
        assertTrue(ap.verifyWith(c, qx, qy, _assert(PK, c, 0x05, "webauthn.get")));
    }
}
