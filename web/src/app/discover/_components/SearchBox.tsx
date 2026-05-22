'use client';

import { useState, useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

interface Props {
  initialValue?: string;
  initialCategory?: string;
}

const SUGGESTIONS = [
  'agent that trades on Polymarket',
  'audit smart contracts',
  'send USDC across chains',
  'summarize a research paper',
  'write tweets for our community',
];

export function SearchBox({ initialValue = '', initialCategory }: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const [value, setValue] = useState(initialValue);
  const [isPending, startTransition] = useTransition();

  function submit(query: string) {
    const params = new URLSearchParams(sp.toString());
    if (query.trim()) {
      params.set('q', query.trim());
    } else {
      params.delete('q');
    }
    if (initialCategory) params.set('category', initialCategory);
    startTransition(() => {
      router.push('/discover?' + params.toString());
    });
  }

  return (
    <div className="space-y-3">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          submit(value);
        }}
        className="relative"
      >
        <input
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="describe what you need…  (e.g. trading bot, doc summarizer)"
          aria-label="search agents by description"
          className="w-full font-mono text-sm sm:text-base px-4 py-3 sm:py-4 border border-[var(--color-hairline)] rounded-[2px] bg-white text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-copper)] pr-24"
        />
        <button
          type="submit"
          disabled={isPending || !value.trim()}
          className="aa-btn aa-btn--primary text-xs absolute right-2 top-1/2 -translate-y-1/2 py-2 px-4 disabled:opacity-50"
        >
          {isPending ? 'searching…' : 'find ▸'}
        </button>
      </form>
      {!initialValue && (
        <div className="flex flex-wrap gap-1.5 -mt-1">
          <span className="font-mono text-[10px] text-[var(--color-mute)] uppercase tracking-[0.06em] mr-1 self-center">
            try
          </span>
          {SUGGESTIONS.map((s) => (
            <button
              key={s}
              onClick={() => {
                setValue(s);
                submit(s);
              }}
              className="font-mono text-[11px] px-2 py-1 rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-mute)] hover:border-[var(--color-ink)] hover:text-[var(--color-ink)] transition"
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
