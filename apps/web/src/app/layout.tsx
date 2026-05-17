import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'ArcAgents Explorer',
  description: 'The first agent explorer for Arc Network',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
