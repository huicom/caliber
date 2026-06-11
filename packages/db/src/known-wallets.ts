// Lepton honest-traction classifier (Guardrail 4).
//
// Every metered_payments row records a `payer_class` so all public metrics can
// be reported split by class — we never present self-generated volume as
// external users. This module is the single source of truth for that mapping,
// importable by both the rating service (ledger insert) and web (metrics).
//
// Classes:
//   internal — our own infrastructure: the x402 seller wallet, the test funder,
//              and any server-to-server bypass call (amount 0, never revenue).
//   demo     — wallets we control that DO pay through the real x402 path:
//              HireBot, the Broker, PokoBlue test wallets, the try-it button.
//   external — anyone else. The only class that counts as genuine outside use.
//
// Addresses are supplied via env (comma-separated, case-insensitive):
//   LEPTON_INTERNAL_WALLETS  — extra internal addresses
//   LEPTON_DEMO_WALLETS      — HireBot, Broker, test, try-it addresses
// The x402 seller (X402_SELLER_ADDRESS) is always treated as internal.
//
// Kept dependency-free (pure string handling) so @arc-agents/db stays light.

export const PAYER_CLASSES = ['external', 'demo', 'internal'] as const;
export type PayerClass = (typeof PAYER_CLASSES)[number];

function parseList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s) => s.length > 0);
}

function internalSet(): Set<string> {
  const set = new Set(parseList(process.env.LEPTON_INTERNAL_WALLETS));
  const seller = process.env.X402_SELLER_ADDRESS?.trim().toLowerCase();
  if (seller) set.add(seller);
  return set;
}

function demoSet(): Set<string> {
  return new Set(parseList(process.env.LEPTON_DEMO_WALLETS));
}

export interface ClassifyOptions {
  /** True for server-to-server bypass-token calls — always `internal`. */
  bypass?: boolean;
}

/**
 * Resolve the payer_class for a metered request. Env is read lazily on each
 * call so a wallet list change takes effect without a service restart.
 */
export function classifyPayer(
  address: string | null | undefined,
  opts: ClassifyOptions = {},
): PayerClass {
  if (opts.bypass) return 'internal';
  const addr = address?.trim().toLowerCase();
  if (!addr) return 'external';
  if (internalSet().has(addr)) return 'internal';
  if (demoSet().has(addr)) return 'demo';
  return 'external';
}

/** True when a class represents genuine outside use (the honest-traction number). */
export function isExternal(cls: PayerClass): boolean {
  return cls === 'external';
}
