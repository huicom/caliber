'use client';

import { useState } from 'react';
import { PolicyView, type CompiledPolicy } from './PolicyView';

// The mandate editor. The human owner writes their spending policy in plain
// English; "Compile & activate" POSTs to /api/steward/mandate which proxies the
// Steward service's LLM mandate-compiler. The current (active) policy stays
// visible and enforced no matter what happens here — the deterministic mandate
// is always in force; this editor only changes what it says.
//
// The compiler can be unavailable in two non-error ways:
//   503 treasurer_disabled — the LLM master switch is off. NOT an error: the
//        existing mandate is still enforced; the owner just can't edit in plain
//        English until they turn the treasurer back on.
//   502 compile_failed (kind=credits) — temporarily out of LLM credits.
// We present both as calm, informative states, never as a crash.

interface MandateMeta {
  id: string;
  rawText: string;
  version: number;
}

interface CompileSuccess {
  mandate: MandateMeta;
  policy: CompiledPolicy;
  warnings?: string[];
}

type Banner =
  | { kind: 'success'; version: number; warnings: string[] }
  | { kind: 'treasurer_disabled'; detail?: string }
  | { kind: 'compile_failed_credits' }
  | { kind: 'compile_failed'; detail?: string }
  | { kind: 'unreachable'; detail?: string }
  | { kind: 'error'; detail: string }
  | null;

export function MandateEditor({
  initialRawText,
  initialPolicy,
  initialVersion,
}: {
  initialRawText: string;
  initialPolicy: CompiledPolicy | null;
  initialVersion: number | null;
}) {
  const [text, setText] = useState(initialRawText);
  // The policy we currently show as compiled. Starts as the active one; swaps to
  // the freshly compiled one on success. Always reflects something enforceable.
  const [policy, setPolicy] = useState<CompiledPolicy | null>(initialPolicy);
  const [activeVersion, setActiveVersion] = useState<number | null>(
    initialVersion,
  );
  const [submitting, setSubmitting] = useState(false);
  const [banner, setBanner] = useState<Banner>(null);

  const dirty = text.trim() !== initialRawText.trim();

  async function compile() {
    if (submitting) return;
    setSubmitting(true);
    setBanner(null);

    let res: Response;
    try {
      res = await fetch('/api/steward/mandate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ rawText: text }),
      });
    } catch {
      setBanner({
        kind: 'unreachable',
        detail: 'Could not reach Steward. Your active mandate is unchanged.',
      });
      setSubmitting(false);
      return;
    }

    let data: Record<string, unknown> = {};
    try {
      data = (await res.json()) as Record<string, unknown>;
    } catch {
      // fall through with empty data; handled by status below
    }

    if (res.ok) {
      const ok = data as unknown as CompileSuccess;
      setPolicy(ok.policy ?? null);
      setActiveVersion(ok.mandate?.version ?? null);
      setBanner({
        kind: 'success',
        version: ok.mandate?.version ?? 0,
        warnings: Array.isArray(ok.warnings) ? ok.warnings : [],
      });
      setSubmitting(false);
      return;
    }

    if (res.status === 503 && data.error === 'treasurer_disabled') {
      setBanner({
        kind: 'treasurer_disabled',
        detail: typeof data.detail === 'string' ? data.detail : undefined,
      });
      setSubmitting(false);
      return;
    }

    if (res.status === 503 && data.error === 'steward_unreachable') {
      setBanner({
        kind: 'unreachable',
        detail: typeof data.detail === 'string' ? data.detail : undefined,
      });
      setSubmitting(false);
      return;
    }

    if (res.status === 502 && data.error === 'compile_failed') {
      if (data.kind === 'credits') {
        setBanner({ kind: 'compile_failed_credits' });
      } else {
        setBanner({
          kind: 'compile_failed',
          detail: typeof data.detail === 'string' ? data.detail : undefined,
        });
      }
      setSubmitting(false);
      return;
    }

    setBanner({
      kind: 'error',
      detail:
        typeof data.detail === 'string'
          ? data.detail
          : typeof data.error === 'string'
            ? data.error
            : `Request failed (${res.status}).`,
    });
    setSubmitting(false);
  }

  return (
    <div className="space-y-8">
      {/* Editor */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
            //mandate
          </h2>
          {activeVersion !== null && (
            <span className="font-mono text-[11px] text-[var(--color-mute)]">
              active · v{activeVersion}
            </span>
          )}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          spellCheck={false}
          rows={6}
          placeholder="e.g. Spend at most $0.005 per payment and $0.50 per day. Anything above $0.002 needs my approval. Hold the first payment to anyone new."
          className="w-full resize-y rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-paper)] px-3 py-3 text-[15px] leading-relaxed text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-copper)] transition-colors"
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={compile}
            disabled={submitting || text.trim().length === 0}
            className="font-mono text-xs px-4 py-2 rounded-[2px] border border-[var(--color-ink)] text-[var(--color-paper)] bg-[var(--color-ink)] hover:bg-[var(--color-copper)] hover:border-[var(--color-copper)] disabled:opacity-40 disabled:cursor-not-allowed transition"
          >
            {submitting ? 'compiling…' : 'Compile & activate'}
          </button>
          {dirty && !submitting && (
            <span className="font-mono text-[11px] text-[var(--color-mute)]">
              unsaved edits — not yet enforced
            </span>
          )}
        </div>
      </section>

      {/* Banner / result state */}
      {banner && <ResultBanner banner={banner} />}

      {/* Compiled policy preview — always shown; this is what Steward enforces. */}
      <section>
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
            //compiled_policy{' '}
            {banner?.kind === 'success' ? '(new)' : '(enforcing now)'}
          </h2>
        </div>
        <PolicyView policy={policy} />
        <p className="mt-3 text-xs text-[var(--color-mute)] leading-relaxed max-w-prose">
          This is the structured policy Steward enforces on every payment — the
          deterministic half. It stays in force even when the plain-English
          compiler is unavailable.
        </p>
      </section>
    </div>
  );
}

