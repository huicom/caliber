# @caliber/sdk

A small TypeScript wrapper around the public **Caliber Rating** HTTP API
and the on-chain `RatingVerifier`. Designed for orchestrator stacks,
contract frontends, and any agent runtime that wants typed access to
ratings, signed attestations, and recommendation routing.

> **Status:** v0.1 — source-disclosed under MIT after the July 2026
> hackathon close. Reviewer or integration access on request. Not yet on
> npm; consume by relative path within this monorepo or by tarball.

## Install

```ts
import { Caliber } from '@caliber/sdk';

const caliber = new Caliber(); // talks to https://caliber.poko.blue by default
```

The SDK has one peer dep — `viem` — for off-chain attestation verification.

## Read a rating

```ts
const rating = await caliber.rating('arc', '1317');
if (rating.rated) {
  console.log(rating.tier, rating.score, '/', 100); // Proven 76 / 100
}
```

## Get a signed attestation

```ts
const envelope = await caliber.attest('arc', '1317', { minTier: 'Proven' });
//  → { attestation: { ... }, signature: '0x...', validUntil, methodologyVersion }
```

## Verify an attestation off-chain (no gas)

```ts
const v = await caliber.verifyAttestation(envelope);
if (v.ok) {
  console.log('signed by the Caliber signer, methodology current, not expired');
} else {
  console.log('failed checks:', v.checks.filter((c) => !c.pass));
}
```

The verifier reads the on-chain signer and methodology versions from the
`RatingVerifier` contract on Arc Testnet, recovers the EIP-712 signer
locally with viem, and runs the same four conditions
`requireMinRating(...)` enforces on-chain — without a transaction.

## Trust-routed agent picker

Plain-language intent, signed attestation back. The AI-native primitive.

```ts
const match = await caliber.route({
  intent: 'agent that summarizes long research papers',
  min_tier: 'Proven',
  category: 'utility',
});

// match.attestation is ready to pass to a smart contract that calls
// RatingVerifier.requireMinRating(...) on Arc Testnet.
```

## Configuration

All options are optional. Defaults talk to the live Arc Testnet deployment.

```ts
const caliber = new Caliber({
  apiBase: 'https://caliber.poko.blue',
  ratingApiBase: 'https://caliber-api.poko.blue',
  verifierAddress: '0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8',
  timeoutMs: 10_000,
});
```

## What's NOT in this SDK

- Indexer / event streaming (use the live SSE feed at `/api/live` directly)
- Watchlist subscription management (RSS at `/watchlist.rss` covers it)
- Contract write helpers (use viem / wagmi directly)

## Methodology

Every response carries a `methodology_version` field. The current
contract accepts the current version and one previous version. See
[caliber.poko.blue/methodology](https://caliber.poko.blue/methodology)
for the full paper.
