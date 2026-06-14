// LLM transport connectivity check (Steward Phase 1, task 14 acceptance).
//
//   tsx --env-file=../../.env scripts/llm-check.ts
//   # or from repo root: tsx --env-file=.env packages/steward-core/scripts/llm-check.ts
//
// TRANSPORT: plain HTTP against the OpenCode Go subscription's OpenAI-compatible
// endpoint (OPENCODE_BASE_URL = https://opencode.ai/zen/go/v1, Bearer
// OPENCODE_API_KEY). Model ids are BARE.
//
// Step 1 — one chatJson against STEWARD_MODEL_FAST (fast model).
// Step 2 — one chatJson against STEWARD_MODEL_SMART (smart model).
// Both should return a validated JSON object (no CreditsError). Prints PASS/FAIL
// + latency per call.
//
// Reads env directly (it's an operator script, not core lib). The core llm.ts
// reads no env.

import { z } from 'zod';
import { createLlmClient, LlmError } from '../src/llm.js';

function env(name: string): string {
  const v = process.env[name]?.trim();
  if (!v) {
    console.error(`[llm-check] missing env ${name} — set it in the repo-root .env`);
    process.exit(1);
  }
  return v;
}

const schema = z.object({ ok: z.boolean(), echo: z.string() });

async function probe(
  client: ReturnType<typeof createLlmClient>,
  label: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  console.log(`\n[${label}] chatJson via HTTP — model=${model} …`);
  const t0 = Date.now();
  try {
    const out = await client.chatJson({
      model,
      system: 'You are a JSON echo service. Reply ONLY with a single raw JSON object, no markdown.',
      user: 'Return exactly {"ok": true, "echo": "steward"}.',
      maxTokens: 600,
      timeoutMs,
      schema,
    });
    const ms = Date.now() - t0;
    console.log(`  PASS — ${JSON.stringify(out)}   (${ms}ms)`);
    return true;
  } catch (err) {
    const ms = Date.now() - t0;
    if (err instanceof LlmError) {
      console.error(`  FAIL — LlmError kind=${err.kind} status=${err.status ?? '-'}: ${err.message}   (${ms}ms)`);
      if (err.detail) console.error(`         detail: ${err.detail}`);
    } else {
      console.error(`  FAIL — unexpected error (${ms}ms):`, err);
    }
    return false;
  }
}

async function main(): Promise<void> {
  const baseUrl = env('OPENCODE_BASE_URL');
  const apiKey = env('OPENCODE_API_KEY');
  const fastModel = env('STEWARD_MODEL_FAST');
  const smartModel = env('STEWARD_MODEL_SMART');

  const client = createLlmClient({ baseUrl, apiKey });

  console.log('━'.repeat(72));
  console.log('STEWARD · OpenCode Go subscription (HTTP) connectivity check');
  console.log(`base=${baseUrl}`);
  console.log(`fast=${fastModel}   smart=${smartModel}`);
  console.log('━'.repeat(72));

  const okFast = await probe(client, '1/2 FAST', fastModel, 12_000);
  const okSmart = await probe(client, '2/2 SMART', smartModel, 30_000);

  console.log('\n' + '━'.repeat(72));
  if (okFast && okSmart) {
    console.log('RESULT: PASS — both fast + smart calls returned validated JSON via the subscription.');
    process.exit(0);
  } else {
    console.error('RESULT: FAIL — see above.');
    process.exit(1);
  }
}

main().catch((e) => {
  console.error('[llm-check] fatal:', e);
  process.exit(1);
});
