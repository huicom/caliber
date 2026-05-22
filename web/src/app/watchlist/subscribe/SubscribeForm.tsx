'use client';

import { useState } from 'react';

const KIND_PRESETS: Array<{ label: string; value: string; hint: string }> = [
  { label: 'everything', value: '*', hint: 'every transition kind' },
  { label: 'risk events only', value: 'tier_down,enter_watch,enter_inactive,flag_added', hint: 'agents that dropped or got flagged' },
  { label: 'good news only', value: 'tier_up,exit_watch,exit_inactive,flag_removed', hint: 'agents that climbed' },
  { label: 'first ratings only', value: 'first_rating', hint: 'new entrants to the board' },
];

export function SubscribeForm() {
  const [url, setUrl] = useState('');
  const [filter, setFilter] = useState('*');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  async function submit() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch('/api/watchlist/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ webhook_url: url.trim(), kind_filter: filter }),
      });
      const j = await res.json();
      if (res.ok && j.ok) {
        setResult({ ok: true, message: j.message ?? 'Subscribed.' });
        setUrl('');
      } else {
        const detail =
          j.detail ?? j.upstream_status ? `${j.error}: ${j.detail ?? `HTTP ${j.upstream_status}`}` : j.error ?? 'failed';
        setResult({ ok: false, message: detail });
      }
    } catch (e) {
      setResult({ ok: false, message: e instanceof Error ? e.message : 'network error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      className="space-y-5"
    >
      <label className="block space-y-2">
        <span className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-mute)]">
          discord_webhook_url
        </span>
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://discord.com/api/webhooks/..."
          spellCheck={false}
          className="w-full font-mono text-xs sm:text-sm px-3 py-2.5 border border-[var(--color-hairline)] rounded-[2px] bg-white text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-copper)]"
        />
      </label>

      <fieldset className="space-y-2">
        <legend className="font-mono text-[12px] uppercase tracking-[0.08em] text-[var(--color-mute)]">
          notify_on
        </legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {KIND_PRESETS.map((p) => (
            <label
              key={p.value}
              className={
                'flex items-start gap-3 p-3 border rounded-[2px] cursor-pointer ' +
                (filter === p.value
                  ? 'border-[var(--color-copper)] bg-[var(--color-bg-elev)]'
                  : 'border-[var(--color-hairline)] hover:border-[var(--color-ink)]')
              }
            >
              <input
                type="radio"
                name="filter"
                value={p.value}
                checked={filter === p.value}
                onChange={() => setFilter(p.value)}
                className="mt-1"
              />
              <div>
                <div className="text-sm text-[var(--color-ink)]">{p.label}</div>
                <div className="text-xs text-[var(--color-mute)]">{p.hint}</div>
              </div>
            </label>
          ))}
        </div>
      </fieldset>

      <button
        type="submit"
        disabled={busy || !url.trim()}
        className="aa-btn aa-btn--primary text-sm py-3 px-5 disabled:opacity-50"
      >
        {busy ? 'sending test message…' : 'subscribe ▸'}
      </button>

      {result && (
        <div
          className={
            'border rounded-[2px] px-4 py-3 text-sm ' +
            (result.ok
              ? 'border-[#00B894]/50 bg-[#E6F7F2] text-[#047857]'
              : 'border-[#B91C1C]/30 bg-[#FEE2E2] text-[#991B1B]')
          }
        >
          {result.ok ? '✓ ' : '× '}
          {result.message}
        </div>
      )}
    </form>
  );
}
