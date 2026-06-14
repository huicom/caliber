// steward_routes access — the per-(host, path_prefix) circuit breaker.
//
// Phase 1 keys routes at the HOST level only (path_prefix = ''). A route is
// either 'active' or 'paused'; a paused route with auto_resume_at in the future
// short-circuits a payment to a 'hold' before any network call. Once
// auto_resume_at passes, the next lookup flips it back to active and lets the
// payment proceed.

import { db, sql, stewardRoutes } from '@arc-agents/db';
import type { StewardRoute } from '@arc-agents/db';
import { and, eq } from 'drizzle-orm';

const PATH_PREFIX = '';

/** What the pipeline's route-pause stage needs to decide. */
export interface RouteGate {
  /** True → hold this payment (route paused, not yet auto-resumed). */
  paused: boolean;
  /** Human reason for the hold, when paused. */
  reason?: string;
  /** The auto-resume time (ISO), when paused. */
  autoResumeAt?: string;
}

/** Look up the host's route row (path_prefix=''), or null. */
async function findRoute(host: string): Promise<StewardRoute | null> {
  const rows = await db
    .select()
    .from(stewardRoutes)
    .where(and(eq(stewardRoutes.host, host.toLowerCase()), eq(stewardRoutes.pathPrefix, PATH_PREFIX)));
  return rows[0] ?? null;
}

/**
 * Route-pause gate: the FIRST thing after the freeze check, before any network
 * call. If the host's route is paused and auto_resume_at is still in the future →
 * { paused: true }. If auto_resume_at has passed, flip the route back to active
 * (self-healing) and return { paused: false }. No row, or an active row → pass.
 */
export async function checkRoutePause(host: string): Promise<RouteGate> {
  const route = await findRoute(host);
  if (!route || route.status !== 'paused') return { paused: false };

  const now = Date.now();
  const resumeAt = route.autoResumeAt ? route.autoResumeAt.getTime() : null;
  if (resumeAt !== null && resumeAt <= now) {
    // Window elapsed — auto-resume and let the payment continue.
    await reactivateRoute(host);
    return { paused: false };
  }

  return {
    paused: true,
    reason: route.pausedReason ?? 'route paused',
    autoResumeAt: route.autoResumeAt ? route.autoResumeAt.toISOString() : undefined,
  };
}

/**
 * Pause a host's route (UPSERT on the (host, path_prefix) unique key). Used by
 * the runaway-loop detector to break a tight retry loop for `pauseMinutes`.
 */
export async function pauseRoute(host: string, reason: string, pauseMinutes: number): Promise<void> {
  await sql`
    insert into steward_routes (host, path_prefix, status, paused_reason, paused_at, auto_resume_at)
    values (
      ${host.toLowerCase()}, ${PATH_PREFIX}, 'paused', ${reason}, now(),
      now() + (${pauseMinutes} || ' minutes')::interval
    )
    on conflict (host, path_prefix) do update set
      status = 'paused',
      paused_reason = ${reason},
      paused_at = now(),
      auto_resume_at = now() + (${pauseMinutes} || ' minutes')::interval
  `;
}

/** Reactivate a host's route (manual or approval-driven). No-op if no row. */
export async function reactivateRoute(host: string): Promise<void> {
  await db
    .update(stewardRoutes)
    .set({ status: 'active', pausedReason: null, pausedAt: null, autoResumeAt: null })
    .where(and(eq(stewardRoutes.host, host.toLowerCase()), eq(stewardRoutes.pathPrefix, PATH_PREFIX)));
}
