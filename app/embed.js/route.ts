// SPDX-License-Identifier: MIT
//
// This file is one of five under MIT, with components/kit.tsx and the three AgentPasskey contract files.
// LICENSE names all five under "Files under MIT". The rest is
// LicenseRef-zkasuran-SAND-1.0, source-available with no derivatives. The carve-out is deliberate and is
// explained in docs/24-KIT-LICENCE.md: a component that exists to be rendered inside somebody else's
// product cannot be read-only and what this file publishes is a constraint rather than an asset. Copy it.
/**
 * `embed.js`: the drop-in trust badge, for a page that is not ours.
 *
 *   <script src="https://kanmani.xyz/embed.js" data-agent="10182"></script>
 *
 * One line in somebody else's agent directory and a listing shows MEASURED status instead of
 * DECLARED status. That is the whole point: directories publish claims and the gap this project
 * exists to close is that nobody checks them. Asking an operator to adopt a backend integration is a
 * project; asking them to paste a script tag is a minute.
 *
 * ## Constraints this file is written under
 *
 * **No framework and no build step.** It is served as plain JavaScript because a host page cannot be
 * asked to adopt our toolchain. It is generated from a route rather than committed as a static asset
 * so the origin it points at follows `NEXT_PUBLIC_SITE_URL` instead of being hardcoded in two places.
 *
 * **Shadow DOM.** Styles are sealed inside a shadow root so the badge cannot inherit a host page's
 * CSS and, more importantly, cannot leak into it. A badge that changes somebody's layout gets
 * removed and a badge that silently restyles itself could show `unknown` in the host's error red,
 * which is the one thing that must never happen.
 *
 * **The `unknown` rule travels with it.** A null count renders as the word, in slate, never as `0`
 * and never in the red used for `false`. That rule is the product; shipping the numbers without it
 * would be worse than shipping nothing.
 *
 * **It fails quiet.** A network error, a bad id or a missing agent renders nothing at all rather than
 * an error box in somebody else's page. We are a guest.
 */

export const dynamic = "force-dynamic";

