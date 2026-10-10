// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {ScleraV2} from "../src/ScleraV2.sol";

/// @notice Deploy ScleraV2. Same rules as DeploySclera, minus the beneficiary, which version 2 fixes
///         in the bytecode as the burn address so no deploy can point it anywhere else.
///
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   export SCLERA_ATTESTOR=$(node ../tools/attestor-address.mjs)
///   forge script script/DeployScleraV2.s.sol:DeployScleraV2 --rpc-url monad \
///     --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
contract DeployScleraV2 is Script {
    address internal constant DEMO_ATTESTOR = 0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf;
    address internal constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;
    address internal constant BURN = 0x000000000000000000000000000000000000dEaD;

    function run() external returns (ScleraV2 sclera) {
        address attestor = vm.envAddress("SCLERA_ATTESTOR");
        require(attestor != address(0), "SCLERA_ATTESTOR is the zero address");
        require(attestor != DEMO_ATTESTOR, "refusing the demo attestor: its key is in the repo");
        require(attestor != msg.sender, "attestor must not be the deployer key");

        address registry = vm.envOr("SCLERA_IDENTITY_REGISTRY", IDENTITY_REGISTRY);
        require(registry.code.length > 0, "no contract at the identity registry address");

        vm.startBroadcast();
        sclera = new ScleraV2(attestor, registry);
        vm.stopBroadcast();

        console.log("ScleraV2        ", address(sclera));
        require(sclera.attestor() == attestor, "attestor did not stick");
        require(sclera.identityRegistry() == registry, "identity registry did not stick");
        require(sclera.slashBeneficiary() == BURN, "beneficiary is not the burn address");
    }
}
