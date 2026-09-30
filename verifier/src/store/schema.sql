-- Fovea's own storage.
--
-- **This lives in its own `fovea` schema, deliberately, not in `public`.**
--
-- Envio owns `public` and drops and recreates it on every resync. That happened twice on
-- 2026-09-18 during ordinary schema work. A verdict is produced by an off-chain check rather than
-- by an event, so no Envio handler can write one and anything stored in an Envio-managed table
-- would be destroyed the next time the indexer's schema changes. Separate schema, same database,
-- so Hasura can still join verdicts to the indexed feedback rows.

CREATE SCHEMA IF NOT EXISTS fovea;

-- Append only. A re-check writes a NEW row and never touches an old one.
--
-- That is the product rather than an implementation detail. We publish verdicts about other
-- people's work, so being wrong has to be cheap to fix AND visible: an operator who repairs a
-- broken document should see `false -> true` with both timestamps, rather than a number quietly
-- improving with no trace that we ever said otherwise. There is no UPDATE path in the code.
CREATE TABLE IF NOT EXISTS fovea.verdict (
  id              bigserial PRIMARY KEY,

  -- Joins to the indexer's Feedback row. Kept as plain text with no foreign key, because the
  -- referenced table lives in a schema that gets dropped and rebuilt and a dangling verdict is
  -- far better than a resync that fails or cascades into deleting our history.
  feedback_id     text        NOT NULL,
  feedback_uri    text        NOT NULL,

  rung            text        NOT NULL CHECK (rung IN ('declared','resolvable','intact','parsed','true')),
  outcome         text        NOT NULL CHECK (outcome IN ('true','false','noClaim','unknown')),
  -- Written for a stranger. Describes what was observed, never what anyone intended.
  reason          text        NOT NULL,

  declared_network text,
  declared_tx      text,
  -- Which published atlas mapping read this document, so a reader can re-run the same one.
  mapping          text,

  hash_matches     boolean,
  computed_hash    text,

  found_chain      text,
  found_chain_id   integer,
  found_block      numeric(78,0),

  -- A verdict is a measurement at a time, so both of these are always recorded.
  checked_at       timestamptz NOT NULL,
  checked_at_block numeric(78,0),

  -- Whether this re-check ran on its own or a human asked for it. A reader should be able to tell
  -- what moved by itself.
  automatic        boolean     NOT NULL DEFAULT true
);

-- The common read is "latest verdict per feedback" and the history view right beside it.
CREATE INDEX IF NOT EXISTS verdict_feedback_checked
  ON fovea.verdict (feedback_id, checked_at DESC);

CREATE INDEX IF NOT EXISTS verdict_outcome
  ON fovea.verdict (outcome);

-- Latest verdict per claim, which is what a page shows. The full history stays one query away,
-- and that is the point of never updating in place.
CREATE OR REPLACE VIEW fovea.verdict_latest AS
SELECT DISTINCT ON (feedback_id) *
FROM fovea.verdict
ORDER BY feedback_id, checked_at DESC, id DESC;

