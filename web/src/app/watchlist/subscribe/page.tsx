import Link from 'next/link';
import { SubscribeForm } from './SubscribeForm';

const PAGE_DESCRIPTION =
  'Subscribe a Discord channel to the Caliber Watchlist. Tier movements and risk-flag firings will arrive as messages with tier-colored embeds.';

export const metadata = {
  title: 'Subscribe to Caliber Watchlist via Discord',
  description: PAGE_DESCRIPTION,
  openGraph: {
    title: 'Subscribe to Caliber Watchlist via Discord',
    description: PAGE_DESCRIPTION,
    url: 'https://caliber.poko.blue/watchlist/subscribe',
    type: 'article',
  },
};

export default function SubscribePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 sm:px-5 py-10 sm:py-14 space-y-8">
      <section>
        <nav className="font-mono text-[11px] text-[var(--color-mute)] mb-4">
          <Link href="/" className="hover:text-[var(--color-copper)]">caliber</Link>
          <span className="mx-2 opacity-50">/</span>
          <Link href="/watchlist" className="hover:text-[var(--color-copper)]">watchlist</Link>
          <span className="mx-2 opacity-50">/</span>
          <span>subscribe</span>
        </nav>
        <h1 className="text-3xl sm:text-4xl font-semibold text-[var(--color-ink)] tracking-tight mb-3">
          Subscribe a Discord channel
        </h1>
        <p className="text-[15px] text-[var(--color-ink)] leading-relaxed max-w-prose">
          Tier movements and flag firings will arrive as Discord messages with tier-colored embeds.
          Best for ops channels watching agents you depend on. Need a different format? The same
          feed is available as <Link href="/watchlist.rss" className="text-[var(--color-copper)] hover:underline font-mono text-xs">RSS</Link>{' '}
          or JSON at <Link href="/api/watchlist" className="text-[var(--color-copper)] hover:underline font-mono text-xs">/api/watchlist</Link>.
        </p>
      </section>

      <SubscribeForm />

      <section className="border-t border-[var(--color-hairline)] pt-6 text-sm text-[var(--color-mute)] leading-relaxed space-y-3">
        <p>
          <strong className="text-[var(--color-ink)]">How to create a Discord webhook URL:</strong>
        </p>
        <ol className="list-decimal pl-5 space-y-1.5">
          <li>In your Discord server, open the channel you want notifications in</li>
          <li>Channel settings → Integrations → Webhooks → New Webhook</li>
          <li>Click <em>Copy Webhook URL</em></li>
          <li>Paste it above</li>
        </ol>
        <p className="mt-3">
          The URL is treated as a secret — anyone with it can post to that channel. We send a
          test message on subscribe so you&rsquo;ll see it work immediately. Webhooks that fail
          three times in a row auto-pause; you can resubscribe to re-activate.
        </p>
        <p>
          <strong className="text-[var(--color-ink)]">Don&rsquo;t want this anymore?</strong>{' '}
          Delete the webhook in Discord (Channel settings → Integrations → Webhooks). The next
          delivery will fail and the subscription will auto-pause within a few days. Or
          unsubscribe explicitly:
        </p>
        <pre className="bg-white border border-[var(--color-hairline)] rounded-[2px] p-3 font-mono text-xs overflow-x-auto">
          <code>{`curl -X DELETE https://caliber.poko.blue/api/watchlist/subscribe \\
  -H 'content-type: application/json' \\
  -d '{"webhook_url":"https://discord.com/api/webhooks/..."}'`}</code>
        </pre>
      </section>
    </main>
  );
}
