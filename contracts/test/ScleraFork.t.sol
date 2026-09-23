// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Sclera, IERC20} from "../src/Sclera.sol";
import {MockToken} from "./Sclera.t.sol";
import {MockIdentityRegistry} from "./fixtures/MockIdentityRegistry.sol";

interface IKeystoneForwarder {
    function report(address receiver, bytes calldata rawReport, bytes calldata, bytes[] calldata) external;
    function typeAndVersion() external view returns (string memory);
}

/// @notice The whole report path against the REAL forwarder the CRE simulator writes through on
///         Monad mainnet, forked locally.
///
/// What only a fork can settle here, and the answer surprised me.
///
/// **The deployed mock does no ERC-165 check.** Its `develop` source calls `ERC165Checker` inside
/// `route` and skips the receiver when the answer is wrong. The bytecode at this address does not:
/// the probe below hands it a receiver that answers false to everything, and another with no
/// `supportsInterface` at all, and `onReport` runs both times. The published source and the
/// deployed bytecode disagree, so anything built on that check being present would be built on a
/// reading rather than a measurement.
///
/// **The attack the mock makes free.** `MockKeystoneForwarder.report` is permissionless by design
/// (its own source says so on lines 13, 85 and 166), so anybody can push a payload at any receiver.
/// A stranger does exactly that below with a forged signature and the bond is still there
/// afterwards. That is the whole reason the verdict carries its own signature.
///
/// **The forwarder swallows the refusal.** A receiver revert becomes `success = false` on the
/// forwarder's own event rather than bubbling to the caller, so a rejected report and a report that
/// never arrived look identical from outside. That is why every refusal in Sclera emits.
///
///   forge test --match-contract ScleraForkTest --fork-url "$MONAD_RPC"
///
/// Skips itself rather than passing quietly when no fork URL is set.
contract ScleraForkTest is Test {
    /// @dev Read live on 2026-09-22: `typeAndVersion()` returns "MockKeystoneForwarder 1.0.0" and
    ///      `eth_getCode` is 4,579 bytes. Hardcoded rather than discovered so a silent redeploy
    ///      fails this test instead of passing against a different contract.
    address internal constant MOCK_FORWARDER = 0x9eF6468C5f37b976E57d52054c693269479A784d;

    uint256 internal constant METADATA_LENGTH = 109;

    Sclera internal sc;
    MockToken internal tok;

    uint256 internal attestorKey = 0xA77E5702;
    address internal attestor;
    uint256 internal rogueKey = 0xBADBADBAD;

    address internal agent = address(0xA9E17);
    address internal sink = address(0x5104);
    address internal stranger = address(0x5712A6E2);

    uint256 internal constant AGENT_ID = 10182;
    uint128 internal constant BOND = 100e6;

    bytes32 internal constant VERDICT_TYPEHASH = keccak256(
        "Verdict(uint256 agentId,uint64 windowStart,uint64 windowEnd,uint32 sampleSize,uint32 trueCount,uint64 nonce)"
    );

    bytes32 internal domainSeparator;
    uint64 internal postedAt;

    modifier onlyForked() {
        if (MOCK_FORWARDER.code.length == 0) {
            emit log("skipped: no fork URL, run with --fork-url $MONAD_RPC");
            return;
        }
        _;
    }

    MockIdentityRegistry reg;

    function setUp() public {
        attestor = vm.addr(attestorKey);
        reg = new MockIdentityRegistry();
        reg.setOwner(AGENT_ID, agent);
        sc = new Sclera(attestor, sink, address(reg));
        tok = new MockToken();
        domainSeparator = sc.DOMAIN_SEPARATOR();

        tok.mint(agent, 1_000e6);
        vm.startPrank(agent);
        tok.approve(address(sc), type(uint256).max);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);
        vm.stopPrank();
        postedAt = uint64(block.number);

        vm.roll(block.number + 10);
    }

    /* ----------------------------------------------------------------- helpers */

    function _rawReport(uint256 key, uint32 sample, uint32 trueCount, uint64 nonce)
        internal
        view
        returns (bytes memory)
    {
        Sclera.Verdict memory v = Sclera.Verdict({
            agentId: AGENT_ID,
            windowStart: postedAt,
            windowEnd: uint64(block.number),
            sampleSize: sample,
            trueCount: trueCount,
            nonce: nonce
        });

        bytes32 structHash = keccak256(
            abi.encode(VERDICT_TYPEHASH, v.agentId, v.windowStart, v.windowEnd, v.sampleSize, v.trueCount, v.nonce)
        );
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", domainSeparator, structHash));
        (uint8 vb, bytes32 r, bytes32 s) = vm.sign(key, digest);

        // The forwarder slices rawReport[45:109] as workflow metadata and rawReport[109:] as the
        // payload it hands to onReport. It only checks the length, so the prefix is filler here.
        bytes memory prefix = new bytes(METADATA_LENGTH);
        return bytes.concat(prefix, abi.encode(v, abi.encodePacked(r, s, vb)));
    }

    /* ------------------------------------------------------------------- tests */

    function test_fork_forwarderIsTheMockWeRead() public onlyForked {
        assertEq(IKeystoneForwarder(MOCK_FORWARDER).typeAndVersion(), "MockKeystoneForwarder 1.0.0");
    }

    /// The happy path, end to end through the real deployed forwarder. If the ERC-165 answer were
    /// wrong, `route` would skip `onReport` and the bond would stay Active with nothing to show.
    function test_fork_signedVerdictArrivesThroughTheRealForwarder() public onlyForked {
        vm.prank(stranger);
        IKeystoneForwarder(MOCK_FORWARDER).report(address(sc), _rawReport(attestorKey, 42, 1, 1), "", new bytes[](0));

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Slashed), "the report never reached onReport");
        assertEq(tok.balanceOf(sink), BOND);
    }

    /// The reason the signature exists. Anyone can reach this forwarder, so a stranger pushes a
    /// verdict signed by the wrong key and the bond has to survive it.
    function test_fork_forgedVerdictThroughTheRealForwarderCannotSlash() public onlyForked {
        vm.prank(stranger);
        IKeystoneForwarder(MOCK_FORWARDER).report(address(sc), _rawReport(rogueKey, 42, 0, 1), "", new bytes[](0));

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Active), "a forged report moved the bond");
        assertEq(uint256(b.amount), BOND);
        assertEq(tok.balanceOf(sink), 0);
        assertEq(tok.balanceOf(address(sc)), BOND);
    }

    /// The mock catches a receiver revert and records it rather than bubbling, so the caller sees
    /// a successful transaction either way. This is exactly why every refusal in Sclera emits.
    function test_fork_forwarderSwallowsTheRefusal() public onlyForked {
        vm.prank(stranger);
        // No revert reaches the caller even though onReport rejected the report.
        IKeystoneForwarder(MOCK_FORWARDER).report(address(sc), _rawReport(rogueKey, 42, 0, 1), "", new bytes[](0));
        assertEq(uint8(sc.bonds(AGENT_ID).state), uint8(Sclera.State.Active));
    }

    /// @notice The deployed mock does not perform the ERC-165 check its own source describes.
    ///
    /// This is here as a standing measurement rather than a curiosity. If a future deployment at
    /// this address starts enforcing the check, this test fails and tells us the assumption under
    /// `Sclera.supportsInterface` has changed. Reading the source again would not have told us.
    function test_fork_deployedMockSkipsTheErc165Gate() public onlyForked {
        DeafReceiver deaf = new DeafReceiver();
        IKeystoneForwarder(MOCK_FORWARDER).report(address(deaf), new bytes(200), "", new bytes[](0));
        assertTrue(deaf.called(), "deployed mock gained an ERC-165 gate");
        assertEq(deaf.asked(), 0, "it never even asked");

        NoErc165Receiver mute = new NoErc165Receiver();
        IKeystoneForwarder(MOCK_FORWARDER).report(address(mute), new bytes(200), "", new bytes[](0));
        assertTrue(mute.called(), "a receiver with no supportsInterface was still called");
    }
}

/// @dev Answers false to every interface and counts how many times it was asked.
contract DeafReceiver {
    bool public called;
    uint256 public asked;

    function supportsInterface(bytes4) external returns (bool) {
        asked++;
        return false;
    }

    function onReport(bytes calldata, bytes calldata) external {
        called = true;
    }
}

/// @dev No ERC-165 surface at all.
contract NoErc165Receiver {
    bool public called;

    function onReport(bytes calldata, bytes calldata) external {
        called = true;
    }
}
