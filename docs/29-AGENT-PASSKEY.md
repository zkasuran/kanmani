# AgentPasskey: a device passkey for an agent, verified by Monad's P256 precompile

`contracts/src/AgentPasskey.sol`, deployed on Monad mainnet at
`0x1E30531CD3ea6DE2958DB363418a5382C419dC24` (tx `0x079296ac69c80e209940ff2bf700c66df94f2cf3dbe99a2d4e2c14300a7dcd50`,
block 109,009,064), source verified on Sourcify.

## Why

An ERC-8004 agent is owned by an address, usually a hot key on a server. Whoever takes that key takes
the agent. A passkey cannot be exported. Every use needs the person there, verified by biometric
or PIN. Binding one to the agent gives it a second authority that a server compromise does not hand
over. Any contract can require it before acting for the agent:

```solidity
require(agentPasskey.verify(agentId, keccak256(abi.encode(address(this), action, nonce, deadline)), assertion));
```

Monad makes this practical. Its P256 precompile at `0x0100` (EIP-7951) verifies a WebAuthn signature
natively: `verifyWith` costs about 55,000 gas end to end in the tests, including the WebAuthn checks,
against roughly 300,000 for a P256 verifier written in Solidity.

## What the contract checks

On `bind(agentId, qx, qy, assertion)`:

- `msg.sender == IdentityRegistry.ownerOf(agentId)`;
- the assertion is `webauthn.get` (not a registration ceremony), with user present **and** verified;
- its challenge is `keccak256(domain, chainId, this contract, agentId, qx, qy, owner, nonce)`, base64url
  in `clientDataJSON`, so it is bound to this chain, this contract, this agent, this key and this owner;
- the P256 signature over `authenticatorData || sha256(clientDataJSON)` verifies for `qx, qy` in the
  precompile. That is proof of possession: the device holding the key signed its own binding.

Each bind and unbind spends the per-agent nonce, so a bind signature works once. A binding only counts
while the owner who made it still owns the agent. Unbinding needs only the owner, so a lost device
never locks an agent. High-s signatures are accepted on purpose: authenticators emit them half the time.

It proves a device approved. It does not prove who holds the device.

## Proven on mainnet, 2026-09-29

| step | result |
|---|---|
| precompile, RIP-7212 reference vector | returns `1` (checked again by the deploy script before broadcasting) |
| `verifyWith`, valid WebAuthn assertion | `true` |
| same, other challenge / tampered `s` / no user verification | `false`, `false`, `false` |
| `bind` for agent 10256 from its owner, through the site with a Chrome virtual authenticator | tx `0x399bdce466786717078e7ea95afd0e59d30e61c0901d24e6db38d28c0d9745f5`, 205,276 gas |
| `verify` with a fresh assertion from the bound passkey, through the site's "test it on chain" | `true` |
| replaying the mined bind | reverts, nonce spent |
| `unbind` (the test passkey lived in a throwaway browser) | tx `0x9736120713db2106d51d8f84446866c3adb354592229ec73331e63cded56b458` |

## Tests

`FOUNDRY_PROFILE=p256 forge test --match-path test/AgentPasskey.t.sol`: 16 tests, run under the osaka
EVM where revm implements the precompile as Monad does. Assertions are built as an authenticator builds
them (`vm.signP256`, real rpId hash, browser-order clientDataJSON, forge's own base64url), covering
owner-only, proof of possession, single-use, wrong agent/owner/chain, missing UV, a registration
ceremony, tampering with every field, transfer, unbind, rebind, high-s and a 256-run fuzz of the
challenge encoder. Under the default shanghai profile the suite skips and says why.

`lib/agent-passkey.ts` converts browser WebAuthn output (SPKI key, DER signature, byte offsets) and is
tested in `lib/agent-passkey.test.ts` with a software authenticator.

## Use it

On any agent page, `kanmani.xyz/agent/<id>#passkey`: the owner binds (two prompts: create, then sign),
anyone holding the passkey tests it on chain for free, the owner unbinds. `GET /api/agent/<id>` returns
`passkey: { state: bound | none | unknown, qx, qy, boundAtBlock }`.
