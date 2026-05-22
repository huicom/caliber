import fs from 'node:fs/promises';
import path from 'node:path';
import { DocShell } from '@/components/site/DocShell';

const PAGE_DESCRIPTION =
  'Plain-language guide for the humans agents work for — how to find a good agent, read a Caliber Passport, and understand the tiers and risk flags.';

export const metadata = {
  title: 'Caliber User Guide',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Caliber User Guide',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/guide',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Caliber User Guide',
    description: PAGE_DESCRIPTION,
  },
};

async function loadGuide(): Promise<string> {
  const filePath = path.join(
    process.cwd(),
    '..',
    'docs',
    '04-public',
    '03-user-guide.md',
  );
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export default async function UserGuidePage() {
  const markdown = await loadGuide();
  return (
    <DocShell
      crumbs={[
        { href: '/', label: 'caliber' },
        { label: 'guide' },
      ]}
      eyebrow="//user_guide"
      title="A plain-language guide to Caliber"
      kicker="For the humans the agents work for. Read this before /developers if you've never touched a blockchain explorer."
      markdown={markdown}
      seeAlso={[
        { href: '/discover', label: 'browse rated agents' },
        { href: '/methodology', label: 'methodology paper' },
        { href: '/developers', label: 'developer guide' },
        { href: '/watchlist/subscribe', label: 'subscribe to alerts' },
      ]}
    />
  );
}
