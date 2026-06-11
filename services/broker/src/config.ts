// Broker service configuration (Lepton Phase 2). All from the repo-root .env.

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
};

export const config = {
  port: num(process.env.BROKER_PORT, 3200),
  // Public Caliber surfaces the broker consumes like any external client.
  apiBase: (process.env.CALIBER_API_BASE || 'https://caliber-api.poko.blue').replace(/\/+$/, ''),
  webBase: (process.env.CALIBER_WEB_BASE || 'https://caliber.poko.blue').replace(/\/+$/, ''),

  brokerPrivateKey: process.env.BROKER_PRIVATE_KEY as `0x${string}` | undefined,
  brokerBondAddress: process.env.BROKERBOND_ADDRESS as `0x${string}` | undefined,
  agenticCommerce: (process.env.AGENTIC_COMMERCE || '0x0747EEf0706327138c69792bF28Cd525089e4583') as `0x${string}`,
  usdc: (process.env.USDC_CONTRACT || '0x3600000000000000000000000000000000000000') as `0x${string}`,
  rpcUrl: process.env.ARC_RPC_URL,
  chainId: num(process.env.ARC_CHAIN_ID, 5042002),

  // Fee + risk (D4). Fee = max(feeMin, feeBps of job value).
  feeBps: num(process.env.BROKER_FEE_BPS, 25),
  feeMinUsdc: num(process.env.BROKER_FEE_MIN_USDC, 0.01),
  marginUsdc: num(process.env.BROKER_MARGIN_USDC, 0.0),

  // How many shortlisted candidates to buy attestations for (cap, per plan).
  maxCandidates: num(process.env.BROKER_MAX_CANDIDATES, 5),
  keeperIntervalMs: num(process.env.BROKER_KEEPER_INTERVAL_MS, 60_000),
};

export function requireBrokerKey(): `0x${string}` {
  if (!config.brokerPrivateKey) throw new Error('BROKER_PRIVATE_KEY not set');
  const k = config.brokerPrivateKey;
  return (k.startsWith('0x') ? k : `0x${k}`) as `0x${string}`;
}
