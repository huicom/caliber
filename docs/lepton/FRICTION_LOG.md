# Lepton — Circle Tooling Friction Log

> Append-only. Every Circle-tooling pain point (setup friction, unclear docs,
> API surprises) with date + context, as encountered. Lepton pays $500 for the
> most useful developer feedback; this log also seeds the "what could be
> improved" sections of future Circle submissions.
>
> Format per entry:
> ### YYYY-MM-DD — <short title>
> **Tool:** <CLI / Gateway SDK / Wallets API / facilitator / docs>
> **Context:** what you were doing
> **Friction:** what went wrong / was unclear / surprised you
> **Workaround:** how you got past it (or "blocked")
> **Suggested fix:** what would have made it smoother

---

### 2026-06-11 — Buyer-side client was easier than the plan assumed
**Tool:** `@circle-fin/x402-batching/client` (v3.0.4)
**Context:** Plan P0.1 assumed the Node paying client had to be hand-rolled
(receive 402 → sign EIP-3009 → encode header → retry).
**Friction:** Positive surprise, not friction — the package already ships a
`GatewayClient` with `deposit()` / `pay(url, {method, body})` / `getBalances()`
/ `withdraw()`. `pay()` runs the full 402→sign→retry loop internally and returns
`{ data, amount, transaction, status }`. `arcTestnet` (Gateway domain 26) is in
`CHAIN_CONFIGS`. No manual EIP-3009 needed.
**Workaround:** n/a
**Suggested fix:** The Nanopayments docs lead with the low-level flow; a
"just use GatewayClient" quickstart near the top would save buyers an afternoon.

### 2026-06-11 — GatewayClient.pay() duplicates a caller-set Content-Type
**Tool:** `@circle-fin/x402-batching/client` `GatewayClient.pay()` (v3.0.4)
**Context:** Posting a JSON body to an x402-gated endpoint via `pay(url, {method:'POST', body, headers:{'content-type':'application/json'}})`.
**Friction:** `pay()` builds headers as `{ 'Content-Type': 'application/json', ...options.headers }`. A caller-supplied lowercase `content-type` becomes a *second* object key, and fetch joins them into `Content-Type: application/json, application/json`. Strict servers (express `type-is`) reject that as not-JSON, skip body parsing, and the route sees an empty body → 400. Symptom was an opaque `Payment failed: invalid_body` *after* the payment had already been signed — easy to misread as a payment problem.
**Workaround:** Don't pass a Content-Type header at all — `pay()` already sets it.
**Suggested fix:** Normalize header casing before merging (or document that `pay()` owns Content-Type and callers must not set it).

