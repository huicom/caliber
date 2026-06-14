// Caliber Metered — Node buyer client (Lepton Phase 0 P0.1; generalized for Steward).
//
// The seller side already runs in production: `rating/src/x402.ts` wraps Circle
// Gateway's batched-settlement middleware and gates POST /v1/agents/:chain/:id/
// attest. What the repo lacked was a Node *paying client*. This wraps Circle's
// `GatewayClient` (from @circle-fin/x402-batching/client) — the matching buyer
// half of the same SDK — into one Caliber-shaped helper so HireBot, the Broker,
// and the /metered try-it button all pay through identical, audited code.
//
// ── Two layers ────────────────────────────────────────────────────────────────
//
// 1. `GatewayClient.pay()` (used by the original `payForAttestation`) runs the
//    entire 402 flow internally — request → parse Circle batching option → sign
//    EIP-3009 → retry → return settled response. It is ATOMIC: there is no
//    pre-sign hook and it never echoes the quoted `payTo`. Fine when the buyer
//    fully trusts the seller.
//
// 2. `probe()` / `pay()` (added for the Steward payment-authorization proxy)
//    decompose that flow so an authorizer can inspect the seller's 402 quote —
//    recipient `payTo` + amount — and ABORT *before* anything is signed. We
//    compose from primitives (decode the PAYMENT-REQUIRED header, select the
//    batching option, sign via `BatchEvmScheme`, build the `payment-signature`
//    header exactly as `GatewayClient.pay()` does internally, retry, decode the
//    PAYMENT-RESPONSE header) rather than calling `pay()`, because `pay()` offers
//    no seam between "I learned the price" and "I signed for it".
//
// We never hand-roll EIP-3009 here — `BatchEvmScheme` owns the signature, the
// same scheme `GatewayClient` registers internally.

import {
  GatewayClient,
  BatchEvmScheme,
  type SupportedChainName,
  type Balances,
  type DepositResult,
} from '@circle-fin/x402-batching/client';
import { supportsBatching, getVerifyingContract } from '@circle-fin/x402-batching';
import {
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
} from '@x402/core/http';
import type { Hex } from 'viem';

/** Public Caliber Metered API. HireBot et al. must hit this like a stranger. */
export const DEFAULT_API_BASE = 'https://caliber-api.poko.blue';

/** Caliber's chain-path segment (the rating API uses `arc`, not `arcTestnet`). */
export const DEFAULT_CHAIN_PATH = 'arc';

/** Circle Gateway chain key for Arc Testnet (domain 26 in CHAIN_CONFIGS). */
export const DEFAULT_GATEWAY_CHAIN: SupportedChainName = 'arcTestnet';

/**
 * One Circle batching payment requirement, as it appears in a 402's `accepts[]`.
 * Mirrors `@x402/core`'s `PaymentRequirements` for the subset we read, kept as a
 * local interface so callers don't take a hard `@x402/core` type dependency.
 */
export interface PaymentOption {
  scheme: string;
  network: string;
  asset: string;
  /** USDC amount in atomic (6-decimal) units, as a decimal string. */
  amount: string;
  payTo: string;
  maxTimeoutSeconds: number;
  /** Circle batching marker: `{ name, version, verifyingContract }`. */
  extra: Record<string, unknown>;
}

/**
 * A seller's x402 quote, surfaced for inspection BEFORE any signature is made.
 * This is the safety boundary: an authorizer (Steward) sees exactly who would be
 * paid and how much, and may throw to abort before the EIP-3009 authorization is
 * signed.
 */
export interface X402Quote {
  /** Recipient address the seller wants paid (the thing to authorize against). */
  payTo: string;
  /** Amount in atomic USDC units (6 decimals). e.g. 1000n === 0.001 USDC. */
  amountMicros: bigint;
  /** Settlement asset (USDC contract) address. */
  asset: string;
  /** CAIP-2 network id, e.g. `eip155:5042002`. */
  network: string;
  /** x402 protocol version the seller advertised. */
  x402Version: number;
  /** Resource identifier echoed back on the paid retry (per the SDK convention). */
  resource: unknown;
  /** The selected batching requirement — what gets signed if the pay proceeds. */
  option: PaymentOption;
}

