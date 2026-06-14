# Steward — red-team demo runbook

The shot list for the attack-demo video. Every beat below is driven by
`scripts/redteam-demo.ts` (run `pnpm demo:redteam`), which prints a narrated,
timestamped transcript you read alongside the console. One agent, one treasurer,
six attacks — each refused by a real pipeline verdict and a real row in
`steward_payments`.

## Before you roll

1. Bring up the pair (two terminals):
   - `cd services/steward && pnpm start`   (`:3300`)
   - `cd services/redteam && pnpm start`   (`:3400`)
2. Bring up the console: `pnpm dev:web`, open `http://localhost:3000/steward/ledger`.
   (Live, in prod: `steward.poko.blue/steward/ledger`.)
3. Arrange the screen: console **ledger** on the left (rows stream in via SSE),
   terminal running `pnpm demo:redteam` on the right.

The script is idempotent — it resets the fixture host's route/history on start,
so you can re-run between takes.

## The sequence (script step → what's on screen)

| # | Script step | Verdict to call out | Console shot |
|---|---|---|---|
| 1 | **Baseline** (honest) | `ALLOW` · settled, **txRef** printed | a green `allow` row appears live in the ledger; point at the txRef |
| 2 | **Overcharge** (10× price) | `DENY` @ **policy** — `per_tx_cap: quote 0.01 > cap 0.005` | a red `deny` row, stage `policy` |
| 3 | **Redirect** (attacker payTo) | `DENY` @ **detector** — prints `expected → seller`, `got → attacker` | red `deny` row, stage `detector`; open `/steward/incidents` → a `redirect` incident |
| 4 | **Loop bait** (rapid fire) | `HOLD` @ **detector** "runaway loop: 5 payments… route paused"; next call `HOLD` "route paused"; then the **approvals queue** is shown and one is **approved** → route reactivates, payment re-executes `ALLOW` | the route flips to paused; held rows queue; on approve, an `allow` re-execution row lands |
| 5 | **Garbage** (malformed body) | `ALLOW` (money moved) **+ conformance incident** | green `allow` row, but `/steward/incidents` shows a `conformance` incident for the same payment |
| 6 | **Freeze** (kill switch) | `423 FROZEN` — every payment denied at the freeze gate; then **unfreeze** → `ALLOW` again | the freeze **banner** lights up across the console; the paid call refuses; lift it and the next call settles |
| 7 | **Epilogue** | counters straight from `steward_payments` / `steward_incidents` | the overview counters match the numbers the script prints |

## Lines to say on camera

- Step 1 — "The agent has a wallet and a job. It asks Steward to pay. Steward
  inspects the x402 quote, decides, signs, and settles. Real USDC, on Arc."
- Step 2 — "The seller quotes ten times the rate. Steward refuses **before
  signing** — the mandate cap is $0.005."
- Step 3 — "Same price, but the recipient changed to a wallet we've never paid.
  Steward catches the swap and blocks it — expected vs got."
- Step 4 — "A 'retry now' response baits a runaway loop. Steward holds the run,
  **pauses the whole route**, and waits for me. I approve from the console (or
  Telegram) and the one payment re-executes."
- Step 5 — "Honest price, so the money moves — but the delivery is junk. Steward
  pays and files a conformance incident so the agent's score reflects it."
- Step 6 — "If anything feels wrong, one switch freezes the treasury. Every
  payment denies instantly. Lift it, and we're back."
- Step 7 — "Every verdict you just saw is a real row. Demo traffic and external
  traffic are tagged separately — we never conflate them."

## If a step doesn't match

The script asserts each verdict and exits non-zero on a mismatch. Re-run; the
reset is automatic. If a step still misbehaves, it's the service, not the
script — check `services/steward` logs (`/tmp/steward.log`). Keep the per-tx cap
at `$0.005` (`STEWARD_MAX_TX_USDC`) and the loop threshold at the default 5
(`STEWARD_LOOP_N`) for the numbers above to line up.
