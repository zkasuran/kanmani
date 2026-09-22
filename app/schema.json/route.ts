import { json, SITE } from "@/lib/api.ts";

export const dynamic = "force-dynamic";

/**
 * JSON Schema for every response this API produces.
 *
 * Written by hand rather than generated, for one reason: the descriptions are the point. A
 * generated schema would carry the types and lose the sentence explaining that `unknown` is not
 * `false`, which is the only thing a consumer really has to get right.
 */
const OUTCOME = {
  type: "string",
  enum: ["true", "false", "noClaim", "unknown"],
  description:
    "true: the cited transaction is on the chain the document names. false: we read that chain successfully and it is not there. noClaim: the document read fine and asserts no payment. unknown: we could not look or could not read. Do not collapse unknown into false.",
} as const;

const RUNG = {
  type: ["string", "null"],
  enum: ["declared", "resolvable", "intact", "parsed", "true", null],
  description: "How far down the ladder this claim got before it stopped. Null means never checked.",
} as const;

export async function GET() {
  return json({
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `${SITE}/schema.json`,
    title: "Kanmani API",
    description:
      "Every response is wrapped in an envelope carrying checkedAt, checkedAtBlock and the command to re-derive it. A number without a time is a number that was true once.",
    $defs: {
      envelope: {
        type: "object",
        required: ["version", "chain", "checkedAt", "reproduce", "data"],
        properties: {
          version: { const: 1, description: "Bumped when a field changes meaning, never when one is added." },
          chain: {
            type: "object",
            required: ["id", "name"],
            properties: { id: { type: "integer" }, name: { type: "string" } },
          },
          checkedAt: {
            type: "string",
            format: "date-time",
            description: "When this response was computed, not when the code was deployed.",
          },
          checkedAtBlock: {
            type: ["string", "null"],
            description:
              "The chain head the index had reached. Null when it could not be read, which is not the same as zero.",
          },
          reproduce: {
            type: "string",
            description: "Exactly what to run to get the same answer without this API.",
          },
          data: {},
        },
      },
      verdict: {
        type: "object",
        required: ["outcome", "rung", "reason", "checkedAt"],
        properties: {
          outcome: OUTCOME,
          rung: RUNG,
          reason: {
            type: "string",
            description:
              "Written for a stranger. Describes what was observed, never what anyone intended. This field never accuses.",
          },
          mapping: {
            type: ["string", "null"],
            description: "Which published atlas mapping read this document, so a reader can re-run the same one.",
          },
          declaredNetwork: { type: ["string", "null"], description: "The chain the document named." },
          declaredTx: { type: ["string", "null"], description: "The transaction hash the document cited." },
          hashMatches: {
            type: ["boolean", "null"],
            description:
              "Whether keccak256 of the bytes served equals the hash committed on chain. Null when not checked.",
          },
          computedHash: { type: ["string", "null"] },
          foundOnChain: {
            type: ["object", "null"],
            description: "Present only when outcome is true.",
            properties: {
              chain: { type: "string" },
              chainId: { type: "integer" },
              blockNumber: { type: "string" },
            },
          },
          checkedAt: { type: "string", format: "date-time" },
          checkedAtBlock: {
            type: ["string", "null"],
            description:
              "The chain head when we looked. Without it a negative is unfalsifiable, because a reader cannot tell whether we looked before the transaction existed.",
          },
        },
      },
      recordState: {
        type: ["string", "null"],
        enum: ["onchain", "answered", "gone", "paywalled", "refused", "nohost", "malformed", "unknown", null],
        description:
          "What an agent's registration document does when asked. onchain: written into tokenURI, so it cannot be deleted. answered: fetched and read. gone: the host said it is not there, or it answered 402 with a suspended-account page that is not a real payment challenge. paywalled: returned a real x402 payment challenge, so it is a live agent asking to be paid first. refused: alive and will not serve it. nohost: the domain no longer resolves. malformed: never a usable pointer. unknown: we could not find out, which is ours not theirs. null: nothing has asked yet.",
      },
    },
    endpoints: {
      "GET /api/claims": {
        description: "Filterable claim feed. Free.",
        parameters: {
          outcome: OUTCOME,
          rung: RUNG,
          mapping: { type: "string" },
          network: { type: "string" },
          limit: { type: "integer", maximum: 1000, default: 100 },
          offset: { type: "integer", default: 0 },
        },
        note: "An unrecognised filter value is refused with the list of accepted values rather than ignored. A filter that is silently dropped returns plausible, wrong data.",
        response: { allOf: [{ $ref: "#/$defs/envelope" }] },
      },
      "GET /api/agent/{agentId}": {
        description: "One agent, including what is not known about it. Free.",
        note: "Fields with no answer are null rather than absent. An absent key invites a consumer to default it to zero.",
      },
      "POST /api/verify": {
        description: "Check a document you supply. Priced, because it spends a request on a third party's server and an RPC call.",
        requestBody: {
          type: "object",
          required: ["uri"],
          properties: {
            uri: { type: "string", description: "http(s), data: or ipfs://" },
            feedbackHash: {
              type: "string",
              description:
                "The commitment recorded on chain. Without it the intact rung is meaningless, because we would compare bytes against a hash of the same bytes. The response says which happened.",
            },
          },
        },
        payment: {
          protocol: "x402",
          note: "An unpaid request answers 402 with the challenge. 402 here means pay me, not broken.",
        },
      },
      "GET /feed.json": { description: "The whole checked population with its distribution. Free." },
    },
  });
}