/** Result of a `pay()` call — settled (or free) HTTP response plus payment facts. */
export interface PaidResult<T> {
  /** HTTP status of the (post-payment) response. */
  status: number;
  /** Parsed JSON body. */
  data: T;
  /** Amount actually authorized, atomic USDC units (`0n` for a free endpoint). */
  amountMicros: bigint;
  /** Recipient that was authorized (undefined for a free endpoint). */
  payTo?: string;
  /** Settlement/batch transaction reference, when the seller echoed one. */
  txRef?: string;
  /** Payer address reported by the facilitator, when present. */
  payer?: string;
  /** True once a payment was signed, retried, and the server accepted it. */
  settled: boolean;
  /**
   * The facilitator's `success` flag decoded from the PAYMENT-RESPONSE header,
   * when present. A `settled` true paired with `settleSuccess === false` (or a
   * missing txRef) is a post-settle MISMATCH the authorizer must flag — the
   * server accepted the retry but the facilitator did not confirm settlement.
   * `undefined` when the seller echoed no/garbled settle header.
   */
  settleSuccess?: boolean;
  /**
   * Raw (post-payment) response body text, surfaced so an authorizer can hash it
   * (delivery-conformance) without re-reading the consumed stream. Present on
   * paid + free responses; undefined only on a free endpoint when the body was
   * unreadable.
   */
  rawBody?: string;
  /** Response Content-Type header value (verbatim), for conformance checks. */
  contentType?: string;
}

/** Optional per-call hooks for `pay()`. */
export interface PayOptions {
  /**
   * Inspect the seller's quote BEFORE signing. Throwing aborts the payment with
   * no signature made — the throw propagates to the `pay()` caller. This is the
   * Steward authorization seam.
   */
  preSign?: (quote: X402Quote) => Promise<void> | void;
}

/** Per-request fetch knobs accepted by `probe()` / `pay()`. */
export interface RequestInitLite {
  method?: string;
  /** Request body. Objects are JSON-serialized with a JSON content-type. */
  body?: unknown;
  /** Extra request headers. */
  headers?: Record<string, string>;
}

/** Thrown when a route returns 402 but exposes no Circle-batching option we can pay. */
export class NoBatchingOptionError extends Error {
  constructor(
    message: string,
    /** CAIP-2 network we looked for a batching option on. */
    public readonly network: string,
  ) {
    super(message);
    this.name = 'NoBatchingOptionError';
  }
}

/** Thrown when the 402 response is structurally unusable (no header / no accepts). */
export class Malformed402Error extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Malformed402Error';
  }
}

/** Thrown when the server rejects a signed payment on the retry. */
export class PaymentRejectedError extends Error {
  constructor(
    message: string,
    /** Server-reported reason, if any. */
    public readonly reason?: string,
  ) {
    super(message);
    this.name = 'PaymentRejectedError';
  }
}

export interface CaliberPayerConfig {
  /** Buyer wallet private key (e.g. HIREBOT_PRIVATE_KEY / BROKER_PRIVATE_KEY). */
  privateKey: Hex;
  /** Metered API base URL. Defaults to the public production host. */
  apiBase?: string;
  /** Circle Gateway chain. Defaults to arcTestnet. */
  chain?: SupportedChainName;
  /** Optional custom RPC URL (else the SDK's default for the chain). */
  rpcUrl?: string;
}

/** Optional knobs for an attestation purchase — mirror the attest body schema. */
export interface AttestationRequest {
  minTier?: 'Gold' | 'Silver' | 'Bronze' | 'Pending' | 'Watch' | 'Dormant';
  minConfidence?: 'high' | 'moderate' | 'low' | 'insufficient';
  validForSeconds?: number;
}

/** Shape returned by the rating service's attest route (subset we rely on). */
export interface AttestationBody {
  attestation?: Record<string, unknown>;
  signature?: string;
  validUntil?: number;
  methodologyVersion?: string;
  tier?: string;
  score?: number;
  confidence?: string;
  flags?: string[];
  // 4xx bodies carry { rated, reason, detail } instead.
  rated?: boolean;
  reason?: string;
  detail?: string;
}

