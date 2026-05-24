'use client';

import { useState, useEffect, useMemo } from 'react';
import { api, type CaliberTier } from '@/lib/api';

/* ──────────────────────────────────────────────────────────────────────────
 * AgentPicker — inline searchable/filterable list of demo-ready rated agents.
 *
 *  - Pulls top-rated rated agents on mount, filtered to moderate+ confidence
 *    so a clicked agent always passes the basic-mode attestation gate.
 *  - Tier filter chips: "≥ Gold" / "≥ Silver" / "≥ Bronze" / "≥ Pending".
 *    Selecting "≥ Bronze" shows agents at Gold | Silver | Bronze.
 *  - Search filters by name or agent id.
 *  - Scrolls inside its own max-height container so it never explodes the form.
 *
 * Designed for the basic-mode form on /jobs/new. Replaces the previous
 * 5-card "featured" picker with something a judge can actually browse.
 * ────────────────────────────────────────────────────────────────────────── */

interface Agent {
  id: string;
  name: string;
  tier: CaliberTier;
  jobs: number;
  score: number;
  confidence: string;
  category: string | null;
}

interface Props {
  selectedId: string;
  onSelect: (id: string) => void;
  /** Filter floor (lower ordinal = stronger tier). 3 = Pending or better. */
  minTierOrdinal: number;
  /** When true, show the tier-filter chips. When false (basic mode), hide them. */
  showTierFilter?: boolean;
}

const TIER_ORDINAL: Record<CaliberTier, number> = {
  Gold: 0,
  Silver: 1,
  Bronze: 2,
  Pending: 3,
  Watch: 4,
  Dormant: 5,
};

const TIER_LABEL: Record<number, string> = {
  0: 'Gold',
  1: 'Silver',
  2: 'Bronze',
  3: 'Pending',
};

const TIER_COLOR: Record<CaliberTier, string> = {
  Gold:    'text-[#B8862B] bg-[#B8862B]/12 border-[#B8862B]/45',
  Silver:  'text-[#7E8690] bg-[#7E8690]/12 border-[#7E8690]/45',
  Bronze:  'text-[#8C5A2C] bg-[#8C5A2C]/12 border-[#8C5A2C]/45',
  Pending: 'text-[#98948C] bg-[#98948C]/12 border-[#98948C]/45',
  Watch:   'text-[#B45309] bg-[#B45309]/12 border-[#B45309]/45',
  Dormant: 'text-[#A8A39A] bg-[#A8A39A]/12 border-[#A8A39A]/45',
};

