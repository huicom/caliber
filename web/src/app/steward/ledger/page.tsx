import { notFound } from 'next/navigation';
import { sql } from '@/lib/db';
import { StewardNav } from '../_components/StewardNav';
import { LiveLedger } from './_components/LiveLedger';
import type { LedgerRow, FreezeState } from './_components/LiveLedger';

// Steward — Payment Ledger. The owner's (and hackathon judge's) system of
// record: every payment the agent asked for, and what the treasurer decided.
// Behind NEXT_PUBLIC_STEWARD.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Steward — Payment Ledger',
  description:
    "Every payment your agent asks for, and what the treasurer decided.",
};

interface PaymentDbRow {
  id: string;
  created_at: Date;
  host: string;
  seller_url: string;
  quoted_usdc: string | null;
  settled_usdc: string | null;
  decision: string;
  decision_stage: string | null;
  reasoning: string | null;
  pay_to: string | null;
  source: string | null;
}

export default async function StewardLedgerPage() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') notFound();

  const dbRows = await sql<PaymentDbRow[]>`
    SELECT id::text, created_at, host, seller_url, quoted_usdc, settled_usdc,
           decision, decision_stage, reasoning, pay_to, source
    FROM steward_payments
    ORDER BY created_at DESC, id DESC
    LIMIT 50`;

  // Normalize to the SSE `payment` shape so the client renders one row type.
  const initialRows: LedgerRow[] = dbRows.map((r) => ({
    id: r.id,
    createdAt:
      r.created_at instanceof Date
        ? r.created_at.toISOString()
        : new Date(r.created_at).toISOString(),
    host: r.host,
    sellerUrl: r.seller_url,
    quotedUsdc: r.quoted_usdc,
    settledUsdc: r.settled_usdc,
    decision: r.decision,
    decisionStage: r.decision_stage,
    reasoning: r.reasoning,
    payTo: r.pay_to,
    source: r.source,
  }));

  const freezeRows = await sql<{ value: FreezeState }[]>`
    SELECT value FROM steward_state WHERE key = 'frozen' LIMIT 1`;
  const initialFreeze: FreezeState = freezeRows[0]?.value ?? { frozen: false };

  return (
    <main className="mx-auto max-w-4xl px-4 sm:px-5 py-10 sm:py-14 space-y-8">
      <StewardNav active="ledger" />
      <section>
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-2">
          //steward_ledger
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3">
          Steward — Payment Ledger
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          Every payment your agent asks for, and what the treasurer decided.
        </p>
      </section>

      <LiveLedger initialRows={initialRows} initialFreeze={initialFreeze} />

      <section className="border-t border-[var(--color-hairline)] pt-6 text-sm text-[var(--color-mute)] leading-relaxed">
        <p>
          Steward sits between your agent and its wallet. Each row is one payment
          request inspected before any signature: deterministic policy and
          detectors first, then a treasurer that can only ever be more
          cautious. <strong>Freeze</strong> halts every payment instantly.
        </p>
      </section>
    </main>
  );
}
