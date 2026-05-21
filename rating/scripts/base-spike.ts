import 'dotenv/config';
import { createPublicClient, http, defineChain, keccak256, toHex } from 'viem';

const BASE_RPC_URL = process.env.BASE_RPC_URL;
if (!BASE_RPC_URL) {
  console.error('❌ BASE_RPC_URL is not set in .env');
  process.exit(1);
}

const baseMainnet = defineChain({
  id: 8453,
  name: 'Base',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [BASE_RPC_URL] } },
});

const client = createPublicClient({
  chain: baseMainnet,
  transport: http(BASE_RPC_URL),
});

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432';
const TRANSFER_TOPIC = keccak256(
  toHex('Transfer(address,address,uint256)'),
);

async function main() {
  const start = Date.now();

  console.log(`🔌 Connecting to Base (${BASE_RPC_URL})...`);
  const head = await client.getBlockNumber();
  console.log(`📦 Latest block: ${head}`);

  const SCAN_BLOCKS = 1000n; // Alchemy free tier = 10-block batches, keep this small
  const fromBlock = head - SCAN_BLOCKS > 0n ? head - SCAN_BLOCKS : 0n;
  console.log(`🔍 Scanning blocks ${fromBlock} → ${head} for Transfer events...`);

  let allLogs: Array<{ blockNumber: bigint; topics: string[] }> = [];
  const BATCH = 10n;
  let cursor = fromBlock;

  while (cursor < head) {
    const to = cursor + BATCH - 1n > head ? head : cursor + BATCH - 1n;
    try {
      const logs = await client.getLogs({
        address: IDENTITY_REGISTRY,
        event: {
          type: 'event',
          name: 'Transfer',
          inputs: [
            { name: 'from', type: 'address', indexed: true },
            { name: 'to', type: 'address', indexed: true },
            { name: 'tokenId', type: 'uint256', indexed: true },
          ],
        },
        fromBlock: cursor,
        toBlock: to,
      });

      allLogs.push(
        ...logs.map((l) => ({
          blockNumber: l.blockNumber,
          topics: l.topics as string[],
        })),
      );
    } catch (err) {
      console.warn(`   ⚠️  Batch ${cursor}-${to} failed, retrying...`);
      await new Promise((r) => setTimeout(r, 200));
    }
    cursor = to + 1n;
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(1);
  console.log(`✅ Transfer events found: ${allLogs.length}`);
  console.log(`⏱️  Time elapsed: ${elapsed}s`);

  if (allLogs.length > 0) {
    console.log('   Sample events:');
    for (const log of allLogs.slice(0, 5)) {
      console.log(
        `   - Block ${log.blockNumber} | tokenId=${log.topics[3] ?? 'N/A'} | from=${log.topics[1] ?? 'N/A'}`,
      );
    }
    console.log(`   ... and ${allLogs.length - 5} more`);
  } else {
    console.log('   No Transfer events found in the scanned range.');
  }
}

main().catch((err) => {
  console.error('❌ Spike failed:', (err as Error).message);
  process.exit(1);
});
