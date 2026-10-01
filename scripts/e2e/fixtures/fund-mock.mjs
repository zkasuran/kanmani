// Mocked Aurora funding API plus an EIP-1193 wallet stub for the /fund e2e suites.
//
// In a subdirectory on purpose: agent 01's runner discovers suites as the top-level `*.mjs` in
// scripts/e2e/, so a fixtures module here is never picked up and run as a suite. These helpers drive
// a Playwright `page`: `installEip1193` injects a window.ethereum stub, `routeFund` fulfils every
// /api/fund/* call with a canned response and walks the status sequence for the chosen track.
//
// Not executed by the gate; it is syntax-checked with `node --check`. The real flow is proven live
// once the key is deployed (item 3.5), and by the lib unit tests under `node --test`.

export const DEPOSIT_ADDRESS = "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E";
export const INTERMEDIARY = "0xFe6EF968D2F7B2e9CCCF92150d96c930C3CC4a4E";
export const DESTINATION_TX = "0x738af85c2f6717da15f1cee3a447b05d0fc7b3c924b8027678afdde0a440b558";
export const EXEC_ID = "e5abf7ce-1111-4000-8000-000000000001";
const WALLET = "0x1111111111111111111111111111111111111111";
const SIGNATURE_HEX = "0x" + "ab".repeat(32) + "cd".repeat(32) + "1b";

// Each track is an ordered list of Aurora states the status route returns, one per poll.
const TRACKS = {
  happy: ["DEPOSIT_PENDING", "DEPOSIT_PROCESSING", "OPERATION_PROCESSING", "SUCCESS"],
  short: ["DEPOSIT_PENDING", "OPERATION_PROCESSING", "OPERATION_FAILED"],
  expired: ["DEPOSIT_PENDING", "EXPIRED"],
  "shortfall-at-create": [],
  "quote-error": [],
};

export async function installEip1193(page) {
  await page.addInitScript(
    ({ wallet, sig }) => {
      const handler = async ({ method }) => {
        if (method === "eth_requestAccounts" || method === "eth_accounts") return [wallet];
        if (method === "eth_chainId") return "0x8f";
        if (method === "personal_sign") return sig;
        if (method === "wallet_switchEthereumChain") return null;
        return null;
      };
      Object.defineProperty(window, "ethereum", { value: { request: handler, on() {}, removeListener() {} }, configurable: true });
    },
    { wallet: WALLET, sig: SIGNATURE_HEX },
  );
}

function quoteBody(min, fee) {
  return { data: { minAmountOut: min, networkFee: fee, intermediary: INTERMEDIARY, depositAddress: null, needed: min, shortfall: false } };
}

function createBody(min) {
  return {
    data: {
      id: EXEC_ID,
      wallet: WALLET,
      status: "CREATED",
      depositAddress: DEPOSIT_ADDRESS,
      intermediary: INTERMEDIARY,
      minAmountOut: min,
      needed: min,
      messageToSign: "SIGN-ME-aurora-intent",
      payloadJson: "CANONICAL-PAYLOAD-JSON",
      signingStandard: "erc191",
    },
  };
}

export async function routeFund(page, { track = "happy" } = {}) {
  const sequence = TRACKS[track] ?? TRACKS.happy;
  let poll = 0;
  await page.route("**/api/fund/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const json = (status, body) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path.endsWith("/api/fund/quote")) {
      if (track === "quote-error") return json(500, { title: "boom" });
      return json(200, quoteBody("87125", "7150"));
    }
    if (path.endsWith("/api/fund/create")) {
      if (track === "shortfall-at-create") return json(200, createBody("80000")); // below the 87125 job: client guard refuses
      return json(201, createBody("87125"));
    }
    if (path.endsWith("/api/fund/submit")) {
      return json(200, { data: { executionId: EXEC_ID, wallet: WALLET, status: "CREATED", messageSigned: true } });
    }
    if (path.includes("/api/fund/intermediary")) {
      const state = track === "short" ? "short" : track === "expired" ? "expired" : "recoverable";
      return json(200, { data: { wallet: WALLET, intermediary: INTERMEDIARY, balance: "80000", balanceHuman: "0.08", needed: "87125", state } });
    }
    if (path.endsWith("/api/fund/recover")) {
      return json(200, { data: { mode: "refund", wallet: WALLET, dry: true, id: EXEC_ID, status: "CREATED", intermediary: INTERMEDIARY, networkFee: "7150", messageToSign: null } });
    }
    // GET /api/fund/:id?wallet= status read: advance the per-track sequence, one state per poll.
    const state = sequence[Math.min(poll, sequence.length - 1)] ?? "DEPOSIT_PENDING";
    poll += 1;
    const body = { data: { id: EXEC_ID, status: state, messageSigned: true, depositAddress: DEPOSIT_ADDRESS, intermediary: INTERMEDIARY } };
    if (state === "SUCCESS") body.data.destinationTx = DESTINATION_TX;
    return json(200, body);
  });
}
