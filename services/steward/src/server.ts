// Steward HTTP surface (Express on :3300). Routes:
//   GET  /health     → { ok, frozen }
//   GET  /v1/policy  → active mandate + compiled policy (auth: x-steward-key)
//   POST /v1/pay     → run the authorization pipeline (auth: x-steward-key)

import express, { type Request, type Response, type NextFunction } from 'express';
import { db, stewardMandates } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { LlmError, type DeliverySpec } from '@caliber/steward-core';
import type { Hex } from 'viem';
import { loadConfig } from './config.js';
import { StewardPipeline, type PayIntent, type SignedSpec } from './pipeline.js';
import { readFrozen } from './state.js';
import { getActiveMandate, invalidatePolicyCache } from './policy-store.js';
import { listApprovals, decideApproval } from './approvals.js';
import { treasurerEnabled, getLlmRuntime } from './llm-config.js';
import { compileMandate } from './mandate.js';

/**
 * WS-1 — parse a signed DeliverySpec from the JSON request body. Over the wire,
 * the spec's bigint fields (validUntil/nonce) arrive as strings or numbers, so
 * coerce them to bigint here. Throws on a structurally-invalid spec (caught by
 * the route as a 400). A missing spec returns undefined (the back-compat path).
 * Signature/expiry/url-binding validity is the pipeline's job, not this parser's.
 */
function parseSignedSpec(raw: unknown): SignedSpec | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'object') throw new Error('`spec` must be an object');
  const s = raw as { spec?: unknown; buyerSig?: unknown; sellerSig?: unknown };
  if (!s.spec || typeof s.spec !== 'object') throw new Error('`spec.spec` (the DeliverySpec) is required');
  if (typeof s.buyerSig !== 'string') throw new Error('`spec.buyerSig` (hex signature) is required');
  if (s.sellerSig !== undefined && typeof s.sellerSig !== 'string') {
    throw new Error('`spec.sellerSig` must be a hex signature string when present');
  }
  const d = s.spec as Record<string, unknown>;
  const required = ['chain', 'buyer', 'seller', 'sellerUrlHash', 'schemaHash', 'validUntil', 'nonce'];
  for (const k of required) {
    if (d[k] === undefined || d[k] === null) throw new Error(`spec.spec.${k} is required`);
  }
  const spec: DeliverySpec = {
    chain: d.chain as Hex,
    buyer: d.buyer as DeliverySpec['buyer'],
    seller: d.seller as DeliverySpec['seller'],
    sellerUrlHash: d.sellerUrlHash as Hex,
    schemaHash: d.schemaHash as Hex,
    maxBytes: Number(d.maxBytes ?? 0),
    deadlineMs: Number(d.deadlineMs ?? 0),
    requireJson: Boolean(d.requireJson),
    requireOkField: Boolean(d.requireOkField),
    validUntil: BigInt(d.validUntil as string | number),
    nonce: BigInt(d.nonce as string | number),
  };
  return {
    spec,
    buyerSig: s.buyerSig as Hex,
    sellerSig: typeof s.sellerSig === 'string' ? (s.sellerSig as Hex) : undefined,
  };
}