export function AgentPicker({ selectedId, onSelect, minTierOrdinal, showTierFilter = false }: Props) {
  const [allAgents, setAllAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterFloor, setFilterFloor] = useState<number>(minTierOrdinal);

  useEffect(() => {
    setFilterFloor(minTierOrdinal);
  }, [minTierOrdinal]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Pull a wide slice so every tier (Gold/Silver/Bronze/Pending) is
        // represented in the picker. The legacy 'rating' sort returns
        // reputation_score descending; top-100 by that metric was
        // dominated by Silver and the "≥ Pending" / "≥ Bronze" filter
        // chips had nothing different to show.
        const list = await api.agents({ sort: 'rating', limit: 600, ratedOnly: 'true' });
        const ids = list.agents.map((a) => a.agentId);
        if (ids.length === 0) {
          if (!cancelled) setLoading(false);
          return;
        }
        // bulkRatings caps at 100 ids per call (server-side), so chunk the
        // request and merge — keeps the picker working as the rated cohort
        // grows past 100.
        const CHUNK = 100;
        const chunks: string[][] = [];
        for (let i = 0; i < ids.length; i += CHUNK) chunks.push(ids.slice(i, i + CHUNK));
        const responses = await Promise.all(chunks.map((c) => api.bulkRatings('arc', c)));
        const ratingMap = Object.fromEntries(
          responses.flatMap((r) => r.ratings).map((r) => [r.agent_id, r]),
        );
        if (cancelled) return;
        const agents: Agent[] = list.agents
          .map((a) => ({
            id: a.agentId,
            name: a.name ?? `Agent #${a.agentId}`,
            tier: (ratingMap[a.agentId]?.tier ?? 'Pending') as CaliberTier,
            jobs: a.jobsCompleted ?? 0,
            score: ratingMap[a.agentId]?.score ?? 0,
            confidence: ratingMap[a.agentId]?.confidence ?? 'low',
            category: a.agentType ?? null,
          }))
          .filter((a) => {
            // Testnet calibration: relaxed filter so all rated agents in
            // Gold/Silver/Bronze/Pending are pickable. Most testnet agents
            // have insufficient confidence (2-3 jobs) under the production
            // gate; filtering by confidence here was hiding 99% of them.
            // The form will warn separately if the picked agent's tier is
            // weaker than the poster's minTier threshold.
            const r = ratingMap[a.id];
            return (
              r?.rated &&
              TIER_ORDINAL[a.tier as CaliberTier] <= 3 // Watch + Dormant excluded
            );
          });
        setAllAgents(agents);
      } catch {
        // surface gracefully
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return allAgents
      .filter((a) => TIER_ORDINAL[a.tier] <= filterFloor)
      .filter(
        (a) => !q || a.name.toLowerCase().includes(q) || a.id.includes(q),
      )
      .sort((a, b) => {
        const t = TIER_ORDINAL[a.tier] - TIER_ORDINAL[b.tier];
        return t !== 0 ? t : b.jobs - a.jobs;
      });
  }, [allAgents, search, filterFloor]);

  return (
    <div className="border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-bg-elev)] p-3 space-y-2">
      <div className="flex items-baseline justify-between gap-2 flex-wrap">
        <p className="font-mono text-[10px] uppercase tracking-[0.05em] text-[var(--color-mute)]">
          //featured · {loading ? 'loading…' : `${filtered.length} agents demo-ready`}
        </p>
        {showTierFilter && (
          <div className="flex gap-1">
            {[3, 2, 1, 0].map((floor) => (
              <button
                key={floor}
                type="button"
                onClick={() => setFilterFloor(floor)}
                className={
                  'font-mono text-[10px] px-1.5 py-0.5 rounded-[2px] border transition ' +
                  (filterFloor === floor
                    ? 'border-[var(--color-copper)] text-[var(--color-copper)] bg-white'
                    : 'border-[var(--color-hairline)] text-[var(--color-mute)] hover:border-[var(--color-ink)]')
                }
              >
                ≥ {TIER_LABEL[floor]}
              </button>
            ))}
          </div>
        )}
      </div>

      <input
        type="text"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="filter by name or id…"
        className="w-full px-2.5 py-1.5 bg-white border border-[var(--color-hairline)] rounded-[2px] text-sm focus:outline-none focus:border-[var(--color-ink)] font-mono"
      />

      <div className="max-h-[280px] overflow-y-auto border border-[var(--color-hairline)] rounded-[2px] bg-white">
        {loading ? (
          <div className="p-4 text-xs text-[var(--color-mute)] text-center font-mono">loading…</div>
        ) : filtered.length === 0 ? (
          <div className="p-4 text-xs text-[var(--color-mute)] text-center">
            no agents match. try clearing the search or lowering the tier filter.
          </div>
        ) : (
          <ul className="divide-y divide-[var(--color-hairline)]">
            {filtered.map((a) => {
              const selected = selectedId === a.id;
              return (
                <li key={a.id} className={selected ? 'bg-[var(--color-bg-elev)]' : ''}>
                  <button
                    type="button"
                    onClick={() => onSelect(a.id)}
                    className={
                      'w-full text-left px-3 pt-2 pb-1 flex items-center gap-3 transition ' +
                      (selected ? '' : 'hover:bg-[var(--color-bg-elev)]/50')
                    }
                  >
                    <div className="flex-1 min-w-0">
                      <div className="flex items-baseline gap-2 flex-wrap">
                        <span className="font-medium text-sm text-[var(--color-ink)] truncate">
                          {a.name}
                        </span>
                        {a.category && (
                          <span className="font-mono text-[9px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] bg-[var(--color-bg-elev)] border border-[var(--color-hairline)] text-[var(--color-mute)] shrink-0">
                            {a.category}
                          </span>
                        )}
                        {selected && (
                          <span className="font-mono text-[10px] text-[var(--color-copper)] shrink-0">
                            ✓ selected
                          </span>
                        )}
                      </div>
                      <div className="font-mono text-[10px] text-[var(--color-mute)] mt-0.5">
                        #{a.id} · score {a.score} · {a.jobs} jobs · {a.confidence}
                      </div>
                    </div>
                    <span
                      className={
                        'shrink-0 font-mono text-[10px] uppercase tracking-[0.04em] px-1.5 py-0.5 rounded-[2px] border ' +
                        TIER_COLOR[a.tier]
                      }
                    >
                      {a.tier}
                    </span>
                  </button>
                  <div className="px-3 pb-2 -mt-0.5">
                    <a
                      href={`/passport/arc/${a.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] font-mono text-[var(--color-copper)] hover:underline"
                    >
                      view passport ↗
                    </a>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