export interface PaidAttestation {
  /** HTTP status from the (post-payment) attest response. */
  status: number;
  /** Parsed JSON body from the rating service. */
  data: AttestationBody;
  /** Settlement info from the Gateway buyer flow. */
  payment: {
    /** USDC paid, atomic units. */
    amount: bigint;
    /** Human-formatted USDC amount, e.g. "0.001". */
    amountUsdc: string;
    /** Settlement/batch transaction reference — the ledger's unique key. */
    transaction: string;
  };
}

/** Format atomic USDC (6 decimals) as a plain decimal string, e.g. "0.001". */
function formatMicrosUsdc(micros: bigint): string {
  const denom = BigInt(1_000_000);
  const whole = micros / denom;
  const frac = micros % denom;
  if (frac === BigInt(0)) return whole.toString();
  const fracStr = frac.toString().padStart(6, '0').replace(/0+$/, '');
  return `${whole.toString()}.${fracStr}`;
}

/** Build the fetch init the SDK-compatible way: JSON-serialize object bodies. */
function buildFetchInit(init: RequestInitLite | undefined): {
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
} {
  const method = init?.method ?? (init?.body !== undefined ? 'POST' : 'GET');
  const headers: Record<string, string> = { ...(init?.headers ?? {}) };
  let body: string | undefined;
  if (init?.body !== undefined) {
    if (typeof init.body === 'string') {
      body = init.body;
    } else {
      body = JSON.stringify(init.body);
      // Match GatewayClient.pay(): it sets a single canonical Content-Type. We
      // only set it if the caller hasn't, to avoid the duplicate-header trap
      // documented in payForAttestation below.
      const hasCT = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
      if (!hasCT) headers['Content-Type'] = 'application/json';
    }
  }
  return { method, headers, body };
}

/**
 * One buyer wallet against one Caliber Metered host. Construct once, reuse for
 * many `payForAttestation` / `pay` / `probe` calls (each is an independent
 * nanopayment).
 */
export class CaliberPayer {
  readonly gateway: GatewayClient;
  readonly apiBase: string;
  readonly chainPath: string;

  constructor(config: CaliberPayerConfig) {
    this.gateway = new GatewayClient({
      chain: config.chain ?? DEFAULT_GATEWAY_CHAIN,
      privateKey: config.privateKey,
      rpcUrl: config.rpcUrl,
    });
    this.apiBase = (config.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, '');
    this.chainPath = DEFAULT_CHAIN_PATH;
  }

  /** Buyer wallet address (0x…). */
  get address(): string {
    return this.gateway.address;
  }

  /** CAIP-2 network id this payer signs for, derived from the SDK chain config. */
  get network(): string {
    return `eip155:${this.gateway.chainConfig.chain.id}`;
  }

  /** Wallet + Gateway USDC balances in one call. */
  getBalances(): Promise<Balances> {
    return this.gateway.getBalances();
  }

  /**
   * Move USDC into the Gateway Balance so subsequent pays settle gaslessly.
   * One-time setup per wallet (top up as the balance drains).
   * @param amount decimal USDC string, e.g. "5".
   */
  deposit(amount: string): Promise<DepositResult> {
    return this.gateway.deposit(amount);
  }

  /**
   * Decode a 402's PAYMENT-REQUIRED header and select the Circle batching option
   * for this payer's chain. Shared by `probe()` and `pay()` so the quote that is
   * inspected is exactly the requirement that gets signed.
   */
  private selectOption(headerValue: string): {
    quote: X402Quote;
  } {
    let decoded: { x402Version: number; resource: unknown; accepts?: PaymentOption[] };
    try {
      decoded = decodePaymentRequiredHeader(headerValue) as unknown as {
        x402Version: number;
        resource: unknown;
        accepts?: PaymentOption[];
      };
    } catch {
      throw new Malformed402Error('failed to decode PAYMENT-REQUIRED header');
    }
    const accepts = decoded.accepts;
    if (!accepts || accepts.length === 0) {
      throw new Malformed402Error('402 response carried no payment options');
    }
    const net = this.network;
    const option = accepts.find(
      (opt) => opt.network === net && supportsBatching(opt),
    );
    if (!option) {
      throw new NoBatchingOptionError(
        `no Circle batching option for network ${net} ` +
          `(seller may not support ${this.gateway.getChainName()})`,
        net,
      );
    }
    // Touch verifyingContract so a malformed batching marker fails here, not deep
    // inside the signer. (getVerifyingContract returns undefined if absent.)
    void getVerifyingContract(option);
    return {
      quote: {
        payTo: option.payTo,
        amountMicros: BigInt(option.amount),
        asset: option.asset,
        network: option.network,
        x402Version: decoded.x402Version ?? 2,
        resource: decoded.resource,
        option,
      },
    };
  }

