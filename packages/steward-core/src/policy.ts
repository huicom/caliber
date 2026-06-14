// Compiled-policy schema + deterministic evaluator (Steward Phase 1, task 13).
//
// A mandate is plain English ("spend at most $0.005 per payment, $0.50 per
// day, anything over $0.002 needs my approval"). A *compiled policy* is the
// machine form the pipeline actually enforces — a small JSON document the LLM
// mandate-compiler will emit (later task). This file owns ONLY the deterministic
// half: the zod schema, a hand-written DEFAULT_POLICY, and a pure
// `evaluatePolicy()` that turns (quote, context, policy) into an allow/hold/deny
// verdict. No DB, no Express, no LLM — same purity contract as the detectors.
//
// USDC amounts are decimal strings throughout (e.g. "0.005"), matching the
// numeric(18,6) columns and the x402 quote's microsToUsdc rendering. We compare
// in integer micro-units (parsed once) so there's no float drift on the hot path.

import { z } from 'zod';

// ── schema ──────────────────────────────────────────────────────────────────

/** A non-negative USDC decimal string, e.g. "0", "0.005", "0.50". */
const usdcString = z
  .string()
  .regex(/^\d+(\.\d{1,6})?$/, 'expected a non-negative USDC decimal string (≤6 dp)');

/** A bare hostname, lowercased; used for allow/deny host lists (suffix match). */
const hostString = z.string().min(1).transform((h) => h.trim().toLowerCase());

