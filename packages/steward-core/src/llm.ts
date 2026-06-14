// LLM client for the Steward treasurer layer (Steward Phase 1, tasks 14–15 + 19).
//
// TRANSPORT: plain HTTP against an OpenAI-compatible gateway. The OpenCode Go
// subscription is reachable over HTTP at base `https://opencode.ai/zen/go/v1`
// (NOT the `/zen/v1` credits endpoint). Auth = `Authorization: Bearer <key>`.
// Endpoints: `POST {base}/chat/completions`, `GET {base}/models`. Model ids on
// this endpoint are BARE (e.g. `mimo-v2.5-pro`) — no provider prefix.
//
// Pure-ish: the core reads NO process.env. The service passes baseUrl + apiKey +
// models + timeouts in. Same purity contract as the detectors and policy
// evaluator: this file knows nothing about Express, the DB, or service config.
//
// Many models on this gateway are REASONING models. Every JSON call sends
// `response_format: {type: 'json_object'}`. Even then we parse defensively:
// prefer `choices[0].message.content`; if empty, fall back to
// `choices[0].message.reasoning_content`; strip ```json fences and any
// `<think>…</think>` block before JSON.parse.
//
// `chatJson()` is the only call shape Steward needs: a system+user prompt that
// must come back as a single JSON object, validated against a caller-supplied
// zod schema. It enforces a HARD timeout (AbortController), retries ONCE on a
// parse/validation failure with a "return ONLY raw JSON" nudge, and throws a
// typed `LlmError` (timeout | credits | parse | http) on any failure so callers
// can fail closed deterministically.

import type { ZodType } from 'zod';

/** Why an LLM call failed — callers branch on this for fail-closed behavior. */
export type LlmErrorKind = 'timeout' | 'credits' | 'parse' | 'http';

/** A typed LLM failure. `kind` distinguishes a credits exhaustion (a degraded
 *  state) from a transport / parse / timeout fault. */
