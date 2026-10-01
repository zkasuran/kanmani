# 32 · PRF primitives, audited

One passkey ceremony, four independent keys, HKDF-SHA256 with a per-key `info`, AES-256-GCM for
content, nothing derived ever written to disk, a store or the server. This file is the audit of that,
with a code reference on every claim, so a judge reads the primitives against the source rather than
against a paragraph.

The test that enforces the no-persist claim is `lib/prf-no-persist.test.ts`. It fails the moment any
derived key appears in anything the write path emits.

## The four namespaces

The code derives four keys, not three. The fourth, `onchainAttestation`, was added later (commit
`2d51436`), so older copy that says "three keys" is stale. Each namespace carries its own version
inside the string, so a byte change loudly changes the derived address rather than silently changing
meaning. All four come from one 32-byte PRF output through HKDF-SHA256 with the fixed extract salt
`kanmani.hkdf.salt.v1` and a distinct `info` per key (`lib/iris.ts:52-79`, `lib/iris.ts:99`).

| key | `info` string | curve or cipher | what it does |
| --- | --- | --- | --- |
| account | `kanmani.iris.v1` | secp256k1 | signs in, owns listings, an EVM address |
| attestation | `kanmani.optic.v1` | ed25519 | signs verification receipts off chain as a `did:key`, not a wallet |
| onchainAttestation | `kanmani.optic-onchain.v1` | secp256k1 | the verdict signer a Sclera contract recovers, still not the account wallet |
| content | `kanmani.vitreous.v1` | AES-256-GCM key | encrypts anything the server must not read |

## Derivation, referenced

- `derive(prfOutput, info, length=32)` (`lib/iris.ts:101`) is HKDF-SHA256, Extract-then-Expand over
  WebCrypto. The extract salt is the fixed non-secret constant `kanmani.hkdf.salt.v1`. The `info`
  is the per-key string from the table above.
- `deriveSecp256k1(prfOutput, info)` (`lib/iris.ts:138`) is the RFC-6979-shaped retry. HKDF returns
  32 uniform bytes, a number in [0, 2^256), while a secp256k1 scalar must be in [1, n). Counter
  0 uses the bare `info` so the common path reproduces by hand. A rare out-of-range output appends
  `.retry.<counter>` then derives again.
- `deriveKeys(prfOutput)` (`lib/iris.ts:174`) runs all four in parallel: account and onchain are
  secp256k1, attestation is ed25519 published as `did:key:kanmani:<base64url>`, content is the raw 32
  bytes for AES-256-GCM.

## Encryption versus derivation, used appropriately

The bounty's second criterion asks for encryption and derivation used in the right places. They are
deliberately kept apart here.

- Signing keys are DERIVED. The secp256k1 and ed25519 private scalars come straight out of HKDF. No
  key is wrapped or stored, there is nothing to decrypt to get one back, the passkey reproduces them.
- Content is ENCRYPTED. The content key feeds AES-256-GCM in `lib/vault.ts:77`. A fresh random 12-byte
  nonce is drawn on every seal (`lib/vault.ts:83`), never a counter, because there is no state to keep
  a counter correct.
- The context string is bound as GCM additional authenticated data (`lib/vault.ts:87`), so a blob
  sealed as a job brief cannot be opened as agent memory even though both use the same key.

## Nothing derived is persisted

- `lib/passkey.ts` stores nothing: no credential id, no session, no hint. The passkey is a
  discoverable credential, so a fresh profile runs the same sign-in path as a returning user.
- `lib/login.ts` persists only public facts. `StoredSession` is `{v, address, method, kind, since}`
  (`lib/login.ts:28`) and `parseSession` rejects whole any blob carrying a field outside that set
  (`lib/login.ts:48`). A key-shaped field on read is refused.
- `components/session.tsx` writes through `persistSession` and nothing else. `persistSession`
  only ever serializes a `StoredSession` (`lib/login.ts`). The derived `IrisKeys` live in React state
  and are never passed to it.
- `lib/session.ts` holds the account key in a Mera signing session in memory and zeroes it on expiry
  or end (`lib/session.ts:142`).

So `localStorage` and `IndexedDB` are never written at all. The server holds only AES-256-GCM
ciphertext (`app/api/vault/route.ts`). The one sanctioned write is the public session record.

