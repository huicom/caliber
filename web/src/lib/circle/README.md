# Circle Programmable Wallets — Caliber demo integration

What this module does: powers the **"demo without MetaMask"** path on `/jobs/new`. A judge clicks one button, Caliber provisions a Circle developer-controlled wallet on Arc Testnet for the browser session, requests testnet USDC + native gas via Circle's faucet, then runs the full Caliber-gated post-job flow (`USDC.approve` → `RatingGateway.postGatedJob`) server-side via Circle's `contractExecution` API.

End-state matches the wallet flow: a real job posted on Arc Testnet, indexed at `/jobs/[id]`, visible on Arcscan.

## Setup

Three env vars on the server (already in `.env.example`):

```
CIRCLE_API_KEY=             # from developers.circle.com console
CIRCLE_ENTITY_SECRET=       # 32-byte hex, registered once with Circle
CIRCLE_DEMO_WALLET_SET_ID=  # UUID of the Caliber wallet set
```

### One-time provisioning steps

1. **Sign up** at https://developers.circle.com → create a project → grab the API key.
2. **Generate the Entity Secret** (32-byte hex) and **register it** once with Circle. The recovery file Circle returns is critical — store it. Both steps can be done with the SDK:

   ```ts
   import {
     generateEntitySecret,
     registerEntitySecretCiphertext,
   } from '@circle-fin/developer-controlled-wallets';

   generateEntitySecret(); // prints to stdout — save it as CIRCLE_ENTITY_SECRET
   await registerEntitySecretCiphertext({
     apiKey: 'YOUR_KEY',
     entitySecret: 'THE_HEX_YOU_JUST_GENERATED',
     recoveryFileDownloadPath: '.',
   });
   ```

3. **Create the demo wallet set** (one-time):

   ```ts
   import { initiateDeveloperControlledWalletsClient } from '@circle-fin/developer-controlled-wallets';

   const c = initiateDeveloperControlledWalletsClient({
     apiKey: 'YOUR_KEY',
     entitySecret: 'YOUR_SECRET',
   });
   const res = await c.createWalletSet({ name: 'caliber-demo-wallets' });
   console.log(res.data?.walletSet?.id); // save as CIRCLE_DEMO_WALLET_SET_ID
   ```

4. **Restart `arc-web.service`** so Next.js picks up the new env vars.

When all three env vars are unset, the demo panel on `/jobs/new` renders a gray "demo mode unavailable" notice instead of the call-to-action. No other surface is affected.

## Files

- `client.ts` — SDK init guarded by env vars; throws clear errors when unset
- `session.ts` — cookie-backed browser session ↔ wallet refId mapping
- `wallet-service.ts` — `getOrCreateWallet`, `requestFaucet`, `executeContractCall`, `getTransactionStatus`

API routes that consume this module:

- `POST /api/circle/wallet` — get-or-create wallet for session
- `POST /api/circle/faucet` — request testnet USDC + gas
- `POST /api/circle/demo-gated-job` — orchestrates the full 2-tx gated flow
- `GET  /api/circle/transaction/[id]` — polling endpoint for the client UI

## Chain support

Circle Programmable Wallets supports Arc Testnet (chain code `ARC-TESTNET`, chain id 5042002) as of the Q2 2026 release. Full supported-chain list: https://developers.circle.com/w3s/supported-blockchains-and-currencies.