const SCRIPT = (origin: string) => `/* Kanmani trust badge. ${origin}/developers */
(function () {
  "use strict";
  var ORIGIN = ${JSON.stringify(origin)};

  // document.currentScript is only valid while this file executes, so it is captured immediately.
  var self = document.currentScript;
  if (!self) return;
  var agentId = self.getAttribute("data-agent");
  if (!agentId || !/^\\d+$/.test(agentId)) return;
  var theme = self.getAttribute("data-theme") === "light" ? "light" : "dark";

  var host = document.createElement("span");
  host.setAttribute("data-kanmani-agent", agentId);
  self.parentNode.insertBefore(host, self.nextSibling);

  // A closed root: the host page cannot reach in and we cannot leak out.
  var root = host.attachShadow ? host.attachShadow({ mode: "closed" }) : null;
  if (!root) return;

  var C = theme === "light"
    ? { text: "#0b0f16", panel: "#ffffff", line: "#d6dee9", brand: "#6c55e0", unknown: "#64748b" }
    : { text: "#dce5f0", panel: "#0b0f16", line: "#1d2836", brand: "#836ef9", unknown: "#94a3b8" };

  var TRUE = "#34d399", FALSE = "#f87171";

  var style = document.createElement("style");
  style.textContent =
    ":host{all:initial}" +
    ".b{display:inline-flex;align-items:center;gap:8px;border:1px solid " + C.line + ";" +
    "background:" + C.panel + ";color:" + C.text + ";border-radius:8px;padding:6px 10px;" +
    "font:12px/1.4 ui-sans-serif,system-ui,-apple-system,sans-serif}" +
    ".m{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}" +
    "a{color:" + C.brand + ";text-decoration:none}" +
    "a:hover{text-decoration:underline}" +
    ".t{border:1px solid currentColor;border-radius:4px;padding:1px 5px;font-size:11px;" +
    "font-family:ui-monospace,monospace;white-space:nowrap}" +
    ".u{color:" + C.unknown + "}" +
    ".n{font-variant-numeric:tabular-nums}";
  root.appendChild(style);

  var wrap = document.createElement("span");
  wrap.className = "b";
  root.appendChild(wrap);

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  /* A count that could not be read is the word, never a digit. This is the rule that travels. */
  function count(v) {
    if (v === null || v === undefined) {
      var u = el("span", "u", "unknown");
      u.title = "This value could not be read. It is not zero.";
      return u;
    }
    return el("span", "n", Number(v).toLocaleString("en-US"));
  }

  function stateChip(state) {
    var fg = state === "answered" ? TRUE
      : (state === "gone" || state === "nohost" || state === "refused") ? FALSE
      : (state === "onchain" || state === "paywalled") ? C.brand
      : C.unknown;
    var label = state === "onchain" ? "on chain" : state === "paywalled" ? "402" : state === "nohost" ? "no host" : state;
    var s = el("span", "t", label);
    s.style.color = fg;
    return s;
  }

  /*
   * Stake behind the claims. Only USDC on Monad gets an amount, because that is the one token whose
   * decimals we know here. Any other token still says bonded, without a number we would have to guess.
   */
  var USDC_MONAD = "0x754704bc059f8c67012fed69bc8a327a5aafb603";
  function bondChip(b) {
    if (!b || !b.state || b.state === "none") return null;
    var a = el("a", "t");
    a.href = ORIGIN + "/bond?agent=" + agentId;
    a.target = "_blank";
    a.rel = "noreferrer noopener";
    var floor = typeof b.minTruthRateBps === "number" ? (b.minTruthRateBps / 100) + "%" : "unknown";
    var usdcAmt = b.token && String(b.token).toLowerCase() === USDC_MONAD && /^\\d+$/.test(String(b.amountAtomic))
      ? (Number(b.amountAtomic) / 1e6).toLocaleString("en-US", { maximumFractionDigits: 6 }) + " USDC"
      : null;
    if (b.state === "active") {
      a.textContent = usdcAmt ? "bonded " + usdcAmt : "bonded";
      a.style.color = TRUE;
      a.title = "Staked on Sclera against a " + floor + " floor on its claim-truth rate over at least " +
        b.minSampleSize + " claims. Falls below it and a signed verdict takes the stake.";
    } else if (b.state === "slashed") {
      a.textContent = "bond slashed";
      a.style.color = FALSE;
      a.title = "Its claim-truth rate fell below the " + floor + " floor it staked on, and the bond was taken.";
    } else if (b.state === "released") {
      a.textContent = "bond returned";
      a.style.color = C.unknown;
      a.title = "Held its " + floor + " floor for the full window. The stake went back to the agent.";
    } else return null;
    return a;
  }

  fetch(ORIGIN + "/api/agent/" + agentId, { headers: { accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (body) {
      var d = body && body.data;
      if (!d) { host.remove(); return; }

      var link = el("a", "m", "kanmani");
      link.href = ORIGIN + "/agent/" + agentId;
      link.target = "_blank";
      link.rel = "noreferrer noopener";
      wrap.appendChild(link);

      wrap.appendChild(el("span", null, "\\u00b7"));
      wrap.appendChild(el("span", "m", "#" + d.agentId));

      if (d.registration && d.registration.state) wrap.appendChild(stateChip(d.registration.state));

      var c = d.claims;
      if (c && (c.resolve + c.doNotResolve) > 0) {
        var line = el("span", "n");
        line.appendChild(count(c.resolve));
        line.appendChild(el("span", null, " of "));
        line.appendChild(count(c.resolve + c.doNotResolve));
        line.appendChild(el("span", null, " claims resolve"));
        wrap.appendChild(line);
        if (c.couldNotCheck > 0) {
          var un = el("span", "u", c.couldNotCheck + " unknown");
          un.title = "We could not look or could not read what we fetched. Never an accusation.";
          wrap.appendChild(un);
        }
      } else {
        /* Never measured must not look like passed. */
        var q = el("span", "t u", "unchecked");
        q.title = "No payment claim by this agent has been checked yet. Unchecked is not clean.";
        wrap.appendChild(q);
      }

      /* The Sclera bond, read live from the contract by /api/agent. No bond renders nothing. */
      var bond = bondChip(d.bond);
      if (bond) wrap.appendChild(bond);
    })
    .catch(function () { host.remove(); });
})();
`;

export async function GET() {
  const origin = process.env.NEXT_PUBLIC_SITE_URL ?? "https://kanmani.xyz";
  return new Response(SCRIPT(origin), {
    headers: {
      "content-type": "application/javascript; charset=utf-8",
      // The point of the file is to run on somebody else's origin.
      "access-control-allow-origin": "*",
      "cache-control": "public, max-age=300",
    },
  });
}