function ResultBanner({ banner }: { banner: NonNullable<Banner> }) {
  if (banner.kind === 'success') {
    return (
      <div
        className="rounded-[2px] border px-4 py-3"
        style={{
          borderColor: 'var(--color-signal-up)',
          background: 'rgba(15,122,74,0.07)',
        }}
      >
        <p
          className="font-mono text-sm font-semibold"
          style={{ color: 'var(--color-signal-up)' }}
        >
          ● Mandate active (v{banner.version})
        </p>
        <p className="text-xs text-[var(--color-ink)] mt-1">
          Steward is now enforcing the compiled policy below on every payment.
        </p>
        {banner.warnings.length > 0 && (
          <ul className="mt-2 space-y-1">
            {banner.warnings.map((w, i) => (
              <li
                key={i}
                className="text-xs text-[var(--color-ink)] leading-snug pl-3 relative before:content-['⚠'] before:absolute before:left-0 before:text-[var(--color-copper)]"
              >
                {w}
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  if (banner.kind === 'treasurer_disabled') {
    // Calm, informative — NOT an error. The deterministic mandate is enforced.
    return (
      <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3">
        <p className="font-mono text-sm font-semibold text-[var(--color-ink)]">
          The treasurer is currently disabled
        </p>
        <p className="text-xs text-[var(--color-ink)] mt-1 leading-relaxed">
          The deterministic mandate is still enforced — nothing has changed for
          your agent. Enable the LLM treasurer to edit your mandate in plain
          English.
        </p>
        {banner.detail && (
          <p className="font-mono text-[11px] text-[var(--color-mute)] mt-2">
            {banner.detail}
          </p>
        )}
      </div>
    );
  }

  if (banner.kind === 'compile_failed_credits') {
    return (
      <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3">
        <p className="font-mono text-sm font-semibold text-[var(--color-ink)]">
          Plain-English compiling is temporarily unavailable
        </p>
        <p className="text-xs text-[var(--color-ink)] mt-1 leading-relaxed">
          The treasurer is out of credits. Your active mandate is still
          enforced; try editing again shortly.
        </p>
      </div>
    );
  }

  if (banner.kind === 'unreachable') {
    return (
      <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3">
        <p className="font-mono text-sm font-semibold text-[var(--color-ink)]">
          Steward is not responding
        </p>
        <p className="text-xs text-[var(--color-ink)] mt-1 leading-relaxed">
          Your active mandate is unchanged and still enforced.
          {banner.detail ? ` ${banner.detail}` : ''}
        </p>
      </div>
    );
  }

  // compile_failed (other kind) or generic error
  const detail = banner.detail;
  return (
    <div
      className="rounded-[2px] border px-4 py-3"
      style={{
        borderColor: 'var(--color-signal-down)',
        background: 'rgba(180,35,24,0.07)',
      }}
    >
      <p
        className="font-mono text-sm font-semibold"
        style={{ color: 'var(--color-signal-down)' }}
      >
        Could not compile this mandate
      </p>
      <p className="text-xs text-[var(--color-ink)] mt-1 leading-relaxed">
        Your active mandate is unchanged and still enforced.
        {detail ? ` ${detail}` : ''}
      </p>
    </div>
  );
}
