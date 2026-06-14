// Pre-built x402 paywall middlewares, one per distinct (price, recipient) pair.
//
// Circle's createGatewayMiddleware binds the recipient (sellerAddress) at
// creation; gw.require(price) binds the price. Neither is per-request
// configurable, so we enumerate every (price, recipient) combination the modes
// need and build a require()-middleware for each at startup. A tiny dispatch
// wrapper (server.ts) then picks the right one based on the live mode.

import type { Request, Response, NextFunction } from 'express';
import { createGatewayMiddleware } from '@circle-fin/x402-batching/server';
import type { RedteamConfig } from './config.js';
import { MODE_SPECS, paywallKey, type ModeSpec, type Mode } from './modes.js';

type PaywallMiddleware = (req: Request, res: Response, next: NextFunction) => void;

/** Build the set of distinct paywalls and a per-mode lookup into them. */
export function buildPaywalls(config: RedteamConfig): Record<Mode, PaywallMiddleware> {
  const recipientAddress = (spec: ModeSpec): string => {
    if (spec.recipient === 'attacker') return config.attackerAddress;
    if (spec.recipient === 'sanctioned') return config.sanctionedAddress;
    return config.sellerAddress;
  };

  // Cache one require()-middleware per distinct (price, recipient) pair so two
  // modes that share a paywall (e.g. honest/garbage/loopbait) reuse it.
  const cache = new Map<string, PaywallMiddleware>();

  function paywallFor(spec: ModeSpec): PaywallMiddleware {
    const key = paywallKey(spec);
    const cached = cache.get(key);
    if (cached) return cached;
    const gw = createGatewayMiddleware({
      sellerAddress: recipientAddress(spec),
      facilitatorUrl: config.facilitatorUrl,
      networks: [`eip155:${config.chainId}`],
      description: 'Red-team research resource (Steward fixture)',
    });
    const mw = gw.require(spec.price) as PaywallMiddleware;
    cache.set(key, mw);
    return mw;
  }

  const byMode = {} as Record<Mode, PaywallMiddleware>;
  for (const [mode, spec] of Object.entries(MODE_SPECS) as [Mode, ModeSpec][]) {
    byMode[mode] = paywallFor(spec);
  }
  return byMode;
}
