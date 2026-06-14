// Redirect detector (Steward Phase 1, task 10).
//
// The cheapest, highest-signal payment attack: a seller answers the 402 quoting
// a payTo that differs from the recipient this host has been paid at before. A
// genuine seller does not silently swap its receiving address mid-relationship;
// a compromised or rogue one does. This detector fires only when we ALREADY have
// a registered counterparty for the host (trust-on-first-use means the first
// payment to a host can't redirect — there's nothing to redirect from yet).
//
// Pure function: no DB, no network. The caller supplies the registered row (or
// null) it loaded for the host; we just compare addresses, case-insensitively
// (EVM addresses are case-insensitive; only EIP-55 checksums vary by case).

/** The bits of a quote this detector inspects. */
export interface RedirectQuote {
  /** Recipient the seller wants paid on THIS quote. */
  payTo: string;
  /** Host the quote came from (used only for evidence/logging by the caller). */
  host: string;
}

/** The registered counterparty for the host, if one exists. */
export interface RegisteredCounterparty {
  /** The recipient we have on record for this host. */
  payTo: string;
}

/** Structured result: `hit` plus the addresses that disagreed (when hit). */
export interface RedirectResult {
  hit: boolean;
  /** The recipient on record (lowercased) — present only on a hit. */
  expected?: string;
  /** The recipient this quote diverts to (lowercased) — present only on a hit. */
  got?: string;
}

/**
 * Fire when a registered counterparty exists for the host and the quote's payTo
 * differs from it (case-insensitive). No registered row → no hit (first-use).
 */
export function checkRedirect(
  quote: RedirectQuote,
  registered: RegisteredCounterparty | null,
): RedirectResult {
  if (!registered) return { hit: false };
  const expected = registered.payTo.toLowerCase();
  const got = quote.payTo.toLowerCase();
  if (expected === got) return { hit: false };
  return { hit: true, expected, got };
}
