import Link from 'next/link';
import { Suspense } from 'react';

// Stats change every block — never serve a cached snapshot of this page.
export const dynamic = 'force-dynamic';
export const revalidate = 0;
import { ArrowRight, ArrowUpRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Eyebrow } from '@/components/ui/Eyebrow';
import { HeroStats, HeroStatsSkeleton } from '@/components/home/HeroStats';
import { LastEventStat } from '@/components/home/LastEventStat';
import { TopAgents } from '@/components/home/TopAgents';
import { LiveFeedWidget } from '@/components/home/LiveFeedWidget';
import { CTASection } from '@/components/home/CTASection';
import { TopAgentsSkeleton } from '@/components/ui/skeletons';

function LiveFeedSkeleton() {
  return (
    <div>
      <div className="flex items-center gap-3 mb-4">
        <span className="font-mono text-xs uppercase tracking-[0.12em] text-fg-dim">
          //live_feed
        </span>
        <span className="live-pulse opacity-40 [&::after]:!hidden" aria-hidden />
        <span className="font-mono text-[11px] tracking-[0.1em] text-accent">
          LIVE
        </span>
      </div>
      <div className="border border-border rounded-xl bg-bg-elev divide-y divide-border">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="px-4 py-3 flex items-center gap-3">
            <div className="h-3 w-20 rounded bg-bg-elev-2 animate-pulse" />
            <div className="h-4 w-14 rounded bg-bg-elev-2 animate-pulse" />
            <div className="h-3 flex-1 rounded bg-bg-elev-2 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  );
}

const HERO_RESOURCES = [
  {
    href: 'https://github.com/huicom/arc_translation_agent',
    label: 'View open-source demo',
  },
  {
    href: 'https://eips.ethereum.org/EIPS/eip-8004',
    label: 'Read ERC-8004 spec',
  },
];

export default function HomePage() {
  return (
    <main>
      {/* === Hero === */}
      <section className="mx-auto max-w-[1200px] px-6 md:px-12 pt-16 md:pt-24 pb-12">
        <Eyebrow variant="curly" className="mb-7">
          arc_agent_explorer
        </Eyebrow>

        <h1 className="h-display max-w-4xl text-fg">
          Every AI agent on Arc,
          <br className="hidden md:block" />{' '}
          <span className="text-accent">in one place.</span>
        </h1>

        <p className="mt-7 text-fg-mute text-lg md:text-xl leading-relaxed max-w-2xl">
          Browse identities, reputation, jobs, and earnings from every
          ERC-8004 agent on Arc testnet.
        </p>

        <p className="mt-3 font-mono text-xs text-fg-dim uppercase tracking-[0.1em]">
          Live-streamed from PokoBlue&apos;s self-hosted Arc node
        </p>

        {/* === Stat strip === */}
        <div className="mt-10 grid grid-cols-2 lg:grid-cols-4 gap-3">
          <Suspense fallback={<HeroStatsSkeleton />}>
            <HeroStats />
          </Suspense>
          <LastEventStat />
        </div>

        {/* === CTAs === */}
        <div className="mt-10 flex flex-wrap gap-3">
          <Button asChild>
            <Link href="/agents">
              Browse agents <ArrowRight />
            </Link>
          </Button>
          <Button variant="ghost" asChild>
            <Link href="/live">Watch live feed</Link>
          </Button>
        </div>

        {/* === Demoted resources === */}
        <div className="mt-7 flex flex-col sm:flex-row sm:flex-wrap gap-x-8 gap-y-3">
          {HERO_RESOURCES.map((r, i) => (
            <a
              key={r.href}
              href={r.href}
              target="_blank"
              rel="noreferrer"
              className="group inline-flex items-center gap-3 text-sm"
            >
              <span className="font-mono text-[11px] tracking-[0.08em] text-fg-dim">
                //R.{String(i + 1).padStart(2, '0')}
              </span>
              <span className="text-fg-mute group-hover:text-fg transition-colors inline-flex items-center gap-1.5">
                {r.label}
                <ArrowUpRight className="w-3.5 h-3.5 text-fg-dim group-hover:text-accent transition-colors" />
              </span>
            </a>
          ))}
        </div>
      </section>

      {/* === Below-fold: leaderboard + live feed === */}
      <section className="mx-auto max-w-[1200px] px-6 md:px-12 py-12 grid gap-10 lg:grid-cols-[1.6fr_1fr]">
        <Suspense fallback={<TopAgentsSkeleton />}>
          <TopAgents />
        </Suspense>
        <Suspense fallback={<LiveFeedSkeleton />}>
          <LiveFeedWidget />
        </Suspense>
      </section>

      {/* === Build on Arc (restructured in slice 6) === */}
      <section className="mx-auto max-w-[1200px] px-6 md:px-12 pb-24">
        <CTASection />
      </section>
    </main>
  );
}
