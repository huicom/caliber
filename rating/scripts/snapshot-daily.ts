import 'dotenv/config';
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};
import { db, sql as rawSql, ratingSnapshots, tierTransitions, watchlistWebhooks } from '@arc-agents/db';
import { eq, and, desc, lt, gte } from 'drizzle-orm';
import { rateAgent } from '../engine/rating';
import { METHODOLOGY_VERSION } from '../engine/version';
import { flagsToBitfield, TIER_ORDINAL, type CaliberTier } from '../engine/types';

// Diff one snapshot against the previous one for the same agent. Returns
// zero or more tier_transition rows. Exported so the historical backfill
// script can reuse the exact same diff rules.
//
// Transition kinds:
//   first_rating    — no previous snapshot existed
//   tier_up         — moved up the tier scale (e.g. Proven → Established)
//   tier_down       — moved down (e.g. Proven → Watch)
//   enter_watch     — entered Watch tier from anything else
//   exit_watch      — left Watch tier
//   enter_inactive  — entered Inactive tier
//   exit_inactive   — left Inactive tier
//   flag_added      — gained at least one risk flag
//   flag_removed    — cleared at least one risk flag
// Tier moves and flag changes can co-occur — both rows emitted.
export interface PrevState {
  tier: string;
  flags: number | null;
  interactionCount: number | null;
}
export interface CurrState {
  tier: string;
  flags: number;
  score: number;
  computedAt: Date;
  agentId: bigint;
  chainId: string;
}
export function computeTransitions(
  prev: PrevState | null,
  curr: CurrState,
  methodologyVersion: string,
  prevScore: number | null = null,
): Array<{
  chainId: string;
  agentId: bigint;
  at: Date;
  kind: string;
  fromTier: string | null;
  toTier: string;
  fromFlags: number | null;
  toFlags: number;
  fromScore: number | null;
  toScore: number;
  methodologyVersion: string;
}> {
  const base = {
    chainId: curr.chainId,
    agentId: curr.agentId,
    at: curr.computedAt,
    toTier: curr.tier,
    toFlags: curr.flags,
    fromTier: prev?.tier ?? null,
    fromFlags: prev?.flags ?? null,
    fromScore: prevScore,
    toScore: curr.score,
    methodologyVersion,
  };

  if (!prev) {
    return [{ ...base, kind: 'first_rating' }];
  }

  const out: typeof base[] & Array<typeof base & { kind: string }> = [];

  if (prev.tier !== curr.tier) {
    const prevOrd = TIER_ORDINAL[prev.tier as CaliberTier];
    const currOrd = TIER_ORDINAL[curr.tier as CaliberTier];
    if (Number.isFinite(prevOrd) && Number.isFinite(currOrd) && currOrd < prevOrd) {
      out.push({ ...base, kind: 'tier_up' });
    } else if (Number.isFinite(prevOrd) && Number.isFinite(currOrd) && currOrd > prevOrd) {
      out.push({ ...base, kind: 'tier_down' });
    }
    if (curr.tier === 'Watch' && prev.tier !== 'Watch') out.push({ ...base, kind: 'enter_watch' });
    if (curr.tier !== 'Watch' && prev.tier === 'Watch') out.push({ ...base, kind: 'exit_watch' });
    if (curr.tier === 'Inactive' && prev.tier !== 'Inactive') out.push({ ...base, kind: 'enter_inactive' });
    if (curr.tier !== 'Inactive' && prev.tier === 'Inactive') out.push({ ...base, kind: 'exit_inactive' });
  }

  const prevFlags = prev.flags ?? 0;
  if (prevFlags !== curr.flags) {
    const added = curr.flags & ~prevFlags;
    const removed = prevFlags & ~curr.flags;
    if (added !== 0) out.push({ ...base, kind: 'flag_added' });
    if (removed !== 0) out.push({ ...base, kind: 'flag_removed' });
  }

  return out;
}

