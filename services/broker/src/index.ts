// Broker service entry (Lepton Phase 2). Starts the HTTP API and runs the
// keeper on a loop to auto-settle bonded matches (release on completion, slash
// on rejection/expiry).

import { startServer } from './server.js';
import { settleActiveBonds } from './keeper.js';
import { config } from './config.js';

startServer();

if (config.brokerBondAddress) {
  console.log(`[broker] keeper loop every ${Math.round(config.keeperIntervalMs / 1000)}s · BrokerBond ${config.brokerBondAddress}`);
  const tick = () => settleActiveBonds().catch((e) => console.error('[broker] keeper error:', e instanceof Error ? e.message : e));
  setInterval(tick, config.keeperIntervalMs);
} else {
  console.log('[broker] BROKERBOND_ADDRESS not set — keeper disabled until the contract is deployed');
}
