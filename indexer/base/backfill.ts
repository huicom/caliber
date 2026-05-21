#!/usr/bin/env -S tsx
import 'dotenv/config';
import { createPublicClient, http } from 'viem';
import { BASE_CONFIG } from '../../indexer/shared/chain-config';
import { createParseLog } from '../../indexer/arc/lib/parsers';
import { applyEvents } from '../../indexer/arc/lib/handlers';
import { runBackfill, type BackfillResult } from '../../indexer/shared/backfill-core';

const CU_PER_CALL = 75;
const CU_BUDGET_SAFETY = 25_000_000;

function parseArgs(args: string[]) {
  const flags: Record<string, string> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) {
        flags[arg.slice(2, eq)] = arg.slice(eq + 1);
      } else if (i + 1 < args.length && !args[i + 1].startsWith('--')) {
        flags[arg.slice(2)] = args[++i];
      } else {
        flags[arg.slice(2)] = 'true';
      }
    }
  }
  return flags;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const windowDays = Number(args['window-days'] ?? '3');
  const fromBlockOverride = args['from-block'] ? BigInt(args['from-block']) : null;
  const toBlockRaw = args['to-block'] ?? 'latest';
  const reset = args['reset'] === 'true';
  const batchSize = BigInt(args['batch-size'] ?? '10');
  const force = args['force'] === 'true';

  if (!BASE_CONFIG.rpcUrl) {
    console.error('❌ BASE_RPC_URL is not set in .env');
    process.exit(1);
  }

  const client = createPublicClient({
    transport: http(BASE_CONFIG.rpcUrl),
  });

  const head = await client.getBlockNumber();
  let fromBlock: bigint;
  let toBlock: bigint;

  if (fromBlockOverride) {
    fromBlock = fromBlockOverride;
  } else {
    const WINDOW_SEC = BigInt(windowDays) * 86400n;
    fromBlock = head - WINDOW_SEC / 2n;
    if (fromBlock < 0n) fromBlock = 0n;
  }

  if (toBlockRaw === 'latest') {
    toBlock = head;
  } else {
    toBlock = BigInt(toBlockRaw);
  }

  const blocksToScan = toBlock - fromBlock;
  const estimatedCalls = blocksToScan / batchSize;
  const estimatedCU = estimatedCalls * BigInt(CU_PER_CALL);

  console.log(`
═══════════════════════════════════════
  Base Backfill — Startup
═══════════════════════════════════════
  Chain:        ${BASE_CONFIG.name}
  RPC:          ${BASE_CONFIG.rpcUrl}
  From block:   ${fromBlock}
  To block:     ${toBlock}
  Blocks:       ${blocksToScan}
  Batch size:   ${batchSize}
  Window days:  ${windowDays}
  Reset:        ${reset}
───────────────────────────────────────
  Est. CU cost: ${estimatedCU.toLocaleString()} CU
  Est. calls:   ${estimatedCalls.toLocaleString()}
  Budget limit: ${CU_BUDGET_SAFETY.toLocaleString()} CU
═══════════════════════════════════════
`);

  if (estimatedCU > CU_BUDGET_SAFETY && !force) {
    console.error(
      `❌ Estimated CU (${estimatedCU}) exceeds safety budget (${CU_BUDGET_SAFETY}). ` +
      'Use --window-days to reduce range or --force to override.',
    );
    process.exit(1);
  }

  const parseLog = createParseLog({
    identity: BASE_CONFIG.contracts.identityRegistry,
    reputation: BASE_CONFIG.contracts.reputationRegistry,
    validation: BASE_CONFIG.contracts.validationRegistry,
    agenticCommerce: BASE_CONFIG.contracts.agenticCommerce,
  });

  const startWall = process.hrtime.bigint();

  const result = await runBackfill({
    chain: BASE_CONFIG,
    client,
    fromBlock,
    toBlock,
    batchSize,
    reset,
    parseLog,
    applyEvents,
    onProgress: (p) => {
      const elapsedSec = Number(process.hrtime.bigint() - startWall) / 1e9;
      console.log(
        `  📦 ${p.blocksDone}/${p.blocksTotal} blocks | ${p.rowsInsertedSoFar.agents}a ${p.rowsInsertedSoFar.feedback}f ${p.rowsInsertedSoFar.validations}v ${p.rowsInsertedSoFar.jobs}j ${p.rowsInsertedSoFar.jobEvents}je | ${elapsedSec.toFixed(1)}s | ~${p.cuUsedEstimate}cu`,
      );
    },
  });

  console.log('\n═══════════════════════════════════════');
  console.log('  Backfill Complete');
  console.log('═══════════════════════════════════════');
  console.log(JSON.stringify({
    lastBlock: result.lastBlock.toString(),
    totals: result.totals,
    cuUsedEstimate: result.cuUsedEstimate,
    durationMs: result.durationMs,
  }, null, 2));
}

main().catch((err) => {
  console.error('❌ Backfill failed:', err.message);
  process.exit(1);
});
