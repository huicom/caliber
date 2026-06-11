// Caliber Metered — Node buyer client (Lepton Phase 0 P0.1).
//
// The seller side already runs in production: `rating/src/x402.ts` wraps Circle
// Gateway's batched-settlement middleware and gates POST /v1/agents/:chain/:id/
// attest. What the repo lacked was a Node *paying client*. This wraps Circle's
// `GatewayClient` (from @circle-fin/x402-batching/client) — the matching buyer
// half of the same SDK — into one Caliber-shaped helper so HireBot, the Broker,
// and the /metered try-it button all pay through identical, audited code.
//
// `GatewayClient.pay()` runs the entire 402 flow internally: initial request →
// parse Circle batching option from the 402 → sign EIP-3009 against the Gateway
// Wallet (gasless) → retry with the payment header → return settled response.
// We never hand-roll EIP-3009 here.

import {
  GatewayClient,
  type SupportedChainName,
  type Balances,
  type DepositResult,
} from '@circle-fin/x402-batching/client';
import type { Hex } from 'viem';

/** Public Caliber Metered API. HireBot et al. must hit this like a stranger. */
export const DEFAULT_API_BASE = 'https://caliber-api.poko.blue';

/** Caliber's chain-path segment (the rating API uses `arc`, not `arcTestnet`). */
export const DEFAULT_CHAIN_PATH = 'arc';

/** Circle Gateway chain key for Arc Testnet (domain 26 in CHAIN_CONFIGS). */
export const DEFAULT_GATEWAY_CHAIN: SupportedChainName = 'arcTestnet';

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

/**
 * One buyer wallet against one Caliber Metered host. Construct once, reuse for
 * many `payForAttestation` calls (each is an independent nanopayment).
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
   * Pay the metered price and receive a signed Caliber attestation for one
   * agent. Runs the full x402 nanopayment flow; throws on transport/payment
   * failure. A non-2xx attest response (e.g. 422 unrated) still resolves —
   * inspect `.status` / `.data.reason`.
   */
  async payForAttestation(
    agentId: bigint | number | string,
    req: AttestationRequest = {},
  ): Promise<PaidAttestation> {
    const url = `${this.apiBase}/v1/agents/${this.chainPath}/${agentId}/attest`;
    // NOTE: do NOT set a Content-Type header here. GatewayClient.pay() already
    // sets `Content-Type: application/json`; adding a lowercase `content-type`
    // produces two distinct object keys that fetch joins into
    // "application/json, application/json", which express's type-is rejects —
    // express.json() then skips parsing and the attest route sees req.body
    // undefined → 400 invalid_body. Let the SDK own the header.
    const res = await this.gateway.pay<AttestationBody>(url, {
      method: 'POST',
      body: req,
    });
    return {
      status: res.status,
      data: res.data,
      payment: {
        amount: res.amount,
        amountUsdc: res.formattedAmount,
        transaction: res.transaction,
      },
    };
  }
}

/** Convenience factory mirroring the SDK's ergonomics. */
export function createCaliberPayer(config: CaliberPayerConfig): CaliberPayer {
  return new CaliberPayer(config);
}

export type { SupportedChainName, Balances, DepositResult };