export const CompiledPolicySchema = z
  .object({
    version: z.literal(1),
    caps: z.object({
      perTxUsdc: usdcString,
      dailyUsdc: usdcString,
      perCounterpartyDailyUsdc: usdcString.optional(),
    }),
    /** If present, ONLY these hosts may be paid (suffix match). */
    allowedHosts: z.array(hostString).optional(),
    /** Hosts that may never be paid (suffix match); takes precedence over allow. */
    deniedHosts: z.array(hostString).optional(),
    /** Quotes strictly above this hold for human approval (action 'hold'). */
    approvalThresholdUsdc: usdcString.optional(),
    /** What to do with a counterparty we've never paid before. */
    newCounterparty: z.enum(['allow', 'hold', 'sandbox']),
    /** When newCounterparty='sandbox', the per-tx cap applied to new ones. */
    sandboxCapUsdc: usdcString.optional(),
    /** Minimum Caliber score; enforced ONLY when a score is in context. */
    minCaliberScore: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export type CompiledPolicy = z.infer<typeof CompiledPolicySchema>;

/**
 * Parse + validate an unknown value (e.g. a `compiled_policy` jsonb blob) into a
 * CompiledPolicy. Throws a ZodError on a malformed policy — callers fail closed.
 */
export function parseCompiledPolicy(value: unknown): CompiledPolicy {
  return CompiledPolicySchema.parse(value);
}

/**
 * The fallback policy when no mandate row exists yet. Deliberately conservative
 * on amounts. `newCounterparty: 'hold'` means the FIRST payment to any host we've
 * never paid before parks for human approval (task 16) — once approved, the
 * counterparty is marked trusted+registered and subsequent payments flow.
 */
export const DEFAULT_POLICY: CompiledPolicy = {
  version: 1,
  caps: {
    perTxUsdc: '0.005',
    dailyUsdc: '0.50',
  },
  newCounterparty: 'hold',
};

// ── evaluator ─────────────────────────────────────────────────────────────────

/** The bits of a quote the policy inspects. */
export interface PolicyQuote {
  /** Bare host (no port) the quote came from. */
  host: string;
  /** What the seller wants paid on THIS quote, decimal USDC string. */
  payToUsdc: string;
}

/** Spend/identity context the caller assembles from the ledger + registry. */
export interface PolicyContext {
  /** USDC already settled today (UTC), decimal string. */
  todaySpentUsdc: string;
  /** USDC already settled today to THIS counterparty, decimal string. */
  counterpartyTodayUsdc?: string;
  /** True when no registered counterparty exists for this host yet. */
  isNewCounterparty: boolean;
  /** Caliber score for the counterparty, when one is available. */
  caliberScore?: number;
}

/** A clean pass. */
export interface PolicyOk {
  ok: true;
}

/** A refusal: which rule, human detail, and whether to deny or hold. */
export interface PolicyDenied {
  ok: false;
  /** Machine-readable rule id, e.g. 'per_tx_cap'. */
  rule: string;
  /** Human-readable explanation (goes into the ledger reasoning). */
  detail: string;
  /** 'deny' = refuse outright; 'hold' = park for human approval. */
  action: 'deny' | 'hold';
}

export type PolicyVerdict = PolicyOk | PolicyDenied;

/** Parse a USDC decimal string to integer micro-units (6 dp). */
function toMicros(usdc: string): bigint {
  const [whole, frac = ''] = usdc.split('.');
  const fracPadded = (frac + '000000').slice(0, 6);
  return BigInt(whole) * 1_000_000n + BigInt(fracPadded || '0');
}

/** Format integer micro-units back to a trimmed USDC decimal string. */
function fromMicros(micros: bigint): string {
  const whole = micros / 1_000_000n;
  const frac = micros % 1_000_000n;
  if (frac === 0n) return whole.toString();
  return `${whole}.${frac.toString().padStart(6, '0').replace(/0+$/, '')}`;
}

/**
 * Suffix host match: pattern "poko.blue" matches "poko.blue" and any
 * "*.poko.blue" (e.g. "api.poko.blue"), but NOT "evilpoko.blue". Case-folded.
 */
function hostMatches(host: string, pattern: string): boolean {
  const h = host.toLowerCase();
  const p = pattern.toLowerCase();
  return h === p || h.endsWith(`.${p}`);
}

/**
 * The deterministic spend gate. Evaluation order encodes precedence — the FIRST
 * rule that fires wins, so denials that should never be overridden are checked
 * before softer holds:
 *   1. deniedHosts        (deny — explicit block beats everything)
 *   2. allowedHosts       (deny — not on the allowlist)
 *   3. minCaliberScore    (deny — only when a score is present)
 *   4. per-tx cap         (deny — sandbox cap applies for new counterparties)
 *   5. per-counterparty daily cap (deny)
 *   6. daily cap          (deny)
 *   7. newCounterparty hold/sandbox-over-cap (hold)
 *   8. approval threshold (hold — the softest gate, checked last)
 * A clean pass returns { ok: true }.
 */
export function evaluatePolicy(
  quote: PolicyQuote,
  ctx: PolicyContext,
  policy: CompiledPolicy,
): PolicyVerdict {
  const host = quote.host.toLowerCase();
  const amount = toMicros(quote.payToUsdc);

  // 1. Explicit deny list — beats the allowlist and everything else.
  if (policy.deniedHosts?.some((p) => hostMatches(host, p))) {
    return {
      ok: false,
      rule: 'denied_host',
      detail: `host ${host} is on the deny list`,
      action: 'deny',
    };
  }

  // 2. Allowlist — if set, the host must match one entry.
  if (policy.allowedHosts && policy.allowedHosts.length > 0) {
    if (!policy.allowedHosts.some((p) => hostMatches(host, p))) {
      return {
        ok: false,
        rule: 'host_not_allowed',
        detail: `host ${host} is not on the allowed list (${policy.allowedHosts.join(', ')})`,
        action: 'deny',
      };
    }
  }

  // 3. Minimum Caliber score — only enforced when a rating is in context.
  if (policy.minCaliberScore !== undefined && ctx.caliberScore !== undefined) {
    if (ctx.caliberScore < policy.minCaliberScore) {
      return {
        ok: false,
        rule: 'min_caliber_score',
        detail: `counterparty Caliber score ${ctx.caliberScore} is below the required ${policy.minCaliberScore}`,
        action: 'deny',
      };
    }
  }

  // 4. Per-tx cap. For a new counterparty in sandbox mode, the sandbox cap (if
  //    set) is the binding per-tx limit instead of the standard one.
  const sandboxActive =
    ctx.isNewCounterparty &&
    policy.newCounterparty === 'sandbox' &&
    policy.sandboxCapUsdc !== undefined;
  const perTxCapStr = sandboxActive ? policy.sandboxCapUsdc! : policy.caps.perTxUsdc;
  const perTxCap = toMicros(perTxCapStr);
  if (amount > perTxCap) {
    return {
      ok: false,
      rule: sandboxActive ? 'sandbox_cap' : 'per_tx_cap',
      detail: sandboxActive
        ? `quote ${quote.payToUsdc} USDC exceeds the new-counterparty sandbox cap ${perTxCapStr} USDC`
        : `quote ${quote.payToUsdc} USDC exceeds the per-tx cap ${perTxCapStr} USDC`,
      action: 'deny',
    };
  }

  // 5. Per-counterparty daily cap (if configured).
  if (policy.caps.perCounterpartyDailyUsdc !== undefined) {
    const cpCap = toMicros(policy.caps.perCounterpartyDailyUsdc);
    const cpSpent = toMicros(ctx.counterpartyTodayUsdc ?? '0');
    if (cpSpent + amount > cpCap) {
      return {
        ok: false,
        rule: 'per_counterparty_daily_cap',
        detail: `this payment would bring today's spend to this counterparty to ${fromMicros(
          cpSpent + amount,
        )} USDC, over the per-counterparty daily cap ${policy.caps.perCounterpartyDailyUsdc} USDC`,
        action: 'deny',
      };
    }
  }

  // 6. Daily cap (total across all counterparties).
  {
    const dailyCap = toMicros(policy.caps.dailyUsdc);
    const spent = toMicros(ctx.todaySpentUsdc);
    if (spent + amount > dailyCap) {
      return {
        ok: false,
        rule: 'daily_cap',
        detail: `this payment would bring today's spend to ${fromMicros(
          spent + amount,
        )} USDC, over the daily cap ${policy.caps.dailyUsdc} USDC`,
        action: 'deny',
      };
    }
  }

  // 7. New-counterparty handling. 'allow' is a no-op (TOFU). 'hold' parks every
  //    new counterparty for approval. 'sandbox' already capped the amount above
  //    (rule 4) and otherwise allows.
  if (ctx.isNewCounterparty && policy.newCounterparty === 'hold') {
    return {
      ok: false,
      rule: 'new_counterparty',
      detail: `first payment to ${host} — held for approval (new-counterparty policy: hold)`,
      action: 'hold',
    };
  }

  // 8. Approval threshold — the softest gate, last so that any hard denial above
  //    short-circuits first. Strictly-above triggers a hold.
  if (policy.approvalThresholdUsdc !== undefined) {
    const threshold = toMicros(policy.approvalThresholdUsdc);
    if (amount > threshold) {
      return {
        ok: false,
        rule: 'approval_threshold',
        detail: `quote ${quote.payToUsdc} USDC is above the approval threshold ${policy.approvalThresholdUsdc} USDC — held for approval`,
        action: 'hold',
      };
    }
  }

  return { ok: true };
}
