// @caliber/steward-client — the 3-line integration.
//
//   const steward = createSteward({ baseUrl, apiKey });
//   const res = await steward.pay('https://seller/api/research', { method: 'POST' });
//
// Steward owns the checkbook: this client never signs anything. It POSTs the
// intent to the Steward service, which inspects the seller's x402 quote, decides
// allow/hold/deny, pays if allowed, and ledgers everything. A refused payment
// (HTTP 4xx with a decision body) throws a typed `StewardRefusal` carrying the
// decision/stage/reasoning so callers can branch without parsing strings.
//
// Near-zero runtime deps — `fetch` (Node 18+ / browsers) plus the workspace
// @caliber/steward-core for the EIP-712 spec helpers (build/sign a DeliverySpec).
// Steward still owns the checkbook; steward-core here is only used CLIENT-side so
// an integrator can build + sign the pre-agreed spec with THEIR own account.

import {
  buildDeliverySpec,
  signDeliverySpec,
  caliberDomain,
  type DeliverySpec,
  type DeliverySpecInput,
} from '@caliber/steward-core';
import type { Hex, LocalAccount } from 'viem';

/** A single Tier-0 conformance violation Steward found post-settle. */
export interface StewardConformanceViolation {
  rule: string;
  detail: string;
}

/** The verdict + (on allow) the settlement facts Steward returns. */
export interface StewardResult {
  /** Steward's request id for this intent (the ledger row key). */
  requestId: string;
  decision: 'allow' | 'hold' | 'deny';
  /** Pipeline stage that produced the verdict. */
  stage: string;
  reasoning: string;
  /** The inspected quote, when one was surfaced. */
  quote?: { payTo: string; amountUsdc: string };
  /** Settlement/batch reference, present on a settled allow. */
  txRef?: string;
  /** The seller's response body, on an allowed pay (the purchased goods). */
  data?: unknown;
  /** sha256 (hex) of the raw seller response body, on an allowed pay. */
  sha256?: string;
  /** Tier-0 conformance violations found post-settle (present only if non-empty). */
  conformance?: StewardConformanceViolation[];
}

/** Per-call request knobs forwarded to the seller via Steward. */
export interface StewardRequestInit {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
}

/**
 * Tier-0 delivery expectations Steward checks AFTER an allowed payment settles.
 * Omitted fields default sensibly (json from the response content-type, 1MB max,
 * okField when the body is JSON with an `ok` key).
 */
export interface StewardExpect {
  json?: boolean;
  maxBytes?: number;
  deadlineMs?: number;
  okField?: boolean;
}

/**
 * A buyer/seller-signed DeliverySpec (WS-1). Forwarded verbatim in the /v1/pay
 * body; Steward derives the Tier-0 conformance bounds FROM this signed,
 * pre-agreed spec instead of response defaults — making a breach disputable.
 * Bigint fields (validUntil/nonce) serialize to strings over the wire; Steward
 * coerces them back. The buyer signature is mandatory; the seller signature is
 * optional (a buyer-only spec is accepted but undisputable).
 */
export interface StewardSignedSpec {
  spec: DeliverySpec;
  buyerSig: Hex;
  sellerSig?: Hex;
}

/**
 * Per-call options for {@link StewardClient.pay}. Either run the legacy unsigned
 * Tier-0 `expect` checks, OR pass a `spec` for the signed-spec path (the bounds
 * then come from the pre-agreed spec). Passing both is allowed but `spec` wins —
 * Steward ignores `expect` when a spec governs the payment.
 */
export interface StewardPayOpts {
  expect?: StewardExpect;
  spec?: StewardSignedSpec;
}

export interface StewardClientConfig {
  /** Steward base URL, e.g. 'http://localhost:3300' or 'https://steward.poko.blue'. */
  baseUrl: string;
  /** Sent as `x-steward-key`. */
  apiKey: string;
  /**
   * Ledger source label for every payment from this client (e.g. 'hirebot').
   * Recorded on the steward_payments row so traction can be split by caller.
   * Defaults to Steward's own 'api' when omitted.
   */
  source?: string;
}

/** Thrown when Steward refuses (hold/deny) — carries the structured verdict. */
export class StewardRefusal extends Error {
  readonly decision: 'allow' | 'hold' | 'deny';
  readonly stage: string;
  readonly reasoning: string;
  readonly requestId?: string;
  readonly httpStatus: number;

  constructor(httpStatus: number, body: Partial<StewardResult>) {
    super(body.reasoning ?? `steward refused (${body.decision ?? 'deny'})`);
    this.name = 'StewardRefusal';
    this.httpStatus = httpStatus;
    this.decision = body.decision ?? 'deny';
    this.stage = body.stage ?? 'unknown';
    this.reasoning = body.reasoning ?? '';
    this.requestId = body.requestId;
  }
}

