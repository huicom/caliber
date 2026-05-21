# Phase 0 — Implementation Plan

> **Goal:** Caliber brand applied to every public surface, tier scale renamed to **Caliber-AAA … Caliber-D**, public copy stripped of multi-chain claims, home page repositioned as trust-layer (not marketplace), `/integrate` builder-facing page exists. Solo execution, flexible pacing, ships **before the Circle Developer Grant submits**.

---

## Mission

A stranger landing on `caliber.poko.blue` should understand within 10 seconds that **Caliber is a rating service for AI agents on Arc**, with the marketplace as a demo and the methodology + API + SDK as the actual product.

## What changes (the rename surface)

| Surface | From | To |
|---|---|---|
| Tier scale | `Arc-AAA … Arc-D` | `Caliber-AAA … Caliber-D` |
| Methodology paper title | "ArcAgents Rating Methodology" | "Caliber Rating Methodology" |
| Service references in docs | "ArcRating" / "ArcRating service" | "Caliber" / "the Caliber rating service" |
| Home page hero | Explorer-first framing | Caliber trust-layer first, ArcAgents as the explorer surface |
| Nav CTA | "Post Job" (orange pill) | "Integrate" (primary) + "Post Job" stays as demo link |
| Methodology / marketplace docs | "Arc + Base coverage" | "Arc coverage" (Base scaffolding stays in code, parked) |
| Page `<meta>` titles + descriptions | "ArcAgents — AI Agent Explorer for Arc" | "Caliber — Trust layer for Arc agents \| powered by ArcAgents" (or similar) |

## What does NOT change (critical — preserve these)

| Surface | Why it stays |
|---|---|
| **EIP-712 domain name `"ArcRating"`** in the deployed `RatingVerifier` contract | **Baked into the on-chain domain separator. Changing it off-chain breaks every existing signature.** The brand is decoupled from the EIP-712 internals. |
| **Contract names** (`RatingVerifier`, `RatingGateway`) | Already deployed on Arc Testnet at `0x32d5…cdC6` and `0x3B7f…7682`. Renaming requires redeploy + re-wiring addresses. Like Moody's contracts wouldn't be called "Moody's" — implementation detail. |
| **Methodology version (`1.0.0`)** | This is a brand/cosmetic rename, not a methodology change. The PD bands are identical; only the tier name strings changed. §8.1 doesn't require a version bump for naming. Add a one-line entry to Appendix F's change history. |
| **API endpoint subdomain** (`caliber-api.poko.blue/v1/...`) | DNS migration, cert rotation, and breaking API consumers isn't worth it pre-hackathon. `caliber.poko.blue` is a Phase 6 decision. |
| **GitHub repo name** (`arc-agents-explorer`) | Repo rename breaks every clone. Stays. |
| **Internal package names** (`@arc-agents/rating`, `@arc-agents/db`, `@arc-agents/indexer`) | npm package names; not user-facing. Stays. |
| **Database column names** (`chain_id`, `rating`, etc.) | Stable schema. Stays. |
| **The marketplace itself** | Stays in nav as demo, no new development. Keep the existing `/post-job` page. |
| **JSON API field name `rating`** | Only the *value strings* change (`"Arc-AAA"` → `"Caliber-AAA"`). Field name stays `rating`. |

If a curious onlooker asks "why does the on-chain domain still say ArcRating", the honest answer is: "Caliber is the brand; ArcRating is the deployment artifact. Same way Apple Pay's API contracts internally reference 'PassKit'."

---

## Execution order (15 atomic steps)

Each step is self-contained, can be done independently, and can be committed before moving to the next. Each step ends with a verification check so you know it's done before continuing.

The order minimizes broken intermediate states: rename the source of truth first (rating engine), let the web app catch the type errors, then update display strings, then docs, then site copy, then new pages.

### Code rename (steps 1–7)

#### Step 1 — Rating engine types: `ArcRating` → `CaliberTier`

**Files:**
- `rating/engine/types.ts` — rename the union type `ArcRating` → `CaliberTier`, update the tier string literals to `'Caliber-AAA'` etc.
- `rating/engine/index.ts` — re-export the renamed type
- `rating/engine/rating.ts` — `TIER_CUTOFFS` array tier names + `assignTier` return type

**Verify:** `cd rating && ./node_modules/.bin/tsc --noEmit` → clean.

