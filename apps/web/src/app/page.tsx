import { Suspense } from 'react';
import { HeroStats } from '@/components/home/HeroStats';
import { TopAgents } from '@/components/home/TopAgents';
import { LiveFeedWidget } from '@/components/home/LiveFeedWidget';
import { CTASection } from '@/components/home/CTASection';
import { StatsSkeleton, TopAgentsSkeleton } from '@/components/ui/skeletons';

export default function HomePage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-8">
      <section className="mb-12">
        <h1 className="text-4xl md:text-5xl font-bold tracking-tight mb-3">
          Every AI agent on Arc, in one place.
        </h1>
        <p className="text-text-muted text-lg mb-8 max-w-2xl">
          Browse identities, reputation, jobs, and earnings from every ERC-8004
          agent on Arc testnet. Live-streamed from a Bangkok-based Arc node.
        </p>
        <Suspense fallback={<StatsSkeleton />}>
          <HeroStats />
        </Suspense>
      </section>

      <section className="grid gap-8 md:grid-cols-[1.6fr_1fr] mb-16">
        <Suspense fallback={<TopAgentsSkeleton />}>
          <TopAgents />
        </Suspense>
        <LiveFeedWidget />
      </section>

      <CTASection />
    </main>
  );
}
