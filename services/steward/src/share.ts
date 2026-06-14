// X (Twitter) share drafts for notable treasurer decisions (hackathon traction).
//
// KEYLESS + HUMAN-APPROVED. Nothing here ever publishes. We compose a ready-to-post
// X draft with the SMART model (quality, off the hot path) and turn it into an
// `https://x.com/intent/post?text=…` link that opens X's composer pre-filled. The
// owner reviews and taps "Post to X" in Telegram — manual publish, no X API, no
// OAuth, no cost.
//
// The trigger is a NOTABLE treasurer decision: the LLM treasurer DOWNGRADING an
// otherwise-allowed payment (allow→hold or allow→deny) — "the agent decided to
// stop the money". Routine allows never fire (too noisy). A cooldown caps drafts
// to one per SHARE_COOLDOWN_MIN (default 30m) so the dogfood loop can't spam.
//
// COSMETIC + FIRE-AND-FORGET: every entry point swallows its own errors and falls
// back to a deterministic templated post. This file must NEVER throw into the
// payment path.

import { z } from 'zod';
import { sql } from '@arc-agents/db';
import { getLlmRuntime } from './llm-config.js';

const CONSOLE_URL = (process.env.STEWARD_CONSOLE_URL ?? 'https://steward.poko.blue').replace(/\/+$/, '');
const X_INTENT_BASE = (process.env.X_INTENT_BASE ?? 'https://x.com/intent/post').replace(/\/+$/, '');

/** Hard ceiling on the post body. X allows 280; we trim to 270 for safety margin. */
const MAX_POST_CHARS = 270;

/** A Circle product reference must appear in every post (judging weights Circle tooling). */
const CIRCLE_REFS = ['Circle Gateway', 'USDC', 'Circle'] as const;

/** Context for one share draft. All fields optional except a kind hint. */
export interface ShareContext {
  /** What happened: a treasurer downgrade verdict, or a manual /tweet draft. */
  kind: 'hold' | 'deny' | 'manual';
  /** Seller host involved (when known). */
  host?: string;
  /** Quoted amount in USDC (decimal string), when known. */
  amountUsdc?: string;
  /** The treasurer's one-line reason / the manual topic text. */
  reason?: string;
  /** Recipient address (when known). */
  payTo?: string;
  /** Incident id for the deep link (when one was opened). */
  incidentId?: string;
}

const PostSchema = z.object({ post: z.string() });

// The smart reasoning model can take 10-25s; this is OFF the hot path (composed
// after the payment verdict is already returned) so a generous timeout is fine.
const SHARE_TIMEOUT_MS = 30_000;

const SHARE_SYSTEM_PROMPT = `You are the voice of Steward — a CFO / risk layer that sits in front of AI agents and stops them from draining their own wallets. You write ONE short, punchy, credible post for X (Twitter) about a real moment that just happened.

Steward facts you may use (all true):
- Steward is an autonomous treasurer for AI agents making x402 micropayments.
- It runs on Arc and settles in USDC via Circle Gateway.
- An LLM "treasurer" gives every payment a final judgment call and can DOWNGRADE an otherwise-allowed payment to a hold (pause for human approval) or a deny — "the agent decided to stop the money".
- Holds/denies are surfaced to a human owner; nothing auto-publishes; humans stay in the loop.

WRITE RULES — follow ALL:
1. ONE post, <= 250 characters (leave room for a link). First-person product voice ("Steward just …", "My treasurer …"). Concrete and credible, not hypey.
2. MUST contain the exact hashtag #x402.
3. MUST name a Circle product explicitly — use "Circle Gateway" (preferred), or "USDC", or "Circle".
4. SHOULD mention it runs on Arc.
5. NO fabricated numbers, NO invented metrics, NO claims beyond the facts above. If an amount/host is given you may reference it; otherwise stay qualitative.
6. No emojis required. Plain text. Do NOT include a URL — the system appends one.

Reply with ONLY a JSON object of the form {"post": "..."} where "..." is the ACTUAL post you wrote. Do not echo this template or any placeholder.

Example of a good reply (write your own, do not copy this one):
{"post": "My treasurer just paused a payment my agent wanted to send — the price looked off. Steward is the CFO that keeps AI agents from draining their wallets. Runs on Arc, settles in USDC via Circle Gateway. #x402"}`;

