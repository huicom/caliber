import { notFound } from 'next/navigation';
import { StewardNav } from '../_components/StewardNav';
import { MandateEditor } from './_components/MandateEditor';
import { PolicyView, type CompiledPolicy } from './_components/PolicyView';

// Steward — Mandate. Where the human owner writes their spending policy in
// plain English and sees the structured policy Steward compiles and enforces.
// The page (server) reads the active mandate + compiled policy from the steward
// service; the editor (client) handles compile & activate. Behind
// NEXT_PUBLIC_STEWARD. Judges drive this alone, so it must be self-explanatory.

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export const metadata = {
  title: 'Steward — Mandate',
  description:
    'Your mandate, in plain English. Steward enforces it on every payment.',
};

const STEWARD_BASE_URL =
  process.env.STEWARD_BASE_URL ?? 'http://localhost:3300';
const STEWARD_API_KEY = process.env.STEWARD_API_KEY ?? '';

interface PolicyResponse {
  mandate?: { id: string; rawText: string; version: number };
  policy?: CompiledPolicy;
}

// Fetch the active mandate + compiled policy directly from the steward service
// (server-side, with the key). Returns null on any failure so the page renders
// a graceful "no mandate yet / service unreachable" state instead of throwing —
// the page must never crash in front of a judge.
async function getActivePolicy(): Promise<PolicyResponse | null> {
  try {
    const res = await fetch(`${STEWARD_BASE_URL}/v1/policy`, {
      headers: { 'x-steward-key': STEWARD_API_KEY },
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PolicyResponse;
  } catch {
    return null;
  }
}

export default async function StewardMandatePage() {
  if (process.env.NEXT_PUBLIC_STEWARD !== '1') notFound();

  const data = await getActivePolicy();
  const rawText = data?.mandate?.rawText ?? '';
  const version = data?.mandate?.version ?? null;
  const policy = data?.policy ?? null;
  const serviceDown = data === null;

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14">
      <StewardNav active="mandate" />

      {/* Hero */}
      <section className="mb-8">
        <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)] mb-2">
          //steward_mandate
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3 leading-[1.1]">
          Your mandate, in plain English.
        </h1>
        <p className="text-[16px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          Steward enforces it on every payment. Write what your agent may spend
          and on whom — Steward compiles it into a deterministic policy and
          checks every payment against it before anything is signed.
        </p>
      </section>

      {serviceDown ? (
        // Service unreachable: still explain the surface and the current policy
        // contract so the page is never blank in a demo. The deterministic
        // mandate keeps running inside the steward service regardless.
        <section className="space-y-8">
          <div className="rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-bg-elev)] px-4 py-3">
            <p className="font-mono text-sm font-semibold text-[var(--color-ink)]">
              Steward is not responding right now
            </p>
            <p className="text-xs text-[var(--color-ink)] mt-1 leading-relaxed">
              The active mandate is still enforced by the Steward service. The
              editor will be available again once the service is reachable.
            </p>
          </div>
          <MandateEditor
            initialRawText={rawText}
            initialPolicy={policy}
            initialVersion={version}
          />
        </section>
      ) : (
        <>
          {/* Current compiled policy at a glance, above the editor, so a judge
              immediately sees what is enforced today. */}
          <section className="mb-8">
            <div className="flex items-baseline justify-between mb-3">
              <h2 className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-copper)]">
                //enforcing_now
              </h2>
              {version !== null && (
                <span className="font-mono text-[11px] text-[var(--color-mute)]">
                  active mandate · v{version}
                </span>
              )}
            </div>
            {rawText ? (
              <blockquote className="border-l-2 border-[var(--color-copper)] pl-4 py-1 text-[15px] text-[var(--color-ink)] leading-relaxed italic">
                {rawText}
              </blockquote>
            ) : (
              <p className="text-sm text-[var(--color-mute)]">
                No mandate written yet — Steward is enforcing its conservative
                default policy.
              </p>
            )}
            <div className="mt-4">
              <PolicyView policy={policy} />
            </div>
          </section>

          <div className="border-t border-[var(--color-hairline)] pt-8">
            <MandateEditor
              initialRawText={rawText}
              initialPolicy={policy}
              initialVersion={version}
            />
          </div>
        </>
      )}

      <section className="border-t border-[var(--color-hairline)] mt-10 pt-6 text-sm text-[var(--color-mute)] leading-relaxed max-w-prose">
        <p>
          Steward holds the checkbook. Your agent requests a payment; Steward
          checks it against this mandate — caps, approval thresholds,
          new-counterparty rules — and authorizes, holds, or denies it. The
          deterministic policy is always in force, whether or not the
          plain-English compiler is available.
        </p>
      </section>
    </main>
  );
}
