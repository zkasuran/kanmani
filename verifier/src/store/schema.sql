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
-- about one registration document, and 10,252 agents share only 2,012 of those. Probing per agent
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
-- `reachable` is a boolean and the truth has more states than that. The probe run over Monad's
-- 2,012 distinct records found, among the ones that did not return bytes:
--
--   539 answering HTTP 402, so the host is alive and asking for payment
--     3 answering HTTP 404, one of them shared by 8,093 agents
--    14 answering HTTP 429, which is a rate limit on OUR side of the conversation
--     2 whose domain no longer resolves at all
--     3 whose URI is not a usable pointer (a localhost URL, two placeholder CIDs)
--
-- Collapsing those into "dead" would publish a rate limit as an operator's failure, which is the
-- same mistake the verdict ladder exists to refuse. `unknown` means we could not tell, and 429
-- and 5xx belong there rather than beside a 404.
--
-- It is a view rather than a column so a re-read reclassifies old probes too. The probe records
-- what happened; this decides what that means, and the second one is allowed to improve.
CREATE OR REPLACE VIEW fovea.record_state AS
SELECT p.*,
  CASE
    -- The document is in tokenURI itself. No host, so nothing can delete it later.
    WHEN p.scheme IN ('inline','data')          THEN 'onchain'
    WHEN p.reachable                            THEN 'answered'
    WHEN p.http_status IN (404, 410)            THEN 'gone'
    -- Alive and wants paying. On a chain whose agent economy runs on x402 this is a state worth
    -- keeping apart from a deletion, not a footnote.
    WHEN p.http_status = 402                    THEN 'paywalled'
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
-- Reads are open on purpose. It is ciphertext, and pretending otherwise by gating it would imply
-- the confidentiality comes from access control rather than from the encryption.
--
-- Writes are NOT open. A write carries a secp256k1 signature from the account key over the exact
-- bytes being stored, checked against the address in the row. Without that anybody could overwrite
-- anybody's blob: they could not read it, and destroying it is enough damage on its own.
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
