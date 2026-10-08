// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Aqueous} from "../src/Aqueous.sol";

interface IUSDC {
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function balanceOf(address) external view returns (uint256);
}

/// @notice Assay job 1: five signed, anchored chat completions from Assay's host (ERC-8004 10278), each
///         reading one BSC evidence document our atlas has never parsed. Metered, 5 units at 0.01 USDC,
///         0.05 ceiling, 72 hours. Terms: docs/jobs/assay-1.terms.txt, whose keccak256 is TERMS.
///
/// termsHash is the keccak256 of the published terms file. The host delivers the StandardMerkleTree
/// root over this job's 5 receipt hashes as deliverableHash. The buyer stays gasless; the house relays.
///
///   PHASE=fund   forge script script/AssayJob.s.sol --rpc-url https://rpc.monad.xyz [--broadcast]
///   PHASE=settle UNITS=10 forge script script/MidaJob.s.sol --rpc-url https://rpc.monad.xyz [--broadcast]
///
/// Needs HOUSE_WALLET_PRIVATE_KEY and DEMO_BUYER_KEY. Both are read from the environment only.
contract AssayJob is Script {
    Aqueous constant ESCROW = Aqueous(0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32);
    IUSDC constant USDC = IUSDC(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);

    address constant AGENT = 0xF3CbD8aaf1f2350bFd8a3220Ab4E83FDd8fa18d9;
    /// keccak256 of docs/jobs/assay-1.terms.txt, byte for byte.
    bytes32 constant BRIEF = 0xa02d192183a305fec199f3bf128cc970a4786461393b79ccc5b37dc9a3c4cdc1;
    bytes32 constant SALT = keccak256("kanmani x assay, job 1: five anchored receipts");

    uint128 constant PRICE = 10_000; // 0.01 USDC per response
    uint128 constant CEILING = 50_000; // 5 responses
    uint64 constant DURATION = 72 hours;
    uint256 constant AGENT_GAS = 0; // the host's payee already holds MON for deliver()

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
