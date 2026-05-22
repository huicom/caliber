import Link from 'next/link';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface CrumbItem {
  href?: string;
  label: string;
}

interface SeeAlsoItem {
  href: string;
  label: string;
}

interface Props {
  /** Mono lowercase eyebrow shown above the page title — e.g. "//user_guide". */
  eyebrow: string;
  /** Display-font page title rendered before the markdown body. */
  title: string;
  /** One-paragraph kicker rendered under the title (optional). */
  kicker?: string;
  /** Top-of-page breadcrumb. The last item should match the current page. */
  crumbs: CrumbItem[];
  /** "see also" links rendered at the bottom in the Caliber editorial style. */
  seeAlso?: SeeAlsoItem[];
  /** Markdown body. The H1 line at the top of the source file is stripped so
   * it doesn't double up with the Caliber title above. */
  markdown: string;
}

/**
 * Caliber-branded shell for long-form markdown pages. Drops the editorial
 * chrome (breadcrumb, mono-lowercase eyebrow, display title) above the prose
 * body and a mono "see also" strip below, so docs feel like the rest of the
 * site even though their bodies are rendered from .md files.
 */
export function DocShell({ eyebrow, title, kicker, crumbs, seeAlso, markdown }: Props) {
  // Strip a leading single H1 line so we don't render two big titles.
  const stripped = markdown.replace(/^\s*#\s+.*\n+/, '');

  return (
    <main className="mx-auto max-w-3xl px-4 sm:px-5 py-10 sm:py-14 space-y-10">
      {/* Breadcrumb — same mono pattern as /passport, /discover, /watchlist */}
      <nav className="font-mono text-[11px] text-[var(--color-mute)]">
        {crumbs.map((c, i) => (
          <span key={i}>
            {c.href ? (
              <Link href={c.href} className="hover:text-[var(--color-copper)]">
                {c.label}
              </Link>
            ) : (
              <span>{c.label}</span>
            )}
            {i < crumbs.length - 1 && <span className="mx-2 opacity-50">/</span>}
          </span>
        ))}
      </nav>

      {/* Editorial header band — eyebrow + display title + kicker */}
      <header className="space-y-3 -mt-4">
        <p className="font-mono text-[12px] uppercase tracking-[0.18em] text-[var(--color-mute)]">
          {eyebrow}
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight leading-tight">
          {title}
        </h1>
        {kicker && (
          <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">{kicker}</p>
        )}
      </header>

      {/* Prose body — Caliber-tokened typography on the rendered markdown */}
      <article
        className="
          prose prose-lg max-w-none
          prose-headings:scroll-mt-24 prose-headings:font-semibold prose-headings:tracking-tight prose-headings:text-[var(--color-ink)]
          prose-h2:text-2xl prose-h2:mt-12 prose-h2:mb-4 prose-h2:border-b prose-h2:border-[var(--color-hairline)] prose-h2:pb-3
          prose-h3:text-xl prose-h3:mt-8
          prose-h4:text-lg prose-h4:mt-6
          prose-p:leading-relaxed prose-p:text-[var(--color-ink)]
          prose-li:text-[var(--color-ink)] prose-li:leading-relaxed
          prose-strong:text-[var(--color-ink)] prose-strong:font-semibold
          prose-em:text-[var(--color-mute)] prose-em:italic
          prose-a:text-[var(--color-copper)] prose-a:no-underline hover:prose-a:underline
          prose-blockquote:border-l-[var(--color-copper)] prose-blockquote:text-[var(--color-mute)] prose-blockquote:not-italic prose-blockquote:font-normal
          prose-code:text-[var(--color-copper)] prose-code:bg-[var(--color-bg-elev)] prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded-[2px] prose-code:font-normal prose-code:before:hidden prose-code:after:hidden
          prose-pre:bg-[var(--color-bg-elev)] prose-pre:border prose-pre:border-[var(--color-hairline)] prose-pre:rounded-[2px] prose-pre:text-[var(--color-ink)]
          prose-hr:border-[var(--color-hairline)] prose-hr:my-10
          prose-table:text-sm
          prose-th:text-[var(--color-ink)] prose-th:border-b prose-th:border-[var(--color-ink)]
          prose-td:text-[var(--color-ink)] prose-td:border-[var(--color-hairline)]
        "
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{stripped}</ReactMarkdown>
      </article>

      {/* See-also footer — mono link strip in Caliber style */}
      {seeAlso && seeAlso.length > 0 && (
        <section className="border-t border-[var(--color-hairline)] pt-6 space-y-3">
          <p className="font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--color-mute)]">
            //see_also
          </p>
          <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">
            {seeAlso.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="text-[var(--color-copper)] hover:underline font-mono text-xs"
              >
                {item.label} →
              </Link>
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
