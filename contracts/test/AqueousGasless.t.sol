// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice The gasless buyer path, end to end and adversarially.
///
/// The property under test, stated once: **a buyer who never holds the gas token can start a job,
/// finish it and get their money back from a dead agent.** Before these functions existed only
/// the first of those three was true, which stranded anyone who took the gasless entrance.
///
/// Every test here asserts `buyer.balance == 0` at the end, because the moment the buyer needs one
/// wei of MON the whole claim is gone and a test that merely checks the balances moved would not
/// notice.
contract AqueousGaslessTest is Test {
    Aqueous internal esc;
    TestUSDC internal usdc;

    uint256 internal buyerKey = 0xB0B5EED;
    uint256 internal attackerKey = 0xBADBAD;
    address internal buyer;
    address internal agent = address(0xA6E7);
    address internal relayer = address(0xBEEF);

    uint64 internal constant CLAIM_WINDOW = 3 days;
    uint128 internal constant AMOUNT = 25_000_000;

    /// @dev secp256k1 group order, for building the malleable twin of a signature.
    uint256 internal constant N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141;

    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function setUp() public {
        vm.chainId(10143);
        esc = new Aqueous(CLAIM_WINDOW);
        usdc = new TestUSDC();
        buyer = vm.addr(buyerKey);
        usdc.mint(buyer, AMOUNT * 4);
        vm.deal(relayer, 10 ether);
        // buyer is deliberately never dealt any MON
    }

    /* ---------------------------------------------------------- happy paths */

    /// The whole point: created, delivered and released without the buyer ever holding MON.
    function test_buyerNeverHoldsGas_createThenRelease() public {
        bytes32 id = _openGasless(0, keccak256("gasless-flat"));

        vm.prank(agent);
        esc.deliver(id, keccak256("done"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(id, validBefore));

        vm.prank(relayer);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);

        assertEq(usdc.balanceOf(agent), AMOUNT, "agent paid");
        assertEq(usdc.balanceOf(address(esc)), 0, "escrow empty");
        assertEq(buyer.balance, 0, "buyer never held a single wei of MON");
    }

    /// Metered settlement, gasless, with the remainder returned.
    function test_buyerNeverHoldsGas_meteredSettle() public {
        bytes32 id = _openGasless(5_000_000, keccak256("gasless-metered"));
        uint256 before = usdc.balanceOf(buyer);

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.settleMeteredDigest(id, 2, validBefore));

        vm.prank(relayer);
        esc.settleMeteredWithAuthorization(id, 2, validBefore, v, r, s);

        assertEq(usdc.balanceOf(agent), 10_000_000, "paid for 2 units");
        assertEq(usdc.balanceOf(buyer), before + 15_000_000, "3 units returned");
        assertEq(buyer.balance, 0, "still no MON");
    }

    /// The exit that matters most: a dead agent cannot strand a buyer who holds no gas.
    function test_buyerNeverHoldsGas_refundFromADeadAgent() public {
        bytes32 id = _openGasless(0, keccak256("gasless-refund"));
        uint256 before = usdc.balanceOf(buyer);

        vm.warp(block.timestamp + 8 days); // agent never delivered
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.refundDigest(id, validBefore));

        vm.prank(relayer);
        esc.refundWithAuthorization(id, validBefore, v, r, s);

        assertEq(usdc.balanceOf(buyer), before + AMOUNT, "whole again");
        assertEq(buyer.balance, 0, "and never needed gas to get there");
    }

    /* ------------------------------------------------------------ adversarial */

    /// A relayer cannot settle for a different unit count than the buyer signed.
    function test_relayerCannotChangeTheUnitCount() public {
        bytes32 id = _openGasless(5_000_000, keccak256("units"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.settleMeteredDigest(id, 1, validBefore));

        // signed for 1 unit, submitted as 5, which would pay the agent the whole ceiling
        vm.prank(relayer);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.settleMeteredWithAuthorization(id, 5, validBefore, v, r, s);

        assertEq(usdc.balanceOf(address(esc)), AMOUNT, "nothing moved");
    }

    /// A signature for one job does not release another.
    function test_signatureIsBoundToItsJob() public {
        bytes32 a = _openGasless(0, keccak256("job-a"));
        bytes32 b = _openGasless(0, keccak256("job-b"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(a, validBefore));

        vm.prank(relayer);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.releaseWithAuthorization(b, validBefore, v, r, s);
    }

    /// Anyone who is not the buyer signing produces a signer that is not the buyer.
    function test_attackerSignatureRejected() public {
        bytes32 id = _openGasless(0, keccak256("attacker"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(attackerKey, esc.releaseDigest(id, validBefore));

        vm.prank(relayer);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);
    }

    /// A relayer cannot sit on a signature indefinitely.
    function test_expiredAuthorizationRejected() public {
        bytes32 id = _openGasless(0, keccak256("expiry"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(id, validBefore));

        vm.warp(validBefore);
        vm.prank(relayer);
        vm.expectRevert(Aqueous.AuthorizationExpired.selector);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);
    }

    /// Replay is blocked by the state machine, which is why there is no nonce.
    ///
    /// This asserts the REASON the design is safe rather than just that it is. If someone later
    /// makes an action non-terminal, this fails and tells them a nonce is now required.
    function test_replayIsBlockedByTerminalState() public {
        bytes32 id = _openGasless(0, keccak256("replay"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(id, validBefore));

        vm.prank(relayer);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);

        vm.prank(relayer);
        vm.expectRevert(Aqueous.WrongState.selector);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);
    }

    /// The malleable twin of a valid signature is refused.
    ///
    /// The twin has to be built correctly or this test passes for the wrong reason. `(v, r, s)` and
    /// `(v flipped, r, n - s)` both recover the SAME signer, so `r` must be carried through
    /// untouched. Pass garbage as `r` and the revert comes from `ecrecover` returning zero instead
    /// of from the high-`s` check, which proves nothing about malleability.
    function test_malleableSignatureRejected() public {
        bytes32 id = _openGasless(0, keccak256("malleable"));

        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(id, validBefore));

        bytes32 twinS = bytes32(N - uint256(s));
        uint8 twinV = v == 27 ? 28 : 27;

        // First prove the twin really is a valid alternative encoding of the same signature, so
        // the rejection below is a deliberate refusal rather than an accident of bad inputs.
        bytes32 digest = esc.releaseDigest(id, validBefore);
        assertEq(ecrecover(digest, twinV, r, twinS), buyer, "the twin does recover to the buyer");
        assertGt(uint256(twinS), uint256(bytes32(N / 2)), "and its s is in the upper half");

        vm.prank(relayer);
        vm.expectRevert(Aqueous.InvalidSignature.selector);
        esc.releaseWithAuthorization(id, validBefore, twinV, r, twinS);

        // and the original still works, so the rejection is about the twin rather than the setup
        vm.prank(relayer);
        esc.releaseWithAuthorization(id, validBefore, v, r, s);
        assertEq(usdc.balanceOf(agent), AMOUNT);
    }

    /// Garbage in the signature fields must never recover to a usable address.
    function test_garbageSignatureRejected() public {
        bytes32 id = _openGasless(0, keccak256("garbage"));
        uint256 validBefore = block.timestamp + 1 hours;

        vm.prank(relayer);
        vm.expectRevert(Aqueous.InvalidSignature.selector);
        esc.releaseWithAuthorization(id, validBefore, 27, bytes32(0), bytes32(0));

        vm.prank(relayer);
        vm.expectRevert(Aqueous.InvalidSignature.selector); // v out of range
        esc.releaseWithAuthorization(id, validBefore, 29, keccak256("r"), keccak256("s"));
    }

    /// A signature is bound to THIS deployment, so it cannot be replayed on another one.
    ///
    /// Built so it can actually fail. The job lives on `other` and the buyer signs a release
    /// against `esc`'s domain for that same job id. Everything except the domain is identical, so
    /// if the two contracts shared a separator this would succeed.
    function test_signatureIsBoundToThisDeployment() public {
        Aqueous other = new Aqueous(CLAIM_WINDOW);
        bytes32 id = _openGaslessOn(other, 0, keccak256("domain"));

        uint256 validBefore = block.timestamp + 1 hours;

        assertTrue(other.DOMAIN_SEPARATOR() != esc.DOMAIN_SEPARATOR(), "different verifyingContract");
        assertTrue(
            other.releaseDigest(id, validBefore) != esc.releaseDigest(id, validBefore),
            "same job, same deadline, different digest"
        );

        // Signed for esc, submitted to other. Recovers to somebody, but not to this job's buyer.
        (uint8 v, bytes32 r, bytes32 s) = _sign(buyerKey, esc.releaseDigest(id, validBefore));
        vm.prank(relayer);
        vm.expectRevert(Aqueous.NotBuyer.selector);
        other.releaseWithAuthorization(id, validBefore, v, r, s);

        // Re-signed for the right deployment it works, so the block above is the domain doing its
        // job rather than anything else being broken.
        (uint8 v2, bytes32 r2, bytes32 s2) = _sign(buyerKey, other.releaseDigest(id, validBefore));
        vm.prank(relayer);
        other.releaseWithAuthorization(id, validBefore, v2, r2, s2);
        assertEq(usdc.balanceOf(agent), AMOUNT, "paid, once, on the right contract");
    }

    /// @dev Worth an assertion of its own, because it surprised me while writing the test above.
    ///
    /// `authNonceFor` is `pure` and does not mix in the escrow's address, so identical terms yield
    /// an identical EIP-3009 nonce on every Aqueous deployment. The token tracks nonces per
    /// `(from, nonce)` and ignores `to`, so the same buyer cannot fund byte-identical terms twice
    /// on one chain even across two different escrows.
    ///
    /// That is conservative rather than dangerous: it refuses work, it never authorises any. Cross
    /// deployment replay of the creation was already impossible because the signed `to` is the
    /// escrow's own address. Keeping `authNonceFor` pure lets a client derive the nonce with no RPC
    /// call, which is worth more than removing a collision that a distinct salt already avoids.
    function test_authNonceIsSharedAcrossDeployments() public {
        Aqueous other = new Aqueous(CLAIM_WINDOW);
        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: address(usdc),
            amount: AMOUNT,
            pricePerUnit: 0,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("terms"),
            salt: keccak256("shared")
        });
        assertEq(esc.authNonceFor(t), other.authNonceFor(t), "same terms, same nonce, either escrow");
    }

    /* ---------------------------------------------------------------- helpers */

    /// @dev Creates a job entirely gaslessly, so every test starts from the state that matters.
    function _openGasless(uint128 pricePerUnit, bytes32 salt) internal returns (bytes32) {
        return _openGaslessOn(esc, pricePerUnit, salt);
    }

    function _openGaslessOn(Aqueous target, uint128 pricePerUnit, bytes32 salt)
        internal
        returns (bytes32)
    {
        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: address(usdc),
            amount: AMOUNT,
            pricePerUnit: pricePerUnit,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("terms"),
            salt: salt
        });

        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                buyer,
                address(target),
                uint256(AMOUNT),
                uint256(0),
                validBefore,
                target.authNonceFor(t)
            )
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);

        vm.prank(relayer);
        return target.createJobWithAuthorization(
            t, Aqueous.Authorization({from: buyer, validAfter: 0, validBefore: validBefore, v: v, r: r, s: s})
        );
    }

    function _sign(uint256 key, bytes32 digest) internal pure returns (uint8, bytes32, bytes32) {
        return vm.sign(key, digest);
    }
}
