// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Aqueous} from "../src/Aqueous.sol";

interface IUSDC {
    function balanceOf(address) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function DOMAIN_SEPARATOR() external view returns (bytes32);
    function authorizationState(address, bytes32) external view returns (bool);
}

/// @notice One real job, on Monad mainnet, in real USDC.
///
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   export MONAD_RPC=https://rpc.monad.xyz
///   forge script script/MainnetDemo.s.sol:MainnetDemo --rpc-url monad --broadcast \
///     --private-key "$HOUSE_WALLET_PRIVATE_KEY"
///
/// The shape is a metered API priced at 2 cents a call. The buyer escrows enough for 70 calls,
/// the agent delivers and the settlement pays for the 30 actually made. 0.80 USDC goes back.
/// That returning remainder is the honesty test of this contract: keeping it would be invisible to
/// almost every buyer, which is exactly why it goes back.
///
/// **The buyer never holds MON.** Not at any point. The script asserts that at both ends rather
/// than printing it, so if the claim ever stops being true this fails instead of quietly passing.
///
/// What this does NOT prove, said here so it never gets blurred in a writeup: the demo agent is
/// mine, so this is evidence the settlement machinery works on mainnet, not evidence that an agent
/// did useful work for a stranger.
contract MainnetDemo is Script {
    Aqueous internal constant ESCROW = Aqueous(0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32);
    IUSDC internal constant USDC = IUSDC(0x754704Bc059F8C67012fEd69BC8A327a5aafb603);

    bytes32 internal constant TRANSFER_WITH_AUTHORIZATION_TYPEHASH = keccak256(
        "TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)"
    );

    /// 1.40 USDC at 6 decimals. Read `decimals()` rather than assuming 18, always.
    ///
    /// Sized to the 1.434081 USDC actually at the house wallet, which arrived in one transfer
    /// (tx `0x7017ab54…f483f0a015`, block 106,352,992). The per-call price below is the number
    /// that matters and it is unchanged. The ceiling is just how many calls the escrow covers,
    /// so it is set to what the wallet holds rather than to a round figure the run would revert
    /// on. A script that asserts a precondition it cannot meet is not a safety check, it is a
    /// script that never runs.
    uint128 internal constant AMOUNT = 1_400_000;
    /// 0.02 USDC per call, so the escrow is a ceiling of 70 calls.
    uint128 internal constant PRICE_PER_UNIT = 20_000;
    /// 30 of the 70 actually used, so 0.60 is earned and 0.80 returns.
    uint256 internal constant UNITS_USED = 30;

    uint256 internal houseKey;
    uint256 internal buyerKey;
    uint256 internal agentKey;
    address internal buyer;
    address internal agent;
    address internal house;
    uint256 internal validBefore;
    bytes32 internal jobId;

    function run() external {
        require(block.chainid == 143, "MainnetDemo: mainnet only");

        houseKey = vm.envUint("HOUSE_WALLET_PRIVATE_KEY");
        buyerKey = vm.envUint("DEMO_BUYER_KEY");
        agentKey = vm.envUint("DEMO_AGENT_KEY");
        buyer = vm.addr(buyerKey);
        agent = vm.addr(agentKey);
        house = vm.addr(houseKey);
        validBefore = block.timestamp + 1 hours;

        require(USDC.balanceOf(house) >= AMOUNT, "MainnetDemo: house wallet needs 2 USDC");
        require(buyer.balance == 0, "MainnetDemo: buyer must start with zero MON");

        console.log("buyer  ", buyer);
        console.log("agent  ", agent);
        console.log("relayer", house);
        console.log("buyer MON at start :", buyer.balance);

        _fundBuyerWithUsdcOnly();
        _createGaslessly();
        _deliver();
        _settleGaslessly();

        console.log("--- settled, real USDC on mainnet ---");
        console.log("agent earned   ", USDC.balanceOf(agent));
        console.log("buyer returned ", USDC.balanceOf(buyer));
        console.log("escrow retains ", USDC.balanceOf(address(ESCROW)));
        console.log("buyer MON at end   :", buyer.balance);

        // The whole claim, asserted rather than printed.
        require(buyer.balance == 0, "MainnetDemo: the buyer was given gas, the claim is false");
        require(USDC.balanceOf(address(ESCROW)) == 0, "MainnetDemo: escrow retained something");
    }

    function _terms() internal view returns (Aqueous.Terms memory) {
        return Aqueous.Terms({
            agent: agent,
            token: address(USDC),
            amount: AMOUNT,
            pricePerUnit: PRICE_PER_UNIT,
            deadline: uint64(block.timestamp + 7 days),
            termsHash: keccak256("kanmani mainnet walkthrough"),
            salt: keccak256(abi.encode(block.timestamp, buyer))
        });
    }

    /// USDC only. Deliberately no MON, which is the point of everything below.
    function _fundBuyerWithUsdcOnly() internal {
        vm.broadcast(houseKey);
        USDC.transfer(buyer, AMOUNT);
    }

    /// The buyer signs one message. Real USDC verifies it, so this is the deployed FiatTokenV2
    /// doing the checking rather than anything of ours.
    function _createGaslessly() internal {
        Aqueous.Terms memory t = _terms();
        bytes32 digest = keccak256(
            abi.encodePacked(
                "\x19\x01",
                USDC.DOMAIN_SEPARATOR(),
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

        console.log("escrowed by the relayer :", USDC.balanceOf(address(ESCROW)));
        console.log("job belongs to the signer:", ESCROW.jobs(jobId).buyer == buyer);
        console.log("USDC burned the nonce   :", USDC.authorizationState(buyer, ESCROW.authNonceFor(t)));
    }

    /// Agents run infrastructure, so they hold their own gas. The buyer is the gasless party.
    function _deliver() internal {
        if (agent.balance < 0.02 ether) {
            vm.broadcast(houseKey);
            payable(agent).transfer(0.05 ether);
        }
        vm.broadcast(agentKey);
        ESCROW.deliver(jobId, keccak256("the deliverable"));
    }

    /// The buyer signs the settlement for the calls actually made. Still no transaction from them.
    /// `units` is inside the digest, so the relayer cannot settle for a different number.
    function _settleGaslessly() internal {
        (uint8 v, bytes32 r, bytes32 s) =
            vm.sign(buyerKey, ESCROW.settleMeteredDigest(jobId, UNITS_USED, validBefore));
        vm.broadcast(houseKey);
        ESCROW.settleMeteredWithAuthorization(jobId, UNITS_USED, validBefore, v, r, s);
    }
}
