// Telegram interrupt bot (Steward Phase 1, task 20).
//
// This is the OWNER's interrupt channel — NOT the system of record. The web
// console (steward.poko.blue) owns the approvals queue, the ledger, and the
// freeze switch; Telegram only PUSHES a held-payment alert to the owner and lets
// them tap Approve / Deny / Freeze on the move. Every tap calls the SAME
// in-process logic the web route calls (decideApproval / freeze upsert) — no
// HTTP loop, no second source of truth.
//
// Transport: grammY long-polling, run IN-PROCESS with the Express service. No
// inbound webhook URL is needed. If TELEGRAM_BOT_TOKEN is absent the bot is a
// silent no-op so the payment service still runs without it.
//
// Outbound pushes ride the existing pg_notify('steward_events') channel: we open
// our own LISTEN connection (like the console's SSE feed does) and react to
// `kind==='approval'` rows with `status==='pending'`. That way no hold site has
// to know the bot exists.

import { Bot, InlineKeyboard, type Context } from 'grammy';
import { db, sql, stewardApprovals } from '@arc-agents/db';
import type { StewardApproval } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { listApprovals, decideApproval } from './approvals.js';
import { readFrozen } from './state.js';
import type { StewardPipeline } from './pipeline.js';
import {
  composeXPost,
  claimShareSlot,
  shareViewUrl,
  type ShareContext,
  type XPostDraft,
} from './share.js';

const CONSOLE_URL = (process.env.STEWARD_CONSOLE_URL ?? 'https://steward.poko.blue').replace(/\/+$/, '');

// Module-level handle to the running bot, set by startTelegramBot(). The treasurer
// hot path calls offerSharePost() which uses this; when the bot isn't running
// (no token), offerSharePost is a silent no-op. NEVER throws into the caller.
let activeBot: Bot | null = null;

/** Owner chat id as a string (Telegram chat ids are numeric but we compare as text). */
function ownerChatId(): string | null {
  const v = process.env.TELEGRAM_OWNER_CHAT_ID?.trim();
  return v && v.length > 0 ? v : null;
}

/** Guard: only the configured owner may act. Returns true if the ctx is the owner. */
function isOwner(ctx: Context): boolean {
  const owner = ownerChatId();
  if (!owner) return false;
  const from = ctx.from?.id;
  return from != null && String(from) === owner;
}

/** Short, human label for a held payment. */
function describeHold(p: {
  host: string;
  quotedUsdc: string | null;
  reasoning: string | null;
  payTo: string | null;
}): string {
  const amount = p.quotedUsdc != null ? `${p.quotedUsdc} USDC` : 'amount unknown';
  const lines = [
    '⏸️ *Payment held — your call*',
    '_Steward paused the money before signing._',
    '',
    `🌐 *Host*  ${escapeMd(p.host)}`,
    `💵 *Amount*  ${escapeMd(amount)}`,
  ];
  if (p.payTo) lines.push(`📮 *Pay to*  \`${escapeMd(p.payTo)}\``);
  if (p.reasoning) lines.push(`🧠 *Why*  ${escapeMd(p.reasoning)}`);
  return lines.join('\n');
}

/** Escape the small set of MarkdownV2-unsafe chars we actually emit. We use the
 *  legacy 'Markdown' parse mode (simpler), so only escape backticks/underscores
 *  that would break formatting. */
