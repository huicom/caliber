// The Bonded Broker match flow (Lepton Phase 2, B2).
//
// Per request: discover candidates over the public Caliber API, BUY an
// attestation for each shortlisted provider through the metered x402 endpoint
// (the broker is Caliber Metered's best customer — this is the multi-hop
// payment chain), score them, apply the decline rule, and on accept price the
// bond + (if a real job + deployed contract exist) post it on-chain. Every
// step is appended to decision_log for the console's reasoning stream.

import { db, brokerMatches } from '@arc-agents/db';
import { CaliberPayer } from '@caliber/x402-client';
import { config, requireBrokerKey } from './config.js';
import { evaluateCandidate, type Candidate, type Tier, type Verdict } from './bond.js';
import { postBondOnChain } from './chain.js';

const TIER_ORDINAL: Record<Tier, number> = { Gold: 0, Silver: 1, Bronze: 2, Pending: 3, Watch: 4, Dormant: 5 };

export interface MatchRequest {
  requesterAddr: string;
  jobValueUsdc: number;
  category?: string;
  query?: string;
  minTier?: Tier;
  maxFeeUsdc?: number;
  /** Optional real ERC-8183 job to bond against (else evaluation-only). */
  jobId?: string;
}

interface Step {
  step: string;
  detail: string;
  ref?: string;
}

export interface MatchResult {
  matchId: string;
  status: 'declined' | 'matched' | 'bonded';
  providerId: string | null;
  feeUsdc: number;
  bondUsdc: number | null;
  bondId: string | null;
  txHash: string | null;
  attestationsBought: number;
  declineReason: string | null;
  decisionLog: Step[];
}

interface SearchHit {
  agent_id: string;
  name?: string;
  tier?: string | null;
}