**Expected blast radius:** every consumer of `ArcRating` type now errors until updated. That's by design — TypeScript will tell you exactly what to fix next.

#### Step 2 — Rating engine consumers (route handlers + scripts)

**Files:**
- `rating/api/v1/agents/[chain]/[id]/attest/route.ts` — `TIER_MAP` keys change from `'Arc-AAA'` to `'Caliber-AAA'`; Zod enum in `bodySchema` updated to `['Caliber-AAA', 'Caliber-AA', ...]`.
- `rating/api/v1/ratings/distribution/route.ts` — `ALL_TIERS` array contents + any tier references.
- `rating/api/v1/ratings/bulk/route.ts` — if it references tier strings (probably just passes through engine output).
- `rating/scripts/pd-sanity.ts` — `TIER_ORDER` array.

**Verify:** `cd rating && ./node_modules/.bin/tsc --noEmit` → clean.

**API contract note:** This is a breaking change to the JSON API — `rating` value strings change from `"Arc-AAA"` to `"Caliber-AAA"`. Since no external consumers exist yet (the only consumer is our own web app, which we update in step 5), this is the cheapest moment to do it.

#### Step 3 — Rating engine tests

**Files:**
- `rating/tests/engine.test.ts` — every `expect(...).toBe('Arc-XXX')` becomes `'Caliber-XXX'`.
- `rating/tests/integration.test.ts` — same pattern, gated by `RUN_INTEGRATION=1`.

**Verify:**
```bash
cd rating && ./node_modules/.bin/vitest run --reporter=verbose 2>&1 | tail -10
```
All passing (was 28 unit tests + 3 integration; should remain green).

#### Step 4 — Solidity tests (Foundry)

**Files:**
- `contracts/test/RatingVerifier.t.sol` — search for any hardcoded tier-name strings used in test setup; none likely (tier names are uint8 indices on-chain), but verify.
- `contracts/src/*.sol` — **no changes** (contracts use uint8 tier indices; no string names).

**Verify:**
```bash
cd contracts && PATH="$HOME/.foundry/bin:$PATH" forge test --summary 2>&1 | tail -5
```
13/13 pass.

#### Step 5 — Web types

**Files:**
- `web/src/lib/api.ts` — rename `ArcTier` type → `CaliberTier`, update string literal union.
- All importers update their import name (search-and-replace).

**Verify:** `cd web && ./node_modules/.bin/tsc --noEmit` → clean.

#### Step 6 — Web display strings

**Files:**
- `web/src/components/ui/RatingBadge.tsx` — `TIER_STYLES` map keys change. Display name in JSX (`{tier}`) automatically updates since it's just the type value.
- `web/src/app/agents/page.tsx` — `ALL_TIERS` array, `TIER_COLORS` map keys, tier ladder `.replace('Arc-', '')` becomes `.replace('Caliber-', '')` (or keep stripping prefix — depends on whether you want chips to show `AAA` or `Caliber-AAA`).
- `web/src/app/rating/[chain]/[id]/page.tsx` — `ALL_TIERS`, `TIER_INFO`, any `.replace('Arc-', '')` calls.
- `web/src/app/stats/page.tsx` — `TIER_COLOR` map, `ALL_TIERS` (in stats distribution chart).
- `web/src/app/post-job/_components/PostJobForm.tsx` — `TIER_OPTIONS` array (`label: 'Arc-AAA (...)'`), `TIER_NAME_MAP` values.
- `web/src/app/globals.css` — comments only? (No tier-color CSS variables are tier-named.) Skim and verify.

**Visual decision to make here:** in the tier filter chips on `/agents`, do you want to show `AAA` (short) or `Caliber-AAA` (full)? Recommendation: keep stripping the prefix to `AAA` for the small chips (space-constrained), but show the full `Caliber-AAA` in the badge component, headings, and detail pages.

**Verify:** Visit `/agents`, `/agents/[id]`, `/rating/arc/1`, `/stats`, `/post-job` — every tier-bearing UI element renders with the new names.

#### Step 7 — Rating engine README

**Files:**
- `rating/README.md` — any "ArcRating" → "Caliber"; any tier examples updated.

**Verify:** read it back, looks coherent.

---

### Documentation rename (steps 8–10)

#### Step 8 — Methodology paper

**File:** `docs/02-riskmodel/01-Methodology.md`

