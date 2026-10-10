// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice TestUSDC on its own, then Aqueous driven through it end to end.
///
/// The end-to-end test is the one that matters. It is the exact flow a judge will run against the
/// testnet deployment, with a real EIP-712 signature checked by real `ecrecover`, so the thing
/// being proven here is the thing that ships rather than a rehearsal of it.
contract TestUSDCTest is Test {
    TestUSDC internal usdc;
    Aqueous internal esc;

    uint256 internal buyerKey = 0xB0B5EED;
    address internal buyer;
    address internal agent = address(0xA6E7);
    address internal relayer = address(0xBEEF);

    uint64 internal constant CLAIM_WINDOW = 3 days;
    uint128 internal constant AMOUNT = 25_000_000; // 25 tUSDC at 6 decimals

    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    /// @dev Aqueous funds through `receiveWithAuthorization`, so a signature for the relayed create
    ///      path is built with THIS typehash. The direct-transfer tests below keep the transfer one.
    bytes32 internal constant RECEIVE_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "ReceiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function setUp() public {
        // Deploy as testnet. The constructor refuses chain 143 on purpose.
        vm.chainId(10143);
        usdc = new TestUSDC();
        esc = new Aqueous(CLAIM_WINDOW);
        buyer = vm.addr(buyerKey);
        usdc.mint(buyer, AMOUNT);
    }

    /* --------------------------------------------------------------- the guard */

    /// The whole reason this contract is safe to write: it cannot land on the chain real USDC is on.
    function test_refusesToDeployOnMainnet() public {
        vm.chainId(143);
        vm.expectRevert(TestUSDC.MainnetRefused.selector);
        new TestUSDC();
    }

    function test_deploysOnTestnet() public {
        vm.chainId(10143);
        TestUSDC t = new TestUSDC();
        assertEq(t.decimals(), 6, "6 decimals, not 18");
        assertTrue(t.DOMAIN_SEPARATOR() != bytes32(0), "has an EIP-712 domain");
    }

    /* ---------------------------------------------------------------- the token */

    function test_mintIsOpenButCapped() public {
        usdc.mint(address(0xCAFE), 1_000_000e6);
        assertEq(usdc.balanceOf(address(0xCAFE)), 1_000_000e6);

        vm.expectRevert(TestUSDC.MintTooLarge.selector);
        usdc.mint(address(0xCAFE), 1_000_000e6 + 1);
    }

    /// A fee-on-transfer token would be refused by Aqueous at creation, so prove there is no fee.
    function test_transferIsExact() public {
        vm.prank(buyer);
        usdc.transfer(agent, 1_000_000);
        assertEq(usdc.balanceOf(agent), 1_000_000, "no fee taken");
    }

    function test_domainSeparatorTracksAChainSplit() public {
        bytes32 before = usdc.DOMAIN_SEPARATOR();
        vm.chainId(999);
        assertTrue(usdc.DOMAIN_SEPARATOR() != before, "rebuilt for the new chain id");
    }

    /* ------------------------------------------------------------- EIP-3009 */

    function test_forgedSignatureRejected() public {
        Aqueous.Terms memory t = _terms(0, keccak256("forged"));
        Aqueous.Authorization memory a = _sign(0xBADBAD, t); // attacker signs, claims to be buyer

        vm.prank(relayer);
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        esc.createJobWithAuthorization(t, a);

        assertEq(usdc.balanceOf(buyer), AMOUNT, "buyer untouched");
    }

    /// The token's own replay guard, exercised DIRECTLY.
    ///
    /// Going through Aqueous cannot test this: the job id is derived from (buyer, agent, salt), so
    /// a replayed authorisation hits `JobExists()` inside `_open` before the token is ever called.
    /// That is two independent layers and it is the right behaviour, which is exactly why the
    /// token's layer has to be asserted on its own rather than inferred from the pair passing.
    function test_replayRejectedByTheToken() public {
        bytes32 nonce = keccak256("direct-replay");
        uint256 validBefore = block.timestamp + 1 hours;
        (uint8 v, bytes32 r, bytes32 s) = _signRaw(buyerKey, buyer, agent, 1_000_000, 0, validBefore, nonce);

        usdc.transferWithAuthorization(buyer, agent, 1_000_000, 0, validBefore, nonce, v, r, s);
        assertEq(usdc.balanceOf(agent), 1_000_000, "first one moved");
        assertTrue(usdc.authorizationState(buyer, nonce), "nonce burned");

        vm.expectRevert(TestUSDC.AuthorizationAlreadyUsed.selector);
        usdc.transferWithAuthorization(buyer, agent, 1_000_000, 0, validBefore, nonce, v, r, s);
    }

    /// And the other layer: Aqueous refuses the same job before the token is consulted.
    function test_replayRejectedByTheEscrowFirst() public {
        usdc.mint(buyer, AMOUNT);
        Aqueous.Terms memory t = _terms(0, keccak256("replay"));
        Aqueous.Authorization memory a = _sign(buyerKey, t);

        vm.prank(relayer);
        esc.createJobWithAuthorization(t, a);

        vm.prank(relayer);
        vm.expectRevert(Aqueous.JobExists.selector);
        esc.createJobWithAuthorization(t, a);
    }

    function test_expiredAuthorizationRejected() public {
        Aqueous.Terms memory t = _terms(0, keccak256("expired"));
        Aqueous.Authorization memory a = _sign(buyerKey, t);

        vm.warp(a.validBefore + 1);
        vm.prank(relayer);
        vm.expectRevert(TestUSDC.AuthorizationExpired.selector);
        esc.createJobWithAuthorization(t, a);
    }

    /// The fix from the audit, against this token: a relayer cannot alter what the buyer agreed to.
    function test_relayerCannotAlterTheTerms() public {
        Aqueous.Terms memory intended = _terms(0, keccak256("intended"));
        Aqueous.Authorization memory a = _sign(buyerKey, intended);

        Aqueous.Terms memory tampered = _copy(intended);
        tampered.agent = address(0xBAD);

        vm.prank(address(0xBAD));
        vm.expectRevert(TestUSDC.InvalidSignature.selector);
        esc.createJobWithAuthorization(tampered, a);

        assertEq(usdc.balanceOf(buyer), AMOUNT, "buyer's money never moved");
    }

    /* ------------------------------------------------------------ end to end */

    /// Exactly what a judge will do against the testnet deployment.
    function test_endToEnd_relayedHireThenRelease() public {
        Aqueous.Terms memory t = _terms(0, keccak256("e2e-flat"));
        Aqueous.Authorization memory a = _sign(buyerKey, t);

        // The buyer holds no gas token at all. This is the point of the relayed path.
        assertEq(buyer.balance, 0, "buyer has no MON");

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        assertEq(usdc.balanceOf(address(esc)), AMOUNT, "escrowed");
        assertEq(esc.jobs(id).buyer, buyer, "signer owns it, not the relayer");
        assertTrue(usdc.authorizationState(buyer, esc.authNonceFor(t)), "nonce burned");

        vm.prank(agent);
        esc.deliver(id, keccak256("the deliverable"));

        vm.prank(buyer);
        esc.release(id);

        assertEq(usdc.balanceOf(agent), AMOUNT, "agent paid");
        assertEq(usdc.balanceOf(address(esc)), 0, "escrow empty");
    }

    /// The metered path, which is the honesty test: the unspent remainder goes back.
    function test_endToEnd_meteredReturnsRemainder() public {
        Aqueous.Terms memory t = _terms(5_000_000, keccak256("e2e-metered")); // 5 tUSDC per unit
        Aqueous.Authorization memory a = _sign(buyerKey, t);

        vm.prank(relayer);
        bytes32 id = esc.createJobWithAuthorization(t, a);

        vm.prank(buyer);
        esc.settleMetered(id, 2); // used 2 of a 5 unit ceiling

        assertEq(usdc.balanceOf(agent), 10_000_000, "paid for 2 units");
        assertEq(usdc.balanceOf(buyer), 15_000_000, "3 units returned");
        assertEq(usdc.balanceOf(address(esc)), 0, "nothing retained");
    }

    /* ---------------------------------------------------------------- helpers */

    /// @dev `Terms memory b = a` ALIASES in Solidity, it does not copy.
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

    function _terms(uint128 pricePerUnit, bytes32 salt) internal view returns (Aqueous.Terms memory) {
        return Aqueous.Terms({
            agent: agent,
            token: address(usdc),
            amount: AMOUNT,
            pricePerUnit: pricePerUnit,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("terms"),
            salt: salt
        });
    }

    /// @dev Signs an arbitrary EIP-3009 authorisation, for testing the token without Aqueous.
    function _signRaw(
        uint256 key,
        address from,
        address to,
        uint256 value,
        uint256 validAfter,
        uint256 validBefore,
        bytes32 nonce
    ) internal view returns (uint8 v, bytes32 r, bytes32 s) {
        bytes32 structHash = keccak256(
            abi.encode(TRANSFER_WITH_AUTHORIZATION_TYPEHASH, from, to, value, validAfter, validBefore, nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        return vm.sign(key, digest);
    }

    /// @dev Signs the nonce the CONTRACT derives from these exact terms, against the domain
    ///      separator READ FROM THE TOKEN rather than reconstructed from assumptions.
    function _sign(uint256 key, Aqueous.Terms memory t)
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
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", usdc.DOMAIN_SEPARATOR(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(key, digest);
        return Aqueous.Authorization({from: buyer, validAfter: 0, validBefore: validBefore, v: v, r: r, s: s});
    }
}
