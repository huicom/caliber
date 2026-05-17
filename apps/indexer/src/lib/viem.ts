import { createPublicClient, http, defineChain } from 'viem';
import { config } from './config';

export const arcTestnet = defineChain({
  id: config.ARC_CHAIN_ID,
  name: 'Arc Testnet',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 6 },
  rpcUrls: {
    default: { http: [config.ARC_RPC_URL], webSocket: [config.ARC_RPC_WS] },
  },
});

export const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: http(config.ARC_RPC_URL, { batch: true }),
});
