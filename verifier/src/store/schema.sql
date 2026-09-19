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
