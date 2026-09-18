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
/// **The buyer never receives a single wei of MON, start to finish.** An earlier version had to
/// send the buyer gas before the settlement, because only job creation was gasless. That gap is
/// closed: `settleMeteredWithAuthorization` takes the buyer's signature and the relayer pays. The
/// `require` at the end asserts the buyer's balance is still exactly zero, so if that ever stops
/// being true the demo fails rather than quietly papering over it.
///
/// @dev Split into steps because one `run()` hit "stack too deep". Same call as the contract made:
///      restructure rather than turn on via-ir to paper over a function that was too wide to read.
contract Demo is Script {
    Aqueous internal constant ESCROW = Aqueous(0xba2B1709eC4C3E76126043B3C3ef43Cc5d4F328C);
    TestUSDC internal constant TOKEN = TestUSDC(0x841057C182b74408628FadAFba01Ad178cDA2E2f);

    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    uint128 internal constant AMOUNT = 25_000_000; // 25 tUSDC
    uint128 internal constant PRICE_PER_UNIT = 5_000_000; // 5 tUSDC per unit, so a 5 unit ceiling
    uint256 internal constant UNITS_USED = 2;

    uint256 internal houseKey;
    uint256 internal buyerKey;
    uint256 internal agentKey;
    address internal buyer;
    address internal agent;
    uint256 internal validBefore;
    bytes32 internal jobId;

    function run() external {
        require(block.chainid == 10143, "Demo: testnet only");

        houseKey = vm.envUint("HOUSE_WALLET_PRIVATE_KEY");
        buyerKey = vm.envUint("DEMO_BUYER_KEY");
        agentKey = vm.envUint("DEMO_AGENT_KEY");
        buyer = vm.addr(buyerKey);
        agent = vm.addr(agentKey);
        validBefore = block.timestamp + 1 hours;

        console.log("buyer      ", buyer);
        console.log("agent      ", agent);
        console.log("relayer    ", vm.addr(houseKey));
        console.log("buyer MON at start:", buyer.balance);
        require(buyer.balance == 0, "Demo: buyer must start with zero MON for this to prove anything");

        _createGaslessly();
        _deliver();
        _settleGaslessly();

        console.log("--- settled ---");
        console.log("agent paid      ", TOKEN.balanceOf(agent));
        console.log("buyer refunded  ", TOKEN.balanceOf(buyer));
        console.log("escrow retains  ", TOKEN.balanceOf(address(ESCROW)));
        console.log("buyer MON at end:", buyer.balance);

        // The claim this whole script exists to make. Assert it rather than print it.
        require(buyer.balance == 0, "Demo: the buyer was given gas, the gasless claim is false");
    }

    function _terms() internal view returns (Aqueous.Terms memory) {
        return Aqueous.Terms({
            agent: agent,
            token: address(TOKEN),
            amount: AMOUNT,
            pricePerUnit: PRICE_PER_UNIT,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("kanmani testnet walkthrough"),
            salt: keccak256(abi.encode(block.timestamp, buyer))
        });
    }

    /// The buyer gets tokens and deliberately no gas, signs one message and a relayer submits it.
    function _createGaslessly() internal {
        Aqueous.Terms memory t = _terms();

        vm.broadcast(houseKey);
        TOKEN.mint(buyer, AMOUNT);

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
                        ESCROW.authNonceFor(t)
                    )
                )
            )
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);

        vm.broadcast(houseKey);
        jobId = ESCROW.createJobWithAuthorization(
            t, Aqueous.Authorization({from: buyer, validAfter: 0, validBefore: validBefore, v: v, r: r, s: s})
        );

        console.log("job created by relayer, escrow holds:", TOKEN.balanceOf(address(ESCROW)));
        console.log("job owner is the signer, not the relayer:", ESCROW.jobs(jobId).buyer == buyer);
    }

    /// Agents run infrastructure, so they hold their own gas. Only the buyer is the gasless party.
    function _deliver() internal {
        if (agent.balance < 0.05 ether) {
            vm.broadcast(houseKey);
            payable(agent).transfer(0.1 ether);
        }
        vm.broadcast(agentKey);
        ESCROW.deliver(jobId, keccak256("the deliverable"));
    }

    /// The buyer SIGNS the settlement for the units actually used. Still no transaction from them.
    /// The unit count is inside the digest, so the relayer cannot settle for a different number.
    function _settleGaslessly() internal {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerKey, ESCROW.settleMeteredDigest(jobId, UNITS_USED, validBefore));

        vm.broadcast(houseKey);
        ESCROW.settleMeteredWithAuthorization(jobId, UNITS_USED, validBefore, v, r, s);
    }
}