-- Whether the document an agent's REGISTRATION points at still exists.
--
-- Separate from fovea.verdict on purpose. A verdict is about one feedback's payment claim; this is
-- about one registration document and 10,252 agents share only 2,012 of those. Probing per agent
-- would mean fetching one dead Vercel URL 8,093 times to learn the same thing once.
--
-- It lives here rather than on the indexer's AgentRecord for the reason everything else does: that
-- table is dropped and rebuilt on every resync, so an enrichment stored there costs 2,012 fetches
-- of somebody else's servers every time our own schema changes. Ours survives.
--
-- Append only, same as verdicts. A deployment somebody restores should read as 404 -> 200 with both
-- timestamps, not as a row quietly changing its mind.
CREATE TABLE IF NOT EXISTS fovea.record_probe (
  id             bigserial PRIMARY KEY,

  -- keccak of the URI, which is AgentRecord.id in the indexer's schema. Plain text, no foreign
  -- key, for the same reason verdict.feedback_id has none.
  uri_hash       text        NOT NULL,
  uri            text        NOT NULL,
  -- `inline` is a JSON document written straight into tokenURI, so it resolves with no network
  -- and cannot 404. That is a genuinely different state from a URL that happens to answer today
  -- and the schema keeps them apart rather than calling both "reachable".
  scheme         text        NOT NULL CHECK (scheme IN ('data','http','ipfs','inline','other','empty')),

  reachable      boolean     NOT NULL,
  http_status    integer,
  byte_length    integer,
  media_type     text,
  -- What a non-2xx response actually said, kept because a status code is not a protocol. x402
  -- answers 402 with `www-authenticate: x402` and a JSON body. A suspended host answers 402 with
  -- a vendor error header and a text/plain body. Reading the integer alone published the second
  -- as the first for 539 records. `record_state` classifies on these, not on http_status.
  www_authenticate text,
  vendor_error     text,
  -- The name the document gives itself, when it is an agent record we can read. A registration
  -- that resolves but names nothing is a different thing from one that does not resolve.
  parsed_name    text,
  -- Written for a stranger. "HTTP 404" is a fact. "This operator abandoned their agent" is not
  -- ours to say and does not go here.
  reason         text        NOT NULL,

  -- How many agents and wallets pointed at this document when we checked, so a finding carries
  -- its own scale and stays true even after the index moves.
  member_count     integer,
  distinct_owners  integer,

  checked_at     timestamptz NOT NULL,
  automatic      boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS record_probe_hash_checked
  ON fovea.record_probe (uri_hash, checked_at DESC);

CREATE INDEX IF NOT EXISTS record_probe_reachable
  ON fovea.record_probe (reachable);

CREATE OR REPLACE VIEW fovea.record_probe_latest AS
SELECT DISTINCT ON (uri_hash) *
FROM fovea.record_probe
ORDER BY uri_hash, checked_at DESC, id DESC;

-- What a registration document's probe actually means, as one definition.
--
-- `reachable` is a boolean and the truth has more states than that. Among the records that did not
-- return bytes, the interesting split is which failures are the operator's design and which are a
-- death. A status code alone cannot tell them apart, so this reads the payload.
--
-- **402 is the trap.** On a chain whose agent economy runs on x402, a 402 can mean "this agent
-- wants paying", which is alive and a design choice. It can equally be a hosting provider's
-- suspended-account page, which is a death wearing the same number. The first carries
-- `www-authenticate: x402` and a JSON body. The second carries a vendor error header
-- (`x-vercel-error`) and a text/plain body. Classifying on the integer alone put 539 suspended
-- documents, 545 agents, in `paywalled` on a project whose whole thesis is that a claim's shape is
-- not its truth. So a 402 is `paywalled` ONLY when it looks like a real challenge. A vendor-error
-- 402 falls through to `gone`.
--
-- Collapsing a rate limit or a timeout into "dead" would publish OUR failure as an operator's, which
-- is the same mistake the verdict ladder exists to refuse. `unknown` means we could not tell and
-- 429 and 5xx belong there rather than beside a 404.
--
-- It is a view rather than a column so a re-read reclassifies old probes too. The probe records
-- what happened; this decides what that means and the second one is allowed to improve.
CREATE OR REPLACE VIEW fovea.record_state AS
SELECT p.*,
  CASE
    -- The document is in tokenURI itself. No host, so nothing can delete it later.
    WHEN p.scheme IN ('inline','data')          THEN 'onchain'
    WHEN p.reachable                            THEN 'answered'
    WHEN p.http_status IN (404, 410)            THEN 'gone'
    -- Alive and wants paying, but ONLY a real x402 challenge. A `www-authenticate: x402` header or
    -- a JSON body is the challenge. A vendor error header is a suspended host, which is a death.
    WHEN p.http_status = 402
      AND p.vendor_error IS NULL
      AND (p.www_authenticate ILIKE 'x402%'
        OR p.media_type ILIKE 'application/json%') THEN 'paywalled'
    -- A 402 that does not look like a challenge is a dead deployment answering with the wrong code.
    WHEN p.http_status = 402                     THEN 'gone'
    WHEN p.http_status IN (401, 403)            THEN 'refused'
    WHEN p.reason LIKE 'DNS lookup failed%'     THEN 'nohost'
    -- The URI was never a usable pointer. Nobody deleted anything; it could not have worked.
    WHEN p.reason LIKE 'ipfs path is not%'
      OR p.reason LIKE 'unsupported URI scheme%'
      OR p.reason LIKE 'blocked,%'
      OR p.reason LIKE '%declares no document%' THEN 'malformed'
    -- Everything left is us failing to find out: a rate limit, a timeout, a server error, a
    -- document past our own size cap. Never an accusation.
    ELSE 'unknown'
  END AS state
FROM fovea.record_probe_latest p;

-- Ciphertext the server cannot read.
--
-- This exists so the cross-device claim is a real round trip rather than two tabs on one machine:
-- a second device signs in with the same passkey, derives the same address, fetches this row and
-- decrypts it with a key that never left either browser.
--
-- What is stored: a public address, a context label, a nonce and a ciphertext. No key, no
-- credential id, no PRF salt, no session. A dump of this table is a pile of AES-GCM blobs and a
-- list of addresses that are public anyway.
--
-- Reads are open on purpose. It is ciphertext and pretending otherwise by gating it would imply
-- the confidentiality comes from access control rather than from the encryption.
--
-- Writes are NOT open. A write carries a secp256k1 signature from the account key over the exact
-- bytes being stored, checked against the address in the row. Without that anybody could overwrite
-- anybody's blob: they could not read it and destroying it is enough damage on its own.
CREATE TABLE IF NOT EXISTS fovea.vault (
  address      text        NOT NULL,
  context      text        NOT NULL,
  -- Format version of the sealed envelope, so a future format is a new row rather than a
  -- reinterpretation of an old one.
  version      integer     NOT NULL DEFAULT 1,
  nonce        text        NOT NULL,
  ciphertext   text        NOT NULL,
  -- The signature that authorised this write, kept so a reader can check it themselves rather
  -- than trusting that we checked.
  signature    text        NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (address, context)
);

-- Who authorised a change to an agent's registration document.
--
-- An action receipt is signed by the ATTESTATION key, which is ed25519 and cannot move money, so a
-- row here proves who authorised a change without granting the signer anything. The account key
-- sends the transaction; this key makes the statement about it. Keeping them apart is why
-- lib/iris.ts derives four keys rather than one.
--
-- **The signature is verified before insert and kept afterwards**, the same posture as fovea.vault:
-- a reader checks it themselves rather than trusting that we checked. verifyAction in
-- lib/authority.ts is self-contained, because the did:key inside a receipt carries the public key it
-- must be checked against, so a receipt cannot be verified against a key it does not name.
--
-- Append only. A second receipt for the same agent is a new row, not an update, because the history
-- of who repointed a document and when is the whole value. `uri_hash` is keccak256 of the agentURI
-- that was intended, which is what makes a receipt a defence against a page that previewed one
-- document and sent another.
--
-- agent_id is NULL for a registration: the registry assigns the id and it does not exist when the
-- intent is signed. NULL rather than 0, for the reason every count on this site is null rather than
-- zero when it is not known.
CREATE TABLE IF NOT EXISTS fovea.agent_action (
  id          bigserial   PRIMARY KEY,
  action      text        NOT NULL CHECK (action IN ('register', 'setAgentURI')),
  chain_id    integer     NOT NULL,
  agent_id    bigint,
  uri_hash    text        NOT NULL,
  signer      text        NOT NULL,
  identity    text        NOT NULL,
  signature   text        NOT NULL,
  -- The account key's signature over the same canonical bytes, binding the EVM signer to the
  -- attestation identity. Nullable so receipts stored before this column existed still read; new
  -- writes require it, because without it the signer address is an unproven claim.
  binding     text,
  -- When the signer says they signed it, from the receipt itself.
  signed_at   timestamptz NOT NULL,
  -- When we received it. Kept apart from signed_at, because a gap between them is information and
  -- collapsing the two would let a caller rewrite our own clock.
  received_at timestamptz NOT NULL DEFAULT now(),
  -- One receipt per identity per document per action. A replay is the same row, not a second one.
  UNIQUE (identity, uri_hash, action)
);

CREATE INDEX IF NOT EXISTS agent_action_agent_idx ON fovea.agent_action (agent_id, signed_at DESC);

-- Whether a buyer could pay an agent's own SERVICE endpoint, right now.
--
-- **Not the same question as fovea.record_probe.** That one asks whether an agent's registration
-- document still resolves. This one asks whether the service that document declares answers a buyer
-- with a payment requirement, which is a different host as often as not. An agent whose business
-- card loads and whose service is gone passes the first and fails this one. Reporting the first
-- as the second is the confusion this whole schema is arranged to prevent.
--
-- It is its own table rather than a rung on fovea.verdict for the reason record_probe is: the
-- denominators differ. A verdict is per feedback claim, 1,192 of them. This is per registration
-- document, 2,016 of them. Most feedback claims belong to agents with no service endpoint at
-- all.
--
-- Append only, same as everything else here. An operator who wires up x402 next week should read as
-- `false -> true` with both timestamps.
CREATE TABLE IF NOT EXISTS fovea.payable_probe (
  id                bigserial PRIMARY KEY,

  -- keccak of the registration URI, which is AgentRecord.id. Plain text, no foreign key, because
  -- that table is dropped and rebuilt on every Envio resync.
  uri_hash          text        NOT NULL,
  uri               text        NOT NULL,

  -- The service endpoint actually contacted, plus where in the document it was declared. Null when
  -- nothing was contacted, which is a real and common state rather than a missing value.
  probed_url        text,
  declared_at       text,

  payable           text        NOT NULL CHECK (payable IN ('true','false','noOffer','unknown')),
  -- Written for a stranger. Describes what was observed, never what anyone intended.
  reason            text        NOT NULL,

  -- What the response actually said. **A status code is not a protocol**, so these columns carry the
  -- discriminators and payable_state below reads them rather than http_status. 402 with a text/plain
  -- body and a vendor error header is a suspended host; 402 with www-authenticate: x402 and an
  -- accepts array is a live till. Keying on the integer published 539 of the second as the first.
  http_status       integer,
  www_authenticate  text,
  content_type      text,
  vendor_error      text,

  -- A 402 demanding payment is a challenge. A 200 publishing the same offer is a catalogue.
  -- Both are live offers from a running server. Which one it was is recorded rather than flattened.
  offer_kind        text        CHECK (offer_kind IS NULL OR offer_kind IN ('challenge','catalogue')),

  -- The x402Version the server printed, next to the shape its entries are actually written in.
  -- **These disagree in the wild and that is why both columns exist.** One live endpoint answers
  -- x402Version 2 over v1-shaped entries (scheme and network at the top of each accepts entry,
  -- amount under maxAmountRequired). Another writes both amount keys at once, which reads as hybrid.
  declared_version  integer,
  accepts_shape     text,

  -- Whether any offer settles on Monad mainnet, chain 143, which is the rail this build measures.
  -- An agent can be genuinely payable on Base and that is a different finding, not a failure.
  monad_option      boolean,
  offer_network     text,
  offer_amount      text,
  offer_asset       text,
  offer_pay_to      text,

  -- The agent's own x402 claim, stored beside the measurement so a page can show claim against
  -- observation. That cross tab is the finding; neither column is it on its own.
  claims_x402       boolean     NOT NULL DEFAULT false,
  declared_settlement_tx text,

  -- How many endpoints the document declared and how many we actually contacted. The gap is
  -- deliberate politeness and it belongs on the record rather than in a comment.
  endpoints_declared integer,
  endpoints_probed   integer,

  -- How many agents and wallets shared this document when we checked, so a finding carries its own
  -- scale and stays true after the index moves.
  member_count      integer,
  distinct_owners   integer,

  checked_at        timestamptz NOT NULL,
  automatic         boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS payable_probe_hash_checked
  ON fovea.payable_probe (uri_hash, checked_at DESC);

CREATE INDEX IF NOT EXISTS payable_probe_payable
  ON fovea.payable_probe (payable);

CREATE OR REPLACE VIEW fovea.payable_probe_latest AS
SELECT DISTINCT ON (uri_hash) *
FROM fovea.payable_probe
ORDER BY uri_hash, checked_at DESC, id DESC;

-- What a payable probe means, as one definition.
--
-- The useful axis is not the boolean. It is the agent's claim set against the measurement, because
-- the whole thesis of this build is that the two come apart. Six states, with `unknown` one of
-- them rather than a rounding of the others.
--
-- A view rather than a column, so a re-read reclassifies old probes too. The probe records what
-- happened; this decides what that means and the second is allowed to improve.
CREATE OR REPLACE VIEW fovea.payable_state AS
SELECT p.*,
  CASE
    -- We could not look. A rate limit, a timeout, a method we never tried, a host we chose to skip.
    -- First, so nothing below can absorb it.
    WHEN p.payable = 'unknown'                   THEN 'unknown'
    -- Nothing was declared to probe, so nothing was refused. Not the same as a refusal.
    WHEN p.payable = 'noOffer'                   THEN 'noendpoint'
    WHEN p.payable = 'true' AND p.monad_option   THEN 'payable-monad'
    -- Genuinely payable, settling somewhere other than Monad mainnet. A finding, not a failure.
    WHEN p.payable = 'true'                      THEN 'payable-elsewhere'
    -- The agent publishes x402Support and its own endpoint asked for nothing. Stated as the
    -- observation it is: the claim is unconfirmed, which is not a statement about anyone's intent.
    WHEN p.claims_x402                           THEN 'claimed-unconfirmed'
    ELSE 'free'
  END AS state
FROM fovea.payable_probe_latest p;

-- Whether a claimed payment actually reached the agent.
--
-- fovea.verdict already records whether a cited transaction exists on the chain a document names.
-- This is the next question and it is a harder one: a transaction can exist, sit on the right
-- chain and still have moved nothing to the agent. It can revert, it can pay a different address,
-- it can move a different token, it can move a token id rather than an amount.
--
-- Separate from fovea.verdict because a settlement claim does not only come from a feedback. An
-- agent's own registration can carry one: one document on Monad publishes an x402Support object
-- holding a settlement transaction, a facilitator and a treasury address. `subject_kind` says which
-- kind of thing the claim was attached to.
--
-- Append only. A reorg or a later read that changes the answer writes a new row.
CREATE TABLE IF NOT EXISTS fovea.settlement_check (
  id               bigserial PRIMARY KEY,

  -- A Feedback id, an AgentRecord uri hash or an operator asking by hand. No foreign key, same
  -- reason as everywhere else in this schema.
  subject          text        NOT NULL,
  subject_kind     text        NOT NULL CHECK (subject_kind IN ('feedback','record','manual')),

  tx_hash          text        NOT NULL,
  declared_network text,
  -- The address the payment was claimed to reach. Without it there is no "to this agent" to check,
  -- so the check refuses rather than answering a different question.
  recipient        text        NOT NULL,
  claimed_asset    text,
  claimed_amount   text,

  settled          text        NOT NULL CHECK (settled IN ('true','false','unknown')),
  reason           text        NOT NULL,

  found_chain      text,
  found_chain_id   integer,
  found_block      numeric(78,0),
  -- How deep the receipt was. A receipt in the head block is on chain and can still be reorganised
  -- away, so depth is evidence and it is stored rather than recomputed from a moving head.
  confirmations    numeric(78,0),

  observed_asset   text,
  observed_amount  numeric(78,0),
  observed_from    text,
  -- **False means the amount was never checked**, not that it failed. A document writing "0.1"
  -- cannot be compared to an on chain integer without the token's own decimals(), which this check
  -- does not read. AUSD on Monad is 6 where the same code met 18 elsewhere, so a guessed conversion
  -- is wrong by 1e12 in the direction of a confident false. Refusing to compare is the honest
  -- answer and this column is how a reader sees that it was refused.
  amount_compared  boolean,
  -- Every transfer the transaction did make, counted, so "none of them to this agent" is a number.
  transfer_count   integer,

  checked_at       timestamptz NOT NULL,
  checked_at_block numeric(78,0),
  automatic        boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS settlement_check_subject_checked
  ON fovea.settlement_check (subject, checked_at DESC);

CREATE INDEX IF NOT EXISTS settlement_check_settled
  ON fovea.settlement_check (settled);

CREATE OR REPLACE VIEW fovea.settlement_check_latest AS
SELECT DISTINCT ON (subject, tx_hash) *
FROM fovea.settlement_check
ORDER BY subject, tx_hash, checked_at DESC, id DESC;

-- Who a registration wallet is, from Nansen.
--
-- The operators page can say 7,962 distinct wallets registered one dead document. It cannot say who
-- they are. Nansen turns an address into its known entity and behavioural labels, so that count
-- becomes a distribution: exchange wallets, smart money, DeFi users and the ones Nansen holds
-- nothing on. The last group is the honest one and it is `unknown`, never a zero.
--
-- It lives in fovea for the reason everything here does: `public` is dropped on every Envio resync,
-- so an enrichment stored there would cost a paid Nansen call per wallet again every time our own
-- schema changed. Keyed on the lowercased address rather than on an agent, because 8,093 agents
-- share far fewer wallets and one wallet's label is the same whichever agent it registered.
--
-- Append only, same as every table here. A wallet that gets a label next month reads as
-- `unlabeled -> labeled` with both timestamps rather than a row quietly changing its mind.
--
-- **There are three statuses and the split is the point.** `labeled` is Nansen holding something. `unlabeled`
-- is Nansen answering with nothing. `unknown` is us not getting an answer at all: a 429, a 500, a
-- missing key. The page renders the last two the same, as unknown, but the row keeps them apart so a
-- reader can tell "asked, nothing there" from "never got an answer". A lookup failure is never
-- written as a category, because our outage is not a fact about somebody's wallet.
CREATE TABLE IF NOT EXISTS fovea.wallet_label (
  id              bigserial PRIMARY KEY,

  -- Lowercased so a join against Agent.owner is case-clean. No foreign key, because the Agent table
  -- lives in the schema Envio drops and rebuilds.
  address         text        NOT NULL,
  chain           text        NOT NULL,

  status          text        NOT NULL CHECK (status IN ('labeled','unlabeled','unknown')),
  -- The primary category bucket, null unless labeled. `other` is Nansen's `others` normalised plus
  -- the fallback for a label that carries no category.
  category        text        CHECK (category IS NULL OR category IN
                    ('smart_money','cefi','defi','nft','social','behavioral','other')),
  -- Every label Nansen returned, verbatim, so a reader sees the raw strings rather than only our
  -- bucket. Empty when unlabeled or unknown.
  labels          text[]      NOT NULL DEFAULT '{}',
  label_count     integer     NOT NULL DEFAULT 0,

  -- Which endpoint produced this and how the call was paid, so the x402 story is on the record.
  source          text        NOT NULL,
  auth_mode       text        NOT NULL CHECK (auth_mode IN ('x402','apikey')),
  -- Written for a stranger. What was observed, never intent. "HTTP 429" is a fact.
  reason          text        NOT NULL,
  http_status     integer,

  checked_at      timestamptz NOT NULL,
  automatic       boolean     NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS wallet_label_address_checked
  ON fovea.wallet_label (address, chain, checked_at DESC);

CREATE INDEX IF NOT EXISTS wallet_label_category
  ON fovea.wallet_label (category);

CREATE OR REPLACE VIEW fovea.wallet_label_latest AS
SELECT DISTINCT ON (address, chain) *
FROM fovea.wallet_label
ORDER BY address, chain, checked_at DESC, id DESC;

-- ---------------------------------------------------------------- usage, without tracking people
--
-- Counts, never people. No IP address, user agent string or cookie is stored anywhere below.
-- "clients" is the number of distinct sha256(daily salt || ip || user agent) seen that day. The salt is
-- random per day and deleted once the day is closed, so a hash cannot be linked across days or
-- reversed afterwards, even by us. Written by scripts/usage-aggregate.mjs from the web server's own
-- access log, which is kept 7 days and rotated.

CREATE TABLE IF NOT EXISTS fovea.usage_daily (
  day      date    NOT NULL,
  surface  text    NOT NULL,   -- page, api:agent, mcp, build:registration, embed, ...
  class    text    NOT NULL,   -- browser | crawler | software
  calls    integer NOT NULL,
  clients  integer NOT NULL,
  PRIMARY KEY (day, surface, class)
);

CREATE TABLE IF NOT EXISTS fovea.usage_salt (
  day  date PRIMARY KEY,
  salt bytea NOT NULL
);

-- Who integrates, by name only: a site that embeds us, an MCP client's self-declared name, a tool's
-- user-agent product token. Names of software and sites, never of people.
CREATE TABLE IF NOT EXISTS fovea.usage_integrator (
  day   date    NOT NULL,
  kind  text    NOT NULL,        -- embed-host | mcp-client | tool
  name  text    NOT NULL,
  calls integer NOT NULL,
  PRIMARY KEY (day, kind, name)
);

-- Counted in the app as they happen (MCP tool calls), because a request body is not in the access log.
CREATE TABLE IF NOT EXISTS fovea.usage_event (
  day   date    NOT NULL,
  name  text    NOT NULL,        -- mcp:tool:check_registration, ...
  calls integer NOT NULL,
  PRIMARY KEY (day, name)
);

-- Every event on our own contracts, with whether the actor is ours. Public chain data.
CREATE TABLE IF NOT EXISTS fovea.onchain_use (
  tx         text    NOT NULL,
  log_index  integer NOT NULL,
  block      bigint  NOT NULL,
  contract   text    NOT NULL,   -- aqueous | sclera | agentPasskey
  event      text    NOT NULL,
  actor      text    NOT NULL,
  agent_id   text,
  ours       boolean NOT NULL,
  PRIMARY KEY (tx, log_index)
);

CREATE TABLE IF NOT EXISTS fovea.usage_cursor (
  name  text PRIMARY KEY,
  block bigint NOT NULL
);

-- sha256 of every agentURI /api/registration/check returned as ready. A registration on chain whose
-- URI hashes to one of these was built with the check, which we learn without asking anyone.
CREATE TABLE IF NOT EXISTS fovea.build_uri (
  uri_sha256 text PRIMARY KEY,
  first_day  date    NOT NULL,
  checks     integer NOT NULL
);

-- ---------------------------------------------------------------- first funders, from Nansen
-- Who first sent each registration wallet gas (Nansen profiler/address/related-wallets, 1 credit).
-- Append only like every fovea table. A sampled subset, not every wallet: the page says so.
CREATE TABLE IF NOT EXISTS fovea.wallet_funder (
  id           bigserial PRIMARY KEY,
  address      text        NOT NULL,
  chain        text        NOT NULL,
  status       text        NOT NULL CHECK (status IN ('found','none','unknown')),
  funder       text,
  funder_label text,
  tx           text,
  funded_at    text,
  reason       text,
  http_status  integer,
  sample       text        NOT NULL,   -- which sampling run chose this wallet, e.g. cluster:<uriHash>
  checked_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wallet_funder_address ON fovea.wallet_funder (address, chain, checked_at DESC);
CREATE OR REPLACE VIEW fovea.wallet_funder_latest AS
  SELECT DISTINCT ON (address, chain) * FROM fovea.wallet_funder ORDER BY address, chain, checked_at DESC;
