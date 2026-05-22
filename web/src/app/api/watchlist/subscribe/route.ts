// POST /api/watchlist/subscribe   { webhook_url, kind_filter? }   → 200 / 400 / 502
// DELETE /api/watchlist/subscribe { webhook_url }                  → 200 / 404
//
// Creates (or removes) a Discord webhook subscription for the Watchlist
// feed. We trust the URL itself as the secret — anyone posting a Discord
// webhook URL to us is implicitly authorizing posts to that channel.
//
// On subscribe we do one test fire to confirm the URL works (and to give
// the subscriber a visible "you're subscribed" message in their channel).
// If the test fire fails, we don't store anything.

import { z } from 'zod';
import { db, watchlistWebhooks } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { ok, badRequest, notFound, serverError } from '@/lib/api-helpers';
import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

const DISCORD_WEBHOOK_RE = /^https:\/\/(?:discord(?:app)?\.com|canary\.discord\.com|ptb\.discord\.com)\/api\/webhooks\/\d+\/[A-Za-z0-9_-]{60,}$/;

const ALL_KINDS = [
  'first_rating',
  'tier_up',
  'tier_down',
  'enter_watch',
  'enter_inactive',
  'exit_watch',
  'exit_inactive',
  'flag_added',
  'flag_removed',
];

const subscribeSchema = z.object({
  webhook_url: z.string().url().refine((u) => DISCORD_WEBHOOK_RE.test(u), {
    message: 'must be a Discord webhook URL (https://discord.com/api/webhooks/...)',
  }),
  kind_filter: z
    .string()
    .optional()
    .default('*')
    .refine(
      (k) => k === '*' || k.split(',').every((part) => ALL_KINDS.includes(part.trim())),
      'kind_filter must be "*" or comma-separated kinds',
    ),
});

async function fireTest(webhookUrl: string, kindFilter: string): Promise<{ ok: true } | { ok: false; status: number; body: string }> {
  const payload = {
    content: `Subscribed to Caliber Watchlist · filter=\`${kindFilter}\``,
    embeds: [
      {
        title: 'Caliber Watchlist',
        description:
          'You will receive a message for every matching tier transition on Arc Testnet. Methodology v2.0.0.',
        url: 'https://caliber.poko.blue/watchlist',
        color: 0xc2410c, // copper
        footer: { text: 'caliber.poko.blue · methodology v2.0' },
      },
    ],
  };
  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.status >= 200 && res.status < 300) return { ok: true };
    const body = await res.text().catch(() => '');
    return { ok: false, status: res.status, body: body.slice(0, 400) };
  } catch (e) {
    return { ok: false, status: 0, body: e instanceof Error ? e.message : 'fetch failed' };
  }
}

export async function POST(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest('body must be JSON');
  }
  const parsed = subscribeSchema.safeParse(json);
  if (!parsed.success) return badRequest('bad input', parsed.error.message);
  const { webhook_url, kind_filter } = parsed.data;

  // Verify the URL works before persisting.
  const test = await fireTest(webhook_url, kind_filter);
  if (!test.ok) {
    return NextResponse.json(
      { error: 'webhook_test_failed', upstream_status: test.status, detail: test.body },
      { status: 502 },
    );
  }

  try {
    await db
      .insert(watchlistWebhooks)
      .values({ webhookUrl: webhook_url, kindFilter: kind_filter, status: 'active' })
      .onConflictDoUpdate({
        target: watchlistWebhooks.webhookUrl,
        set: { kindFilter: kind_filter, status: 'active', consecutiveFailures: 0, lastError: null, lastErrorAt: null },
      });
    return ok({ ok: true, message: 'Subscribed. Check your Discord channel for the confirmation.' });
  } catch (err) {
    return serverError('failed to record subscription', err);
  }
}

export async function DELETE(req: Request) {
  let json: unknown;
  try {
    json = await req.json();
  } catch {
    return badRequest('body must be JSON');
  }
  const parsed = z.object({ webhook_url: z.string().url() }).safeParse(json);
  if (!parsed.success) return badRequest('bad input', parsed.error.message);

  try {
    const rows = await db
      .delete(watchlistWebhooks)
      .where(eq(watchlistWebhooks.webhookUrl, parsed.data.webhook_url))
      .returning();
    if (rows.length === 0) return notFound('subscription not found');
    return ok({ ok: true, removed: rows.length });
  } catch (err) {
    return serverError('failed to remove subscription', err);
  }
}
