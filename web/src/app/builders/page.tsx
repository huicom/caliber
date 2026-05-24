import fs from 'node:fs/promises';
import path from 'node:path';
import { DocShell } from '@/components/site/DocShell';

const PAGE_DESCRIPTION =
  "A 10-minute introduction to Caliber Rating v2.0.1 — a counterparty performance rating for AI agents on Arc. Plain language, working code examples, honest limitations.";

export const metadata = {
  title: "Caliber Builder's Guide",
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: "Caliber Builder's Guide",
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/builders',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: "Caliber Builder's Guide",
    description: PAGE_DESCRIPTION,
  },
};

async function loadGuide(): Promise<string> {
  const filePath = path.join(
    process.cwd(),
    '..',
    'docs',
    '04-public',
    '01-builders-guide.md',
  );
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export default async function BuildersGuidePage() {
  const markdown = await loadGuide();
  return (
    <DocShell
      crumbs={[
        { href: '/', label: 'caliber' },
        { label: 'builders' },
      ]}
      eyebrow="//builders_guide"
      title="Build with Caliber in 10 minutes"
      kicker="Plain-language tour of what Caliber is, why it matters, and three concrete things you can build with it today. For the deep technical reference, see /developers."
      markdown={markdown}
      seeAlso={[
        { href: '/developers', label: 'developer guide' },
        { href: '/integrate', label: 'integrate (code samples)' },
        { href: '/methodology', label: 'methodology paper' },
        { href: '/guide', label: 'user guide' },
      ]}
    />
  );
}
