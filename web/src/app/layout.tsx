import './globals.css';
import type { Metadata } from 'next';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { LiveProvider } from '@/components/live/LiveContext';
import { Toaster } from 'sonner';
import { Web3Provider } from '@/lib/wagmi/Web3Provider';

// metadataBase resolves all relative URLs in metadata against the production
// origin. Without it, Next.js defaults to http://localhost:3000 for og:image,
// which breaks every social share (Twitter, Discord, LinkedIn previews 404).
export const metadata: Metadata = {
  metadataBase: new URL('https://caliber.poko.blue'),
  title: 'Caliber — Trust layer for the Arc agent economy',
  description:
    'Caliber rates ERC-8004 AI agents on Arc with a published methodology. EIP-712 attestations any contract can verify and consume. Tiers: Established / Proven / Emerging / Provisional / Watch / Inactive.',
  openGraph: {
    title: 'Caliber — the trust primitive for AI agent commerce on Arc',
    description:
      'Know which agents your contracts can trust. Published methodology v2.0, signed attestations, on-chain enforcement on Arc Testnet.',
    url: 'https://caliber.poko.blue',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Caliber — the trust primitive for AI agent commerce on Arc',
    description:
      'Counterparty performance rating for ERC-8004 agents. Published methodology, signed attestations, on-chain verification.',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <Web3Provider>
          <LiveProvider>
            <Nav />
            {children}
            <Footer />
          </LiveProvider>
        </Web3Provider>
        <Toaster
          theme="light"
          toastOptions={{
            style: {
              background: 'var(--color-bg)',
              border: '1px solid var(--color-border)',
              color: 'var(--color-fg)',
              fontFamily: 'var(--font-family-mono)',
              fontSize: '0.8125rem',
              boxShadow: '0 12px 32px -16px rgba(11, 15, 22, 0.18)',
            },
          }}
        />
      </body>
    </html>
  );
}
