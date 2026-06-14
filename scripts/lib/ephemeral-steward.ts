// scripts/lib/ephemeral-steward.ts — spawn a throwaway, deterministic Steward.
//
// The red-team attack demo needs a Steward whose verdicts are 100% reproducible.
// The LIVE :3300 instance runs with the LLM treasurer ENABLED, which is
// non-deterministic and can HOLD a perfectly valid payment — that flakes the
// scripted STEP 5 (approve loop-hold → re-execute → expect ALLOW).
//
// This helper boots a private Steward child process with the treasurer turned
// OFF and the Telegram bot disabled, so it:
//   • produces only deterministic pipeline verdicts (no LLM in the loop), and
//   • never opens a second long-poll on the live bot token (no grammY 409).
//
// It owns the child's lifecycle: spawn in its own process group, poll /health,
// and tear the whole group down on stop() — so a crashed caller never orphans it.

import { spawn, type ChildProcess } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');
const STEWARD_DIR = resolve(REPO_ROOT, 'services', 'steward');
const ENV_FILE = resolve(REPO_ROOT, '.env');

export interface EphemeralSteward {
  /** Base URL of the booted instance, e.g. http://localhost:3390 */
  baseUrl: string;
  port: number;
  /** Kill the child's process group and wait for the port to free. */
  stop: () => Promise<void>;
}

async function isHealthy(baseUrl: string): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean };
    return body.ok === true;
  } catch {
    return false;
  }
}

async function portFree(port: number): Promise<boolean> {
  return !(await isHealthy(`http://localhost:${port}`));
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/**
 * Boot a deterministic Steward child on `port` and resolve once /health is ok.
 *
 * Env overrides applied to the child (everything else inherits from the repo
 * .env via `tsx --env-file`):
 *   STEWARD_PORT              = <port>
 *   STEWARD_TREASURER_ENABLED = 0      (deterministic — the whole point)
 *   TELEGRAM_BOT_TOKEN        = ''     (no bot → no 409 with the live poller)
 *
 * @throws if the port is already serving a Steward, or /health never comes up.
 */
export async function startEphemeralSteward(
  port: number,
  opts: { onLog?: (line: string) => void; timeoutMs?: number } = {},
): Promise<EphemeralSteward> {
  const baseUrl = `http://localhost:${port}`;
  const log = opts.onLog ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? 20_000;

  if (!(await portFree(port))) {
    throw new Error(
      `[ephemeral-steward] port ${port} is already serving a Steward — refusing to clash. ` +
        `Pick a free STEWARD_DEMO_PORT or stop the other instance.`,
    );
  }

  const child: ChildProcess = spawn(
    'pnpm',
    ['exec', 'tsx', `--env-file=${ENV_FILE}`, 'src/index.ts'],
    {
      cwd: STEWARD_DIR,
      env: {
        ...process.env,
        STEWARD_PORT: String(port),
        STEWARD_TREASURER_ENABLED: '0',
        TELEGRAM_BOT_TOKEN: '',
      },
      // Own process group so we can signal the whole tree (tsx → node) on stop.
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  child.stdout?.on('data', (b: Buffer) => log(`[steward:${port}] ${b.toString().trimEnd()}`));
  child.stderr?.on('data', (b: Buffer) => log(`[steward:${port}!] ${b.toString().trimEnd()}`));

  let exited = false;
  let exitInfo = '';
  child.on('exit', (code, signal) => {
    exited = true;
    exitInfo = `code=${code ?? 'null'} signal=${signal ?? 'null'}`;
  });

  const stop = async (): Promise<void> => {
    if (child.pid && !exited) {
      try {
        // Negative pid → signal the whole process group (kills tsx + the node child).
        process.kill(-child.pid, 'SIGTERM');
      } catch {
        /* already gone */
      }
    }
    // Wait for the port to actually free (up to ~6s), escalating to SIGKILL.
    const deadline = Date.now() + 6000;
    let escalated = false;
    while (Date.now() < deadline) {
      if (await portFree(port)) return;
      if (!escalated && Date.now() > deadline - 3000 && child.pid) {
        escalated = true;
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
      await sleep(200);
    }
  };

  // Poll /health until the instance answers, or give up and tear down.
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (exited) {
      throw new Error(`[ephemeral-steward] child exited before /health (${exitInfo}).`);
    }
    if (await isHealthy(baseUrl)) {
      return { baseUrl, port, stop };
    }
    await sleep(300);
  }

  await stop();
  throw new Error(`[ephemeral-steward] /health on :${port} did not come up within ${timeoutMs}ms.`);
}