The honest limit, carried from `lib/iris.ts:24-31`: HKDF makes the four keys independent of each
other, not independent of the PRF output. Anyone holding those 32 bytes holds all four. That is
equally true of deriving from four separate salts, so saying it plainly beats implying a
compartmentalisation that does not exist.

## Stronger than Mera's own vault, on purpose

Mera ships a secret vault and we follow its construction, an AES-256-GCM key from the PRF output via
HKDF with a fixed `info` string. Mera's own `info` is `mera.v1.encrypt.secret`
(`node_modules/@category-labs/mera/src/secret.ts:24`, whose comment says it "separates it from other
keys derived from the same PRF output"). Ours is `kanmani.vitreous.v1`.

Two differences, both in our favour on the "nothing sensitive persisted" criterion:

- Mera's vault format persists `credentialId` and `prfSalt` next to the ciphertext (its secret-vault
  format reference plus `node_modules/@category-labs/mera/src/secret.ts`). Vitreous persists neither,
  anywhere (`lib/vault.ts` header). That is a tighter form of the same stateless promise.
- Mera's decrypt runs its own assertion ceremony, so opening your own data costs an extra prompt on
  top of sign-in. Vitreous reuses the content key from the one sign-in ceremony, so it is one prompt,
  not two.

## The novelty, further from "passkey wallet" than an encrypted blob

The first bounty criterion rewards distance from "passkey wallet". The attestation key is the
distance. `kanmani.optic.v1` is ed25519, published as a `did:key`. It does non-account work: it
signs verification receipts (`lib/iris.ts:255-323`, the `Receipt` type, `receiptBytes`, `signReceipt`
and `verifyReceipt`). It owns nothing and cannot move money.

Anyone can check one of those receipts at `POST /api/receipt/verify`
(`app/api/receipt/verify/route.ts`) with no key and no payment. The endpoint holds no key material,
consults no database and verifies any receipt, not only ours. So the identity's output is public
evidence a stranger can recompute, which is further from a login than an encrypted memory blob is.
The `/account` page signs a receipt in the tab then verifies it through that endpoint, with a
copy-ready `curl` so a judge runs the same check from their own shell.

## Primary sources

- RFC 5869 (HKDF). Extract-then-Expand, section 2. `info` is "optional context and application
  specific information" (section 2.3), so distinct `info` over the same pseudorandom key gives
  independent output. The salt may be a constant or zero (section 2.2), so a fixed non-secret salt is
  within the spec and stronger than the zero salt it permits. `https://www.rfc-editor.org/rfc/rfc5869`.
- Mera, passkeys and PRF: "A ceremony is one WebAuthn call and one user-verification prompt", "Salts
  act as namespaces", "The same credential, rpId, and salt produce the same 32 bytes on every synced
  device". `https://mera.category.xyz/concepts/passkeys-and-prf/`.
- Mera, secret vault format: the v1 format stores `credentialId` and `prfSalt`, while "The encryption
  key and the PRF output are never stored." `https://mera.category.xyz/reference/secret-vault-format/`.
- WebAuthn PRF extension (W3C WebAuthn Level 3), built on CTAP2 `hmac-secret`, evaluated during an
  assertion, 32 bytes per salt. This is why desktop Chrome without Google Password Manager returns no
  PRF, as the account page's authenticator matrix states. `https://www.w3.org/TR/webauthn-3/#prf-extension`.
- Kai Jun Eer, Category Labs (organizer-reviewed mentor answers): HKDF `info` per key "counts as salts
  genuinely namespaced" (2026-09-18). Because the PRF output is deterministic "the PRF output key
  are always recoverable, even when cross device", so nothing needs persisting (2026-09-21). He stated
  in both answers that he is not involved in judging, so these confirm the mechanics and are not a
  judging guarantee. The design is stated as ours, with his confirmation cited as support.

## The limit of the unit test

`lib/prf-no-persist.test.ts` proves the serializer and the write helper never emit key material. It
does not prove the browser never writes a key by some path outside `persistSession`. The airtight
version is a headless check that reads `localStorage`, `sessionStorage` and `IndexedDB` after a real
sign-in and asserts no value decodes to a derived key. That belongs in the e2e layer, named here as a
follow-on rather than implied to be covered by the unit test.
