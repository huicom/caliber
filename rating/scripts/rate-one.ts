import 'dotenv/config';
import { rateAgent } from '../engine/rating';
import type { RatingView } from '../engine/types';

// BigInt serialization support (mirrors web/src/lib/db.ts)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function main() {
  const chain = process.argv[2];
  const agentIdStr = process.argv[3];

  if (!chain || !agentIdStr) {
    console.error('Usage: pnpm --filter @arc-agents/rating tsx scripts/rate-one.ts <chain> <agent_id> [--ttc]');
    process.exit(1);
  }

  const agentId = BigInt(agentIdStr);
  const view: RatingView = process.argv.includes('--ttc') ? 'TTC' : 'PIT';

  console.error(`Rating agent ${agentIdStr} on chain ${chain} (${view})...\n`);

  try {
    const result = await rateAgent(agentId, chain, view);
    console.log(JSON.stringify(result, null, 2));
  } catch (err) {
    console.error('Fatal error:', err);
    process.exit(1);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal error:', err);
    process.exit(1);
  });
