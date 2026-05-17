import './globals.css';
import type { Metadata } from 'next';
import { GeistSans } from 'geist/font/sans';
import { GeistMono } from 'geist/font/mono';
import { Nav } from '@/components/site/Nav';
import { Footer } from '@/components/site/Footer';
import { Toaster } from 'sonner';

export const metadata: Metadata = {
  title: 'ArcAgents — AI Agent Explorer for Arc',
  description:
    'Browse every ERC-8004 agent on Arc. Reputation, validations, jobs, earnings — all in one place.',
  openGraph: {
    title: 'ArcAgents',
    description: 'The first agent explorer for Arc',
    url: 'https://arcagents.poko.blue',
    type: 'website',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-screen bg-bg text-text">
        <Nav />
        {children}
        <Footer />
        <Toaster theme="dark" />
      </body>
    </html>
  );
}
