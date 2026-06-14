import Link from 'next/link';
import { ConsoleKeyUnlock } from './ConsoleKeyUnlock';

// Small top tab strip shared by every Steward page. `active` highlights the
// current tab. Kept a plain server component — no client state needed.

const TABS: { href: string; label: string; key: string }[] = [
  { href: '/steward', label: 'Overview', key: 'overview' },
  { href: '/steward/mandate', label: 'Mandate', key: 'mandate' },
  { href: '/steward/ledger', label: 'Ledger', key: 'ledger' },
  { href: '/steward/incidents', label: 'Incidents', key: 'incidents' },
];

export function StewardNav({ active }: { active: string }) {
  return (
    <div className="border-b border-[var(--color-hairline)] mb-8 flex items-end justify-between gap-3 flex-wrap">
      <nav className="flex items-end gap-1 -mb-px">
        {TABS.map((t) => {
          const isActive = t.key === active;
          return (
            <Link
              key={t.key}
              href={t.href}
              className={
                'font-mono text-xs px-3 py-2 border-b-2 transition-colors ' +
                (isActive
                  ? 'border-[var(--color-copper)] text-[var(--color-ink)] font-semibold'
                  : 'border-transparent text-[var(--color-mute)] hover:text-[var(--color-ink)]')
              }
            >
              {t.label}
            </Link>
          );
        })}
      </nav>
      <div className="pb-1.5">
        <ConsoleKeyUnlock />
      </div>
    </div>
  );
}