export class LlmError extends Error {
  constructor(
    public readonly kind: LlmErrorKind,
    message: string,
    /** HTTP status code when kind === 'http'/'credits'. */
    public readonly status?: number,
    /** The raw body excerpt, for logging. */
    public readonly detail?: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Static config for one client. */
export interface LlmClientConfig {
  /** OpenAI-compatible base URL, e.g. 'https://opencode.ai/zen/go/v1'. */
  baseUrl: string;
  /** Bearer API key (subscription key). */
  apiKey: string;
  /** Default hard timeout (ms) if a call doesn't override it. */
  defaultTimeoutMs?: number;
}

/** One `chatJson` request. */
export interface ChatJsonRequest<T> {
  /** Bare model id, e.g. 'mimo-v2.5-pro'. No provider prefix. */
  model: string;
  /** System prompt. */
  system: string;
  /** User prompt. */
  user: string;
  /** Max tokens for the completion. Default 600 (headroom for reasoning models). */
  maxTokens?: number;
  /** Hard timeout (ms) for THIS call; overrides the client default. */
  timeoutMs?: number;
  /** zod schema the parsed JSON assistant message must satisfy. */
  schema: ZodType<T>;
}

/** One model entry from `GET /models`. */
export interface LlmModel {
  id: string;
  [k: string]: unknown;
}

export interface LlmClient {
  /** `GET {base}/models` — proves the gateway is reachable + lists models. */
  listModels(timeoutMs?: number): Promise<LlmModel[]>;
  /** `POST {base}/chat/completions`, parse + validate the assistant text as JSON. */
  chatJson<T>(req: ChatJsonRequest<T>): Promise<T>;
}

const DEFAULT_TIMEOUT_MS = 12_000;
const DEFAULT_MAX_TOKENS = 600;

/** Detect a credits / insufficient-balance error in a response body. */
function isCreditsError(text: string): boolean {
  return (
    /CreditsError/i.test(text) ||
    /insufficient (?:balance|credit|funds)/i.test(text) ||
    /\bcredits?\b[^a-z]*(error|exhaust|insufficient|depleted)/i.test(text)
  );
}

/**
 * Scan for the LAST top-level balanced `{…}` object in a string and return it.
 * Reasoning models often emit prose with many stray braces and (when their final
 * answer survives) the real JSON object at the very end — so we walk from the
 * back, tracking brace depth (ignoring braces inside double-quoted strings), and
 * return the last fully-balanced object. Returns null if none balances.
 */
function lastBalancedObject(s: string): string | null {
  let end = s.lastIndexOf('}');
  while (end !== -1) {
    let depth = 0;
    let inStr = false;
    let esc = false;
    for (let i = end; i >= 0; i--) {
      const ch = s[i];
      if (inStr) {
        // Walking backwards: a quote closes the string unless it's escaped. We
        // approximate escape handling by checking the preceding backslash.
        if (ch === '"' && s[i - 1] !== '\\') inStr = false;
        continue;
      }
      if (ch === '"') {
        inStr = true;
        continue;
      }
      if (ch === '}') depth++;
      else if (ch === '{') {
        depth--;
        if (depth === 0) return s.slice(i, end + 1);
      }
      void esc;
    }
    end = s.lastIndexOf('}', end - 1);
  }
  return null;
}

/** Strip <think>…</think> blocks and ```json fences, then JSON.parse — falling
 *  back to the last balanced object if the cleaned string still won't parse. */
function parseJsonLoose(content: string): unknown {
  let s = content.trim();
  // Drop any reasoning <think>…</think> blocks the model may have emitted.
  s = s.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  // Strip a ```json … ``` (or bare ```) fence if present.
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fence) s = fence[1].trim();
  if (s.startsWith('{')) {
    try {
      return JSON.parse(s);
    } catch {
      /* fall through to balanced-object extraction */
    }
  }
  const obj = lastBalancedObject(s);
  if (obj) return JSON.parse(obj);
  // Last resort: outermost slice (covers a clean object with leading prose).
  const first = s.indexOf('{');
  const last = s.lastIndexOf('}');
  if (first !== -1 && last > first) return JSON.parse(s.slice(first, last + 1));
  return JSON.parse(s);
}

/** Extract the assistant text from a chat-completions response, preferring
 *  `content`, falling back to `reasoning_content`. */
function extractAssistantText(body: unknown): string {
  const choices = (body as { choices?: Array<{ message?: { content?: unknown; reasoning_content?: unknown } }> })
    ?.choices;
  const msg = choices?.[0]?.message;
  const content = typeof msg?.content === 'string' ? msg.content.trim() : '';
  if (content) return content;
  const reasoning = typeof msg?.reasoning_content === 'string' ? msg.reasoning_content.trim() : '';
  return reasoning;
}

/**
 * Build an HTTP-backed client against an OpenAI-compatible gateway.
 */
export function createLlmClient(cfg: LlmClientConfig): LlmClient {
  const baseUrl = cfg.baseUrl.trim().replace(/\/+$/, '');
  const apiKey = cfg.apiKey.trim();
  if (!baseUrl) throw new Error('[steward-core] createLlmClient: baseUrl is required');
  if (!apiKey) throw new Error('[steward-core] createLlmClient: apiKey is required');
  const defaultTimeout = cfg.defaultTimeoutMs ?? DEFAULT_TIMEOUT_MS;

  const authHeaders = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  };

