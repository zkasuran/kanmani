// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Aqueous} from "../src/Aqueous.sol";
import {TestUSDC} from "../src/TestUSDC.sol";

/// @notice Deploys Aqueous, plus a token to escrow when the chain does not already have one.
///
///   # testnet, chain 10143
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   forge script script/Deploy.s.sol:Deploy --rpc-url monad_testnet --broadcast \
///     --private-key "$HOUSE_WALLET_PRIVATE_KEY"
///
///   # mainnet, chain 143, uses real USDC and deploys no token of its own
///   forge script script/Deploy.s.sol:Deploy --rpc-url monad --broadcast \
///     --private-key "$HOUSE_WALLET_PRIVATE_KEY"
///
/// The chain decides the shape, never a flag, because a flag is a thing you can get wrong.
contract Deploy is Script {
    /// @notice Real USDC on Monad mainnet. Verified live: 1,798 bytes of code on chain 143,
    ///         `decimals()` returns 6 and it answers `authorizationState(0,0)`.
    address internal constant MAINNET_USDC = 0x754704Bc059F8C67012fEd69BC8A327a5aafb603;

    uint64 internal constant MAINNET_CHAIN = 143;
    uint64 internal constant TESTNET_CHAIN = 10143;

    /// @dev How long a delivered job waits before the agent can claim without the buyer. Fixed at
    ///      deploy and public, so neither side can be surprised by it. Three days is long enough
    ///      for a buyer to notice and short enough that an agent is not held hostage.
    uint64 internal constant CLAIM_WINDOW = 3 days;

    function run() external {
        uint256 chain = block.chainid;
        require(
            chain == MAINNET_CHAIN || chain == TESTNET_CHAIN,
            "Deploy: not a Monad chain, check --rpc-url"
        );

        vm.startBroadcast();

        address token;
        if (chain == TESTNET_CHAIN) {
            // Testnet has no USDC and no AUSD, verified by eth_getCode returning 0x at both
            // addresses, so the escrow needs a token brought with it.
            token = address(new TestUSDC());
            console.log("TestUSDC   ", token);
        } else {
            token = MAINNET_USDC;
            // Never deploy against an address with no code. A deployment that "succeeds" against
            // nothing is the expensive way to find out the RPC pointed somewhere unexpected.
            require(token.code.length > 0, "Deploy: no USDC code at the mainnet address");
            console.log("USDC (real)", token);
        }

        Aqueous escrow = new Aqueous(CLAIM_WINDOW);
        console.log("Aqueous    ", address(escrow));

        vm.stopBroadcast();

        console.log("chainId    ", chain);
        console.log("claimWindow", uint256(CLAIM_WINDOW));
    }
}
