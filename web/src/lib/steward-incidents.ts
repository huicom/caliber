// Shared presentation helpers for Steward incidents — kept out of the page
// components so the list, the detail page, and the overview all derive the
// same colors and the same one-line summaries from a single place.

export const INCIDENT_KINDS = [
  'runaway_loop',
  'price_spike',
  'redirect',
  'new_counterparty',
  'conformance',
  'sdn_hit',
  'settle_mismatch',
] as const;

export type IncidentKind = (typeof INCIDENT_KINDS)[number];

// One distinct accent per kind. Values are raw colors (not CSS vars) so they
// can be inlined into both badge fg and a translucent bg.
const KIND_COLOR: Record<string, string> = {
  redirect: '#b42318', // red — funds being diverted
  sdn_hit: '#7f1d1d', // dark red — sanctions
  settle_mismatch: '#b45309', // amber-brown — paid ≠ authorized
  price_spike: '#a16207', // gold — overcharge
  runaway_loop: '#6d28d9', // violet — loop
  new_counterparty: '#1d4ed8', // blue — unknown payee
  conformance: '#0f766e', // teal — bad delivery
};

const KIND_LABEL: Record<string, string> = {
  redirect: 'redirect',
  sdn_hit: 'sdn hit',
  settle_mismatch: 'settle mismatch',
  price_spike: 'price spike',
  runaway_loop: 'runaway loop',
  new_counterparty: 'new counterparty',
  conformance: 'conformance',
};

export function kindColor(kind: string): string {
  return KIND_COLOR[kind] ?? '#52525b';
}

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind.replace(/_/g, ' ');
}

function short(addr: unknown): string {
  const s = String(addr ?? '');
  if (/^0x[0-9a-fA-F]{8,}$/.test(s)) return `${s.slice(0, 6)}…${s.slice(-4)}`;
  return s || '?';
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

type Evidence = Record<string, unknown> | null | undefined;

// One-line, human summary derived from the evidence jsonb. Each kind gets a
// tailored sentence; anything we don't recognise falls back to a compact
// key/value join so the row is never blank.
export function incidentSummary(kind: string, evidence: Evidence): string {
  const e = (evidence ?? {}) as Record<string, unknown>;
  switch (kind) {
    case 'redirect': {
      const exp = short(e.expected);
      const got = short(e.got);
      return `payTo changed — expected ${exp}, got ${got}`;
    }
    case 'price_spike': {
      const q = num(e.quoted ?? e.quotedUsdc);
      const m = num(e.median ?? e.medianUsdc);
      const mult =
        q != null && m != null && m > 0 ? `${Math.round(q / m)}×` : null;
      if (q != null && m != null) {
        return `quoted ${q} vs median ${m}${mult ? ` (${mult})` : ''}`;
      }
      return 'quote far above the trailing median';
    }
    case 'runaway_loop': {
      const n = num(e.count ?? e.payments);
      const mins = num(e.windowMinutes ?? e.minutes);
      if (n != null && mins != null) {
        return `${n} payments in ${mins} min — route paused`;
      }
      return 'too many payments to one host in a short window — route paused';
    }
    case 'new_counterparty': {
      return `first-ever payee ${short(e.payTo ?? e.got)} — held for review`;
    }
    case 'sdn_hit': {
      const src = e.source ? ` (${String(e.source)})` : '';
      return `OFAC SDN match on ${short(e.payTo ?? e.address)}${src} — denied`;
    }
    case 'settle_mismatch': {
      const a = num(e.authorized ?? e.authorizedUsdc);
      const s = num(e.settled ?? e.settledUsdc);
      if (a != null && s != null) {
        return `settled ${s} but authorized ${a} — post-settle mismatch`;
      }
      return 'settled amount or recipient differed from what was authorized';
    }
    case 'conformance': {
      const r = e.reason ?? e.check;
      return r
        ? `delivery failed conformance: ${String(r)}`
        : 'delivery failed Tier-0 conformance checks';
    }
    default: {
      const parts = Object.entries(e)
        .slice(0, 4)
        .map(([k, v]) => `${k} ${typeof v === 'object' ? JSON.stringify(v) : short(v)}`);
      return parts.length ? parts.join(' · ') : 'see detail';
    }
  }
}

// Field labels for the detail-page definition list. Unknown keys fall back to
// their raw name; their values are pretty-printed JSON.
export const EVIDENCE_LABELS: Record<string, string> = {
  expected: 'Expected payTo',
  got: 'Observed payTo',
  payTo: 'Counterparty',
  address: 'Address',
  url: 'Endpoint',
  quoted: 'Quoted (USDC)',
  quotedUsdc: 'Quoted (USDC)',
  median: 'Trailing median (USDC)',
  medianUsdc: 'Trailing median (USDC)',
  authorized: 'Authorized (USDC)',
  authorizedUsdc: 'Authorized (USDC)',
  settled: 'Settled (USDC)',
  settledUsdc: 'Settled (USDC)',
  count: 'Payment count',
  payments: 'Payment count',
  windowMinutes: 'Window (minutes)',
  minutes: 'Window (minutes)',
  source: 'Screening source',
  checkedAt: 'Screened at',
  reason: 'Reason',
  check: 'Failed check',
};