**Find & replace (in order — be careful with order to avoid double-substitution):**
1. `ArcAgents Rating Methodology` → `Caliber Rating Methodology`
2. `ArcAgents Rating Service` → `Caliber Rating Service` (or just `Caliber`)
3. `ArcAgents is not` → `Caliber is not` (in plain-language intro)
4. Tier scale: every `Arc-AAA` → `Caliber-AAA` (replace all 9 tier names)
5. JSON example in Appendix E: `"rating": "Arc-BB"` → `"rating": "Caliber-BB"`
6. Add one line to Appendix F change history:
   ```
   | 1.0.0-rebrand | 2026-05-{day} | Brand renamed from ArcAgents Rating Service to Caliber. Tier scale strings renamed Arc-* → Caliber-* (band cutoffs unchanged). No methodological change; methodology version remains 1.0.0. |
   ```

**Don't change:**
- Attribution string in §9.2: stays "ArcAgents by PokoBlue".
- Methodology version: stays `1.0.0`.
- ERC-8004 / ERC-8183 references (those are protocol names).

**Verify:** Visit `/methodology` on the live site after build, scroll through, confirm:
- Title reads "Caliber Rating Methodology"
- Every tier band table uses `Caliber-AAA` etc.
- Appendix E JSON shows `"rating": "Caliber-..."`
- Appendix F has the rebrand change-log line

#### Step 9 — Marketplace plan

**File:** `docs/03-marketplace/marketplace_plan.md`

- Title: `ArcRating Marketplace — Implementation Plan` → `Caliber Demo Marketplace — Implementation Plan`
- "ArcRating service must be deployed" → "Caliber service must be deployed"
- `name="ArcRating"` in the EIP-712 domain spec (§11.1) — **stays as `"ArcRating"`** because that's the actual immutable on-chain value. Add a parenthetical: `name="ArcRating"  // immutable on-chain; Caliber is the brand`.
- §7 submission form Title: `ArcAgents Rating-Gated Marketplace` → `Caliber-Gated Marketplace on Arc`

#### Step 10 — Other docs touch-ups

**Files to skim and update (mostly internal, low priority):**
- `docs/methodology-v1.md` — stub file at root, says "ArcAgents Rating Methodology v1". Could either delete or rename to "Caliber Rating Methodology — Index" with a link to the real paper.
- `docs/02-riskmodel/02-Roadmap.md` — historical doc, optional to update. Mark `[SUPERSEDED — see docs/01-mysel-roadmap.md]` at the top instead of rebranding.
- `docs/02-riskmodel/phase1.md` and `phase1-daily-plan.md` — historical docs. Mark `[HISTORICAL]` at top, don't bother renaming.

**Don't rebrand:**
- `CLAUDE.md` — it's an internal LLM context doc. Update at leisure later.
- `AGENTS.md` if it exists — internal.

---

### Site repositioning (steps 11–13)

#### Step 11 — Strip multi-chain copy from public surface

**Files:**
- `docs/02-riskmodel/01-Methodology.md` §1.1 — "currently **Arc testnet** and **Base mainnet**" → "currently **Arc testnet**". §7.3 limitations — "v1 covers Arc and Base only" → "v1 covers Arc only; Base scaffolding exists in the codebase but is parked." §9.3 known limitations — same edit.