  /**
   * Inspect what an x402-gated URL would charge, WITHOUT paying. Issues the real
   * request (method + body matter — pricing may depend on them) and:
   *   • returns `null` if the endpoint is free (any non-402 response);
   *   • returns the parsed {@link X402Quote} if it answered 402;
   *   • throws {@link NoBatchingOptionError} / {@link Malformed402Error} if it
   *     answered 402 but exposed nothing this payer can settle.
   *
   * This is a SEPARATE round-trip from `pay()` — use it for read-only price
   * discovery. For an authorize-then-pay flow that signs the very requirement it
   * inspected, use `pay({ preSign })`, which probes and pays in one round-trip.
   */
  async probe(url: string, init?: RequestInitLite): Promise<X402Quote | null> {
    const { method, headers, body } = buildFetchInit(init);
    const res = await fetch(url, { method, headers, body });
    if (res.status !== 402) return null;
    const headerValue = res.headers.get('payment-required');
    if (!headerValue) {
      throw new Malformed402Error('402 response missing PAYMENT-REQUIRED header');
    }
    return this.selectOption(headerValue).quote;
  }

  /**
   * Pay an x402-gated URL and return its (settled) response. A SINGLE round-trip
   * underlies this: one fetch surfaces the 402, `preSign` (if given) inspects the
   * exact requirement, then that same requirement is signed and retried — there
   * is no second probe, so the quote inspected IS the quote paid.
   *
   * Free endpoints (any non-402, ok response) return immediately with
   * `amountMicros: 0n` and `settled: false`.
   *
   * Throws (propagating any `preSign` throw) BEFORE signing on abort, and
   * {@link PaymentRejectedError} if the server rejects the signed retry.
   */
  async pay<T = unknown>(
    url: string,
    init?: RequestInitLite,
    opts?: PayOptions,
  ): Promise<PaidResult<T>> {
    const { method, headers, body } = buildFetchInit(init);
    const first = await fetch(url, { method, headers, body });

    if (first.status !== 402) {
      if (!first.ok) {
        const text = await first.text().catch(() => '');
        throw new PaymentRejectedError(
          `request failed with status ${first.status}${text ? `: ${text}` : ''}`,
        );
      }
      const rawBody = await first.text().catch(() => '');
      let data: T;
      try {
        data = (rawBody ? JSON.parse(rawBody) : {}) as T;
      } catch {
        data = {} as T;
      }
      return {
        status: first.status,
        data,
        amountMicros: BigInt(0),
        settled: false,
        rawBody,
        contentType: first.headers.get('content-type') ?? undefined,
      };
    }

    const headerValue = first.headers.get('payment-required');
    if (!headerValue) {
      throw new Malformed402Error('402 response missing PAYMENT-REQUIRED header');
    }
    const { quote } = this.selectOption(headerValue);

    // Safety boundary: inspect the quote before anything is signed. A throw here
    // aborts with zero on-chain/off-chain commitment — propagate it untouched.
    if (opts?.preSign) await opts.preSign(quote);

    // Sign the EIP-3009 authorization for the SELECTED requirement. The viem
    // account loaded by GatewayClient already satisfies BatchEvmSigner
    // ({ address, signTypedData }); reuse it — this is the same scheme the SDK's
    // own pay() drives internally.
    const scheme = new BatchEvmScheme(this.gateway.account);
    const payload = await scheme.createPaymentPayload(
      quote.x402Version,
      quote.option as unknown as Parameters<typeof scheme.createPaymentPayload>[1],
    );

    // Build the retry header EXACTLY as GatewayClient.pay() does internally:
    // base64( JSON.stringify({ ...paymentPayload, resource, accepted: option }) )
    // sent as `payment-signature`. encodePaymentSignatureHeader alone is NOT
    // enough — Circle's createGatewayMiddleware reads resource + accepted off
    // this header (dist/client/index.mjs ~L901-907).
    const paymentHeader = Buffer.from(
      JSON.stringify({ ...payload, resource: quote.resource, accepted: quote.option }),
    ).toString('base64');

    const retryHeaders: Record<string, string> = { ...headers, 'Payment-Signature': paymentHeader };
    const paid = await fetch(url, { method, headers: retryHeaders, body });

    if (!paid.ok) {
      const err = (await paid.json().catch(() => ({}))) as { error?: string };
      throw new PaymentRejectedError(
        `payment failed: ${err.error ?? paid.statusText}`,
        err.error,
      );
    }

    // Read the body once as text so an authorizer can hash the exact bytes
    // (delivery conformance) without re-consuming the stream; parse JSON from it.
    const rawBody = await paid.text().catch(() => '');
    let data: T;
    try {
      data = (rawBody ? JSON.parse(rawBody) : {}) as T;
    } catch {
      data = {} as T;
    }

    // PAYMENT-RESPONSE echoes settlement facts: { success, transaction, network,
    // payer } — no amount/payTo (pre-sign inspection was the safety boundary).
    let txRef: string | undefined;
    let payer: string | undefined;
    let settleSuccess: boolean | undefined;
    const respHeader = paid.headers.get('payment-response');
    if (respHeader) {
      try {
        const settle = decodePaymentResponseHeader(respHeader) as {
          success?: boolean;
          transaction?: string;
          payer?: string;
        };
        txRef = settle.transaction || undefined;
        payer = settle.payer || undefined;
        settleSuccess = typeof settle.success === 'boolean' ? settle.success : undefined;
      } catch {
        // A missing/garbled settle header doesn't undo an accepted payment.
      }
    }

    return {
      status: paid.status,
      data,
      amountMicros: quote.amountMicros,
      payTo: quote.payTo,
      txRef,
      payer,
      settled: true,
      settleSuccess,
      rawBody,
      contentType: paid.headers.get('content-type') ?? undefined,
    };
  }

