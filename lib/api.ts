/**
 * The shared shape of every JSON response.
 *
 * Two fields are on every single one: `checkedAt` and `reproduce`. A number with no time attached
 * is a number that was true once and a number with no way to re-derive it is a number the reader
 * has to take on trust. The whole argument of this site is that neither is good enough when the
 * subject is somebody else's reputation, so our own output holds to it.
 */
import { CHAIN_ID } from "./db.ts";

export const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3400";

export type Envelope<T> = {
  /** Bumped when a field changes meaning, never when one is added. */
  version: 1;
  chain: { id: number; name: string };
  /** When this response was computed. Always present, never the time the code was deployed. */
  checkedAt: string;
  /** The chain head the underlying index had reached. Null when it could not be read. */
  checkedAtBlock: string | null;
  /** Exactly what to run to get the same answer without this API. */
  reproduce: string;
  data: T;
};

export function envelope<T>(data: T, reproduce: string, checkedAtBlock: number | null = null): Envelope<T> {
  return {
    version: 1,
    chain: { id: CHAIN_ID, name: "Monad" },
    checkedAt: new Date().toISOString(),
    checkedAtBlock: checkedAtBlock === null ? null : String(checkedAtBlock),
    reproduce,
    data,
  };
}

export function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body, null, 2), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Read by an agent, not by a browser cache. A stale verdict is worse than a slow one.
      "cache-control": "no-store",
      ...(init.headers ?? {}),
    },
  });
}

export function problem(status: number, title: string, detail: string, extra: object = {}): Response {
  // RFC 9457 shape, so a consumer that already understands problem+json needs no special case.
  return new Response(JSON.stringify({ type: `${SITE}/method`, title, status, detail, ...extra }, null, 2), {
    status,
    headers: { "content-type": "application/problem+json; charset=utf-8", "cache-control": "no-store" },
  });
}
