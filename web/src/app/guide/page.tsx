import fs from 'node:fs/promises';
import path from 'node:path';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
    <main className="mx-auto max-w-3xl px-5 py-16 sm:py-20">
      <article
        className="
          prose prose-lg max-w-none
          prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-[var(--color-fg)]
          prose-h1:text-4xl prose-h1:mb-6 prose-h1:mt-0
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-[var(--color-border)] prose-h2:pb-3
          prose-h3:text-xl prose-h3:mt-8
          prose-h4:text-lg prose-h4:mt-6
          prose-p:leading-relaxed prose-p:text-[var(--color-fg)]
          prose-li:text-[var(--color-fg)] prose-li:leading-relaxed
          prose-strong:text-[var(--color-fg)] prose-strong:font-semibold
          prose-em:text-[var(--color-fg-mute)] prose-em:italic
          prose-a:text-[var(--color-accent)] prose-a:no-underline hover:prose-a:underline
          prose-blockquote:border-l-[var(--color-accent)] prose-blockquote:text-[var(--color-fg-mute)] prose-blockquote:not-italic prose-blockquote:font-normal
          prose-code:text-[var(--color-accent)] prose-code:bg-[var(--color-bg-elev)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:font-normal prose-code:before:hidden prose-code:after:hidden
          prose-pre:bg-[var(--color-bg-elev)] prose-pre:border prose-pre:border-[var(--color-border)] prose-pre:text-[var(--color-fg)]
          prose-hr:border-[var(--color-border)] prose-hr:my-10
          prose-table:text-sm
          prose-th:text-[var(--color-fg)] prose-th:border-b-[var(--color-border-hi)]
          prose-td:text-[var(--color-fg)] prose-td:border-[var(--color-border)]
        "
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{markdown}</ReactMarkdown>
      </article>
    </main>
  );
}
