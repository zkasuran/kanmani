// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Aqueous} from "../src/Aqueous.sol";

interface IUSDC {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function authorizationState(address, bytes32) external view returns (bool);
}

/// @notice The whole lifecycle against the REAL USDC contract on Monad mainnet, forked locally.
///
/// This replaces "testnet first", which is not available for the money path: **USDC does not exist
/// on Monad testnet** (`eth_getCode` returns `0x` at the mainnet address and there is no testnet
/// deployment). A testnet run could only ever exercise a mock token.
///
/// A fork is strictly better here anyway. The unit suite's mock does no signature checking at all,
/// because a mock that pretends to verify signatures tests the mock. This exercises the real
/// bytecode, the real EIP-712 domain and the real nonce tracking, which is the one part of the
/// facilitator path we could not otherwise prove.
///
///   forge test --match-contract AqueousForkTest --fork-url "$MONAD_RPC"
///
/// Skips itself rather than passing quietly when no fork URL is set.
contract AqueousForkTest is Test {
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    /// @dev EIP-3009. Fixed by the standard, not read from the token, so a token that disagreed
    ///      would fail the signature check rather than silently accept a different shape.
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    Aqueous internal esc;

    uint256 internal buyerKey = 0xB0B5EED;
    address internal buyer;
    address internal agent = address(0xA6E7);
    address internal relayer = address(0xBEEF);

    uint128 internal constant AMOUNT = 250_000; // 0.25 USDC at 6 decimals

    function setUp() public {
        if (block.chainid != 143) return;
        buyer = vm.addr(buyerKey);
        esc = new Aqueous(3 days);
    }

    /// @dev `vm.skip`, not an early return. An early return reports [PASS] at ~2,400 gas, which is a
    ///      failure that looks like success: five green fork tests that never touched a fork. Caught by
    ///      running the suite without `--fork-url` and noticing the gas was too small to be real.
    modifier onlyFork() {
        vm.skip(block.chainid != 143, "not forked: run with --fork-url against Monad mainnet (143)");
        _;
    }

    /// The token is what we think it is. If this fails, nothing below it means anything.
    function test_fork_usdcIsWhatWeThinkItIs() public onlyFork {
        assertEq(IUSDC(USDC).decimals(), 6, "6 decimals, not 18");
        assertTrue(IUSDC(USDC).DOMAIN_SEPARATOR() != bytes32(0), "has an EIP-712 domain");
        assertGt(USDC.code.length, 0, "deployed");
    }

    /// The facilitator path, end to end, with a signature real USDC verifies.
    function test_fork_relayedAuthorizationThenRelease() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        Aqueous.Terms memory t = _terms(0, keccak256("fork-job-1"));
        Aqueous.Authorization memory a = _signFor(buyerKey, t);

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        assertEq(IUSDC(USDC).balanceOf(address(esc)), AMOUNT, "real USDC is escrowed");
        assertEq(IUSDC(USDC).balanceOf(buyer), 0, "buyer paid");
        assertEq(esc.jobs(id).buyer, buyer, "signer owns it, not the relayer");
        assertTrue(IUSDC(USDC).authorizationState(buyer, esc.authNonceFor(t)), "token burned the nonce");

        vm.prank(agent);
        esc.deliver(id, keccak256("deliverable"));

        vm.prank(buyer);
        esc.release(id);

        assertEq(IUSDC(USDC).balanceOf(agent), AMOUNT, "agent paid in real USDC");
        assertEq(IUSDC(USDC).balanceOf(address(esc)), 0, "escrow empty");
    }

    /// Real USDC rejects a second use of the same authorisation. Nonce tracking is its job.
    function test_fork_realTokenRejectsReplay() public onlyFork {
        deal(USDC, buyer, AMOUNT * 2);

        Aqueous.Terms memory t = _terms(0, keccak256("replay-1"));
        Aqueous.Authorization memory a = _signFor(buyerKey, t);

        vm.prank(relayer);
        esc.createJobWithAuthorization(t, a);

        // Same terms means the same derived nonce, so the token refuses the second use.
        vm.prank(relayer);
        vm.expectRevert();
        esc.createJobWithAuthorization(t, a);
    }

    /// A signature from the wrong key must not move anyone's money.
    function test_fork_forgedSignatureRejected() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        Aqueous.Terms memory t = _terms(0, keccak256("forged-job"));
        // signed by an attacker while claiming `from` is the buyer
        Aqueous.Authorization memory a = _signFor(0xBADBAD, t);

        vm.prank(relayer);
        vm.expectRevert();
        esc.createJobWithAuthorization(t, a);

        assertEq(IUSDC(USDC).balanceOf(buyer), AMOUNT, "buyer untouched");
    }

    /// THE FIX, against the real token: a relayer cannot alter what the buyer agreed to.
    ///
    /// The buyer's EIP-3009 signature covers only (from, to, value, validAfter, validBefore, nonce).
    /// Before the nonce was derived from the terms, a relayer holding a valid authorisation could
    /// name itself as the agent, deliver nothing, block refund by moving the job out of Open and
    /// claim the whole escrow after the dispute window.
    function test_fork_relayerCannotAlterTheTerms() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        Aqueous.Terms memory intended = _terms(0, keccak256("intended"));
        Aqueous.Authorization memory a = _signFor(buyerKey, intended);

        Aqueous.Terms memory tampered = _copy(intended);
        tampered.agent = address(0xBAD); // the whole attack, in one line

        vm.prank(address(0xBAD));
        vm.expectRevert();
        esc.createJobWithAuthorization(tampered, a);

        assertEq(IUSDC(USDC).balanceOf(buyer), AMOUNT, "buyer's money never moved");

        // Unaltered it still works, so the revert is about tampering rather than a broken helper.
        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(intended, a);
        assertEq(esc.jobs(id).agent, agent, "the agent the buyer chose");
    }

    /// Metered settlement returns the remainder in real USDC, in the same transaction.
    function test_fork_meteredReturnsRemainder() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        Aqueous.Terms memory t = _terms(50_000, keccak256("metered-job")); // 0.05 per unit, 5 unit ceiling
        Aqueous.Authorization memory a = _signFor(buyerKey, t);

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        vm.prank(buyer);
        esc.settleMetered(id, 2); // used 2 of 5

        assertEq(IUSDC(USDC).balanceOf(agent), 100_000, "agent paid for 2 units");
        assertEq(IUSDC(USDC).balanceOf(buyer), 150_000, "3 units returned");
        assertEq(IUSDC(USDC).balanceOf(address(esc)), 0, "nothing retained");
    }

    /* ---------------------------------------------------------------- helpers */

    /// @dev `Terms memory b = a` ALIASES in Solidity, it does not copy. Tampering through the
    ///      alias mutated the original and invalidated a signature made earlier in the test, which
    ///      looked exactly like the contract rejecting valid terms. Copy explicitly.
    function _copy(Aqueous.Terms memory t) internal pure returns (Aqueous.Terms memory) {
        return Aqueous.Terms({
            agent: t.agent,
            token: t.token,
            amount: t.amount,
            pricePerUnit: t.pricePerUnit,
            deadline: t.deadline,
            termsHash: t.termsHash,
            salt: t.salt
        });
    }

    function _terms(uint128 pricePerUnit, bytes32 salt)
        internal
        view
        returns (Aqueous.Terms memory)
    {
        return Aqueous.Terms({
            agent: agent,
            token: USDC,
            amount: AMOUNT,
            pricePerUnit: pricePerUnit,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("terms"),
            salt: salt
        });
    }

    /// @dev Signs the nonce the CONTRACT derives from these exact terms and against the domain
    ///      separator READ FROM THE TOKEN rather than reconstructed from assumptions.
    function _signFor(uint256 key, Aqueous.Terms memory t)
        internal
        view
        returns (Aqueous.Authorization memory)
    {
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 structHash = keccak256(
            abi.encode(
                RECEIVE_WITH_AUTHORIZATION_TYPEHASH,
                buyer,
                address(esc),
                uint256(t.amount),
                uint256(0),
                validBefore,
                esc.authNonceFor(t)
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IUSDC(USDC).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Aqueous.Authorization({
            from: buyer,
            validAfter: 0,
            validBefore: validBefore,
            v: v,
            r: r,
            s: s
        });
    }
}
