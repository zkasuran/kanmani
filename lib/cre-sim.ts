/**
 * The last recorded CRE workflow simulation, loaded from shared/cre-simulation.json and validated.
 *
 * The page reads this rather than a hard-coded string, so item 8.1 just overwrites the JSON with a
 * fresh capture and the page follows. Validation is the point: a mangled 8.1 paste must fail loudly
 * at build and test time, never render an undefined count as a number, which is the project's whole
 * "unknown is never zero" position applied to our own evidence.
 *
 * Every field traces to a real run (see the JSON's own $comment). Nothing here is synthesised.
 */
import RAW from "../shared/cre-simulation.json" with { type: "json" };

export type CreMeasured = {
  sampleSize: number;
  trueCount: number;
  unknownCount: number;
  rateBps: number;
};

export type CreFeatured = {
  agentId: number;
  mode: string;
  measured: CreMeasured;
  log: string[];
  result: string;
  liveCheck: string;
};

export type CreBondRead = {
  agentId: number;
  log: string;
  source: string;
};

export type CreExternalCall = {
  chainRead: string;
  httpGet: string;
};

export type CreSimulation = {
  capturedAt: string;
  command: string;
  cliVersion: string;
  sdkVersion: string;
  chain: { name: string; chainId: number; selector: string };
  scleraAddress: string;
  externalCall: CreExternalCall;
  featured: CreFeatured;
  bondRead: CreBondRead;
  docsHref: string;
};

const SCLERA = "0x57aF4e4B482Ab1bb4f9d1aeb5206258a7Def0eaf";

function fail(what: string): never {
  throw new Error(`cre-simulation.json is invalid: ${what}`);
}

function str(v: unknown, where: string): string {
  if (typeof v !== "string" || v.length === 0) fail(`${where} must be a non-empty string`);
  return v;
}

function int(v: unknown, where: string): number {
  if (typeof v !== "number" || !Number.isInteger(v)) fail(`${where} must be an integer`);
  return v;
}

/**
 * Validate an arbitrary object into a CreSimulation, throwing on anything missing or malformed.
 *
 * Exported so the negative test can feed it a bad object directly, rather than needing a bad JSON
 * file on disk to prove the loader fails loud.
 */
export function validateCreSimulation(raw: unknown): CreSimulation {
  if (typeof raw !== "object" || raw === null) fail("not an object");
  const r = raw as Record<string, unknown>;

  const chainRaw = (r.chain ?? {}) as Record<string, unknown>;
  const callRaw = (r.externalCall ?? {}) as Record<string, unknown>;
  const featuredRaw = (r.featured ?? {}) as Record<string, unknown>;
  const measuredRaw = (featuredRaw.measured ?? {}) as Record<string, unknown>;
  const bondRaw = (r.bondRead ?? {}) as Record<string, unknown>;

  const chainRead = str(callRaw.chainRead, "externalCall.chainRead");
  if (!chainRead.includes("bonds(")) fail("externalCall.chainRead must name the bonds( call");
  if (!chainRead.includes(SCLERA)) fail("externalCall.chainRead must carry the Sclera address");
  const httpGet = str(callRaw.httpGet, "externalCall.httpGet");
  if (!httpGet.startsWith("GET https://kanmani.xyz/api/sla/")) {
    fail("externalCall.httpGet must start with GET https://kanmani.xyz/api/sla/");
  }

  const log = featuredRaw.log;
  if (!Array.isArray(log) || log.length === 0 || !log.every((l) => typeof l === "string")) {
    fail("featured.log must be a non-empty array of strings");
  }

  return {
    capturedAt: str(r.capturedAt, "capturedAt"),
    command: str(r.command, "command"),
    cliVersion: str(r.cliVersion, "cliVersion"),
    sdkVersion: str(r.sdkVersion, "sdkVersion"),
    chain: {
      name: str(chainRaw.name, "chain.name"),
      chainId: int(chainRaw.chainId, "chain.chainId"),
      selector: str(chainRaw.selector, "chain.selector"),
    },
    scleraAddress: str(r.scleraAddress, "scleraAddress"),
    externalCall: { chainRead, httpGet },
    featured: {
      agentId: int(featuredRaw.agentId, "featured.agentId"),
      mode: str(featuredRaw.mode, "featured.mode"),
      measured: {
        sampleSize: int(measuredRaw.sampleSize, "featured.measured.sampleSize"),
        trueCount: int(measuredRaw.trueCount, "featured.measured.trueCount"),
        unknownCount: int(measuredRaw.unknownCount, "featured.measured.unknownCount"),
        rateBps: int(measuredRaw.rateBps, "featured.measured.rateBps"),
      },
      log: log as string[],
      result: str(featuredRaw.result, "featured.result"),
      liveCheck: str(featuredRaw.liveCheck, "featured.liveCheck"),
    },
    bondRead: {
      agentId: int(bondRaw.agentId, "bondRead.agentId"),
      log: str(bondRaw.log, "bondRead.log"),
      source: str(bondRaw.source, "bondRead.source"),
    },
    docsHref: str(r.docsHref, "docsHref"),
  };
}

let cached: CreSimulation | null = null;

/** The validated simulation, built once. Throws at first call if the JSON is malformed. */
export function creSimulation(): CreSimulation {
  if (!cached) cached = validateCreSimulation(RAW);
  return cached;
}

