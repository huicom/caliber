// Red-team fixture entry point. Boots the Express app and logs the admin token
// when it was randomly generated (REDTEAM_ADMIN_TOKEN unset).

import { createApp } from './server.js';

const { app, config } = createApp();

app.listen(config.port, () => {
  console.log(`[redteam] malicious x402 seller fixture listening on :${config.port}`);
  console.log(`[redteam]   seller   = ${config.sellerAddress}`);
  console.log(`[redteam]   attacker = ${config.attackerAddress}`);
  console.log(`[redteam]   facilitator = ${config.facilitatorUrl}`);
  console.log('[redteam]   mode = honest (default)');
  if (config.adminTokenGenerated) {
    console.log(
      `[redteam]   admin token (generated, REDTEAM_ADMIN_TOKEN was unset): ${config.adminToken}`,
    );
    console.log('[redteam]   use header  x-redteam-admin: <token>  for /admin/*');
  } else {
    console.log('[redteam]   admin token loaded from REDTEAM_ADMIN_TOKEN');
  }
});