function escapeMd(s: string): string {
  return s.replace(/([_*`\[])/g, '\\$1');
}

/** The inline keyboard offered on a fresh hold. */
function holdKeyboard(approvalId: string, incidentId: string | null, paymentId: string): InlineKeyboard {
  const deepLink = incidentId
    ? `${CONSOLE_URL}/steward/incidents/${incidentId}`
    : `${CONSOLE_URL}/steward`;
  return new InlineKeyboard()
    .text('✅ Approve', `approve:${approvalId}`)
    .text('⛔ Deny', `deny:${approvalId}`)
    .row()
    .text('🧊 Freeze treasury', `freeze:${approvalId}`)
    .row()
    .url('🔎 Open incident', deepLink);
}

// ── X share: compose + push a draft to the owner (keyless, human-approved) ──────

/** The inline keyboard for a share draft: 1-tap post + reword + view. */
function shareKeyboard(intentUrl: string, ctx: ShareContext): InlineKeyboard {
  return new InlineKeyboard()
    .url('🐦 Post to X', intentUrl)
    .row()
    .text('🔄 Reword', `reword:${ctx.kind}`)
    .url('🔎 View', shareViewUrl(ctx));
}

/** Render the "shareable moment" message body (draft shown in a quoted block). */
function shareMessage(ctx: ShareContext, draft: XPostDraft): string {
  const headline =
    ctx.kind === 'deny'
      ? '💡 *Shareable moment* — your treasurer *denied* a payment'
      : ctx.kind === 'hold'
        ? '💡 *Shareable moment* — your treasurer *held* a payment'
        : '💡 *Shareable moment* — fresh X draft';
  const oneLiner = [ctx.host && `🌐 ${ctx.host}`, ctx.amountUsdc && `💵 ${ctx.amountUsdc} USDC`, ctx.reason && `🧠 ${ctx.reason}`]
    .filter(Boolean)
    .map((s) => escapeMd(String(s)))
    .join('  ·  ');
  const quoted = draft.text
    .split('\n')
    .map((l) => `> ${escapeMd(l)}`)
    .join('\n');
  const lines = [headline];
  if (oneLiner) lines.push(oneLiner);
  lines.push('', '*Draft post:*', quoted, '', '_Tap_ 🐦 _to open X pre-filled — review, then post manually._');
  return lines.join('\n');
}

/**
 * Compose an X draft for `ctx` and DM it to the owner with a 1-tap "Post to X"
 * button. Owner-only, cooldown-gated, FIRE-AND-FORGET: every error is swallowed
 * here so it can be called as `void offerSharePost(...)` from the payment path.
 *
 * `skipCooldown` is set true for the manual /tweet command (always drafts).
 */
export async function offerSharePost(ctx: ShareContext, skipCooldown = false): Promise<void> {
  try {
    const bot = activeBot;
    const owner = ownerChatId();
    if (!bot || !owner) return; // bot disabled or no owner — silent no-op.

    if (!skipCooldown) {
      const ok = await claimShareSlot();
      if (!ok) {
        console.log('[steward:share] within cooldown — skipping share draft');
        return;
      }
    }

    const draft = await composeXPost(ctx);
    await bot.api.sendMessage(owner, shareMessage(ctx, draft), {
      parse_mode: 'Markdown',
      reply_markup: shareKeyboard(draft.intentUrl, ctx),
      link_preview_options: { is_disabled: true },
    });
  } catch (err) {
    // COSMETIC feature — never propagate. Just log.
    console.error('[steward:share] offerSharePost failed (non-fatal):', err instanceof Error ? err.message : err);
  }
}

// ── Freeze (reuse the web route's upsert + notify pattern) ────────────────────

async function setFrozen(frozen: boolean, reason: string, by: string): Promise<void> {
  const value = JSON.stringify({ frozen, reason, by, at: new Date().toISOString() });
  await sql`
    insert into steward_state (key, value, updated_at)
    values ('frozen', ${value}::jsonb, now())
    on conflict (key) do update set value = ${value}::jsonb, updated_at = now()`;
  await sql`select pg_notify('steward_events', ${JSON.stringify({ kind: 'freeze', frozen, reason })})`;
}

// ── Today's counts for /status ────────────────────────────────────────────────

async function todayCounts(): Promise<{ allow: number; deny: number; hold: number }> {
  const rows = await sql<{ decision: string; n: string }[]>`
    select decision, count(*)::text as n
    from steward_payments
    where created_at >= date_trunc('day', now())
    group by decision`;
  const out = { allow: 0, deny: 0, hold: 0 };
  for (const r of rows) {
    if (r.decision === 'allow') out.allow = Number(r.n);
    else if (r.decision === 'deny') out.deny = Number(r.n);
    else if (r.decision === 'hold') out.hold = Number(r.n);
  }
  return out;
}

async function pendingCount(): Promise<number> {
  const rows = await sql<{ n: string }[]>`
    select count(*)::text as n from steward_approvals where status = 'pending'`;
  return Number(rows[0]?.n ?? '0');
}

// ── /tweet context builders ────────────────────────────────────────────────────

/** A manual /tweet with a free-text topic — pass the text straight to the composer. */
async function manualShareContext(topic: string): Promise<ShareContext> {
  return { kind: 'manual', reason: topic };
}

/**
 * Build a share context from the most recent NOTABLE treasurer decision (a hold or
 * deny that came from the treasurer stage). Falls back to a generic 'manual' draft
 * if there's no such row yet — so /tweet always produces something to demo.
 */
async function recentShareContext(): Promise<ShareContext> {
  try {
    const rows = await sql<
      { decision: string; host: string; quoted_usdc: string | null; reasoning: string | null; incident_id: string | null }[]
    >`
      select decision, host, quoted_usdc::text as quoted_usdc, reasoning, incident_id::text as incident_id
      from steward_payments
      where decision_stage = 'treasurer' and decision in ('hold','deny')
      order by created_at desc
      limit 1`;
    const r = rows[0];
    if (r) {
      return {
        kind: r.decision === 'deny' ? 'deny' : 'hold',
        host: r.host,
        amountUsdc: r.quoted_usdc ?? undefined,
        reason: r.reasoning ?? undefined,
        incidentId: r.incident_id ?? undefined,
      };
    }
  } catch (err) {
    console.error('[steward:share] recentShareContext query failed:', err instanceof Error ? err.message : err);
  }
  return { kind: 'manual', reason: 'How Steward guards an agent wallet' };
}

// ── Push: send the owner an alert for one freshly-held approval ────────────────

async function pushHold(bot: Bot, approvalId: string): Promise<void> {
  const owner = ownerChatId();
  if (!owner) return;

  // Pull full context from the pending list (joins payment fields).
  const pending = await listApprovals('pending');
  const item = pending.find((a) => a.id === approvalId);
  if (!item || !item.payment) return; // already decided / raced

  const text = describeHold(item.payment);
  const kb = holdKeyboard(item.id, item.incidentId, item.paymentId);

  try {
    const sent = await bot.api.sendMessage(owner, text, {
      parse_mode: 'Markdown',
      reply_markup: kb,
    });
    // Store message + chat id back on the approval row for traceability.
    await db
      .update(stewardApprovals)
      .set({ telegramChatId: String(sent.chat.id), telegramMessageId: String(sent.message_id) })
      .where(eq(stewardApprovals.id, BigInt(approvalId)));
  } catch (err) {
    reportSendError(err, approvalId);
  }
}

/** Detect the "owner has never pressed Start" condition and report it loudly as a
 *  required one-time user action — NOT a code bug. */
function reportSendError(err: unknown, context: string): void {
  const msg = err instanceof Error ? err.message : String(err);
  const blocked = /can't initiate conversation|chat not found|bot was blocked|403/i.test(msg);
  if (blocked) {
    console.error(
      `[steward:telegram] cannot message owner (${context}): ${msg}\n` +
        '[steward:telegram] >>> ONE-TIME OWNER ACTION REQUIRED: open @ArcStewardbot in Telegram and press Start once. ' +
        'A bot cannot initiate a conversation until the user has started it. This is expected, not a bug.',
    );
  } else {
    console.error(`[steward:telegram] sendMessage failed (${context}):`, msg);
  }
}

// ── LISTEN loop: turn pending-approval notifies into pushes ────────────────────

function startApprovalListener(bot: Bot): void {
  // postgres-js dedicates a connection from the pool for LISTEN; we reuse the
  // shared `sql` client (no extra `postgres` dependency in this package).
  sql
    .listen('steward_events', (payload: string) => {
      let evt: { kind?: string; approval?: { id?: string; status?: string } };
      try {
        evt = JSON.parse(payload);
      } catch {
        return;
      }
      if (evt.kind !== 'approval') return;
      if (evt.approval?.status !== 'pending') return;
      const id = evt.approval.id;
      if (!id) return;
      pushHold(bot, id).catch((err) => console.error('[steward:telegram] pushHold failed:', err));
    })
    .then(() => console.log('[steward:telegram] LISTEN steward_events (approval pushes) active'))
    .catch((err: unknown) => console.error('[steward:telegram] LISTEN failed:', err));
}

// ── Bot wiring ────────────────────────────────────────────────────────────────

export interface TelegramHandle {
  bot: Bot;
  stop: () => Promise<void>;
}

/**
 * Start the Telegram interrupt bot. No-op (returns null) when no token is set, so
 * the service runs fine without Telegram. `pipeline` is needed because Approve
 * re-executes the held payment via decideApproval.
 */
export function startTelegramBot(pipeline: StewardPipeline): TelegramHandle | null {
  const token = process.env.TELEGRAM_BOT_TOKEN?.trim();
  if (!token) {
    console.log('[steward:telegram] disabled (no TELEGRAM_BOT_TOKEN)');
    return null;
  }
  if (!ownerChatId()) {
    console.warn('[steward:telegram] TELEGRAM_BOT_TOKEN set but TELEGRAM_OWNER_CHAT_ID missing — pushes/commands will be ignored');
  }

  const bot = new Bot(token);
  // Publish the handle so the treasurer hot path can fire offerSharePost().
  activeBot = bot;

  // ── Commands (thin) ─────────────────────────────────────────────────────────
  bot.command('start', async (ctx) => {
    await ctx.reply(
      "👋 *I'm Arc Steward* — the CFO layer for your agent's wallet.\n\n" +
        '⏸️ When my treasurer pauses a payment I ping you here with ✅ Approve / ⛔ Deny / 🧊 Freeze.\n' +
        '🐦 When I make a notable call I draft a ready-to-post X update for you (1-tap, you publish).\n\n' +
        `🔎 Console (system of record): ${CONSOLE_URL}\n\n` +
        '*Commands*\n' +
        '/status — treasury + today\n' +
        '/pending — open approvals\n' +
        '/tweet `[topic]` — draft an X post\n' +
        '/freeze · /unfreeze — kill switch',
      { parse_mode: 'Markdown', link_preview_options: { is_disabled: true } },
    );
  });

  bot.command('status', async (ctx) => {
    try {
      const [frozen, pending, counts] = await Promise.all([readFrozen(), pendingCount(), todayCounts()]);
      const head = frozen.frozen
        ? `🧊 *Treasury FROZEN*${frozen.reason ? ` — ${escapeMd(frozen.reason)}` : ''}`
        : '🟢 *Treasury live*';
      await ctx.reply(
        `${head}\n\n` +
          `⏳ *Pending approvals*  ${pending}\n` +
          `📊 *Today*  ✅ ${counts.allow} allowed  ·  ⏸️ ${counts.hold} held  ·  ⛔ ${counts.deny} denied`,
        { parse_mode: 'Markdown' },
      );
    } catch (err) {
      await ctx.reply('status read failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  // /tweet [topic] — draft an X post on demand (demo-friendly). Owner-only.
  // Drafts from the most recent notable activity, or from the given topic text.
  bot.command('tweet', async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      const topic = ctx.match?.trim();
      const shareCtx = topic ? await manualShareContext(topic) : await recentShareContext();
      await ctx.reply('✍️ Drafting an X post…');
      await offerSharePost(shareCtx, /* skipCooldown */ true);
    } catch (err) {
      await ctx.reply('tweet draft failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  bot.command('pending', async (ctx) => {
    try {
      const pending = await listApprovals('pending');
      if (pending.length === 0) {
        await ctx.reply('No pending approvals. ✅');
        return;
      }
      const lines = pending.slice(0, 20).map((a) => {
        const amt = a.payment?.quotedUsdc != null ? `${a.payment.quotedUsdc} USDC` : '?';
        return `#${a.id} — ${a.payment?.host ?? '?'} · ${amt}`;
      });
      await ctx.reply(`Pending approvals (${pending.length}):\n` + lines.join('\n'));
    } catch (err) {
      await ctx.reply('pending read failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  bot.command('freeze', async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      await setFrozen(true, 'frozen via Telegram', 'telegram');
      await ctx.reply('🧊 Treasury FROZEN. Every payment is denied until you /unfreeze.');
    } catch (err) {
      await ctx.reply('freeze failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  bot.command('unfreeze', async (ctx) => {
    if (!isOwner(ctx)) return;
    try {
      await setFrozen(false, 'unfrozen via Telegram', 'telegram');
      await ctx.reply('🟢 Treasury live again.');
    } catch (err) {
      await ctx.reply('unfreeze failed: ' + (err instanceof Error ? err.message : String(err)));
    }
  });

  // ── Callback buttons ─────────────────────────────────────────────────────────
  bot.on('callback_query:data', async (ctx) => {
    // Owner-only: ignore (politely) taps from anyone else.
    if (!isOwner(ctx)) {
      await ctx.answerCallbackQuery({ text: 'Not authorized.', show_alert: true }).catch(() => {});
      return;
    }

    const data = ctx.callbackQuery.data;
    const [action, idStr] = data.split(':');

    try {
      if (action === 'freeze') {
        await setFrozen(true, 'frozen via Telegram', 'telegram');
        await ctx.answerCallbackQuery({ text: 'Treasury frozen.' });
        const kb = new InlineKeyboard().text('🟢 Unfreeze treasury', 'unfreeze:0');
        await ctx.reply('🧊 Treasury FROZEN via Telegram. Every payment is denied until unfrozen.', {
          reply_markup: kb,
        });
        return;
      }

      if (action === 'unfreeze') {
        await setFrozen(false, 'unfrozen via Telegram', 'telegram');
        await ctx.answerCallbackQuery({ text: 'Treasury live.' });
        await ctx.reply('🟢 Treasury live again.');
        return;
      }

      if (action === 'reword') {
        // Regenerate the draft for the same kind and edit the message in place.
        const kind: ShareContext['kind'] = idStr === 'deny' ? 'deny' : idStr === 'hold' ? 'hold' : 'manual';
        const shareCtx: ShareContext =
          kind === 'manual' ? await recentShareContext() : { kind };
        await ctx.answerCallbackQuery({ text: 'Rewording…' });
        const draft = await composeXPost(shareCtx);
        try {
          await ctx.editMessageText(shareMessage(shareCtx, draft), {
            parse_mode: 'Markdown',
            reply_markup: shareKeyboard(draft.intentUrl, shareCtx),
            link_preview_options: { is_disabled: true },
          });
        } catch {
          await ctx.reply(shareMessage(shareCtx, draft), {
            parse_mode: 'Markdown',
            reply_markup: shareKeyboard(draft.intentUrl, shareCtx),
            link_preview_options: { is_disabled: true },
          });
        }
        return;
      }

      if (action === 'approve' || action === 'deny') {
        let approvalId: bigint;
        try {
          approvalId = BigInt(idStr);
        } catch {
          await ctx.answerCallbackQuery({ text: 'Bad approval id.' });
          return;
        }
        const decision = action === 'approve' ? 'approve' : 'deny';
        const out = await decideApproval(approvalId, decision, 'telegram', pipeline);

        // Build the outcome summary and edit the original message (strip buttons).
        let summary: string;
        if (out.httpStatus === 200 || out.httpStatus === 202) {
          if (decision === 'deny') {
            summary = `⛔ *Denied* (approval #${idStr}). Nothing executed.`;
          } else {
            const exec = (out.body as { execution?: { settled?: unknown } }).execution;
            const execNote = exec ? ' Re-execution ran (see console for settlement).' : '';
            summary = `✅ *Approved* (approval #${idStr}).${execNote}`;
          }
        } else if (out.httpStatus === 409) {
          summary = `⚠️ Already decided (approval #${idStr}): ${(out.body as { status?: string }).status ?? 'unknown'}.`;
        } else if (out.httpStatus === 410) {
          summary = `⌛ Expired (approval #${idStr}) before a decision.`;
        } else {
          summary = `⚠️ Decision returned ${out.httpStatus} for approval #${idStr}.`;
        }

        await ctx.answerCallbackQuery({ text: decision === 'approve' ? 'Approved.' : 'Denied.' });
        // Edit the original alert message to show the outcome + remove the keyboard.
        try {
          await ctx.editMessageText(summary, { parse_mode: 'Markdown' });
        } catch {
          // Fall back to a fresh reply if the message can't be edited.
          await ctx.reply(summary, { parse_mode: 'Markdown' });
        }
        return;
      }

      await ctx.answerCallbackQuery({ text: 'Unknown action.' });
    } catch (err) {
      console.error('[steward:telegram] callback failed:', err);
      await ctx.answerCallbackQuery({ text: 'Error — check the console.' }).catch(() => {});
    }
  });

  bot.catch((err) => {
    console.error('[steward:telegram] bot error:', err.error);
  });

  // Start long-polling (non-blocking) + the approval LISTEN loop.
  startApprovalListener(bot);
  void bot.start({
    onStart: (me) => console.log(`[steward:telegram] long-polling as @${me.username} (interrupt channel)`),
  });

  return {
    bot,
    stop: async () => {
      await bot.stop();
      if (activeBot === bot) activeBot = null;
    },
  };
}
