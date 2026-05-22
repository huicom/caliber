import { Suspense } from 'react';
import Link from 'next/link';
import { VerifyForm } from './_components/VerifyForm';

const PAGE_DESCRIPTION =
  "Paste a Caliber attestation JSON. We recover the signer, compare it against the on-chain RatingVerifier, and check the methodology version + expiry — entirely in your browser, no transaction required.";

export const metadata = {
  title: 'Verify a Caliber attestation',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Verify a Caliber attestation',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/verify',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Verify a Caliber attestation',
    description: PAGE_DESCRIPTION,
  },
};

export default function VerifyPage() {
  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14 space-y-8">
      <section>
        <nav className="font-mono text-[11px] text-[var(--color-mute)] mb-4">
          <Link href="/" className="hover:text-[var(--color-copper)]">caliber</Link>
          <span className="mx-2 opacity-50">/</span>
          <span>verify</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3">
          Verify a Caliber attestation
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          Paste an attestation JSON below. We recover the EIP-712 signer in your browser, compare it against the
          on-chain Caliber <code className="font-mono text-xs">RatingVerifier</code>, and check the methodology
          version + expiry. No transaction, no wallet connect, no data leaves your machine.
        </p>
      </section>

      <Suspense fallback={<div className="text-sm text-[var(--color-mute)]">loading verifier…</div>}>
        <VerifyForm />
      </Suspense>

      <section className="border-t border-[var(--color-hairline)] pt-6 text-sm text-[var(--color-mute)] leading-relaxed">
        <p>
          The on-chain contract is <code className="font-mono text-xs">RatingVerifier</code> at{' '}
          <a
            href="https://testnet.arcscan.app/address/0xE3b1e82f1A047BC5B41d8982EaC635EC61526EE8"
            target="_blank"
            rel="noreferrer"
            className="text-[var(--color-copper)] hover:underline"
          >
            0xE3b1e8…6EE8
          </a>{' '}
          on Arc Testnet. EIP-712 domain name <code className="font-mono text-xs">Caliber</code>, version{' '}
          <code className="font-mono text-xs">1</code>, methodology{' '}
          <code className="font-mono text-xs">2.0.0</code>.
        </p>
        <p className="mt-3">
          Don&rsquo;t have an attestation handy? Open any agent&rsquo;s Passport and click{' '}
          <em>download attestation</em>.{' '}
          <Link href="/discover" className="text-[var(--color-copper)] hover:underline">
            browse agents →
          </Link>
        </p>
      </section>
    </main>
  );
}