**Don't touch:**
- `indexer/shared/chain-config.ts` — Base entries stay in the registry (code lives, just isn't marketed).
- `indexer/base/` workspace — code stays, indexer service for Base just isn't running. Effectively dormant.

#### Step 12 — Home page hero rewrite

**File:** `web/src/app/page.tsx`

Current hero says "Every AI agent on Arc, in one place." That's explorer framing. Caliber needs to come first.

**Rewrite the `<h1>` section to something like:**

```tsx
<Eyebrow variant="curly" className="mb-7">
  caliber · trust_layer · arc_agents
</Eyebrow>

<h1 className="h-display max-w-4xl text-fg">
  Know which agents your
  <br className="hidden md:block" />{' '}
  <span className="text-accent">contracts can trust.</span>
</h1>

<p className="mt-7 text-fg-mute text-lg md:text-xl leading-relaxed max-w-2xl">
  Caliber is the rating layer for Arc-native AI agent commerce. Published
  methodology, signed attestations, on-chain enforcement. Every ERC-8004
  agent gets a Caliber-AAA … Caliber-D rating you can consume from a
  smart contract, a Python script, or your browser.
</p>
```

**Add new CTA buttons** below the hero:
```tsx
<Button asChild>
  <Link href="/integrate">Integrate Caliber <ArrowRight /></Link>
</Button>
<Button variant="ghost" asChild>
  <Link href="/agents">Browse rated agents</Link>
</Button>
<Button variant="ghost" asChild>
  <Link href="/methodology">Read methodology</Link>
</Button>
```

**Stats / live feed sections stay** — they reinforce the "real data" angle.

**Add a "Try the demo" callout** somewhere mid-page that links to `/post-job` and explains "this is the rating gate working end-to-end on real USDC escrow."

#### Step 13 — Nav update

**File:** `web/src/components/site/Nav.tsx`

Current `NAV_LINKS`:
```ts
{ href: '/post-job', label: 'Post Job', cta: true },
```

Change to:
```ts
{ href: '/integrate', label: 'Integrate', cta: true },
{ href: '/post-job', label: 'Demo' },  // demoted from CTA pill to plain link
```

This communicates "the action page is /integrate; /post-job is a demo".

---

### New surface (step 14)

#### Step 14 — `/integrate` page

**New file:** `web/src/app/integrate/page.tsx`

Stub content for Phase 0 (real SDK docs land in Phase 2). The job is to give judges/builders a page to land on when the nav says "Integrate".

```tsx
import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';

export const metadata = {
  title: 'Integrate Caliber — ArcAgents',
  description:
    'Two ways to consume Caliber ratings: HTTP API (any language) or on-chain RatingVerifier (any Solidity contract). SDK in beta — Q3 2026.',
};

export default function IntegratePage() {
  return (
    <main className="mx-auto max-w-[1200px] px-6 md:px-12 pt-12 md:pt-16 pb-24">
      <header className="mb-12 max-w-2xl">
        <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-5">
          <span className="rule-accent" />
          for builders
        </p>
        <h1 className="h-display text-fg" style={{ fontSize: 'clamp(2rem, 4.5vw, 3.4rem)' }}>
          Integrate the<br />
          <span className="text-accent">Caliber rating gate.</span>
        </h1>
        <p className="mt-6 text-fg-mute text-lg leading-relaxed">
          Two surfaces, same methodology. Pick whichever fits your stack.
        </p>
      </header>

      <div className="grid gap-8 lg:grid-cols-2">
        {/* HTTP API */}
        <section className="border border-border rounded-xl p-6 bg-bg-elev">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
            {'{'}http_api{'}'}
          </p>
          <h2 className="text-xl font-semibold mb-3 text-fg">From any language</h2>
          <p className="text-fg-mute text-sm mb-4 leading-relaxed">
            Read a rating for any Arc-native ERC-8004 agent. Works from Python,
            TypeScript, Go, curl — any HTTP client.
          </p>
          <pre className="bg-bg p-4 rounded-lg border border-border text-xs overflow-x-auto"><code>{`curl https://caliber-api.poko.blue/v1/agents/arc/1/rating

# Returns:
# { "rated": true,
#   "rating": "Caliber-AAA",
#   "ppd_30d": 0.0018,
#   "confidence": "low",
#   "methodology_version": "1.0.0",
#   ... }`}</code></pre>
        </section>

        {/* Solidity */}
        <section className="border border-border rounded-xl p-6 bg-bg-elev">
          <p className="font-mono text-[11px] tracking-[0.18em] uppercase text-fg-dim mb-3">
            {'{'}on_chain{'}'}
          </p>
          <h2 className="text-xl font-semibold mb-3 text-fg">From any Solidity contract</h2>
          <p className="text-fg-mute text-sm mb-4 leading-relaxed">
            Request a signed attestation, pass it to the on-chain verifier.
            Your contract reverts if the agent doesn&apos;t meet your threshold.
          </p>
          <pre className="bg-bg p-4 rounded-lg border border-border text-xs overflow-x-auto"><code>{`IRatingVerifier verifier = IRatingVerifier(
  0x32d57F806FccbEd91B1F2352a8463cB2078aCdC6
);

verifier.requireMinRating(
  att,            // EIP-712 RatingAttestation
  signature,      // signed by Caliber
  3,              // max tier allowed (Caliber-BBB)
  1               // min confidence (Medium)
);
// reverts if agent doesn't qualify`}</code></pre>
        </section>
      </div>

      <section className="mt-12 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold mb-4 text-fg">SDK — beta soon</h2>
        <p className="text-fg-mute leading-relaxed max-w-2xl">
          <code className="text-accent">@caliber/sdk</code> wraps both surfaces with ergonomic
          TypeScript types and one-call helpers. Coming in Phase 2 of the{' '}
          <Link href="https://github.com/huicom/arc-agents-explorer" className="text-accent hover:underline">
            roadmap <ArrowUpRight className="inline w-3.5 h-3.5" />
          </Link>. If you want early access, open a GitHub issue or email PokoBlue (@PokoBlue99) on X.
        </p>
      </section>

      <section className="mt-12 border-t border-border pt-12">
        <h2 className="text-2xl font-semibold mb-4 text-fg">How it works</h2>
        <ol className="space-y-3 text-fg-mute leading-relaxed">
          <li><strong className="text-fg">1. Read the methodology.</strong> <Link href="/methodology" className="text-accent hover:underline">/methodology</Link> — published v1.0, open for review.</li>
          <li><strong className="text-fg">2. Query the rating.</strong> HTTP or on-chain. Always carries <code>methodology_version</code>.</li>
          <li><strong className="text-fg">3. Gate your flow.</strong> Refuse to fund escrow / accept jobs / pay invoices below your tier threshold.</li>
          <li><strong className="text-fg">4. The agent improves or gets filtered out.</strong> Their incentive is to climb the tiers.</li>
        </ol>
      </section>
    </main>
  );
}
```

**Verify:** Visit `/integrate` after build — code blocks render correctly, links work, page reads as a builder landing page.

---

### Verification + ship (step 15)

#### Step 15 — Full-site sweep + deploy

```bash
# Typecheck everything
cd web && ./node_modules/.bin/tsc --noEmit
cd ../rating && ./node_modules/.bin/tsc --noEmit
cd ../indexer/arc && ./node_modules/.bin/tsc --noEmit

