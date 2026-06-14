// Readable, structured render of a compiled Steward policy. Shared by the
// server page (current policy) and the client editor (newly compiled policy),
// so the two can never render the same policy differently.
//
// A compiled policy is the machine form Steward actually enforces. We surface
// the fields a human owner cares about — caps, allow/deny hosts, approval
// threshold, new-counterparty rule, min rating — as plain rows, NOT raw JSON.
// Any unrecognized key falls back to a pretty-printed value so nothing is ever
// silently dropped.

import type { ReactNode } from 'react';

// Mirrors packages/steward-core CompiledPolicySchema. Kept structural (all
// optional beyond the required core) so an older/newer service shape still
// renders without throwing.
export interface CompiledPolicy {
  version?: number;
  caps?: {
    perTxUsdc?: string;
    dailyUsdc?: string;
    perCounterpartyDailyUsdc?: string;
  };
  allowedHosts?: string[];
  deniedHosts?: string[];
  approvalThresholdUsdc?: string;
  newCounterparty?: 'allow' | 'hold' | 'sandbox';
  sandboxCapUsdc?: string;
  minCaliberScore?: number;
  [key: string]: unknown;
}

const KNOWN_KEYS = new Set([
  'version',
  'caps',
  'allowedHosts',
  'deniedHosts',
  'approvalThresholdUsdc',
  'newCounterparty',
  'sandboxCapUsdc',
  'minCaliberScore',
]);

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 px-3 py-2.5 border-b border-[var(--color-hairline)] last:border-b-0">
      <span className="font-mono text-[10px] uppercase tracking-[0.06em] text-[var(--color-mute)] shrink-0">
        {label}
      </span>
      <span className="text-right text-sm text-[var(--color-ink)] leading-snug">
        {children}
      </span>
    </div>
  );
}

function Usd({ value }: { value: string }) {
  return (
    <span className="font-mono tabular-nums text-[var(--color-ink)]">
      ${value}
    </span>
  );
}

const NEW_CP_COPY: Record<string, string> = {
  allow: 'Pay immediately',
  hold: 'Hold the first payment for approval',
  sandbox: 'Allow up to a small sandbox cap',
};

export function PolicyView({ policy }: { policy: CompiledPolicy | null }) {
  if (!policy) {
    return (
      <div className="border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-paper)] px-3 py-6 text-sm text-[var(--color-mute)]">
        No compiled policy on record yet.
      </div>
    );
  }

  const caps = policy.caps ?? {};
  const unknown = Object.keys(policy).filter((k) => !KNOWN_KEYS.has(k));

  return (
    <div className="border border-[var(--color-hairline)] rounded-[2px] bg-[var(--color-paper)] overflow-hidden">
      {caps.perTxUsdc !== undefined && (
        <Row label="per-payment cap">
          <Usd value={caps.perTxUsdc} />
        </Row>
      )}
      {caps.dailyUsdc !== undefined && (
        <Row label="daily cap">
          <Usd value={caps.dailyUsdc} />
        </Row>
      )}
      {caps.perCounterpartyDailyUsdc !== undefined && (
        <Row label="per-counterparty daily cap">
          <Usd value={caps.perCounterpartyDailyUsdc} />
        </Row>
      )}
      {policy.approvalThresholdUsdc !== undefined && (
        <Row label="needs approval above">
          <Usd value={policy.approvalThresholdUsdc} />
        </Row>
      )}
      <Row label="new counterparty">
        {NEW_CP_COPY[policy.newCounterparty ?? ''] ??
          policy.newCounterparty ??
          'Hold the first payment for approval'}
        {policy.newCounterparty === 'sandbox' &&
          policy.sandboxCapUsdc !== undefined && (
            <span className="text-[var(--color-mute)]">
              {' '}
              (<Usd value={policy.sandboxCapUsdc} />)
            </span>
          )}
      </Row>
      {policy.allowedHosts && policy.allowedHosts.length > 0 && (
        <Row label="allowed hosts only">
          <span className="font-mono text-xs break-all">
            {policy.allowedHosts.join(', ')}
          </span>
        </Row>
      )}
      {policy.deniedHosts && policy.deniedHosts.length > 0 && (
        <Row label="never pay">
          <span className="font-mono text-xs break-all">
            {policy.deniedHosts.join(', ')}
          </span>
        </Row>
      )}
      {policy.minCaliberScore !== undefined && (
        <Row label="min provider rating">
          <span className="font-mono tabular-nums">
            {policy.minCaliberScore}
          </span>
        </Row>
      )}

      {/* Pretty-print fallback for any key we don't have a friendly row for. */}
      {unknown.map((k) => (
        <Row key={k} label={k}>
          <span className="font-mono text-xs break-all text-[var(--color-mute)]">
            {typeof policy[k] === 'object'
              ? JSON.stringify(policy[k])
              : String(policy[k])}
          </span>
        </Row>
      ))}
    </div>
  );
}