/**
 * Wave 3 — Daily snapshot of every rateable agent's current Caliber rating.
 *
 * Run by the caliber-snapshot systemd timer. Writes one PIT row per agent
 * per UTC day. Idempotent: a unique partial index on
 * (chain_id, agent_id, view, date(computed_at)) prevents double-inserts if
 * the timer fires twice in the same day.
 *
 * TTC view is deferred — requires ≥180 days of history (methodology §3.3).
 * The testnet is too young; we'll start emitting TTC rows automatically once
 * agents cross the threshold.
 */

const CHAIN = process.env.SNAPSHOT_CHAIN ?? 'arc';
const BATCH_LOG_EVERY = 50;

async function main() {
  const startedAt = new Date();
  console.log(
    `[snapshot] starting daily snapshot · chain=${CHAIN} · methodology=${METHODOLOGY_VERSION}`,
  );

  // The pre-filter mirrors web/src/app/api/agents/route.ts ratedOnly:
  // feedback_count + jobs_completed + validation count >= 5. Validations are
  // joined via correlated subquery (uses idx_validations_agent).
  const agentRows = (await rawSql.unsafe(`
    SELECT agent_id::text AS agent_id
    FROM agents
    WHERE chain_id = $1
      AND (
        COALESCE(feedback_count, 0)
        + COALESCE(jobs_completed, 0)
        + (SELECT COUNT(*) FROM validations v WHERE v.agent_id = agents.agent_id AND v.chain_id = agents.chain_id)
      ) >= 5
  `, [CHAIN])) as Array<{ agent_id: string }>;

  console.log(`[snapshot] ${agentRows.length} potentially-rateable agents on ${CHAIN}`);

  let written = 0;
  let skippedUnrated = 0;
  let errors = 0;
  const now = new Date();

  for (let i = 0; i < agentRows.length; i++) {
    const agentId = agentRows[i].agent_id;
    try {
      const result = await rateAgent(BigInt(agentId), CHAIN, 'PIT');
      if (!result.rated) {
        skippedUnrated++;
        continue;
      }

      // v2.0 column reuse:
      //   ppd_30d  → completion_rate_smoothed (was probability of default)
      //   lgd      → forward_success           (was loss given default)
      //   ead_usdc → active_escrow_usdc        (was funded EAD)
      // Schema kept stable for now; column-rename migration is a separate
      // follow-up so existing snapshots in the table remain queryable while
      // the dashboards update. The semantic shift is captured in code +
      // methodology Appendix F v2.0 entry.
      const currentFlags = flagsToBitfield(result.flags);

      // Fetch the most recent snapshot BEFORE today, for transition diff.
      const prevRows = await db
        .select({
          tier: ratingSnapshots.tier,
          flags: ratingSnapshots.flags,
          interactionCount: ratingSnapshots.interactionCount,
        })
        .from(ratingSnapshots)
        .where(
          and(
            eq(ratingSnapshots.agentId, BigInt(agentId)),
            eq(ratingSnapshots.chainId, CHAIN),
            eq(ratingSnapshots.view, 'PIT'),
            lt(ratingSnapshots.computedAt, now),
          ),
        )
        .orderBy(desc(ratingSnapshots.computedAt))
        .limit(1);
      const prevSnapshot = prevRows[0] ?? null;

      await db
        .insert(ratingSnapshots)
        .values({
          chainId: CHAIN,
          agentId: BigInt(agentId),
          computedAt: now,
          tier: result.tier,
          ppd30d: String(result.factors.completion_rate_smoothed),
          lgd: String(result.factors.forward_success),
          eadUsdc: result.factors.active_escrow_usdc,
          confidence: result.confidence,
          flags: currentFlags,
          view: 'PIT',
          methodologyVersion: METHODOLOGY_VERSION,
          interactionCount: result.interaction_count,
        });

      // Emit transition rows (0+ per snapshot diff)
      const transitions = computeTransitions(
        prevSnapshot,
        {
          tier: result.tier,
          flags: currentFlags,
          score: result.score,
          computedAt: now,
          agentId: BigInt(agentId),
          chainId: CHAIN,
        },
        METHODOLOGY_VERSION,
      );
      if (transitions.length > 0) {
        await db.insert(tierTransitions).values(transitions);
      }

      written++;
    } catch (err) {
      errors++;
      console.warn(`[snapshot] error on agent ${agentId}: ${(err as Error).message}`);
    }

    if ((i + 1) % BATCH_LOG_EVERY === 0) {
      console.error(`[snapshot] progress: ${i + 1}/${agentRows.length}`);
    }
  }

  const elapsedSec = ((Date.now() - startedAt.getTime()) / 1000).toFixed(1);
  console.log(
    `[snapshot] done · written=${written} · skipped_unrated=${skippedUnrated} · errors=${errors} · ${elapsedSec}s`,
  );

  // Phase B polish: fan today's new transitions out to subscribed Discord webhooks.
  // Runs strictly AFTER snapshot insertion so we never dispatch from partial data.
  await dispatchWebhooks(startedAt);
}

