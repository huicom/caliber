import fs from 'node:fs/promises';
import path from 'node:path';
import { DocShell } from '@/components/site/DocShell';

const PAGE_DESCRIPTION =
  "Integration patterns, HTTP API reference, SDK quickstart, on-chain verifier addresses, and error handling. Everything you need to build with Caliber on Arc Testnet.";

export const metadata = {
  title: 'Caliber Developer Guide',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Caliber Developer Guide',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/developers',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Caliber Developer Guide',
    description: PAGE_DESCRIPTION,
  },
};

async function loadGuide(): Promise<string> {
  const filePath = path.join(
    process.cwd(),
    '..',
    'docs',
    '04-public',
    '04-developer-guide.md',
  );
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export default async function DeveloperGuidePage() {
  const markdown = await loadGuide();
  return (
    <DocShell
      crumbs={[
        { href: '/', label: 'caliber' },
        { label: 'developers' },
      ]}
      eyebrow="//developer_guide"
      title="Build with Caliber"
      kicker="The precise integration reference. Five patterns, full HTTP API, SDK quickstart, on-chain ABI, and error tables. For the gentle intro, see /builders."
      markdown={markdown}
      seeAlso={[
        { href: '/integrate', label: 'quickstart code samples' },
        { href: '/methodology', label: 'methodology paper' },
        { href: '/docs/service', label: 'service operations' },
        { href: '/guide', label: 'user guide' },
      ]}
    />
  );
}
