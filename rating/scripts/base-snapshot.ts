import 'dotenv/config';
import { createPublicClient, http, defineChain, parseAbi } from 'viem';

const BASE_RPC_URL = process.env.BASE_RPC_URL;
if (!BASE_RPC_URL) {
  console.error('BASE_RPC_URL is not set in .env');
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

const IDENTITY_REGISTRY = '0x8004A169FB4a3325136EB29fA0ceB6D2e539a432' as const;
const REPUTATION_REGISTRY = '0x8004BAa17C55a88189AE136b182e5fdA19dE9b63' as const;

const erc721Abi = parseAbi([
  'function totalSupply() view returns (uint256)',
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
]);

async function safeCall<T>(label: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    console.log(`  ${label}: <call reverted or unsupported — ${(err as Error).message.split('\n')[0]}>`);
    return null;
  }
}

async function main() {
  const head = await client.getBlockNumber();
  console.log(`\nBase mainnet snapshot (taken at block ${head})\n`);

  console.log('IdentityRegistry @ 0x8004A169...');
  const totalSupply = await safeCall('totalSupply', () =>
    client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'totalSupply' }),
  );
  const name = await safeCall('name', () =>
    client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'name' }),
  );
  const symbol = await safeCall('symbol', () =>
    client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'symbol' }),
  );

  console.log(`  name:        ${name ?? 'n/a'}`);
  console.log(`  symbol:      ${symbol ?? 'n/a'}`);
  console.log(`  totalSupply: ${totalSupply ?? 'n/a'}`);

  if (totalSupply && typeof totalSupply === 'bigint' && totalSupply > 0n) {
    const latestId = totalSupply - 1n;
    const owner = await safeCall('ownerOf(latest)', () =>
      client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'ownerOf', args: [latestId] }),
    );
    const uri = await safeCall('tokenURI(latest)', () =>
      client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'tokenURI', args: [latestId] }),
    );
    console.log(`\n  latest agent (id ${latestId}):`);
    console.log(`    owner:    ${owner ?? 'n/a'}`);
    console.log(`    tokenURI: ${uri ?? 'n/a'}`);

    const sampleIds = [0n, totalSupply / 4n, totalSupply / 2n, (3n * totalSupply) / 4n].filter(
      (id) => id < totalSupply,
    );
    console.log(`\n  spot check ownerOf:`);
    for (const id of sampleIds) {
      const o = await safeCall(`ownerOf(${id})`, () =>
        client.readContract({ address: IDENTITY_REGISTRY, abi: erc721Abi, functionName: 'ownerOf', args: [id] }),
      );
      console.log(`    id ${id}: ${o ?? 'n/a'}`);
    }
  }

  console.log('\nReputationRegistry @ 0x8004BAa1...');
  const codeRep = await client.getCode({ address: REPUTATION_REGISTRY });
  console.log(`  bytecode present: ${codeRep && codeRep !== '0x' ? 'yes' : 'no'}`);

  console.log('\nContract age probe (binary search for IdentityRegistry deployment):');
  let lo = 0n;
  let hi = head;
  let deploymentBlock: bigint | null = null;
  for (let i = 0; i < 32 && lo < hi; i++) {
    const mid = (lo + hi) / 2n;
    const code = await safeCall(`getCode@${mid}`, () =>
      client.getCode({ address: IDENTITY_REGISTRY, blockNumber: mid }),
    );
    if (code === null) break;
    if (code && code !== '0x') {
      hi = mid;
      deploymentBlock = mid;
    } else {
      lo = mid + 1n;
    }
  }
  if (deploymentBlock !== null) {
    const block = await safeCall('getBlock@deployment', () =>
      client.getBlock({ blockNumber: deploymentBlock! }),
    );
    const ts = block && typeof block === 'object' && 'timestamp' in block ? block.timestamp : null;
    const ageBlocks = head - deploymentBlock;
    const ageDays = Number(ageBlocks) * 2 / 86400;
    console.log(`  deployment block: ~${deploymentBlock}`);
    console.log(`  contract age:     ~${ageBlocks} blocks (~${ageDays.toFixed(1)} days at 2s/block)`);
    if (ts) {
      console.log(`  deployment time:  ${new Date(Number(ts) * 1000).toISOString()}`);
    }
  }

  console.log('\nSummary:');
  console.log(`  Base head:    ${head}`);
  console.log(`  Agents minted: ${totalSupply ?? 'unknown'}`);
  console.log(`  Backfill cost estimate at Alchemy 10-block batches:`);
  if (deploymentBlock !== null) {
    const ageBlocks = head - deploymentBlock;
    const calls = ageBlocks / 10n;
    console.log(`    full history: ${ageBlocks} blocks / 10 = ${calls} eth_getLogs calls`);
    const calls30d = 1296000n / 10n;
    console.log(`    last 30 days: ~1,296,000 blocks / 10 = ${calls30d} calls`);
    const calls3d = 129600n / 10n;
    console.log(`    last 3 days:  ~129,600 blocks / 10 = ${calls3d} calls (fits free tier)`);
  }
}

main().catch((err) => {
  console.error('snapshot failed:', (err as Error).message);
  process.exit(1);
});