export interface StewardClient {
  /**
   * Ask Steward to pay an x402-gated URL on your behalf. Resolves with the
   * settlement facts (and the seller's `data`) on allow; throws
   * {@link StewardRefusal} on a 4xx decision (deny/hold/frozen). Other transport
   * failures throw a plain Error.
   *
   * The third argument is back-compatible:
   *   • pass a bare {@link StewardExpect} — legacy Tier-0 conformance checks; or
   *   • pass {@link StewardPayOpts} ({ expect?, spec? }) — the WS-1 signed-spec
   *     path, where the bounds come from a buyer/seller-signed DeliverySpec.
   */
  pay(
    url: string,
    init?: StewardRequestInit,
    opts?: StewardExpect | StewardPayOpts,
  ): Promise<StewardResult>;
}

/** Discriminate the legacy bare-`expect` arg from the new options object. */
function normalizeOpts(opts?: StewardExpect | StewardPayOpts): StewardPayOpts {
  if (!opts) return {};
  // A StewardPayOpts is the only shape carrying `spec`; an `expect` key alone is
  // ambiguous (StewardExpect has no `expect` key, so its presence means opts).
  if ('spec' in opts || 'expect' in opts) return opts as StewardPayOpts;
  return { expect: opts as StewardExpect };
}

/**
 * WS-1 convenience: build + sign a DeliverySpec with the integrator's OWN
 * account (Steward never signs the spec — only the buyer/seller do). Pass the
 * resulting {spec, buyerSig} (and optionally a sellerSig) as `opts.spec` to
 * {@link StewardClient.pay}. `chain` defaults to 'arc'; spec signing is off-chain
 * so the EIP-712 domain's verifyingContract stays the zero-address default.
 */
export async function signSpec(
  input: DeliverySpecInput,
  account: LocalAccount,
  chain: string = 'arc',
): Promise<{ spec: DeliverySpec; sig: Hex }> {
  const spec = buildDeliverySpec(input);
  const sig = await signDeliverySpec(spec, account, caliberDomain(chain));
  return { spec, sig };
}

// Re-export the underlying EIP-712 helpers so an integrator can build/sign/hash
// specs without depending on @caliber/steward-core directly.
export {
  buildDeliverySpec,
  signDeliverySpec,
  caliberDomain,
  sellerUrlHash,
  schemaHashFromExpect,
  type DeliverySpec,
  type DeliverySpecInput,
} from '@caliber/steward-core';

/** Serialize a signed spec for the JSON body (bigint fields → strings). */
function specToBody(s: StewardSignedSpec): Record<string, unknown> {
  return {
    spec: {
      ...s.spec,
      validUntil: s.spec.validUntil.toString(),
      nonce: s.spec.nonce.toString(),
    },
    buyerSig: s.buyerSig,
    ...(s.sellerSig ? { sellerSig: s.sellerSig } : {}),
  };
}

export function createSteward(config: StewardClientConfig): StewardClient {
  const base = config.baseUrl.replace(/\/+$/, '');
  return {
    async pay(
      url: string,
      init?: StewardRequestInit,
      opts?: StewardExpect | StewardPayOpts,
    ): Promise<StewardResult> {
      const { expect, spec } = normalizeOpts(opts);
      const res = await fetch(`${base}/v1/pay`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-steward-key': config.apiKey },
        body: JSON.stringify({
          url,
          init,
          ...(expect ? { expect } : {}),
          ...(spec ? { spec: specToBody(spec) } : {}),
          ...(config.source ? { source: config.source } : {}),
        }),
      });

      let body: Partial<StewardResult> & { error?: string; message?: string };
      try {
        body = (await res.json()) as typeof body;
      } catch {
        throw new Error(`steward returned a non-JSON ${res.status} response`);
      }

      // 401/400 (auth / bad request) aren't payment decisions — surface plainly.
      if (res.status === 401 || res.status === 400) {
        throw new Error(`steward ${res.status}: ${body.message ?? body.error ?? 'request rejected'}`);
      }

      // Any non-ALLOW verdict is a refusal the caller must handle, REGARDLESS of
      // HTTP status: a HOLD returns 202 (res.ok true) yet is not a completed
      // payment — it's parked for human approval. deny/frozen come back 4xx.
      // Throwing on `decision !== 'allow'` means a successful resolve always
      // carries settled goods (`data`), and StewardRefusal always means "not now".
      if (!res.ok || body.decision !== 'allow') {
        throw new StewardRefusal(res.status, body);
      }

      return body as StewardResult;
    },
  };
}
