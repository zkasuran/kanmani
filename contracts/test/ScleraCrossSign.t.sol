// SPDX-License-Identifier: LicenseRef-zkasuran-SAND-1.0
pragma solidity 0.8.24;

import {Test} from "forge-std/Test.sol";
import {Sclera, IERC20} from "../src/Sclera.sol";

/// @dev The one join the rest of the suite does not test.
///
/// Every other Sclera test signs with `vm.sign`, so it proves the contract is self-consistent: the
/// same Solidity that verifies also produced the signature. This test signs with the real product
/// code instead, `lib/verdict.ts` using a key `lib/iris.ts` derives, reached over ffi. So it proves
/// the thing that actually matters at wire time: a signature the TypeScript signer makes is one the
/// deployed contract accepts, and the two independent EIP-712 implementations agree byte for byte.
///
/// It slashes for real off that signature rather than only checking recovery, because "the signer
/// recovers" and "the bond moves" are different claims and the second is the one that holds money.
///
/// ffi is required and off by default. Run with `forge test --ffi --match-path
/// test/ScleraCrossSign.t.sol`. Without `--ffi` the test skips loudly rather than passing on nothing,
/// the same posture as the fork tests skipping without a fork url.
contract MintableToken is IERC20 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }
}

contract ScleraCrossSignTest is Test {
    Sclera internal sc;
    MintableToken internal tok;

    // The published attestor for the pinned demo PRF vector [1..32]. The fixture derives this same
    // address, so the constructor and the signer have to agree on it or the recover fails.
    address internal constant PINNED_ATTESTOR = 0x722cf70CbC5Ff80942A1274b0cc252E4DB2CaFdf;

    address internal agent = address(0xA9E17);
    address internal sink = address(0x5104);

    uint256 internal constant AGENT_ID = 10182;
    uint128 internal constant BOND = 100e6;

    function setUp() public {
        // Deploy with the derived attestor, not a vm.addr test key. That is the point.
        sc = new Sclera(PINNED_ATTESTOR, sink);
        tok = new MintableToken();
        tok.mint(agent, 1_000e6);
        vm.prank(agent);
        tok.approve(address(sc), type(uint256).max);
        vm.roll(1_000);
    }

    function _ffiEnabled() internal returns (bool) {
        // No direct "is ffi on" cheatcode, so probe with a trivial echo. If ffi is disabled the
        // cheatcode reverts and the try fails, which we read as "skip", never as a pass.
        string[] memory cmd = new string[](2);
        cmd[0] = "echo";
        cmd[1] = "-n";
        try vm.ffi(cmd) returns (bytes memory) {
            return true;
        } catch {
            return false;
        }
    }

    /// @dev Ask the product signer for a real signature over this exact verdict and domain.
    function _signViaTypeScript(Sclera.Verdict memory v)
        internal
        returns (address attestor, bytes memory signature)
    {
        string[] memory cmd = new string[](11);
        cmd[0] = "node";
        cmd[1] = "--experimental-strip-types";
        cmd[2] = "test/fixtures/sign-verdict.mjs";
        cmd[3] = vm.toString(block.chainid);
        cmd[4] = vm.toString(address(sc));
        cmd[5] = vm.toString(v.agentId);
        cmd[6] = vm.toString(uint256(v.windowStart));
        cmd[7] = vm.toString(uint256(v.windowEnd));
        cmd[8] = vm.toString(uint256(v.sampleSize));
        cmd[9] = vm.toString(uint256(v.trueCount));
        cmd[10] = vm.toString(uint256(v.nonce));

        bytes memory out = vm.ffi(cmd);
        // The fixture prints "<address> <signature>". Split on the single space.
        string[] memory parts = vm.split(string(out), " ");
        require(parts.length == 2, "fixture output not '<addr> <sig>'");
        attestor = vm.parseAddress(parts[0]);
        signature = vm.parseBytes(parts[1]);
    }

    function test_crossSign_typescriptSignatureSlashesTheBond() public {
        if (!_ffiEnabled()) {
            emit log("SKIP: ffi disabled, run with --ffi to cross-check the TypeScript signer");
            vm.skip(true);
            return;
        }

        // Post a bond committing to an 80% floor over 100 blocks, min sample 5.
        vm.prank(agent);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);

        // A verdict well under the floor: 1 true of 42, which is agent 10182's real history, 238 bps.
        // The window opens at postedAt so the forward-looking check passes.
        Sclera.Verdict memory v = Sclera.Verdict({
            agentId: AGENT_ID,
            windowStart: uint64(block.number),
            windowEnd: uint64(block.number),
            sampleSize: 42,
            trueCount: 1,
            nonce: 1
        });

        (address attestor, bytes memory sig) = _signViaTypeScript(v);

        // The fixture's derived attestor is exactly the address the contract was deployed to trust.
        assertEq(attestor, PINNED_ATTESTOR, "the derived attestor is the pinned one");
        assertEq(attestor, sc.attestor(), "and it is what the contract will recover against");
        assertEq(sig.length, 65, "a 65-byte r||s||v signature");

        uint256 sinkBefore = tok.balanceOf(sink);

        // Push the TypeScript-signed report through the same entry the forwarder would.
        sc.onReport("", abi.encode(v, sig));

        // The contract accepted a signature it did not produce, and acted on it.
        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Slashed), "below the floor, so slashed");
        assertEq(tok.balanceOf(sink) - sinkBefore, BOND, "the whole bond moved to the beneficiary");
    }

    function test_crossSign_typescriptSignatureAboveFloorIsAccepted() public {
        if (!_ffiEnabled()) {
            emit log("SKIP: ffi disabled, run with --ffi to cross-check the TypeScript signer");
            vm.skip(true);
            return;
        }

        vm.prank(agent);
        sc.postBond(AGENT_ID, address(tok), BOND, 8000, 100, 5);

        // 9 true of 10 is 9000 bps, above the 8000 floor, so this verifies the accept path too, not
        // only the slash. A signer that only ever slashed would pass a one-sided test.
        Sclera.Verdict memory v = Sclera.Verdict({
            agentId: AGENT_ID,
            windowStart: uint64(block.number),
            windowEnd: uint64(block.number),
            sampleSize: 10,
            trueCount: 9,
            nonce: 1
        });

        (, bytes memory sig) = _signViaTypeScript(v);

        sc.onReport("", abi.encode(v, sig));

        Sclera.Bond memory b = sc.bonds(AGENT_ID);
        assertEq(uint8(b.state), uint8(Sclera.State.Active), "above the floor, so still active");
        assertEq(b.lastNonce, 1, "the nonce advanced, so a real verdict was recorded");
    }
}
