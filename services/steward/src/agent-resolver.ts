// Resolve a seller payTo address → its Caliber agentId, so a breach can be
// attributed to the right rated agent. The mapping is agents.owner_address →
// agents.agent_id (the same join the rating engine uses in features.ts). When a
// seller address has multiple agents, the lowest agent_id wins (deterministic).
//
// Returns null when the address has no registered agent — evidence issuance then
// skips on-chain attestation for that payment (you can't attest against a
// non-existent agentId). The flagship demo seeds an agent for the redteam seller
// so this resolves (see scripts/flagship-demo.ts).

import { sql } from '@arc-agents/db';

export async function resolveAgentId(payTo: string, chainId = 'arc'): Promise<bigint | null> {
  const rows = await sql<{ agent_id: string }[]>`
    select agent_id::text as agent_id
    from agents
    where chain_id = ${chainId} and lower(owner_address) = lower(${payTo})
    order by agent_id asc
    limit 1
  `;
  return rows.length ? BigInt(rows[0].agent_id) : null;
}