async function discover(req: MatchRequest): Promise<SearchHit[]> {
  const q = encodeURIComponent(req.query || req.category || '');
  // Over-fetch: most agents are unrated, so we triage a larger pool down to
  // maxCandidates *rated* providers before paying for any attestation.
  const url = `${config.webBase}/api/v1/search?q=${q}&limit=${config.maxCandidates * 8}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`search ${res.status}`);
  const body = (await res.json()) as { results?: SearchHit[] };
  return body.results ?? [];
}

interface TriageJson {
  rated: boolean;
  tier?: string;
  score?: number;
  flags?: string[];
  reason?: string;
}
async function freeTriage(agentId: string): Promise<TriageJson> {
  const res = await fetch(`${config.apiBase}/v1/agents/arc/${agentId}/rating`);
  return (await res.json()) as TriageJson;
}

export async function runMatch(req: MatchRequest): Promise<MatchResult> {
  const log: Step[] = [];
  const payer = new CaliberPayer({ privateKey: requireBrokerKey(), apiBase: config.apiBase });
  let attestationsBought = 0;

  log.push({ step: 'request', detail: `match for ${req.requesterAddr.slice(0, 10)}… · job value $${req.jobValueUsdc.toFixed(2)}${req.category ? ` · ${req.category}` : ''}${req.minTier ? ` · min ${req.minTier}` : ''}` });

  const hits = await discover(req);
  log.push({ step: 'discover', detail: `${hits.length} candidate(s) from public search` });

  // Triage on the free rating first (cheap), then BUY a signed attestation only
  // for rated providers — the multi-hop nanopayments, without wasting USDC on
  // unrated agents (which would also 422 the paid call).
  const candidates: Candidate[] = [];
  for (const h of hits) {
    if (candidates.length >= config.maxCandidates) break;
    let triage: TriageJson;
    try {
      triage = await freeTriage(h.agent_id);
    } catch {
      continue;
    }
    if (!triage.rated) continue;
    try {
      const r = await payer.payForAttestation(h.agent_id, { minTier: 'Dormant', minConfidence: 'insufficient' });
      if (r.status >= 200 && r.status < 300 && r.data.tier) {
        attestationsBought += 1;
        const tier = r.data.tier as Tier;
        const score = r.data.score ?? triage.score ?? 0;
        const flags = r.data.flags ?? triage.flags ?? [];
        candidates.push({ agentId: h.agent_id, tier, score, flags });
        log.push({ step: 'attestation', detail: `bought attestation for #${h.agent_id} → ${tier} score ${score}${flags.length ? ` flags [${flags.join(', ')}]` : ''}`, ref: r.payment.transaction });
      } else {
        log.push({ step: 'attestation', detail: `#${h.agent_id} unrated (${r.data.reason ?? 'n/a'}) — dropped` });
      }
    } catch (e) {
      log.push({ step: 'attestation', detail: `#${h.agent_id} attestation purchase failed (${e instanceof Error ? e.message : e}) — dropped` });
    }
  }

  // Apply min-tier filter (if any), then the decline rule to each.
  const evalOpts = { feeBps: config.feeBps, feeMinUsdc: config.feeMinUsdc, marginUsdc: config.marginUsdc, maxFeeUsdc: req.maxFeeUsdc };
  let best: { c: Candidate; v: Verdict } | null = null;
  for (const c of candidates) {
    if (req.minTier && TIER_ORDINAL[c.tier] > TIER_ORDINAL[req.minTier]) {
      log.push({ step: 'evaluate', detail: `#${c.agentId} ${c.tier} below requested min ${req.minTier} — skipped` });
      continue;
    }
    const v = evaluateCandidate(c, req.jobValueUsdc, evalOpts);
    log.push({ step: v.accept ? 'accept' : 'decline', detail: v.reason });
    if (v.accept && (!best || c.score > best.c.score)) best = { c, v };
  }

  // No acceptable candidate → decline the match.
  if (!best) {
    const reason = candidates.length === 0 ? 'no rated candidates found' : 'no candidate clears the decline rule';
    log.push({ step: 'verdict', detail: `match declined — ${reason}` });
    const [row] = await db.insert(brokerMatches).values({
      requesterAddr: req.requesterAddr, jobId: req.jobId ? BigInt(req.jobId) : null, providerId: null,
      status: 'declined', attestationsBought, declineReason: reason, decisionLog: log,
    }).returning({ id: brokerMatches.id });
    return { matchId: String(row.id), status: 'declined', providerId: null, feeUsdc: 0, bondUsdc: null, bondId: null, txHash: null, attestationsBought, declineReason: reason, decisionLog: log };
  }

  const { c, v } = best;
  log.push({ step: 'verdict', detail: `matched #${c.agentId} (${c.tier}) · fee $${v.feeUsdc.toFixed(4)} · bond $${(v.bondUsdc ?? 0).toFixed(2)}` });

  // Post the bond on-chain if we have a real job and a deployed contract.
  let bondId: string | null = null;
  let txHash: string | null = null;
  let status: MatchResult['status'] = 'matched';
  if (req.jobId && config.brokerBondAddress && v.bondUsdc != null) {
    try {
      const res = await postBondOnChain(BigInt(req.jobId), req.requesterAddr as `0x${string}`, v.bondUsdc);
      bondId = String(res.bondId);
      txHash = res.txHash;
      status = 'bonded';
      log.push({ step: 'bond', detail: `bond $${(v.bondUsdc).toFixed(2)} posted on-chain · bondId ${bondId}`, ref: txHash });
    } catch (e) {
      log.push({ step: 'bond', detail: `bond post failed (${e instanceof Error ? e.message : e}) — left as matched` });
    }
  }

  const [row] = await db.insert(brokerMatches).values({
    requesterAddr: req.requesterAddr, jobId: req.jobId ? BigInt(req.jobId) : null, providerId: BigInt(c.agentId),
    status, feeUsdc: v.feeUsdc.toFixed(6), bondUsdc: (v.bondUsdc ?? 0).toFixed(6), bondId: bondId ? BigInt(bondId) : null,
    attestationsBought, declineReason: null, decisionLog: log,
  }).returning({ id: brokerMatches.id });

  return { matchId: String(row.id), status, providerId: c.agentId, feeUsdc: v.feeUsdc, bondUsdc: v.bondUsdc, bondId, txHash, attestationsBought, declineReason: null, decisionLog: log };
}
