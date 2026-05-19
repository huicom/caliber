import { z } from 'zod';

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  ARC_RPC_URL: z.string().url(),
  ARC_RPC_WS: z.string().url(),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),
  IDENTITY_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  REPUTATION_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  VALIDATION_REGISTRY: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  AGENTIC_COMMERCE: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  USDC_CONTRACT: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  DEPLOYMENT_BLOCK: z.coerce.bigint().default(0n),
});

export const config = envSchema.parse(process.env);

export const BATCH_SIZE = 5000n;
export const IPFS_CONCURRENCY = 5;
export const IPFS_TIMEOUT_MS = 5000;
export const IPFS_GATEWAY = 'https://ipfs.io/ipfs/';
