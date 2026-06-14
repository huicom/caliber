# @caliber/steward-client

The 3-line integration for **Steward** — a CFO standing in front of your agent's
x402 payments. Your agent never holds keys, never signs a payment, never decides
what's safe to pay. It hands the intent to Steward, and Steward inspects the
seller's x402 quote against your mandate, screens for redirects and price spikes,
settles the USDC if the payment clears policy, and ledgers every cent. A refused
payment comes back as a typed `StewardRefusal` — *before* any money moves — so
your agent can branch on `err.stage` / `err.reasoning` instead of parsing strings.

```ts
import { createSteward } from '@caliber/steward-client';

const steward = createSteward({
  baseUrl: 'https://steward-api.poko.blue',
  apiKey: process.env.STEWARD_API_KEY!,
});

const res = await steward.pay(sellerUrl, { method: 'POST', body });
// authorized, screened, settled — res.data holds the purchased goods,
// or a typed StewardRefusal threw if Steward said not now.
```

## Install

```bash
npm install @caliber/steward-client viem
# or: pnpm add @caliber/steward-client viem
```

`viem` is a **peer dependency** (only needed if you use the signed-spec path; most
agents already depend on it). The HTTP path uses the global `fetch` — Node 18+ or
any modern browser. The package has **no other runtime dependencies**.

## Getting a key

`POST /v1/pay` authenticates with the `x-steward-key` header.

- **Hackathon / demo:** request a demo key from the Caliber team (the live API is
  at `https://steward-api.poko.blue`). Set it as `STEWARD_API_KEY`.
- **Per-team keys:** Steward tracks integrations in a `steward_integrations` table
  for honest "teams integrated" reporting. Per-team key issuance is rolling out;
  until then a shared demo key is the integration path. Ask the team for one.

> Steward owns the checkbook. The key authorizes you to *ask Steward to pay* under
> the operator's mandate — it is not a wallet key and never moves your funds
> directly.

## API

### `createSteward({ baseUrl, apiKey, source? }): StewardClient`

- **`baseUrl`** — Steward base URL, no trailing slash needed
  (`https://steward-api.poko.blue`).
- **`apiKey`** — sent as the `x-steward-key` header.
- **`source`** *(optional)* — a ledger label for every payment from this client
  (e.g. `'hirebot'`), so traction can be split by caller.

### `client.pay(url, init?, opts?): Promise<StewardResult>`

POSTs the intent to `POST {baseUrl}/v1/pay`.

- **`url`** — the x402-gated resource Steward should pay for.
- **`init`** — optional `{ method?, body?, headers? }` forwarded to the seller
  (pricing can depend on method/body, so these matter).
- **`opts`** — optional, one of:
  - a bare **`StewardExpect`** `{ json?, maxBytes?, deadlineMs?, okField? }` — the
    Tier-0 conformance checks Steward runs *after* the payment settles; or
  - a **`StewardPayOpts`** `{ expect?, spec? }` — pass a signed `spec` for the
    disputable signed-spec path (see below). When `spec` is present it governs the
    bounds and `expect` is ignored.

Resolves with a `StewardResult` **only on allow** — so a successful resolve always
carries settled goods:

```ts
{
  requestId,                       // ledger row key
  decision: 'allow',
  stage: 'executed',
  reasoning,
  quote?: { payTo, amountUsdc },   // the inspected x402 quote
  txRef?,                          // settlement / batch reference
  data?,                           // the seller's response body (your goods)
  sha256?,                         // sha256 of the raw response bytes
  conformance?,                    // Tier-0 violations found post-settle, if any
}
```

### `StewardRefusal`

Thrown on **any non-allow verdict, regardless of HTTP status** — a `deny` (403),
a `frozen` (423), and a `hold` (202, parked for human approval) all throw. This
means: if `pay()` resolves, the payment settled; if it throws `StewardRefusal`,
nothing was paid (or it's waiting on a human).

```ts
import { StewardRefusal } from '@caliber/steward-client';

try {
  const res = await steward.pay(sellerUrl, { method: 'POST', body });
  use(res.data);
} catch (err) {
  if (err instanceof StewardRefusal) {
    // { decision: 'hold' | 'deny', stage, reasoning, requestId, httpStatus }
    console.warn(`refused at ${err.stage}: ${err.reasoning}`);
  } else {
    throw err; // transport / auth (401) / bad-request (400) error
  }
}
```

## Signed specs (disputable delivery)

For payments where a breach must be **provable**, you and the seller sign a
`DeliverySpec` *before* paying — pinning the seller URL, the expected schema, the
size/deadline budget, and the JSON/ok-field requirements. Steward then derives the
Tier-0 bounds from that pre-agreed, signed spec instead of loose defaults, and (on
breach) signs an EIP-712 `EvidenceAttestation` you can verify off-chain.

Steward never signs the spec — only the buyer (you) and optionally the seller do,
each with their own account.

```ts
import { createSteward, signSpec } from '@caliber/steward-client';
import { privateKeyToAccount } from 'viem/accounts';

const buyer = privateKeyToAccount(process.env.BUYER_PK!);

const { spec, sig } = await signSpec(
  {
    buyer: buyer.address,
    seller: sellerAddress,
    sellerUrl: 'https://seller.example.com/api/research',
    expect: { json: true, maxBytes: 1_048_576, deadlineMs: 30_000, okField: true },
    maxBytes: 1_048_576,
    deadlineMs: 30_000,
    requireJson: true,
    requireOkField: true,
    validUntil: Math.floor(Date.now() / 1000) + 3600,
    nonce: 1,
  },
  buyer, // your account — Steward never sees your key
);

const res = await steward.pay(
  'https://seller.example.com/api/research',
  { method: 'POST', body },
  { spec: { spec, buyerSig: sig /*, sellerSig */ } },
);
```

### Verifying the evidence

When a signed-spec payment is resolved, Steward signs an `EvidenceAttestation`.
Verify it off-chain — no wallet, no RPC — against the published Steward signer:

```ts
import { verifyEvidence, caliberDomain } from '@caliber/steward-client';

const result = await verifyEvidence(
  { attestation, signature },
  { expectedSigner: STEWARD_SIGNER_ADDRESS, domain: caliberDomain('arc') },
);
// { valid: boolean, recovered: Address | null, checks: [...] }
```

## What ships

The published tarball contains only the compiled `dist/` (ESM + `.d.ts`) and this
README. Its single dependency is the `viem` peer — **no `@caliber/*` workspace
packages** — so it resolves standalone from npm or a tarball.

## License

MIT © PokoBlue / Caliber