export function createApp() {
  const config = loadConfig();
  const pipeline = new StewardPipeline(config);

  const app = express();
  app.use(express.json({ limit: '256kb' }));

  // ---- health ---------------------------------------------------------------
  app.get('/health', async (_req, res) => {
    let frozen = false;
    try {
      frozen = (await readFrozen()).frozen;
    } catch (err) {
      console.error('[steward] /health frozen read failed:', err);
    }
    res.json({ ok: true, frozen });
  });

  // ---- auth guard -----------------------------------------------------------
  function requireKey(req: Request, res: Response, next: NextFunction): void {
    const key = req.headers['x-steward-key'];
    if (typeof key !== 'string' || key !== config.apiKey) {
      res.status(401).json({ error: 'unauthorized', message: 'set header x-steward-key: <STEWARD_API_KEY>' });
      return;
    }
    next();
  }

  // ---- active policy (for the console to render) ----------------------------
  app.get('/v1/policy', requireKey, async (_req: Request, res: Response) => {
    try {
      const m = await getActiveMandate();
      res.json({
        mandate: { id: m.id ? m.id.toString() : null, rawText: m.rawText, version: m.version },
        policy: m.policy,
      });
    } catch (err) {
      console.error('[steward] /v1/policy failed:', err);
      res.status(500).json({ error: 'policy_error', message: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // ---- mandate compiler (LLM, master-switch gated) --------------------------
  // POST /v1/mandate { rawText } → compile plain English into a CompiledPolicy,
  // install it as the new active mandate, supersede the previous one.
  app.post('/v1/mandate', requireKey, async (req: Request, res: Response) => {
    const body = req.body as { rawText?: unknown } | undefined;
    const rawText = typeof body?.rawText === 'string' ? body.rawText.trim() : '';
    if (!rawText) {
      res.status(400).json({ error: 'invalid_body', message: 'body must include a non-empty string `rawText`' });
      return;
    }

    // MASTER SWITCH: when off, the compiler is unavailable (no LLM call made).
    if (!treasurerEnabled()) {
      res.status(503).json({
        error: 'treasurer_disabled',
        detail: 'LLM treasurer is disabled; fund OpenCode Zen credits and set STEWARD_TREASURER_ENABLED=1',
      });
      return;
    }

    let compiled;
    try {
      compiled = await compileMandate(rawText);
    } catch (err) {
      if (err instanceof LlmError) {
        res.status(502).json({ error: 'compile_failed', kind: err.kind, detail: err.message });
        return;
      }
      console.error('[steward] /v1/mandate compile error:', err);
      res.status(500).json({ error: 'mandate_error', message: err instanceof Error ? err.message : 'unknown' });
      return;
    }

    try {
      const prev = await getActiveMandate();
      const nextVersion = (prev.version ?? 0) + 1;
      const rt = getLlmRuntime();
      // Supersede the current active row(s), then install the new one.
      await db
        .update(stewardMandates)
        .set({ status: 'superseded' })
        .where(eq(stewardMandates.status, 'active'));
      const [inserted] = await db
        .insert(stewardMandates)
        .values({
          rawText,
          compiledPolicy: compiled.policy,
          compileModel: rt ? `opencode/${rt.smartModel}` : 'opencode',
          version: nextVersion,
          status: 'active',
        })
        .returning();
      invalidatePolicyCache();

      res.status(200).json({
        mandate: { id: inserted.id.toString(), rawText: inserted.rawText, version: inserted.version },
        policy: compiled.policy,
        warnings: compiled.warnings,
      });
    } catch (err) {
      console.error('[steward] /v1/mandate install error:', err);
      res.status(500).json({ error: 'mandate_error', message: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // ---- the payment intent ---------------------------------------------------
  app.post('/v1/pay', requireKey, async (req: Request, res: Response) => {
    const body = req.body as Partial<PayIntent> | undefined;
    if (!body || typeof body.url !== 'string' || !body.url) {
      res.status(400).json({ error: 'invalid_body', message: 'body must include a string `url`' });
      return;
    }
    try {
      // Validate the URL early so a garbage URL is a clean 400, not a 500.
      new URL(body.url);
    } catch {
      res.status(400).json({ error: 'invalid_url', message: `not a valid URL: ${body.url}` });
      return;
    }

    // WS-1: an optional signed DeliverySpec. A structurally-invalid spec is a
    // clean 400 (semantic validity — signatures/expiry — is the pipeline's job).
    let spec: SignedSpec | undefined;
    try {
      spec = parseSignedSpec((body as { spec?: unknown }).spec);
    } catch (err) {
      res.status(400).json({ error: 'invalid_spec', message: err instanceof Error ? err.message : 'invalid spec' });
      return;
    }

    try {
      const outcome = await pipeline.run({
        url: body.url,
        init: body.init,
        source: typeof body.source === 'string' ? body.source : undefined,
        expect:
          body.expect && typeof body.expect === 'object'
            ? (body.expect as PayIntent['expect'])
            : undefined,
        spec,
      });
      res.status(outcome.httpStatus).json(outcome.body);
    } catch (err) {
      console.error('[steward] pipeline error:', err);
      res.status(500).json({ error: 'pipeline_error', message: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // ---- approvals queue ------------------------------------------------------
  // List held payments awaiting a decision (default: pending only).
  app.get('/v1/approvals', requireKey, async (req: Request, res: Response) => {
    const statusParam = typeof req.query.status === 'string' ? req.query.status : 'pending';
    const status = statusParam === 'all' ? undefined : statusParam;
    try {
      const items = await listApprovals(status);
      res.json({ approvals: items });
    } catch (err) {
      console.error('[steward] /v1/approvals failed:', err);
      res.status(500).json({ error: 'approvals_error', message: err instanceof Error ? err.message : 'unknown' });
    }
  });

  // Decide a held approval: approve (re-execute the stored request) or deny.
  app.post('/v1/approvals/:id/decide', requireKey, async (req: Request, res: Response) => {
    const idRaw = String(req.params.id);
    let approvalId: bigint;
    try {
      approvalId = BigInt(idRaw);
    } catch {
      res.status(400).json({ error: 'invalid_id', message: `not a numeric approval id: ${idRaw}` });
      return;
    }
    const body = req.body as { decision?: unknown; via?: unknown } | undefined;
    const decision = body?.decision;
    if (decision !== 'approve' && decision !== 'deny') {
      res.status(400).json({ error: 'invalid_decision', message: "decision must be 'approve' or 'deny'" });
      return;
    }
    const via: 'web' | 'telegram' = body?.via === 'telegram' ? 'telegram' : 'web';

    try {
      const out = await decideApproval(approvalId, decision, via, pipeline);
      res.status(out.httpStatus).json(out.body);
    } catch (err) {
      console.error('[steward] /v1/approvals/:id/decide failed:', err);
      res.status(500).json({ error: 'decide_error', message: err instanceof Error ? err.message : 'unknown' });
    }
  });

  return { app, config, pipeline };
}
