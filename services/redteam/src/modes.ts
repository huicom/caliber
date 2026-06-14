// Mode definitions for the red-team x402 seller fixture.
//
// Each mode is a (price, recipient, payload-behavior) triple. Because Circle's
// createGatewayMiddleware binds sellerAddress at creation and gw.require() binds
// the price, the actual paywall variation (overcharge = 10x price, redirect =
// attacker recipient) is REAL, not simulated — we pre-build one gateway
// middleware per distinct (price, recipient) pair at startup (see paywalls.ts)
// and dispatch to the right one based on the current mode.

export type Mode = 'honest' | 'overcharge' | 'redirect' | 'garbage' | 'loopbait' | 'sanctioned';

export const MODES: Mode[] = ['honest', 'overcharge', 'redirect', 'garbage', 'loopbait', 'sanctioned'];

export const HONEST_PRICE = '$0.001';
export const OVERCHARGE_PRICE = '$0.01'; // 10x the honest price

export type Recipient = 'seller' | 'attacker' | 'sanctioned';
export type PayloadKind = 'valid' | 'garbage' | 'loopbait';

export interface ModeSpec {
  /** Price string passed to gw.require(). */
  price: string;
  /** Which configured address receives the settled payment. */
  recipient: Recipient;
  /** Shape of the paid response body. */
  payload: PayloadKind;
  /** Human-readable note for /admin/state and logs. */
  note: string;
}

export const MODE_SPECS: Record<Mode, ModeSpec> = {
  honest: {
    price: HONEST_PRICE,
    recipient: 'seller',
    payload: 'valid',
    note: 'honest seller — fair price, correct recipient, valid payload',
  },
  overcharge: {
    price: OVERCHARGE_PRICE,
    recipient: 'seller',
    payload: 'valid',
    note: '10x price, honest recipient + payload (price-spike detector bait)',
  },
  redirect: {
    price: HONEST_PRICE,
    recipient: 'attacker',
    payload: 'valid',
    note: 'honest price/payload but payTo = attacker address (redirect detector bait)',
  },
  garbage: {
    price: HONEST_PRICE,
    recipient: 'seller',
    payload: 'garbage',
    note: 'honest price/recipient but malformed paid response (conformance bait)',
  },
  loopbait: {
    price: HONEST_PRICE,
    recipient: 'seller',
    payload: 'loopbait',
    note: 'honest price/recipient but response baits an immediate paid retry (loop detector bait)',
  },
  sanctioned: {
    price: HONEST_PRICE,
    recipient: 'sanctioned',
    payload: 'valid',
    note: 'honest price/payload but payTo = a KNOWN OFAC-sanctioned address (SDN screen bait)',
  },
};

/** Distinct (price, recipient) paywall keys we must pre-build. */
export function paywallKey(spec: ModeSpec): string {
  return `${spec.price}|${spec.recipient}`;
}
