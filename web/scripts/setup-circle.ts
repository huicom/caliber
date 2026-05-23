/**
 * One-shot Circle Programmable Wallets setup for the Caliber demo flow.
 *
 * Generates an Entity Secret (32-byte hex), registers it with Circle,
 * downloads the recovery file, and creates the "caliber-demo-wallets"
 * wallet set. Prints the three env vars you need to paste into your
 * .env at the end.
 *
 * Usage:
 *   CIRCLE_API_KEY=SAND_API_KEY:xxxxxxxxxx \
 *     pnpm --filter web exec tsx scripts/setup-circle.ts
 *
 * Re-running is safe:
 *   - If CIRCLE_ENTITY_SECRET is already set, the script reuses it
 *     instead of generating a new one (re-registering with a different
 *     secret would lock you out of any wallets created under the old).
 *   - The wallet set creation uses a deterministic idempotency key, so
 *     repeated runs return the same wallet set instead of creating new.
 *
 * The recovery file landing in cwd is your only path back to the
 * wallets if the entity secret is ever lost. Store it somewhere safe
 * (a password manager, a separate encrypted backup) and delete the
 * local copy after you've moved it.
 */

import { randomBytes } from 'node:crypto';
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets';

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  if (!apiKey) {
    console.error('✗ CIRCLE_API_KEY env var is required.');
    console.error('  Get one from https://developers.circle.com and re-run:');
    console.error('    CIRCLE_API_KEY=SAND_API_KEY:... pnpm --filter web exec tsx scripts/setup-circle.ts');
    process.exit(1);
  }

  const isNewSecret = !process.env.CIRCLE_ENTITY_SECRET;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET ?? randomBytes(32).toString('hex');

  console.log('▸ Caliber Circle setup\n');
  console.log(`  API key:        ${apiKey.slice(0, 20)}…`);
  console.log(`  Entity secret:  ${entitySecret.slice(0, 12)}… (${isNewSecret ? 'newly generated' : 'reused from env'})\n`);

  if (isNewSecret) {
    console.log('▸ Step 1/3 — registering entity secret with Circle');
    console.log('  (Downloads a recovery file to cwd. Move it to safe storage afterwards.)\n');
    try {
      await registerEntitySecretCiphertext({
        apiKey,
        entitySecret,
        recoveryFileDownloadPath: '.',
      });
      console.log('  ✓ entity secret registered\n');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const is409 = msg.includes('409') || msg.toLowerCase().includes('already');
      console.error(`  ✗ register failed: ${msg}`);
      if (is409) {
        console.error('\n    An entity secret is already registered for this API key.');
        console.error('    Three ways forward, cheapest first:');
        console.error('      a) If you have the prior entity secret hex, re-run with:');
        console.error('           CIRCLE_API_KEY=... CIRCLE_ENTITY_SECRET=<hex> \\');
        console.error('             pnpm --filter web exec tsx scripts/setup-circle.ts');
        console.error('      b) Check Circle Console → Web3 Services → Configurator.');
        console.error('         The entity secret / recovery file may be retrievable there.');
        console.error('      c) Create a fresh Circle project (gets a new API key). Cleanest.');
      }
      process.exit(1);
    }
  } else {
    console.log('▸ Step 1/3 — skipping registration (CIRCLE_ENTITY_SECRET already set)\n');
  }

  console.log('▸ Step 2/3 — initiating SDK client');
  const client = initiateDeveloperControlledWalletsClient({ apiKey, entitySecret });
  console.log('  ✓ client ready\n');

  console.log('▸ Step 3/3 — creating wallet set "caliber-demo-wallets"');
  let walletSetId: string | undefined = process.env.CIRCLE_DEMO_WALLET_SET_ID;
  if (walletSetId) {
    console.log(`  ✓ reusing existing wallet set from env · ${walletSetId}\n`);
  } else {
    try {
      const res = await client.createWalletSet({
        name: 'caliber-demo-wallets',
        // Deterministic UUID (hex-only, valid 8-4-4-4-12 layout) so
        // re-runs without CIRCLE_DEMO_WALLET_SET_ID set don't multiply
        // wallet sets. Circle validates idempotencyKey as a real UUID,
        // so the segments must contain only 0-9 / a-f.
        idempotencyKey: 'ca11be1d-0000-4000-8000-000000000001',
      });
      walletSetId = res.data?.walletSet?.id;
      if (!walletSetId) throw new Error('createWalletSet returned no id');
      console.log(`  ✓ wallet set created · ${walletSetId}\n`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`  ✗ createWalletSet failed: ${msg}`);
      if (msg.includes('400')) {
        console.error('\n    Common 400 causes:');
        console.error('      • idempotencyKey is reserved for a different wallet set name');
        console.error('        (rare — happens if the script was modified between runs)');
        console.error('      • API key lacks Programmable Wallets permission');
        console.error('      • Wallet-set name conflict in this project');
      }
      process.exit(1);
    }
  }

  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('✓ done. Paste these into your .env (then restart arc-web.service):\n');
  console.log(`CIRCLE_API_KEY=${apiKey}`);
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log(`CIRCLE_DEMO_WALLET_SET_ID=${walletSetId}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  if (isNewSecret) {
    console.log('⚠ Important security tasks:');
    console.log('  1. Move the recovery file (recoveryFile*.dat in cwd) to safe storage.');
    console.log('     It is your only fallback if the entity secret is lost.');
    console.log('  2. .gitignore already excludes circle-recovery-*.dat and recoveryFile*');
    console.log('     but verify with `git status` before committing anything.');
    console.log('  3. Never share the entity secret. Treat it like a master password.\n');
  }
}

main().catch((err) => {
  console.error('✗ setup failed:', err);
  process.exit(1);
});
