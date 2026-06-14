# @caliber/steward-client

The 3-line integration for Steward — the CFO layer for agent payments. Your
agent never holds keys or signs: it asks Steward to pay, and Steward inspects the
seller's x402 quote, decides allow/hold/deny, settles if allowed, and ledgers
everything.

```ts
import { createSteward, StewardRefusal } from '@caliber/steward-client';

const steward = createSteward({
  baseUrl: 'http://localhost:3300',   // or https://steward.poko.blue
  apiKey: process.env.STEWARD_API_KEY!,
});

try {
  const res = await steward.pay('http://localhost:3400/api/research', { method: 'POST' });
  // res.decision === 'allow'
  console.log(`paid ${res.quote?.amountUsdc} USDC → ${res.quote?.payTo} (tx ${res.txRef})`);
} catch (err) {
  if (err instanceof StewardRefusal) {
    // Steward refused before signing — nothing was paid.
    console.warn(`refused at ${err.stage}: ${err.reasoning}`);  // e.g. "detector" / "policy" / "frozen"
  } else {
    throw err;  // transport / auth error
  }
}
```

## API

### `createSteward({ baseUrl, apiKey }): StewardClient`

- **`baseUrl`** — Steward service URL (no trailing slash needed).
- **`apiKey`** — sent as the `x-steward-key` header.

### `client.pay(url, init?): Promise<StewardResult>`

POSTs `{ url, init }` to `POST {baseUrl}/v1/pay`.

- **`url`** — the x402-gated resource Steward should pay for.
- **`init`** — optional `{ method?, body?, headers? }` forwarded to the seller
  (pricing can depend on method/body, so these matter).

Resolves to a `StewardResult` on **allow**:

```ts
{ requestId, decision: 'allow', stage: 'executed', reasoning,
  quote?: { payTo, amountUsdc }, txRef? }
```

Throws **`StewardRefusal`** on a refused decision (HTTP 403 deny / 423 frozen),
carrying `{ decision, stage, reasoning, requestId, httpStatus }`. Auth (401) and
malformed-request (400) errors throw a plain `Error`.

Zero runtime dependencies — uses the global `fetch` (Node 18+ or browsers).
