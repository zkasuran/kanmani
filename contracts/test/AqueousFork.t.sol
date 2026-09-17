// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Aqueous, IERC20} from "../src/Aqueous.sol";

interface IUSDC {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
    function decimals() external view returns (uint8);
    function authorizationState(address, bytes32) external view returns (bool);
}

/// @notice The whole lifecycle against the REAL USDC contract on Monad mainnet, forked locally.
///
/// This replaces "testnet first", which is not available for the money path: **USDC does not exist
/// on Monad testnet** (`eth_getCode` returns `0x` at the mainnet address, and there is no testnet
/// deployment). A testnet run could only ever exercise a mock token.
///
/// A fork is strictly better here anyway. The unit suite's mock does no signature checking at all,
/// because a mock that pretends to verify signatures tests the mock. This exercises the real
/// bytecode, the real EIP-712 domain and the real nonce tracking, which is the one part of the
/// facilitator path we could not otherwise prove.
///
///   forge test --match-contract AqueousForkTest --fork-url "$MONAD_RPC"
///
/// Skips itself with a clear message when no fork URL is set, rather than passing quietly.
contract AqueousForkTest is Test {
    address internal constant USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    /// @dev EIP-3009. Fixed by the standard, not read from the token, so a token that disagreed
    ///      would fail the signature check rather than silently accept a different shape.
    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    Aqueous internal esc;

    uint256 internal buyerKey = 0xB0B5EED;
    address internal buyer;
    address internal agent = address(0xA6E7);
    address internal relayer = address(0xBEEF);

    uint128 internal constant AMOUNT = 250_000; // 0.25 USDC at 6 decimals

    function setUp() public {
        // Only run when pointed at a fork. `forge test` without --fork-url leaves this empty.
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

    /// The facilitator path, end to end, with a signature the real token verifies.
    ///
    /// The buyer signs once and never touches the chain. The relayer pays the gas and receives no
    /// rights over the job. That is the only shape in which someone who holds no MON can hire.
    function test_fork_relayedAuthorizationThenRelease() public onlyFork {
        deal(USDC, buyer, AMOUNT);
        assertEq(IUSDC(USDC).balanceOf(buyer), AMOUNT, "buyer funded");

        bytes32 nonce = keccak256("kanmani-fork-1");
        uint256 validAfter = 0;
        uint256 validBefore = block.timestamp + 1 hours;

        Aqueous.Authorization memory a =
            _sign(buyer, address(esc), AMOUNT, validAfter, validBefore, nonce);

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: USDC,
            amount: AMOUNT,
            pricePerUnit: 0,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("fork terms"),
            salt: keccak256("fork-job-1")
        });

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        assertEq(IUSDC(USDC).balanceOf(address(esc)), AMOUNT, "real USDC is escrowed");
        assertEq(IUSDC(USDC).balanceOf(buyer), 0, "buyer paid");
        assertEq(esc.jobs(id).buyer, buyer, "signer owns it, not the relayer");
        assertTrue(IUSDC(USDC).authorizationState(buyer, nonce), "token burned the nonce");

        vm.prank(agent);
        esc.deliver(id, keccak256("deliverable"));

        vm.prank(buyer);
        esc.release(id);

        assertEq(IUSDC(USDC).balanceOf(agent), AMOUNT, "agent paid in real USDC");
        assertEq(IUSDC(USDC).balanceOf(address(esc)), 0, "escrow empty");
    }

    /// The real token rejects a replayed authorisation. Nonce tracking is its job, not ours.
    function test_fork_realTokenRejectsReplay() public onlyFork {
        deal(USDC, buyer, AMOUNT * 2);

        bytes32 nonce = keccak256("kanmani-fork-replay");
        Aqueous.Authorization memory a =
            _sign(buyer, address(esc), AMOUNT, 0, block.timestamp + 1 hours, nonce);

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: USDC,
            amount: AMOUNT,
            pricePerUnit: 0,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("t"),
            salt: keccak256("replay-1")
        });

        vm.prank(relayer);
        esc.createJobWithAuthorization(t, a);

        t.salt = keccak256("replay-2"); // different job, same authorisation
        vm.prank(relayer);
        vm.expectRevert();
        esc.createJobWithAuthorization(t, a);
    }

    /// A signature from the wrong key must not move anyone's money.
    function test_fork_forgedSignatureRejected() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        uint256 attackerKey = 0xBADBAD;
        // signed by the attacker, but claiming `from` is the buyer
        Aqueous.Authorization memory a = _signWith(
            attackerKey, buyer, address(esc), AMOUNT, 0, block.timestamp + 1 hours, keccak256("forged")
        );

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: USDC,
            amount: AMOUNT,
            pricePerUnit: 0,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("t"),
            salt: keccak256("forged-job")
        });

        vm.prank(relayer);
        vm.expectRevert();
        esc.createJobWithAuthorization(t, a);

        assertEq(IUSDC(USDC).balanceOf(buyer), AMOUNT, "buyer untouched");
    }

    /// Metered settlement returns the remainder in real USDC, in the same transaction.
    function test_fork_meteredReturnsRemainder() public onlyFork {
        deal(USDC, buyer, AMOUNT);

        uint128 price = 50_000; // 0.05 USDC per unit, ceiling of 5 units
        Aqueous.Authorization memory a =
            _sign(buyer, address(esc), AMOUNT, 0, block.timestamp + 1 hours, keccak256("metered"));

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: USDC,
            amount: AMOUNT,
            pricePerUnit: price,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("t"),
            salt: keccak256("metered-job")
        });

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        vm.prank(buyer);
        esc.settleMetered(id, 2); // used 2 of 5

        assertEq(IUSDC(USDC).balanceOf(agent), 100_000, "agent paid for 2 units");
        assertEq(IUSDC(USDC).balanceOf(buyer), 150_000, "3 units returned");
        assertEq(IUSDC(USDC).balanceOf(address(esc)), 0, "nothing retained");
    }

    /* ---------------------------------------------------------------- helpers */

    function _sign(
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (Aqueous.Authorization memory) {
        return _signWith(buyerKey, from, to, value, validAfter, validBefore, nonce);
    }

    /// @dev Domain separator is READ FROM THE TOKEN rather than reconstructed, so this signs against
    ///      whatever domain USDC actually uses instead of whatever we assumed it uses.
    function _signWith(
        uint256 key,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (Aqueous.Authorization memory) {
        bytes32 structHash = keccak256(
            abi.encode(
                TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce
            )
        );
        bytes32 digest =
            keccak256(abi.encodePacked("\x19\x01", IUSDC(USDC).DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);

        return Aqueous.Authorization({
            from: from,
            validAfter: validAfter,
            validBefore: validBefore,
            nonce: nonce,
            v: v,
            r: r,
            s: s
        });
    }
}
