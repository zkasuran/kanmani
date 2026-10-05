// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Aqueous} from "../src/Aqueous.sol";

interface IUSDC {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
}

/// @notice The first outside job: Mida's kanmani-auditor re-checks the 10 Monad payment claims our
///         verifier found on no chain. Metered, 10 units at 0.05 USDC, 0.50 ceiling, 72 hours.
///
/// The brief is a Mida record on Monad testnet. Its write-once contextId is the termsHash, so the
/// buyer's signature covers exactly that brief. The agent delivers with the contextId of its
/// findings record as deliverableHash. The buyer stays gasless; the house relays and pays gas.
///
///   PHASE=fund   forge script script/MidaJob.s.sol --rpc-url https://rpc.monad.xyz [--broadcast]
///   PHASE=settle UNITS=10 forge script script/MidaJob.s.sol --rpc-url https://rpc.monad.xyz [--broadcast]
///
/// Needs HOUSE_WALLET_PRIVATE_KEY and DEMO_BUYER_KEY. Both are read from the environment only.
contract MidaJob is Script {
    Aqueous constant ESCROW = Aqueous(0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32);
    IUSDC constant USDC = IUSDC(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);

    address constant AGENT = 0xD68937ed886243bf5A44Bb0A9338Ee91bB8D2016;
    /// Mida brief record, registry 0x75fB6dB9af93A8d823e51c488CaA913ca711FB78 on Monad testnet.
    bytes32 constant BRIEF = 0xd9d35dc2c50055f8054b6c7a3b36fc447f6118ac5e2a4f76a7c53920cdcb9007;
    bytes32 constant SALT = keccak256("kanmani x mida, job 1: re-check the 10 claims found on no chain");

    uint128 constant PRICE = 50_000; // 0.05 USDC per claim
    uint128 constant CEILING = 500_000; // 10 claims
    uint64 constant DURATION = 72 hours;
    uint256 constant AGENT_GAS = 0.05 ether; // MON for the agent's one deliver() call

    bytes32 constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    function run() external {
        uint256 houseKey = vm.envUint("HOUSE_WALLET_PRIVATE_KEY");
        uint256 buyerKey = vm.envUint("DEMO_BUYER_KEY");
        address buyer = vm.addr(buyerKey);
        bytes32 jobId = ESCROW.jobIdFor(buyer, AGENT, SALT);
        string memory phase = vm.envString("PHASE");

        console.log("buyer  :", buyer);
        console.log("agent  :", AGENT);
        console.log("jobId  :");
        console.logBytes32(jobId);

        if (keccak256(bytes(phase)) == keccak256("fund")) {
            require(USDC.balanceOf(buyer) >= CEILING, "buyer holds less than the ceiling");
            Aqueous.Terms memory t = Aqueous.Terms({
                agent: AGENT,
                token: address(USDC),
                amount: CEILING,
                pricePerUnit: PRICE,
                deadline: uint64(block.timestamp) + DURATION,
                termsHash: BRIEF,
                salt: SALT
            });
            uint256 validBefore = block.timestamp + 1 hours;
            bytes32 digest = keccak256(
                abi.encodePacked(
                    "\x19\x01",
                    USDC.DOMAIN_SEPARATOR(),
                    keccak256(
                        abi.encode(
                            TRANSFER_WITH_AUTHORIZATION_TYPEHASH,
                            buyer,
                            address(ESCROW),
                            uint256(CEILING),
                            uint256(0),
                            validBefore,
                            ESCROW.authNonceFor(t)
                        )
                    )
                )
            );
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, digest);

            vm.startBroadcast(houseKey);
            ESCROW.createJobWithAuthorization(
                t, Aqueous.Authorization({from: buyer, validAfter: 0, validBefore: validBefore, v: v, r: r, s: s})
            );
            if (AGENT.balance < AGENT_GAS) payable(AGENT).transfer(AGENT_GAS);
            vm.stopBroadcast();

            console.log("escrowed      :", uint256(ESCROW.jobs(jobId).amount));
            console.log("termsHash ok  :", ESCROW.jobs(jobId).termsHash == BRIEF);
            console.log("deadline      :", uint256(t.deadline));
            console.log("agent MON wei :", AGENT.balance);
        } else if (keccak256(bytes(phase)) == keccak256("settle")) {
            uint256 units = vm.envUint("UNITS");
            require(units <= CEILING / PRICE, "more units than the ceiling allows");
            uint256 validBefore = block.timestamp + 1 hours;
            (uint8 v, bytes32 r, bytes32 s) = vm.sign(buyerKey, ESCROW.settleMeteredDigest(jobId, units, validBefore));
            vm.broadcast(houseKey);
            ESCROW.settleMeteredWithAuthorization(jobId, units, validBefore, v, r, s);
            console.log("agent USDC    :", USDC.balanceOf(AGENT));
        } else {
            revert("PHASE must be fund or settle");
        }
    }
}
