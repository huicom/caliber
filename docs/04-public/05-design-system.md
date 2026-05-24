---
title: "Caliber Design System"
description: "Tokens, tier palette, and surface rules for Caliber's UI. Source of truth for any new page, chart, badge, or embed."
slug: design-system
methodology_version: 2.0.1
updated: 2026-05-24
---

# Caliber Design System

Caliber's UI is editorial, audit-tone, deliberately not flashy. The visual brand follows the **paper / ink / copper** core (warm off-white background, dark ink text, single copper accent) — the same palette a financial-data publication would use. Tier colours sit in a **metallurgical family**: medal-tone but material rather than gilded, chosen to coexist with the copper accent without competing.

This document is the source of truth. The actual tokens live in `web/src/app/globals.css` `:root`. If a value here doesn't match the CSS, the CSS is wrong.

---

## Core palette

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F4F1EB` | Primary background — warm off-white |
| `--ink` | `#0E1116` | Primary text + chrome |
| `--copper` | `#C2410C` | The single accent — used sparingly (one per view) |
| `--mute` | `#6B7280` | Secondary text |
| `--hairline` | `#C7C3BB` | Borders, dividers |
| `--signal-up` | `#0F7A4A` | Positive deltas, success states |
| `--signal-down` | `#B42318` | Negative deltas, failures |
| `--signal-watch` | `#B45309` | Watchlist amber (a tone of copper) |

---

## Tier palette (v2.0.1 metallurgical)

The six rating tiers each carry a colour. Material/audit-tone — not flashy gilded yellows. Each meets ≥4.5:1 contrast on `--paper`.

| Tier | Hex | OKLCH | Token | Notes |
|---|---|---|---|---|
| 🥇 **Gold** | `#B8862B` | `oklch(63% 0.13 78)` | `--tier-gold` | Antique ochre-gold. Reads as "metal" against paper, not glittery. |
| 🥈 **Silver** | `#7E8690` | `oklch(60% 0.015 250)` | `--tier-silver` | Cool steel grey. Darkened from `--mute` for ≥4.5:1 contrast. |
| 🥉 **Bronze** | `#8C5A2C` | `oklch(48% 0.10 55)` | `--tier-bronze` | Deeper, browner than `--copper` so the two coexist without fighting. |
| ◯ **Pending** | `#98948C` | `oklch(63% 0.008 80)` | `--tier-pending` | Desaturated warm grey — pending is neutral, neither good nor bad. |
| ⚠ **Watch** | `#B45309` | `oklch(57% 0.16 50)` | `--tier-watch` | Reuses `--signal-watch` — already in the system as a tone of copper. |
| 💤 **Dormant** | `#A8A39A` | `oklch(70% 0.012 80)` | `--tier-dormant` | Warm grey, lower contrast on purpose — dormant should recede. |

Each tier also has a **soft variant** (`--tier-{name}-soft`) at 15% alpha for fills, washes, and chip backgrounds:

```css
--tier-gold-soft:    #B8862B26;
--tier-silver-soft:  #7E869026;
--tier-bronze-soft:  #8C5A2C26;
--tier-pending-soft: #98948C26;
--tier-watch-soft:   #B4530926;
--tier-dormant-soft: #A8A39A26;
```

### When to use each tier colour

- **Tier badges** (Passport, Discover top_rated cards) — solid colour for border + text; soft variant for background fill
- **Distribution charts** (RatingScale on landing, ExposureSummary on /stats, TierDistributionHistory) — solid colour for the bar
- **Pulse legend + dots** (/discover live_pulse) — solid colour
- **Tier filter chips** (/agents tier filter sidebar) — soft background + solid border + solid text
- **SVG embed badge** (`/badge/arc/[id]`) — solid border + soft bg + solid text
- **OG share card** (Passport opengraph-image) — solid border on dark bg + lightened text variant for contrast

### What NOT to do

- ❌ Never use `--ink` for Gold — Gold is its own colour, not "the strongest possible ink"
- ❌ Never use `--copper` for any tier — `--copper` is the *brand* accent (CTAs, links); tiers must not visually compete with it
- ❌ Never use ratings-style green/red palette (e.g., `#00B894`, `#0F7A4A`) for tier colour — green reads as "success/up", not "metal"
- ❌ Don't add a Pending dot or chip with copper border — it overclaims the visual weight of an unrated agent

---

## Surface scale

| Token | Hex | Use |
|---|---|---|
| `--paper` | `#F4F1EB` | Main page background |
| `--bg-elevated` (alias of `--color-bg-elev`) | `#FBF8F2` | Cards, table zebra, panel surfaces |
| `--color-bg-elev-2` | `#EFEBE2` | Second elevation — quiet panel-on-card |
| Ink surface (`.cl-section--ink`) | `var(--ink)` | The dark live-feed strip — inverts to paper text |

---

## Type families

| Token | Stack | Use |
|---|---|---|
| `--font-display` | Inter (semibold, optical-sizing) | Display headlines, h1/h2 |
| `--font-body` | Inter | Body copy |
| `--font-mono` | JetBrains Mono | All numerics, ledger rows, mono eyebrows (`//section`), code |

All ledger numerics get `tabular-nums` + `slashed-zero` (`ss01`) for alignment.

---

## Class systems

Three coexisting class prefixes:

| Prefix | Used by | Provenance |
|---|---|---|
| `aa-*` | Site header, footer, original ArcAgents pages | Original visual system |
| `cd-*` | `/discover` redesign (Caliber Discover handoff) | Design-tool handoff v1 |
| `cl-*` | `/` landing redesign (Caliber Landing handoff) | Design-tool handoff v2 |

They use the same underlying tokens (paper / ink / copper / etc.) so they coexist cleanly. Don't introduce a fourth prefix without a specific reason.

---

## Layout tokens

```css
--container-marketing: 1180px;  /* used by cl-container (landing surfaces) */
--container-product:   1024px;  /* used by cd-container (product surfaces) */
--gutter-marketing:    24px;
--gutter-product:      16px;
```

The site header + footer use their own `aa-container` at 1240px — they're slightly wider than the marketing container by design (chrome breathes).

---

## When you add a new page

1. Use existing class system (`aa-*` for general site, `cd-*` for /discover surfaces, `cl-*` for marketing surfaces). Don't introduce new prefixes.
2. Use `--tier-*` tokens for any tier-coloured chip, dot, or bar. Never inline a tier hex.
3. Use `--copper` sparingly — exactly one accent per view (a primary CTA, an active nav link, an emphasized number). If a page has more than one copper element, demote the lesser one to `--ink`.
4. Verify contrast: text on `--paper` needs ≥4.5:1; small text on the ink surface needs to use `--paper` or `#C7C3BB` (the hairline-on-ink equivalent), not `--mute`.
5. Numerics get `font-mono` + `tabular-nums`. Always.

---

*Caliber Design System · v2.0.1 calibration · updated 2026-05-24*