# Run rating tests
cd ../../rating && ./node_modules/.bin/vitest run --reporter=verbose

# Run Foundry tests
cd ../contracts && PATH="$HOME/.foundry/bin:$PATH" forge test --summary

# Production build
cd ../ && export PATH="/home/huicom/.npm-global/bin:$PATH" && pnpm --filter web build

# Restart services (sudoers should allow passwordless)
sudo -n systemctl restart arc-rating
sudo -n systemctl restart arc-web
sleep 5

# Smoke tests
curl -s http://localhost:3000/ | grep -oE "Caliber|trust_layer" | head -3
curl -s http://localhost:3000/integrate | grep -oE "Integrate Caliber" | head -1
curl -s http://localhost:3000/methodology | grep -oE "Caliber Rating Methodology" | head -1
curl -s http://localhost:3100/v1/agents/arc/1/rating | grep -oE "Caliber-[A-D]+" | head -1
```

**Visual verification (open in browser):**
- Home page hero reads "Caliber..." with the trust-layer message
- `/integrate` page renders cleanly with both code snippets
- Nav shows **Integrate** as the orange CTA pill
- `/agents` page shows tier badges as `Caliber-AAA` (or `AAA` short form on chips, full name on detail badges)
- `/jobs/[id]` page renders without errors
- `/methodology` paper has new title + tier names throughout
- `/stats` chart axis / labels reflect new tier names

---

## Verification checklist (gate-keeper for "Phase 0 done")

Tick each before declaring done.

- [ ] `pnpm --filter web build` succeeds with no new errors
- [ ] All three workspaces (`web`, `rating`, `indexer/arc`) typecheck clean
- [ ] `vitest run` in `rating/` shows all unit + integration tests passing
- [ ] `forge test --summary` shows 13/13 passing
- [ ] `arc-web` and `arc-rating` services restart cleanly (active state, non-zero PID, < 5s)
- [ ] Home page (`/`) hero reads "Caliber... trust layer"
- [ ] `/integrate` page exists and renders cleanly
- [ ] Nav shows "Integrate" as the primary CTA, "Demo" as a normal link
- [ ] `/agents`, `/agents/[id]`, `/jobs/[id]`, `/rating/arc/1`, `/stats`, `/post-job`, `/methodology` all render without errors
- [ ] Tier badges everywhere read "Caliber-AAA" etc.
- [ ] `/methodology` page title is "Caliber Rating Methodology"
- [ ] `/methodology` Appendix F has the rebrand entry in change history
- [ ] `/methodology` paper no longer says "Arc + Base coverage" anywhere
- [ ] JSON API responses include `"rating": "Caliber-..."` (curl test)
- [ ] On-chain EIP-712 signature verification still works (`curl POST /v1/agents/arc/1/attest` returns a valid signature; manually verify against the deployed verifier with `cast call`)
- [ ] `<meta>` tags in page source show "Caliber" in title + description
- [ ] OG image / Twitter card preview reads as Caliber (test via X post preview or opengraph.xyz)
- [ ] Marketplace (`/post-job`) still functional end-to-end

If any check fails, the rollback strategy is: `git stash` the rename commit, the previous state still works. The rename is purely additive in semantics (band cutoffs unchanged) so no data needs reverting.

---

## Time / effort estimates

Rough — depends on availability + interruptions. Pad by 50% for "first time through".

| Step bucket | Optimistic | Realistic | Hard cap |
|---|---|---|---|
| Code rename (steps 1–7) | 90 min | 2.5 hrs | 4 hrs |
| Docs rename (steps 8–10) | 30 min | 1 hr | 2 hrs |
| Site repositioning (steps 11–13) | 45 min | 1.5 hrs | 3 hrs |
| `/integrate` page (step 14) | 30 min | 1 hr | 2 hrs |
| Verification + ship (step 15) | 30 min | 45 min | 2 hrs (if something breaks) |
| **Total focused work** | **~3.5 hrs** | **~7 hrs** | **~13 hrs** |

Realistic plan: one focused half-day for code rename + tests (steps 1–7); one focused half-day for docs + site copy + new page + ship (steps 8–15). Can be split across consecutive days; can't be split into smaller chunks easily because of the cross-file type dependencies.

---

## Decisions you still need to make before kicking off

1. **Tagline.** Three candidates in the roadmap. Picking now means you write it correctly once instead of three times. Lean toward: *"Caliber — the trust primitive for the Arc agent economy."*
2. **Nav: "Integrate" vs "Get the SDK" vs something else** for the CTA label. *"Integrate"* matches the page name and reads as the action; recommended.
3. **Tier chip display: short (`AAA`) or full (`Caliber-AAA`)** on the agents page filter chips? Short keeps the row compact; full is brand-reinforcing. Recommendation: short on chips, full on every badge / heading / detail page.
4. **One-line entry to add to Appendix F change history.** Need the date you actually execute Phase 0. (Today is 2026-05-21; you might execute over a day or two.)
5. **Do you want to remove the marketplace's "Post Job" page from the home page CTA buttons** (alongside the nav demotion)? Recommendation: yes — only mention it in the "Try the demo" callout further down the page.

---

## Risks and mitigations

| Risk | Probability | Mitigation |
|---|---|---|
| Tier rename breaks API consumers we didn't anticipate | Low — the only consumer is our own web app | Web app is updated in step 5; no external consumers exist yet |
| EIP-712 signature verification breaks because someone "tidies up" the domain name | Medium if someone else picks this up | The "What does NOT change" table at the top is the firewall — re-read it before touching the attest route |
| `/integrate` page metadata description gets cached by social platforms (X, Discord) and shows stale OG preview | Medium | Force-refresh via opengraph.xyz or post a tweet that triggers re-crawl after the deploy |
| `tier.replace('Arc-', '')` calls in display code give weird output (`Caliber-AAA`.replace('Arc-', '') → `Caliber-AAA`) | High if missed | Step 6 explicitly calls this out — search-and-replace `replace('Arc-', '')` with `replace('Caliber-', '')` everywhere |
| Methodology paper change-history bloat | Low | Single line entry. Don't bump methodology version. |
| Production build picks up stale `.next/` cache | Medium | Phase 0 build includes deleting `web/.next/cache` if anything looks weird after restart |

---

## What comes after Phase 0

Phase 1: Circle Developer Grant submission. Use the new positioning verbatim — *"Caliber is the trust primitive for the Arc agent economy"*. Submit before **2026-05-31 23:59 UTC**.

Phase 2: TypeScript SDK that delivers on the promise the `/integrate` page is making. The page currently says "SDK — beta soon"; Phase 2's job is to make that no longer "soon".

---

*Plan version 1.0. Author: PokoBlue + Claude (planning). Executes against `docs/01-mysel-roadmap.md` Phase 0.*
