import Link from 'next/link';
import { ArrowUpRight } from 'lucide-react';
import { Eyebrow } from '@/components/ui/Eyebrow';

function ArcMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden className={className}>
      <path
        d="M3 17 A 9 9 0 0 1 21 17"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <circle cx="12" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}

const EXPLORE = [
  { href: '/', label: 'Home' },
  { href: '/agents', label: 'Agents' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/live', label: 'Live Feed' },
  { href: '/stats', label: 'Stats' },
];

const ARC_ECOSYSTEM = [
  { href: 'https://arc.network', label: 'Arc Network' },
  { href: 'https://docs.arc.network', label: 'Arc Docs' },
  { href: 'https://testnet.arcscan.app', label: 'ArcScan' },
  { href: 'https://eips.ethereum.org/EIPS/eip-8004', label: 'ERC-8004 spec' },
];

const CONNECT = [
  { href: 'https://discord.gg/buildonarc', label: 'Arc Discord' },
  { href: 'https://community.arc.io', label: 'Arc House' },
  { href: 'https://github.com/huicom/arc-agents-explorer', label: 'GitHub' },
];

export function Footer() {
  return (
    <footer className="mt-24 border-t border-border">
      <div className="mx-auto max-w-[1200px] px-6 md:px-12 py-16">
        <div className="grid gap-10 md:grid-cols-3 md:gap-16">
          {/* === //Explore === */}
          <div>
            <Eyebrow variant="slash" className="mb-5">
              Explore
            </Eyebrow>
            <ul className="space-y-2.5">
              {EXPLORE.map((l) => (
                <li key={l.href}>
                  <Link
                    href={l.href}
                    className="text-fg-mute hover:text-fg transition-colors text-[14px]"
                  >
                    {l.label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* === //Arc ecosystem (numbered resources) === */}
          <div>
            <Eyebrow variant="slash" className="mb-5">
              Arc ecosystem
            </Eyebrow>
            <ul className="space-y-2.5">
              {ARC_ECOSYSTEM.map((l, i) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-baseline gap-3 text-[14px]"
                  >
                    <span className="font-mono text-[11px] tracking-[0.08em] text-fg-dim shrink-0">
                      //R.{String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="text-fg-mute group-hover:text-fg transition-colors inline-flex items-center gap-1">
                      {l.label}
                      <ArrowUpRight className="w-3.5 h-3.5 text-fg-dim group-hover:text-accent transition-colors translate-y-[1px]" />
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </div>

          {/* === //Connect === */}
          <div>
            <Eyebrow variant="slash" className="mb-5">
              Connect
            </Eyebrow>
            <ul className="space-y-2.5">
              {CONNECT.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    target="_blank"
                    rel="noreferrer"
                    className="group inline-flex items-center gap-1 text-[14px] text-fg-mute hover:text-fg transition-colors"
                  >
                    {l.label}
                    <ArrowUpRight className="w-3.5 h-3.5 text-fg-dim group-hover:text-accent transition-colors" />
                  </a>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>

      {/* === Bottom strip === */}
      <div className="border-t border-border">
        <div className="mx-auto max-w-[1200px] px-6 md:px-12 py-6 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-[13px] text-fg-mute">
            <span className="flex items-center gap-2 text-accent">
              <ArcMark className="w-4 h-4" />
              <span className="font-semibold text-fg tracking-tight">
                ArcAgents
              </span>
            </span>
            <span
              className="font-mono text-[10.5px] uppercase tracking-[0.15em] px-2 py-0.5 rounded border border-accent/40 text-accent select-none"
              title="Built by an independent Arc Architect"
            >
              {'{architect_built}'}
            </span>
            <span className="text-fg-dim">
              Built solo from Bangkok <span aria-label="Thailand">🇹🇭</span>
            </span>
          </div>
          <p className="text-[12px] text-fg-dim md:text-right">
            Not affiliated with Circle or the Arc team.
          </p>
        </div>
      </div>
    </footer>
  );
}
