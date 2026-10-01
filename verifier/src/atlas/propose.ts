/**
 * The atlas review queue: turning one induction run into a stored, reviewable proposal.
 *
 * This is the DB side of the induction loop. The loop (`induce.ts`) proposes a mapping and confirms
 * it round-trips through the real parser. This file records that result as a `fovea.mapping_proposal`
 * row so `/method` can show it and a reviewer can act on it.
 *
 * **Nothing here changes a verdict.** The verdict pipeline reads only `ATLAS` in
 * `../ladder/parse.ts` and imports nothing from this file. A proposal takes effect only as a code
 * diff that adds the mapping to `ATLAS`. So the worst a wrong proposal can do is sit in the queue and
 * be rejected. The schema comment and a test both state this; here the guarantee is structural: this
 * module never writes to `fovea.verdict` and the parser never reads `fovea.mapping_proposal`.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { connectionStringFrom } from "../store/store.ts";
import type { InducedMapping, InductionResult, TranscriptStep } from "./model.ts";

export type ProposalStatus = "pending" | "accepted" | "rejected" | "superseded";

/** One row of the review queue, in the camelCase a page reads. */
export type MappingProposalRow = {
  /** Sorted top-level keys of the document shape, joined with commas. N claims of one shape, one row. */
  shapeKey: string;
  /** The unmapped claims this shape covers. */
  feedbackIds: string[];
  /** One feedbackUri the proposal was induced from. */
  exampleUri: string;
  /** The client label that produced it. qwen3.8-max for a real credited run. */
  model: string;
  converged: boolean;
  /** The loop's own round-trip result, stored explicitly. */
  roundTripOk: boolean;
  iterations: number;
  toolCalls: number;
  /** The induced mapping, null when the loop did not converge. */
  proposal: InducedMapping | null;
  /** The full agentic transcript: propose, run the parser as a tool, read, revise. */
  transcript: TranscriptStep[];
  giveUpReason: string | null;
  status: ProposalStatus;
};

/**
 * A stable id for a document shape: its sorted top-level keys joined with commas. Deterministic and
 * human-readable, so a reviewer can see which shape a row is about without opening the transcript.
 */
export function shapeKey(doc: unknown): string {
  if (typeof doc !== "object" || doc === null || Array.isArray(doc)) {
    return `<non-object:${Array.isArray(doc) ? "array" : typeof doc}>`;
  }
  return Object.keys(doc as Record<string, unknown>).sort().join(",");
}

/**
 * Turn one induction run into a queue row. `roundTripOk` mirrors `converged` because the loop
 * returns `converged` only on a confirmed round-trip (`induce.ts` guard #1); it is stored as its own
 * column so a storage bug is catchable and a hand-forced value still cannot move a verdict.
 */
export function toProposalRow(args: {
  shapeKey: string;
  feedbackIds: string[];
  exampleUri: string;
  model: string;
  result: InductionResult;
}): MappingProposalRow {
  const { result } = args;
  return {
    shapeKey: args.shapeKey,
    feedbackIds: args.feedbackIds,
    exampleUri: args.exampleUri,
    model: args.model,
    converged: result.converged,
    roundTripOk: result.converged,
    iterations: result.iterations,
    toolCalls: result.toolCalls,
    proposal: result.mapping ?? null,
    transcript: result.transcript,
    giveUpReason: result.converged ? null : (result.reason ?? "did not converge"),
    status: "pending",
  };
}

/**
 * Writing proposals down. Append only, same posture as VerdictStore: a re-run of a shape writes a new
 * row and `mapping_proposal_latest` surfaces the newest per shape. There is no update path.
 */
export class ProposalStore {
  private readonly pool: pg.Pool;

  private constructor(pool: pg.Pool) {
    this.pool = pool;
  }

  static async open(connectionString = connectionStringFrom()): Promise<ProposalStore> {
    const pool = new pg.Pool({ connectionString, max: 4 });
    const here = dirname(fileURLToPath(import.meta.url));
    // The same idempotent DDL the verifier store applies, so a fresh database gets every fovea table
    // including mapping_proposal. Ours, so nothing else races to define it.
    await pool.query(readFileSync(join(here, "../store/schema.sql"), "utf8"));
    return new ProposalStore(pool);
  }

  /** Records one proposal. No update counterpart, on purpose. */
  async record(row: MappingProposalRow): Promise<number> {
    const r = await this.pool.query<{ id: string }>(
      `INSERT INTO fovea.mapping_proposal
         (shape_key, feedback_ids, example_uri, model, converged, round_trip_ok,
          iterations, tool_calls, proposal, transcript, give_up_reason, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        row.shapeKey,
        row.feedbackIds,
        row.exampleUri,
        row.model,
        row.converged,
        row.roundTripOk,
        row.iterations,
        row.toolCalls,
        // jsonb columns: stringify, or node-postgres renders a JS array/object as a Postgres array
        // literal rather than JSON.
        row.proposal === null ? null : JSON.stringify(row.proposal),
        JSON.stringify(row.transcript),
        row.giveUpReason,
        row.status,
      ],
    );
    return Number(r.rows[0]!.id);
  }

  /** The newest proposal per shape, newest first. */
  async latest(): Promise<MappingProposalRow[]> {
    const r = await this.pool.query<Record<string, unknown>>(
      `SELECT * FROM fovea.mapping_proposal_latest ORDER BY checked_at DESC, id DESC`,
    );
    return r.rows.map((x) => ({
      shapeKey: String(x.shape_key),
      feedbackIds: (x.feedback_ids as string[] | null) ?? [],
      exampleUri: String(x.example_uri ?? ""),
      model: String(x.model ?? ""),
      converged: Boolean(x.converged),
      roundTripOk: Boolean(x.round_trip_ok),
      iterations: Number(x.iterations ?? 0),
      toolCalls: Number(x.tool_calls ?? 0),
      proposal: (x.proposal as InducedMapping | null) ?? null,
      transcript: (x.transcript as TranscriptStep[] | null) ?? [],
      giveUpReason: (x.give_up_reason as string | null) ?? null,
      status: (x.status as ProposalStatus) ?? "pending",
    }));
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
