import { createPublicClient, type PublicClient, webSocket } from 'viem';
import { arcTestnet } from './viem';
import { config } from './config';

export function createWsClient(): PublicClient {
  return createPublicClient({
    chain: arcTestnet,
    transport: webSocket(config.ARC_RPC_WS, {
      retryCount: 0,
      reconnect: {
        attempts: 1000,
        delay: 1000,
      },
      keepAlive: { interval: 30_000 },
    }),
  });
}
