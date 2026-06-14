// Tiny NOTIFY listener to verify the steward_events payload contract.
// Run: tsx --env-file=../../.env scripts/listen.ts
import { sql } from '@arc-agents/db';

(async () => {
  await sql.listen('steward_events', (payload) => {
    console.log('NOTIFY', payload);
  });
  console.log('listening on steward_events…');
})();
