// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {AgentPasskey} from "../src/AgentPasskey.sol";

/// forge script script/DeployAgentPasskey.s.sol --rpc-url https://rpc.monad.xyz --broadcast --private-key $DEPLOYER_PRIVATE_KEY
contract DeployAgentPasskey is Script {
    address internal constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external returns (AgentPasskey ap) {
        // Refuse a chain without the precompile: a binding contract that can never verify is worse than
        // none. Asked of the live node over RPC, because the script's own local EVM is shanghai and has no
        // precompile, while the deployed bytecode must stay shanghai-compiled for Monad.
        bytes memory res = vm.rpc(
            "eth_call",
            '[{"to":"0x0000000000000000000000000000000000000100","data":"0x4cee90eb86eaa050036147a12d49004b6b9c72bd725d39d4785011fe190f0b4da73bd4903f0ce3b639bbbf6e8e80d16931ff4bcf5993d58468e8fb19086e8cac36dbcd03009df8c59286b162af3bd7fcc0450c9aa81be5d10d312af6c66b1d604aebd3099c618202fcfe16ae7770b0c49ab5eadf74b754204a3bb6060e44eff37618b065f9832de4ca6ca971a7a1adc826d0f7c00181a5fb2ddf79ae00b4e10e"},"latest"]'
        );
        require(res.length == 32 && uint256(bytes32(res)) == 1, "no P256 precompile on this chain (RIP-7212 reference vector)");
        console.log("P256 precompile answers 1 for the RIP-7212 reference vector");
        vm.startBroadcast();
        ap = new AgentPasskey(IDENTITY_REGISTRY);
        vm.stopBroadcast();
        console.log("AgentPasskey", address(ap));
    }
}
