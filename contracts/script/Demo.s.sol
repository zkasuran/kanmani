// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Drives one complete job through the LIVE testnet deployment, as a judge would.
///
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   forge script script/Demo.s.sol:Demo --rpc-url monad_testnet --broadcast \
///     --private-key "$HOUSE_WALLET_PRIVATE_KEY"
///
/// Everything here is a real transaction against real deployed bytecode. Nothing is simulated,
/// which is the only reason running it proves anything.
///
/// **One honest limitation this script makes visible rather than hides.** The relayed path removes
/// the gas requirement from job CREATION, which is the step a new buyer hits first and the step
/// that otherwise stops them dead. It does not remove it from `release`, because releasing is the
/// buyer asserting the work is good and that assertion has to come from the buyer's own key. So
/// the script funds the buyer a little MON before the release and says so on screen.
contract Demo is Script {
    Aqueous internal constant ESCROW = Aqueous(0xAbB85ab157357676eBE7ae17A161168912A3c232);
    TestUSDC internal constant TOKEN = TestUSDC(0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32);

    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint128 internal constant AMOUNT = 25_000_000; // 25 tUSDC
    uint128 internal constant PRICE_PER_UNIT = 5_000_000; // 5 tUSDC per unit, so a 5 unit ceiling
    uint256 internal constant UNITS_USED = 2;

    function run() external {
        require(block.chainid == 10143, "Demo: testnet only");

        uint256 houseKey = vm.envUint("HOUSE_WALLET_PRIVATE_KEY");
        uint256 buyerKey = vm.envUint("DEMO_BUYER_KEY");
        uint256 agentKey = vm.envUint("DEMO_AGENT_KEY");

        address buyer = vm.addr(buyerKey);
        address agent = vm.addr(agentKey);

        console.log("buyer      ", buyer);
        console.log("agent      ", agent);
        console.log("relayer    ", vm.addr(houseKey));

        Aqueous.Terms memory t = Aqueous.Terms({
            agent: agent,
            token: address(TOKEN),
            amount: AMOUNT,
            pricePerUnit: PRICE_PER_UNIT,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("kanmani testnet walkthrough"),
            salt: keccak256(abi.encode(block.timestamp, buyer))
        });

        // 1. The buyer is given test tokens and deliberately NO gas token.
        vm.broadcast(houseKey);
        TOKEN.mint(buyer, AMOUNT);
        console.log("minted tUSDC to buyer, buyer MON balance:", buyer.balance);

        // 2. The buyer signs one message. No transaction, no gas, nothing on chain yet.
        //    The nonce is derived from the terms, so this signature is only usable for THESE terms.
        bytes32 authNonce = ESCROW.authNonceFor(t);
        uint256 validBefore = block.timestamp + 1 hours;
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                TOKEN.DOMAIN_SEPARATOR(),
                keccak256(
                    abi.encode(
                        TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                        buyer,
                        address(ESCROW),
                        uint256(AMOUNT),
                        uint256(0),
                        validBefore,
                        authNonce
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);

        // 3. The RELAYER submits it and pays the gas. The buyer still has not touched the chain.
        vm.broadcast(houseKey);
        bytes32 jobId = ESCROW.createJobWithAuthorization(
            t, Aqueous.Authorization({from: buyer, validAfter: 0, validBefore: validBefore, v: v, r: r, s: s})
        );
        console.log("job created by relayer, escrow holds:", TOKEN.balanceOf(address(ESCROW)));
        console.log("job owner is the signer, not the relayer:", ESCROW.jobs(jobId).buyer == buyer);

        // 4. The agent delivers.
        vm.broadcast(houseKey);
        payable(agent).transfer(0.2 ether);
        vm.broadcast(agentKey);
        ESCROW.deliver(jobId, keccak256("the deliverable"));

        // 5. The buyer settles for what was actually used. This step needs the buyer's own key, so
        //    it needs the buyer to hold gas. Stated plainly rather than papered over.
        vm.broadcast(houseKey);
        payable(buyer).transfer(0.2 ether);
        vm.broadcast(buyerKey);
        ESCROW.settleMetered(jobId, UNITS_USED);

        console.log("--- settled ---");
        console.log("agent paid      ", TOKEN.balanceOf(agent));
        console.log("buyer refunded  ", TOKEN.balanceOf(buyer));
        console.log("escrow retains  ", TOKEN.balanceOf(address(ESCROW)));
    }
}
