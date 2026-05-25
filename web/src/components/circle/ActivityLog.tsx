'use client';

import { useEffect, useRef } from 'react';

/* ──────────────────────────────────────────────────────────────────────────
 * ActivityLog — non-blocking bottom-right panel that streams the steps of a
 * multi-step flow (Circle hire, Circle sign-in, MetaMask hire) so the user
 * sees what's happening between popups and judges see which Circle SDK
 * methods are being invoked.
 *
 * Steps lifecycle:
 *   pending   → grey dot         (queued)
 *   running   → copper spinner   (current step)
 *   ok        → green check      (completed)
 *   error     → red X            (failed)
 *
 * Each step's `detail` shows the specific API call or SDK method so the
 * judge can read "POST /v1/w3s/.../createChallenge · Circle SDK", etc.
 * ────────────────────────────────────────────────────────────────────────── */

export type StepStatus = 'pending' | 'running' | 'ok' | 'error';

export interface ActivityStep {
  id: string;
  label: string;
  /** Subtitle line — API method, SDK call, contract function. */
  detail?: string;
  status: StepStatus;
  /** Free-text result shown when status === 'ok' (e.g., tx hash). */
  result?: string;
}

interface Props {
  open: boolean;
  title?: string;
  steps: ActivityStep[];
  /** Optional close handler — when omitted, panel can't be dismissed. */
  onClose?: () => void;
}

function StatusGlyph({ status }: { status: StepStatus }) {
  if (status === 'running') {
    return (
      <span
        className="inline-block w-3 h-3 rounded-full border-2 border-[var(--color-copper)] border-t-transparent animate-spin shrink-0 mt-0.5"
        aria-label="running"
      />
    );
  }
  if (status === 'ok') {
    return (
      <span
        className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-[var(--color-signal-up)] text-white shrink-0 mt-0.5"
        aria-label="completed"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M1 4l2 2 4-5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span
        className="inline-flex items-center justify-center w-3 h-3 rounded-full bg-[var(--color-signal-down)] text-white shrink-0 mt-0.5"
        aria-label="failed"
      >
        <svg width="8" height="8" viewBox="0 0 8 8" fill="none">
          <path d="M2 2l4 4M6 2l-4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </span>
    );
  }
  return (
    <span
      className="inline-block w-3 h-3 rounded-full border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] shrink-0 mt-0.5"
      aria-label="pending"
    />
  );
}

export function ActivityLog({ open, title = 'activity', steps, onClose }: Props) {
  const listRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the currently-running step so judges always see the
  // latest action without manually scrolling.
  useEffect(() => {
    if (!listRef.current) return;
    const running = listRef.current.querySelector<HTMLElement>('[data-step-running="true"]');
    if (running) running.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [steps]);

  if (!open) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed z-[60] bottom-4 right-4 left-4 sm:left-auto sm:bottom-6 sm:right-6 sm:w-[360px] max-h-[70vh] flex flex-col border border-[var(--color-hairline)] bg-white rounded-[2px] shadow-[0_6px_24px_rgba(14,17,22,0.18)]"
    >
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-hairline)] bg-[var(--color-bg-elev)]">
        <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-mute)]">
          //{title}
        </span>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="text-[var(--color-mute)] hover:text-[var(--color-ink)] text-sm leading-none"
            aria-label="dismiss"
          >
            ×
          </button>
        )}
      </div>
      <div ref={listRef} className="overflow-y-auto px-3 py-3 space-y-2.5">
        {steps.map((step) => (
          <div
            key={step.id}
            data-step-running={step.status === 'running' ? 'true' : 'false'}
            className="flex items-start gap-2"
          >
            <StatusGlyph status={step.status} />
            <div className="flex-1 min-w-0">
              <div
                className={
                  'text-[13px] leading-snug ' +
                  (step.status === 'pending'
                    ? 'text-[var(--color-mute)]'
                    : 'text-[var(--color-ink)]')
                }
              >
                {step.label}
              </div>
              {step.detail && (
                <div className="font-mono text-[10px] text-[var(--color-mute)] mt-0.5 break-all">
                  {step.detail}
                </div>
              )}
              {step.result && step.status === 'ok' && (
                <div className="font-mono text-[10px] text-[var(--color-signal-up)] mt-0.5 break-all">
                  {step.result}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