  /**
   * Pay the metered price and receive a signed Caliber attestation for one
   * agent. Runs the full x402 nanopayment flow; throws on transport/payment
   * failure. A non-2xx attest response (e.g. 422 unrated) still resolves —
   * inspect `.status` / `.data.reason`.
   *
   * Implemented on top of `pay()` (the generalized buyer path) so HireBot, the
   * Broker, and the try-it button all settle through one audited code path. The
   * public signature and return shape are unchanged.
   */
  async payForAttestation(
    agentId: bigint | number | string,
    req: AttestationRequest = {},
  ): Promise<PaidAttestation> {
    const url = `${this.apiBase}/v1/agents/${this.chainPath}/${agentId}/attest`;
    // NOTE: do NOT set a Content-Type header here. buildFetchInit() sets a single
    // canonical `Content-Type: application/json`; adding a second lowercase
    // `content-type` would produce two object keys that fetch joins into
    // "application/json, application/json", which express's type-is rejects —
    // express.json() then skips parsing and the attest route sees req.body
    // undefined → 400 invalid_body. Let the client own the header.
    const res = await this.pay<AttestationBody>(url, { method: 'POST', body: req });
    return {
      status: res.status,
      data: res.data,
      payment: {
        amount: res.amountMicros,
        amountUsdc: formatMicrosUsdc(res.amountMicros),
        transaction: res.txRef ?? '',
      },
    };
  }
}

/** Convenience factory mirroring the SDK's ergonomics. */
export function createCaliberPayer(config: CaliberPayerConfig): CaliberPayer {
  return new CaliberPayer(config);
}

export type { SupportedChainName, Balances, DepositResult };