  return {
    async listModels(timeoutMs = defaultTimeout): Promise<LlmModel[]> {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), timeoutMs);
      let res: Response;
      try {
        res = await fetch(`${baseUrl}/models`, {
          method: 'GET',
          headers: authHeaders,
          signal: ctrl.signal,
        });
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') {
          throw new LlmError('timeout', `GET /models timed out after ${timeoutMs}ms`);
        }
        throw new LlmError('http', `GET /models transport error: ${(err as Error).message}`);
      } finally {
        clearTimeout(timer);
      }
      const text = await res.text();
      if (!res.ok) {
        if (isCreditsError(text)) {
          throw new LlmError('credits', 'gateway reports no credits / insufficient balance', res.status, text.slice(0, 500));
        }
        throw new LlmError('http', `GET /models returned ${res.status}`, res.status, text.slice(0, 500));
      }
      let body: { data?: LlmModel[] };
      try {
        body = JSON.parse(text);
      } catch {
        throw new LlmError('parse', 'GET /models returned non-JSON', res.status, text.slice(0, 500));
      }
      return Array.isArray(body.data) ? body.data : [];
    },

    async chatJson<T>(req: ChatJsonRequest<T>): Promise<T> {
      const timeoutMs = req.timeoutMs ?? defaultTimeout;
      const maxTokens = req.maxTokens ?? DEFAULT_MAX_TOKENS;

      const post = async (userContent: string): Promise<string> => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), timeoutMs);
        let res: Response;
        try {
          res = await fetch(`${baseUrl}/chat/completions`, {
            method: 'POST',
            headers: authHeaders,
            signal: ctrl.signal,
            body: JSON.stringify({
              model: req.model,
              messages: [
                { role: 'system', content: req.system },
                { role: 'user', content: userContent },
              ],
              max_tokens: maxTokens,
              response_format: { type: 'json_object' },
            }),
          });
        } catch (err) {
          if ((err as Error)?.name === 'AbortError') {
            throw new LlmError('timeout', `chat/completions timed out after ${timeoutMs}ms`);
          }
          throw new LlmError('http', `chat/completions transport error: ${(err as Error).message}`);
        } finally {
          clearTimeout(timer);
        }

        const text = await res.text();
        if (!res.ok) {
          if (isCreditsError(text)) {
            throw new LlmError('credits', 'gateway reports no credits / insufficient balance', res.status, text.slice(0, 500));
          }
          throw new LlmError('http', `chat/completions returned ${res.status}`, res.status, text.slice(0, 500));
        }
        // Credits errors can also surface inside a 200 body.
        if (isCreditsError(text)) {
          throw new LlmError('credits', 'gateway reports no credits / insufficient balance', res.status, text.slice(0, 500));
        }
        let body: unknown;
        try {
          body = JSON.parse(text);
        } catch {
          throw new LlmError('parse', 'chat/completions returned non-JSON envelope', res.status, text.slice(0, 500));
        }
        const assistantText = extractAssistantText(body);
        if (!assistantText) {
          throw new LlmError('parse', 'chat/completions returned no assistant content/reasoning_content', res.status, text.slice(0, 500));
        }
        return assistantText;
      };

      const attempt = async (userContent: string): Promise<T> => {
        const text = await post(userContent);
        let parsed: unknown;
        try {
          parsed = parseJsonLoose(text);
        } catch (err) {
          throw new LlmError(
            'parse',
            `assistant text was not JSON: ${err instanceof Error ? err.message : String(err)}`,
            undefined,
            text.slice(0, 500),
          );
        }
        const result = req.schema.safeParse(parsed);
        if (!result.success) {
          throw new LlmError('parse', `assistant JSON failed schema validation: ${result.error.message}`, undefined, text.slice(0, 500));
        }
        return result.data;
      };

      try {
        return await attempt(req.user);
      } catch (err) {
        // Retry ONCE on a parse/validation failure with an explicit nudge.
        // Transport/credits/timeout failures are NOT retried (won't self-heal).
        if (err instanceof LlmError && err.kind === 'parse') {
          const nudged =
            req.user +
            '\n\n# IMPORTANT\nYour previous reply was not valid JSON matching the required schema. ' +
            'Return ONLY raw JSON, no markdown, no code fences, no reasoning.';
          return await attempt(nudged);
        }
        throw err;
      }
    },
  };
}
