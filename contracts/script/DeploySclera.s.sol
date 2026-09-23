// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Sclera} from "../src/Sclera.sol";

/// @notice Deploy Sclera, the claim-truth bond contract.
///
/// Two constructor arguments and both are immutable for the life of the contract, so this script
/// refuses rather than defaulting either of them.
///
/// **The attestor is the whole security boundary.** The CRE forwarder on Monad mainnet is
/// `MockKeystoneForwarder 1.0.0` and its `report` function is permissionless, so `msg.sender`
/// authorises nothing. The only thing standing between a forged verdict and a posted bond is the
/// signature this address recovers to.
///
/// **Never deploy this with the demo attestor.** `contracts/test/fixtures/sign-verdict.mjs` derives
/// its key from the pinned PRF vector `bytes [1..32]`, which is hardcoded in a committed file, so
/// once this repository is public that private key is public too. It is the right key for a
/// cross-check test and it would let anyone on the internet slash any bond here. The script checks
/// for that address by name and reverts.
///
/// Usage, from contracts/:
///
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   export SCLERA_ATTESTOR=$(node ../tools/attestor-address.mjs)
///   export SCLERA_SLASH_BENEFICIARY=0xDB6c6340342e71A63cD11Ebac2185204b7777777
///   forge script script/DeploySclera.s.sol:DeploySclera --rpc-url monad \
///     --private-key "$DEPLOYER_PRIVATE_KEY" --broadcast
///
/// Drop `--broadcast` to simulate and read the gas without spending anything.
contract DeploySclera is Script {
    /// @dev The published test attestor. Its key is derivable from the repository.
    address internal constant DEMO_ATTESTOR = 0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf;

    /// @dev The ERC-8004 Identity Registry. A per-chain singleton at this address on every mainnet
    ///      deployment checked, verified on chain on both 143 and 56 rather than taken from a
    ///      deployment list. Overridable by env for a chain that deployed elsewhere, which Monad
    ///      testnet did.
    address internal constant IDENTITY_REGISTRY = 0x8004A169FB4a3325136EB29fA0ceB6D2e539a432;

    function run() external returns (Sclera sclera) {
        address attestor = vm.envAddress("SCLERA_ATTESTOR");
        address beneficiary = vm.envAddress("SCLERA_SLASH_BENEFICIARY");

        require(attestor != address(0), "SCLERA_ATTESTOR is the zero address");
        require(beneficiary != address(0), "SCLERA_SLASH_BENEFICIARY is the zero address");
        require(attestor != DEMO_ATTESTOR, "refusing the demo attestor: its key is in the repo");

        // A deployer that is also the attestor would mean one compromised key both owns the
        // deployment and can sign slashing verdicts. Keeping them apart costs nothing.
        require(attestor != msg.sender, "attestor must not be the deployer key");

        console.log("attestor        ", attestor);
        console.log("slashBeneficiary", beneficiary);

        vm.startBroadcast();
        address registry = vm.envOr("SCLERA_IDENTITY_REGISTRY", IDENTITY_REGISTRY);
        require(registry != address(0), "identity registry is the zero address");
        // A bond has to be the agent's own stake, so the contract reads ownership from here. If this
        // address is wrong the contract is inert rather than dangerous: every postBond reverts.
        require(registry.code.length > 0, "no contract at the identity registry address");

        sclera = new Sclera(attestor, beneficiary, registry);
        vm.stopBroadcast();

        console.log("Sclera          ", address(sclera));

        // Read the immutables back off the deployed contract rather than trusting the arguments.
        require(sclera.attestor() == attestor, "attestor did not stick");
        require(sclera.slashBeneficiary() == beneficiary, "beneficiary did not stick");
        require(sclera.identityRegistry() == registry, "identity registry did not stick");
    }
}
