'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

// Resolve control on the incident detail page. Optimistic: flips to a resolved
// pill immediately, posts, then refreshes the server component to reconcile.

export function ResolveButton({
  id,
  initialStatus,
}: {
  id: string;
  initialStatus: string;
}) {
  const router = useRouter();
  const [status, setStatus] = useState(initialStatus);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (status === 'resolved') {
    return (
      <span className="font-mono text-xs text-[var(--color-mute)] uppercase tracking-[0.05em]">
        resolved
      </span>
    );
  }

  async function resolve() {
    setPending(true);
    setError(null);
    setStatus('resolved'); // optimistic
    try {
      const res = await fetch(`/api/steward/incidents/${id}/resolve`, {
        method: 'POST',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch (e) {
      setStatus('open'); // roll back
      setError(e instanceof Error ? e.message : 'failed');
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        disabled={pending}
        onClick={resolve}
        className="font-mono text-xs px-3 py-1.5 rounded-[2px] border border-[var(--color-ink)] text-[var(--color-ink)] hover:bg-[var(--color-ink)] hover:text-[var(--color-paper)] transition disabled:opacity-50"
      >
        {pending ? 'resolving…' : 'mark resolved'}
      </button>
      {error ? (
        <span className="font-mono text-[11px] text-[var(--color-signal-down)]">
          {error}
        </span>
      ) : null}
    </div>
  );
}