/** Build the user prompt describing the moment to post about. */
function buildUserPrompt(ctx: ShareContext): string {
  const facts: Record<string, unknown> = {};
  if (ctx.kind === 'hold') facts.event = 'My treasurer downgraded an allowed payment to a HOLD (paused for owner approval).';
  else if (ctx.kind === 'deny') facts.event = 'My treasurer downgraded an allowed payment to a DENY (refused outright).';
  else facts.event = 'Compose a general post about Steward.';
  if (ctx.host) facts.seller_host = ctx.host;
  if (ctx.amountUsdc) facts.quoted_usdc = ctx.amountUsdc;
  if (ctx.reason) facts.treasurer_reason = ctx.reason;
  return `Write the post for this moment:\n${JSON.stringify(facts, null, 2)}`;
}

/** Does the text already reference a Circle product? */
function hasCircleRef(text: string): boolean {
  return CIRCLE_REFS.some((ref) => text.toLowerCase().includes(ref.toLowerCase()));
}

/**
 * Deterministically enforce the hard requirements on whatever the LLM returned
 * (or the templated fallback): ensure #x402 + a Circle reference are present, try
 * to append the console URL if it fits, then hard-trim to MAX_POST_CHARS.
 */
function enforceRequirements(raw: string): string {
  let text = raw.replace(/\s+/g, ' ').trim();

  // Ensure a Circle product reference.
  if (!hasCircleRef(text)) {
    const add = ' on Circle Gateway';
    if (text.length + add.length <= MAX_POST_CHARS) text += add;
  }
  // Ensure the #x402 hashtag.
  if (!/#x402\b/i.test(text)) {
    const add = ' #x402';
    if (text.length + add.length <= MAX_POST_CHARS) text += add;
    else text = text.slice(0, MAX_POST_CHARS - add.length).trimEnd() + add;
  }
  // Append the console URL if there's room (and it's not already there).
  if (!text.includes(CONSOLE_URL)) {
    const add = ' ' + CONSOLE_URL;
    if (text.length + add.length <= MAX_POST_CHARS) text += add;
  }
  // Final hard trim — never exceed the ceiling, but keep #x402 if we can.
  if (text.length > MAX_POST_CHARS) {
    text = text.slice(0, MAX_POST_CHARS).trimEnd();
    if (!/#x402\b/i.test(text)) {
      text = text.slice(0, MAX_POST_CHARS - 6).trimEnd() + ' #x402';
    }
  }
  return text;
}

/** Deterministic fallback post — used on any LLM error/timeout. Always valid. */
function templatedPost(ctx: ShareContext): string {
  const verb =
    ctx.kind === 'deny'
      ? 'denied a payment my agent wanted to make'
      : ctx.kind === 'hold'
        ? 'paused a payment for my approval'
        : 'is guarding my agent wallet';
  const base = `Steward just ${verb} — an AI CFO that stops agents draining their wallets. Runs on Arc, settles in USDC via Circle Gateway. #x402`;
  return enforceRequirements(base);
}

export interface XPostDraft {
  /** The final, validated post text (<= 270 chars, #x402 + Circle ref guaranteed). */
  text: string;
  /** The X intent URL that opens the composer pre-filled with `text`. */
  intentUrl: string;
}

/**
 * Compose an X post draft for a moment. Uses the SMART model; post-validates the
 * output for the hard requirements; falls back to a deterministic template on any
 * LLM error. NEVER throws.
 */
