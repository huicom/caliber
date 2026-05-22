import fs from 'node:fs/promises';
import path from 'node:path';
import { DocShell } from '@/components/site/DocShell';

const PAGE_DESCRIPTION =
  'Operational companion to the Caliber Rating Methodology v2.0. How the service is operated, what the API contract looks like, how the on-chain primitives compose, and the v1→v2 provenance lesson.';

export const metadata = {
  title: 'Caliber Rating — Service Companion',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Caliber Rating — Service Companion',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/docs/service',
    type: 'article',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Caliber Rating — Service Companion',
    description: PAGE_DESCRIPTION,
  },
};

async function loadOverview(): Promise<string> {
  const filePath = path.join(
    process.cwd(),
    '..',
    'docs',
    '04-public',
    '02-methodology-and-service.md',
  );
  const raw = await fs.readFile(filePath, 'utf8');
  return raw.replace(/^---\n[\s\S]*?\n---\n/, '');
}

export default async function MethodologyServicePage() {
  const markdown = await loadOverview();
  return (
    <DocShell
      crumbs={[
        { href: '/', label: 'caliber' },
        { href: '/docs', label: 'docs' },
        { label: 'service' },
      ]}
      eyebrow="//service_companion"
      title="Service Companion"
      kicker="How Caliber Rating v2.0 is operated. System architecture, on-chain primitives, the API surface, data-quality disclosures, ops model, and the v1 → v2 pivot lesson."
      markdown={markdown}
      seeAlso={[
        { href: '/methodology', label: 'methodology paper' },
        { href: '/developers', label: 'developer guide' },
        { href: '/integrate', label: 'integrate (code samples)' },
        { href: '/builders', label: 'builders guide' },
      ]}
    />
  );
}