// ---------------------------------------------------------------------
// Discord webhook dispatch (Track 3.5)
// ---------------------------------------------------------------------

const TIER_COLOR: Record<string, number> = {
  Established: 0x00b894,
  Proven:      0x0ea5e9,
  Emerging:    0x14b8a6,
  Provisional: 0x94a3b8,
  Watch:       0xf59e0b,
  Inactive:    0x1f2937,
};

const KIND_VERB: Record<string, string> = {
  first_rating: 'received first Caliber rating',
  tier_up: 'moved up to',
  tier_down: 'moved down to',
  enter_watch: 'entered Watch tier',
  enter_inactive: 'went Inactive',
  exit_watch: 'left Watch tier',
  exit_inactive: 'reactivated to',
  flag_added: 'gained risk flag while at',
  flag_removed: 'cleared risk flag while at',
};

const FLAG_NAMES = [
  'CounterpartyConcentration',
  'ValidatorConcentration',
  'SybilPattern',
  'VolumeAnomaly',
  'Dormancy',
];

function flagsToNames(mask: number | null): string[] {
  if (mask == null) return [];
  return FLAG_NAMES.filter((_, i) => (mask & (1 << i)) !== 0);
}

interface TransitionWithAgent {
  id: string;
  chain_id: string;
  agent_id: string;
  at: Date;
  kind: string;
  from_tier: string | null;
  to_tier: string;
  from_flags: number | null;
  to_flags: number;
  methodology_version: string;
  agent_name: string | null;
}

function buildEmbeds(transitions: TransitionWithAgent[]): Array<Record<string, unknown>> {
  return transitions.slice(0, 10).map((t) => {
    const name = t.agent_name ?? `Agent #${t.agent_id}`;
    const verb = KIND_VERB[t.kind] ?? t.kind;
    const flagsAdded = flagsToNames(t.to_flags & ~(t.from_flags ?? 0));
    const flagsRemoved = flagsToNames((t.from_flags ?? 0) & ~t.to_flags);
    const detail: string[] = [];
    if (t.from_tier) detail.push(`From: \`${t.from_tier}\``);
    detail.push(`Now: \`${t.to_tier}\``);
    if (flagsAdded.length) detail.push(`Flags + : ${flagsAdded.join(', ')}`);
    if (flagsRemoved.length) detail.push(`Flags − : ${flagsRemoved.join(', ')}`);
    return {
      title: `${name} ${verb} ${t.to_tier}`,
      url: `https://caliber.poko.blue/passport/${t.chain_id}/${t.agent_id}`,
      description: detail.join(' · '),
      color: TIER_COLOR[t.to_tier] ?? 0x94a3b8,
      footer: { text: `caliber · methodology v${t.methodology_version} · ${t.kind}` },
      timestamp: t.at.toISOString(),
    };
  });
}