export async function composeXPost(ctx: ShareContext): Promise<XPostDraft> {
  let text: string;
  try {
    const rt = getLlmRuntime();
    if (!rt) {
      text = templatedPost(ctx);
    } else {
      const out = await rt.client.chatJson({
        // The SMART model (deepseek-v4-pro) is a REASONING model: it spends tokens
        // on hidden reasoning before emitting the final `content`. With too small a
        // budget the reasoning eats everything and `content` comes back empty (the
        // client then falls back to reasoning_content, which isn't JSON). Give it
        // generous headroom so the final JSON object actually lands.
        model: rt.smartModel,
        system: SHARE_SYSTEM_PROMPT,
        user: buildUserPrompt(ctx),
        // ~2000 tokens of hidden reasoning is typical for this model; budget well
        // above that so the final JSON `content` lands after the reasoning. (The
        // deterministic template is the safety net when it occasionally overruns.)
        maxTokens: 3200,
        timeoutMs: SHARE_TIMEOUT_MS,
        schema: PostSchema,
      });
      const composed = (out.post ?? '').trim();
      // Reject degenerate output (empty, too short, or an echoed placeholder) and
      // fall back to the deterministic template.
      const degenerate =
        composed.length < 20 ||
        /<\s*the post text\s*>|<\s*post\s*>|your post here|\.\.\./i.test(composed);
      text = degenerate ? templatedPost(ctx) : enforceRequirements(composed);
    }
  } catch (err) {
    console.error('[steward:share] composeXPost LLM failed — using template:', err instanceof Error ? err.message : err);
    text = templatedPost(ctx);
  }

  const intentUrl = `${X_INTENT_BASE}?text=${encodeURIComponent(text)}`;
  return { text, intentUrl };
}

// ── Cooldown (one draft per SHARE_COOLDOWN_MIN; persisted in steward_state) ─────

/** Cooldown window in ms (default 30 minutes). */
function cooldownMs(): number {
  const min = Number(process.env.SHARE_COOLDOWN_MIN);
  return (Number.isFinite(min) && min > 0 ? min : 30) * 60 * 1000;
}

const SHARE_STATE_KEY = 'share_last_at';

/** In-process memo so two rapid calls in the same process short-circuit without a DB race. */
let lastSentAtMemo = 0;

/**
 * Claim the cooldown slot. Returns true if a draft MAY be sent now (and records
 * the timestamp), false if we are still within the cooldown window. Best-effort:
 * on a DB error it falls back to the in-process memo so it still rate-limits.
 */
export async function claimShareSlot(now: number = Date.now()): Promise<boolean> {
  const window = cooldownMs();
  // In-process guard first (covers the rapid-fire dogfood case deterministically).
  if (now - lastSentAtMemo < window) return false;

  try {
    const rows = await sql<{ value: string }[]>`
      select value::text as value from steward_state where key = ${SHARE_STATE_KEY}`;
    const last = rows[0]?.value ? Number(String(rows[0].value).replace(/"/g, '')) : 0;
    if (Number.isFinite(last) && last > 0 && now - last < window) {
      lastSentAtMemo = last;
      return false;
    }
    const value = JSON.stringify(now);
    await sql`
      insert into steward_state (key, value, updated_at)
      values (${SHARE_STATE_KEY}, ${value}::jsonb, now())
      on conflict (key) do update set value = ${value}::jsonb, updated_at = now()`;
    lastSentAtMemo = now;
    return true;
  } catch (err) {
    // DB hiccup: fall back to the in-process memo so we never spam, never throw.
    console.error('[steward:share] cooldown DB read/write failed — using in-process memo:', err instanceof Error ? err.message : err);
    lastSentAtMemo = now;
    return true;
  }
}

/** Test/diagnostic helper — reset the in-process cooldown memo. */
export function resetShareMemo(): void {
  lastSentAtMemo = 0;
}

/** Deep link to the incident/ledger for the "View" button. */
export function shareViewUrl(ctx: ShareContext): string {
  return ctx.incidentId ? `${CONSOLE_URL}/steward/incidents/${ctx.incidentId}` : `${CONSOLE_URL}/steward`;
}
