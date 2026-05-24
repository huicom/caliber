'use client';

import { useState, useEffect, useMemo } from 'react';
import { api, type CaliberTier } from '@/lib/api';

/* ──────────────────────────────────────────────────────────────────────────
 * AgentPicker — inline searchable/filterable list of demo-ready rated agents.
 *
 *  - Pulls top-rated rated agents on mount, filtered to moderate+ confidence
 *    so a clicked agent always passes the basic-mode attestation gate.
 *  - Tier filter chips: "≥ Established" / "≥ Proven" / "≥ Emerging" / "≥ Provisional".
 *    Selecting "≥ Emerging" shows agents at Established | Proven | Emerging.
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
  /** Filter floor (lower ordinal = stronger tier). 3 = Provisional or better. */
  minTierOrdinal: number;
  /** When true, show the tier-filter chips. When false (basic mode), hide them. */
  showTierFilter?: boolean;
}

const TIER_ORDINAL: Record<CaliberTier, number> = {
  Established: 0,
  Proven: 1,
  Emerging: 2,
  Provisional: 3,
  Watch: 4,
  Inactive: 5,
};

const TIER_LABEL: Record<number, string> = {
  0: 'Established',
  1: 'Proven',
  2: 'Emerging',
  3: 'Provisional',
};

const TIER_COLOR: Record<CaliberTier, string> = {
  Established: 'text-[#047857] bg-[#E6F7F2] border-[#00B894]/40',
  Proven: 'text-[#075985] bg-[#E0F2FE] border-[#0EA5E9]/40',
  Emerging: 'text-[#0F766E] bg-[#CCFBF1] border-[#14B8A6]/40',
  Provisional: 'text-[#475569] bg-[#F1F5F9] border-[#94A3B8]/40',
  Watch: 'text-[#B45309] bg-[#FEF3E2] border-[#F59E0B]/40',
  Inactive: 'text-[#111827] bg-[#E5E7EB] border-[#1F2937]/40',
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
        const list = await api.agents({ sort: 'rating', limit: 100, ratedOnly: 'true' });
        const ids = list.agents.map((a) => a.agentId);
        if (ids.length === 0) {
          if (!cancelled) setLoading(false);
          return;
        }
        const ratings = await api.bulkRatings('arc', ids);
        const ratingMap = Object.fromEntries(ratings.ratings.map((r) => [r.agent_id, r]));
        if (cancelled) return;
        const agents: Agent[] = list.agents
          .map((a) => ({
            id: a.agentId,
            name: a.name ?? `Agent #${a.agentId}`,
            tier: (ratingMap[a.agentId]?.tier ?? 'Provisional') as CaliberTier,
            jobs: a.jobsCompleted ?? 0,
            score: ratingMap[a.agentId]?.score ?? 0,
            confidence: ratingMap[a.agentId]?.confidence ?? 'low',
            category: a.agentType ?? null,
          }))
          .filter((a) => {
            const r = ratingMap[a.id];
            return (
              r?.rated &&
              (r.confidence === 'high' || r.confidence === 'moderate') &&
              TIER_ORDINAL[a.tier as CaliberTier] <= 3 // Watch + Inactive excluded
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
