/**
 * The real Qwen client, implementing the same `ChatClient` seam the loop is tested against.
 *
 * Qwen 3.8 Max is served by Alibaba Cloud Model Studio (formerly DashScope), which exposes an
 * OpenAI-compatible chat-completions surface, so this client is a thin pass-through rather than a
 * translation layer.
 *
 * Confirmed live against the official docs on 2026-09-23:
 *   - International (Singapore) base URL: https://dashscope-intl.aliyuncs.com/compatible-mode/v1
 *     (China/Beijing is https://dashscope.aliyuncs.com/compatible-mode/v1)
 *     Source: help.aliyun.com/en/model-studio/base-url
 *   - API key env var: DASHSCOPE_API_KEY
 *   - Tool calling is supported on chat completions via the `tools` parameter. The one documented
 *     constraint is that `tools` cannot be combined with `stream: true`, so this client never
 *     streams. Source: alibabacloud.com/help/en/model-studio/compatibility-of-openai-with-dashscope
 *   - The model id is `qwen3.8-max`, the same string on Alibaba Cloud Model Studio / DashScope and
 *     on QwenCloud. This is the exact model the "best builds with Qwen 3.8 Max" bounty names, so the
 *     wire model matches the credit grant by default. Qwen3.8-Max shipped 2026-08-03 (a sparse MoE,
 *     1M-token context, hybrid thinking mode). Sources: apidog.com/blog/qwen-3-8-api,
 *     together.ai/models/qwen3-8-max, alibabacloud.com/help/en/model-studio.
 *
 * BUILT, UNVERIFIED against a live call: no DASHSCOPE_API_KEY is present in this environment, so no
 * request has been sent. The orchestration is fully tested through the seam. See CONTENT-qwen.html
 * and the lane summary for exactly what is proven and what waits on one keyed run.
 */

import type { ChatClient, ChatRequest, ChatResponse, ChatMessage } from "./model.ts";

export const DEFAULT_BASE_URL = "https://dashscope-intl.aliyuncs.com/compatible-mode/v1";
export const DEFAULT_MODEL = "qwen3.8-max";

/**
 * Keys are read in order and the first present one wins.
 *
 * DashScope is Alibaba's own endpoint and was never reachable here. GMI Cloud serves the same model
 * over an OpenAI-compatible API: verified 2026-09-28, `/v1/models` lists `Qwen/Qwen3.8-Max` and a
 * completion reports `model: qwen3.8-max`. Two names for one route to the same weights, so the client
 * accepts either rather than pretending there is only one door.
 *
 * `QWEN_BASE_URL` and `QWEN_MODEL` still override, which is how GMI is selected without a code change.
 */
export const API_KEY_ENVS = ["DASHSCOPE_API_KEY", "GMI_API_KEY"] as const;
export const API_KEY_ENV = API_KEY_ENVS[0];

export type QwenConfig = {
  apiKey: string;
  baseUrl?: string;
  model?: string;
  /** Injectable for a test; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
};

/**
 * Build a client from the environment. Throws a clear error naming the env var when the key is
 * absent, rather than sending an unauthenticated request that fails opaquely.
 */
export function qwenFromEnv(env: NodeJS.ProcessEnv = process.env): QwenChatClient {
  const named = API_KEY_ENVS.find((k) => env[k]);
  const apiKey = named ? env[named] : undefined;
  if (!apiKey) {
    throw new Error(
      `No Qwen key found. The atlas loop needs one of ${API_KEY_ENVS.join(" or ")}. ` +
        `Set one, optionally QWEN_BASE_URL and QWEN_MODEL to pick a provider.`,
    );
  }
  return new QwenChatClient({
    apiKey,
    baseUrl: env.QWEN_BASE_URL ?? DEFAULT_BASE_URL,
    model: env.QWEN_MODEL ?? DEFAULT_MODEL,
  });
}

export class QwenChatClient implements ChatClient {
  readonly label: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(cfg: QwenConfig) {
    this.apiKey = cfg.apiKey;
    this.baseUrl = (cfg.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, "");
    this.label = cfg.model ?? DEFAULT_MODEL;
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  async chat(req: ChatRequest): Promise<ChatResponse> {
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: req.model,
        messages: req.messages,
        tools: req.tools,
        /**
         * A thinking model refuses a forced tool choice.
         *
         * Qwen3.8-Max rejects `tool_choice: "required"` or an object form with
         * `InternalError.Algo.InvalidParameter: The tool_choice parameter does not support being set
         * to required or object in thinking mode`. Found by running the induction loop against it for
         * the first time.
         *
         * Downgrading to "auto" is the honest fix rather than turning thinking off, because the
         * reasoning is what makes the model good at reading an unfamiliar document shape. The caller
         * already handles a turn that returns no tool call, so "auto" costs a retry at worst and the
         * loop still refuses to accept a mapping it has not verified through the parser.
         */
        tool_choice:
          req.tool_choice === "required" || typeof req.tool_choice === "object"
            ? "auto"
            : req.tool_choice,
        temperature: req.temperature ?? 0,
        stream: false, // tools and streaming cannot be combined on this API
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`Qwen chat failed: HTTP ${res.status} ${body.slice(0, 300)}`);
    }
    // Read as text with a cap rather than res.json() straight, so a runaway or malformed response
    // cannot buffer without bound. 4 MB is far above any real chat completion.
    const MAX_BYTES = 4_000_000;
    const declared = Number(res.headers.get("content-length") ?? "0");
    if (declared > MAX_BYTES) throw new Error(`Qwen chat response too large: ${declared} bytes`);
    const text = await res.text();
    if (text.length > MAX_BYTES) throw new Error(`Qwen chat response too large: ${text.length} bytes`);
    const json = JSON.parse(text) as {
      choices?: { message?: ChatMessage }[];
    };
    const message = json.choices?.[0]?.message;
    if (!message) throw new Error("Qwen chat returned no message");
    return { message };
  }
}
