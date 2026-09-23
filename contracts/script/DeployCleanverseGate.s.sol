// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {CleanverseGate, IComplianceValidator} from "../src/CleanverseGate.sol";
import {Aqueous} from "../src/Aqueous.sol";

/// @notice Deploy CleanverseGate against the live Aqueous escrow and the live Cleanverse Compliance
///         Validator on Monad.
///
/// Both dependencies are immutable on the gate, so this script refuses rather than defaulting either to
/// the zero address and it requires both to have code so a wrong or empty address fails here instead
/// of at the first settlement. Simulate against a real RPC so those code checks run against live state:
///
///   set -a && . ~/Downloads/hackathon-hq/.env && set +a
///   forge script script/DeployCleanverseGate.s.sol:DeployCleanverseGate \
///     --rpc-url https://rpc.monad.xyz --sender 0xDB6c6340342e71A63cD11Ebac2185204b7777777
///
/// Add `--broadcast --private-key "$DEPLOYER_PRIVATE_KEY"` to deploy for real. That spends MON for gas,
/// which is the standing real-funds stop, so it is a deliberate step rather than part of the build.
///
/// One more step before the gate can settle anything: the deployed gate address must be registered as
/// a compliance pool with Cleanverse (the off-chain Register Compliance Pool call binds the gate to the
/// validator). Until that lands, `complianceVerify` reverts `PoolNotRegistered` for the gate and every
/// settlement fails closed, which is the safe direction rather than a broken one.
contract DeployCleanverseGate is Script {
    /// @dev Read live on 2026-09-23 with eth_getCode and eth_call, on chain 143 and chain 10143.
    ///      The validator is an ERC-1967 proxy that answers `complianceVerify(pool,user)` and reverts
    ///      `PoolNotRegistered()` (0x739f4185) for an unknown pool.
    address internal constant MONAD_VALIDATOR = 0xA64529732B52EFFD2B245320E88226D72c23b788;
    /// @dev The Aqueous escrow already deployed on Monad mainnet, 10,901 bytes of code.
    address internal constant MONAD_AQUEOUS = 0xd75f7786D0DD42c8F161Bd78E87D37001044Fc32;

    function run() external returns (CleanverseGate gate) {
        address escrowAddr = vm.envOr("CLEANVERSE_GATE_ESCROW", MONAD_AQUEOUS);
        address validatorAddr = vm.envOr("CLEANVERSE_VALIDATOR", MONAD_VALIDATOR);

        require(escrowAddr != address(0), "escrow is the zero address");
        require(validatorAddr != address(0), "validator is the zero address");
        require(escrowAddr.code.length > 0, "no code at the escrow address on this chain");
        require(validatorAddr.code.length > 0, "no code at the validator address on this chain");

        console.log("escrow   ", escrowAddr);
        console.log("validator", validatorAddr);

        vm.startBroadcast();
        gate = new CleanverseGate(Aqueous(escrowAddr), IComplianceValidator(validatorAddr));
        vm.stopBroadcast();

        console.log("CleanverseGate", address(gate));

        // Read the immutables back off the deployed contract rather than trusting the arguments.
        require(address(gate.escrow()) == escrowAddr, "escrow did not stick");
        require(address(gate.validator()) == validatorAddr, "validator did not stick");
        console.log("Register this gate address as a Cleanverse compliance pool before settling.");
    }
}
