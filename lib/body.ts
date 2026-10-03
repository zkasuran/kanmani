/**
 * A byte ceiling on inbound request bodies.
 *
 * Every OUTBOUND parser in this repo already caps what it will read: 64 KiB in the verifier's
 * guarded fetch, 256 KiB in the probe, an encoded and a decoded bound on a `data:` evidence URI. The
 * INBOUND side had no cap at all. `await req.json()` buffers whatever arrives, and on the priced
 * service route it ran before the payment check, so an unauthenticated stranger could POST a body of
 * any size to a free agent endpoint and make the process hold it in memory. The per-IP limiter in
 * proxy.ts counts requests, never bytes, and it says in its own comment that it is not a security
 * boundary.
 *
 * The cap is enforced by reading the stream and counting, not by trusting `content-length`. A
 * declared length is a claim by the sender: it can be absent under chunked encoding, and it can be
 * a lie in either direction. So the declared value is used only as a cheap early refusal when it is
 * present and already over the cap, and the real decision is made on bytes that actually arrived.
 * Reading stops at the first chunk that crosses the line, so an endless body is refused after one
 * chunk past the ceiling rather than after all of it.
 *
 * 1 MiB is the default. The largest honest body any route here takes is an evidence document or a
 * registration record, both far under it, and the verifier refuses to FETCH a document above 64 KiB,
 * so a 1 MiB inbound allowance is already generous by a wide margin.
 *
 * Failure is a typed result, never a throw. 413 is the status, because the request was understood
 * and refused on size.
 */

/** The default inbound ceiling. Named so a route can cite it and a test can assert against it. */
export const MAX_REQUEST_BYTES = 1_048_576;

export type BodyOutcome =
  | { ok: true; text: string }
  | { ok: false; status: 400 | 413; title: string; detail: string };

/** The refusal a caller gets when the body crosses the ceiling. Shared so the wording exists once. */
function tooLarge(maxBytes: number): BodyOutcome {
  return {
    ok: false,
    status: 413,
    title: "Body is too large",
    detail: `This endpoint reads at most ${maxBytes} bytes. Nothing was parsed and no work was done.`,
  };
}

/**
 * Read the body as text, refusing anything past `maxBytes`.
 *
 * Returns the exact bytes as text, so a caller that has to verify a signature over the raw body can
 * use this and still hash what the sender sent. Re-serialising parsed JSON would change key order
 * and break that digest, which is why the webhook path needs text rather than an object.
 */
export async function readBodyText(
  req: Request,
  maxBytes: number = MAX_REQUEST_BYTES,
): Promise<BodyOutcome> {
  // Cheap early refusal. Only trusted when it is present AND already over the cap: a sender
  // claiming a small size is still read under the counter below.
  const declared = req.headers.get("content-length");
  if (declared !== null) {
    const n = Number(declared);
    if (Number.isFinite(n) && n > maxBytes) return tooLarge(maxBytes);
  }

  const body = req.body;
  if (body === null) return { ok: true, text: "" };

  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value === undefined) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        // Stop pulling. Cancelling tells the peer we are done rather than draining the rest.
        await reader.cancel().catch(() => {});
        return tooLarge(maxBytes);
      }
      chunks.push(value);
    }
  } catch (e) {
    return {
      ok: false,
      status: 400,
      title: "Body could not be read",
      detail: (e as Error).message ?? String(e),
    };
  }

  const joined = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) {
    joined.set(c, at);
    at += c.byteLength;
  }
  try {
    // `fatal` so invalid UTF-8 is a refusal rather than a string quietly full of replacement
    // characters that a parser would then reject with a confusing message.
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(joined) };
  } catch {
    return {
      ok: false,
      status: 400,
      title: "Body is not UTF-8",
      detail: "The bytes sent are not valid UTF-8, so they were not parsed.",
    };
  }
}

export type JsonOutcome =
  | { ok: true; value: unknown }
  | { ok: false; status: 400 | 413; title: string; detail: string };

/**
 * Read the body and parse it as JSON, under the same ceiling.
 *
 * The parse runs on bytes that are already bounded, so a hostile body cannot reach `JSON.parse` at
 * a size that matters. A parse failure is a 400 with no part of the input echoed back.
 */
export async function readBodyJson(
  req: Request,
  maxBytes: number = MAX_REQUEST_BYTES,
): Promise<JsonOutcome> {
  const read = await readBodyText(req, maxBytes);
  if (!read.ok) return read;
  try {
    return { ok: true, value: JSON.parse(read.text) };
  } catch {
    return {
      ok: false,
      status: 400,
      title: "Body is not JSON",
      detail: "The body was read in full and did not parse as JSON.",
    };
  }
}
