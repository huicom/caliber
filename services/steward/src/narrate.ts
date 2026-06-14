// Incident narrator (Steward Phase 1, task 19, narrative half).
//
// Fire-and-forget: turn a raw incident (kind + evidence + the linked payment)
// into a 2–3 sentence plain-English narrative with the SMART model, and UPDATE
// steward_incidents.narrative. NEVER blocks the payment path — every call site
// invokes `void narrateIncident(id).catch(log)`.
//
// Gated by the master switch: when the treasurer is disabled, this is a no-op
// and the column stays null (the web renders "Treasurer's narrative pending.").

import { z } from 'zod';
import { db, sql, stewardIncidents, stewardPayments } from '@arc-agents/db';
import { eq } from 'drizzle-orm';
import { LlmError } from '@caliber/steward-core';
import { getLlmRuntime } from './llm-config.js';

const NarrativeSchema = z.object({
  narrative: z.string().min(1).max(800),
});

const SYSTEM_PROMPT = `You are Steward, an AI agent's CFO. You write SHORT, plain-English incident narratives for a human owner reviewing flagged payments. Reply with ONLY a JSON object: {"narrative": "..."}.

The narrative must be 2-3 sentences and cover, in order:
1. What happened (in concrete terms — amounts, hosts, recipients).
2. Why it is suspicious or noteworthy.
3. The recommended action (approve, deny, investigate, ignore).

Be specific and calm. Do not invent facts beyond the evidence provided. No markdown, no bullet points.`;

/**
 * Generate + persist a narrative for one incident. No-op when the master switch
 * is off. Designed to be called fire-and-forget; it swallows nothing silently —
 * callers attach `.catch(...)` and we also log internally.
 */
export async function narrateIncident(incidentId: bigint): Promise<void> {
  const rt = getLlmRuntime();
  if (!rt) return; // treasurer disabled → leave narrative null

  // Load the incident + its linked payment (if any) for context.
  const [incident] = await db
    .select()
    .from(stewardIncidents)
    .where(eq(stewardIncidents.id, incidentId))
    .limit(1);
  if (!incident) return;

  let payment = null;
  if (incident.paymentId) {
    const [p] = await db
      .select()
      .from(stewardPayments)
      .where(eq(stewardPayments.id, incident.paymentId))
      .limit(1);
    payment = p ?? null;
  }

  const facts = {
    incident: {
      kind: incident.kind,
      severity: incident.severity,
      host: incident.host,
      payTo: incident.payTo,
      evidence: incident.evidence ?? null,
    },
    payment: payment
      ? {
          decision: payment.decision,
          stage: payment.decisionStage,
          quotedUsdc: payment.quotedUsdc,
          settledUsdc: payment.settledUsdc,
          sellerUrl: payment.sellerUrl,
          reasoning: payment.reasoning,
        }
      : null,
  };

  let narrative: string;
  try {
    const out = await rt.client.chatJson({
      model: rt.smartModel,
      system: SYSTEM_PROMPT,
      user: `Write the incident narrative for this flagged payment:\n\n${JSON.stringify(facts, null, 2)}`,
      // Reasoning model — leave headroom for the reasoning trace to finish before
      // it emits the final {"narrative": …} JSON in `content`.
      maxTokens: 2000,
      timeoutMs: 30_000,
      schema: NarrativeSchema,
    });
    narrative = out.narrative.trim();
  } catch (err) {
    // Narratives are best-effort prose; a credits/timeout failure must not crash
    // anything. Log and leave the column null (the UI shows the pending state).
    if (err instanceof LlmError) {
      console.error(`[steward] narrateIncident #${incidentId} skipped (LlmError kind=${err.kind}): ${err.message}`);
    } else {
      console.error(`[steward] narrateIncident #${incidentId} failed:`, err);
    }
    return;
  }

  await db
    .update(stewardIncidents)
    .set({ narrative })
    .where(eq(stewardIncidents.id, incidentId));

  // Cheap incident-update NOTIFY so an open console can refresh the narrative.
  try {
    await sql`select pg_notify('steward_events', ${JSON.stringify({
      kind: 'incident',
      incident: { id: incidentId.toString(), narrativeReady: true },
    })})`;
  } catch {
    /* best-effort */
  }
}