async function postToDiscord(
  webhookUrl: string,
  embeds: Array<Record<string, unknown>>,
): Promise<{ ok: boolean; status: number; body?: string }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        content: `**Caliber Watchlist** · ${embeds.length} new event${embeds.length === 1 ? '' : 's'}`,
        embeds,
      }),
      signal: ctrl.signal,
    });
    if (res.status === 429) {
      // Honor Discord's rate-limit retry hint
      const retryAfter = Number(res.headers.get('retry-after') ?? '5');
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return { ok: false, status: 429, body: 'rate-limited; will retry next run' };
    }
    if (res.status >= 200 && res.status < 300) return { ok: true, status: res.status };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: body.slice(0, 200) };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : 'fetch failed' };
  } finally {
    clearTimeout(timer);
  }
}

export async function dispatchWebhooks(snapshotStartedAt: Date): Promise<void> {
  // Pull all transitions written during this snapshot run + the agent name for each.
  const rows = (await rawSql.unsafe(
    `
    SELECT
      t.id::text AS id,
      t.chain_id AS chain_id,
      t.agent_id::text AS agent_id,
      t.at AS at,
      t.kind AS kind,
      t.from_tier AS from_tier,
      t.to_tier AS to_tier,
      t.from_flags AS from_flags,
      t.to_flags AS to_flags,
      t.methodology_version AS methodology_version,
      a.name AS agent_name
    FROM tier_transitions t
    LEFT JOIN agents a ON a.agent_id = t.agent_id
    WHERE t.at >= $1
    ORDER BY t.at, t.id;
  `,
    [snapshotStartedAt.toISOString()],
  )) as TransitionWithAgent[];

  if (rows.length === 0) {
    console.log('[dispatch] no new transitions to fan out');
    return;
  }

  const subscribers = await db
    .select()
    .from(watchlistWebhooks)
    .where(eq(watchlistWebhooks.status, 'active'));

  if (subscribers.length === 0) {
    console.log(`[dispatch] ${rows.length} transitions, 0 subscribers — nothing to send`);
    return;
  }

  console.log(`[dispatch] ${rows.length} transitions × ${subscribers.length} active subscribers`);

  for (const sub of subscribers) {
    const filter = sub.kindFilter;
    const kinds = filter === '*' ? null : new Set(filter.split(',').map((s) => s.trim()));
    const filtered = rows.filter((r) => !kinds || kinds.has(r.kind));
    if (filtered.length === 0) continue;

    // Send in 10-embed chunks (Discord's per-message embed cap).
    let dispatched = 0;
    let lastResult: Awaited<ReturnType<typeof postToDiscord>> | null = null;
    for (let i = 0; i < filtered.length; i += 10) {
      const chunk = filtered.slice(i, i + 10);
      const res = await postToDiscord(sub.webhookUrl, buildEmbeds(chunk));
      lastResult = res;
      if (!res.ok) break;
      dispatched += chunk.length;
      // Tiny pause between chunks to be a polite Discord client.
      if (i + 10 < filtered.length) await new Promise((r) => setTimeout(r, 800));
    }

    if (lastResult?.ok) {
      await db
        .update(watchlistWebhooks)
        .set({ lastFiredAt: new Date(), consecutiveFailures: 0, lastError: null, lastErrorAt: null })
        .where(eq(watchlistWebhooks.id, sub.id));
      console.log(`[dispatch] webhook=${sub.id} sent=${dispatched}`);
    } else {
      const fails = (sub.consecutiveFailures ?? 0) + 1;
      const shouldPause = fails >= 3;
      await db
        .update(watchlistWebhooks)
        .set({
          consecutiveFailures: fails,
          lastErrorAt: new Date(),
          lastError: `${lastResult?.status ?? 0} ${lastResult?.body ?? 'unknown'}`,
          status: shouldPause ? 'paused' : 'active',
        })
        .where(eq(watchlistWebhooks.id, sub.id));
      console.warn(
        `[dispatch] webhook=${sub.id} failed (${fails} consecutive)${shouldPause ? ' — paused' : ''}`,
      );
    }
  }
}

// Only auto-run when invoked directly. When this file is imported (e.g. by
// backfill-transitions.ts which reuses computeTransitions), don't fire main().
if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error('[snapshot] failed:', err);
      process.exit(1);
    });
}
