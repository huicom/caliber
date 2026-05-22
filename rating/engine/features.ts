import { db, sql as rawSql, agents, feedbackEvents, validations, jobs } from '@arc-agents/db';
import { eq, and, desc } from 'drizzle-orm';
import type { AgentFeatures } from './types';

// Approximate block time per chain, used to derive registered_at from
// registered_at_block when the timestamp column isn't populated by the indexer.
const BLOCK_TIME_SECONDS: Record<string, number> = {
  arc: 1,
  base: 2,
};

export async function buildFeatures(
  agentId: bigint,
  chainId: string,
  lookbackDays: number,
): Promise<AgentFeatures | null> {
  const [agent] = await db
    .select()
    .from(agents)
    .where(and(eq(agents.agentId, agentId), eq(agents.chainId, chainId)))
    .limit(1);
  if (!agent) return null;

  const lookbackCutoff = new Date(Date.now() - lookbackDays * 86400_000);
  const lookbackCutoffStr = lookbackCutoff.toISOString();

  const [feedbackRows, jobRows, validationRows] = await Promise.all([
    lookbackDays === 0
      ? db
          .select({
            score: feedbackEvents.score,
            tag: feedbackEvents.tag,
            blockNumber: feedbackEvents.blockNumber,
            createdAt: feedbackEvents.createdAt,
          })
          .from(feedbackEvents)
          .where(
            and(
              eq(feedbackEvents.agentId, agentId),
              eq(feedbackEvents.chainId, chainId),
            ),
          )
          .orderBy(feedbackEvents.blockNumber)
      : db
          .select({
            score: feedbackEvents.score,
            tag: feedbackEvents.tag,
            blockNumber: feedbackEvents.blockNumber,
            createdAt: feedbackEvents.createdAt,
          })
          .from(feedbackEvents)
          .where(
            and(
              eq(feedbackEvents.agentId, agentId),
              eq(feedbackEvents.chainId, chainId),
            ),
          )
          .orderBy(feedbackEvents.blockNumber),

    db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.chainId, chainId),
          eq(jobs.providerAddress, agent.ownerAddress),
        ),
      )
      .orderBy(desc(jobs.createdAtBlock)),

    db
      .select({
        status: validations.status,
        validatorAddress: validations.validatorAddress,
        responseCode: validations.responseCode,
      })
      .from(validations)
      .where(
        and(eq(validations.agentId, agentId), eq(validations.chainId, chainId)),
      ),
  ]);

  // Filter feedback and jobs to lookback window (if not full history)
  const feedbackInWindow = lookbackDays === 0
    ? feedbackRows
    : feedbackRows.filter((f) => f.createdAt && new Date(f.createdAt) >= lookbackCutoff);

  const jobRowsInWindow = lookbackDays === 0
    ? jobRows
    : jobRows.filter((j) => j.createdAt && new Date(j.createdAt) >= lookbackCutoff);

  // Use raw postgres-js for complex queries
  const validatorCounts = await rawSql.unsafe(
    `SELECT validator_address, COUNT(*)::text AS n
     FROM (
       SELECT validator_address FROM feedback_events
       WHERE agent_id = $1 AND chain_id = $2
       UNION ALL
       SELECT validator_address FROM validations
       WHERE agent_id = $1 AND chain_id = $2
     ) u
     GROUP BY validator_address`,
    [agentId.toString(), chainId],
  ) as Array<{ validator_address: string; n: string }>;

  const crossChainRows = await rawSql.unsafe(
    `SELECT DISTINCT chain_id FROM agents
     WHERE LOWER(owner_address) = LOWER($1)`,
    [agent.ownerAddress],
  ) as Array<{ chain_id: string }>;

  const feedbackScores = feedbackInWindow.map((r) => ({
    score: Number(r.score),
    tag: r.tag ?? '',
    blockNumber: r.blockNumber,
    createdAt: r.createdAt,
  }));

  const jobMapped = jobRowsInWindow.map((j) => ({
    jobId: j.jobId,
    status: j.status,
    // v2.0: clientAddress is needed for counterparty-concentration flag.
    // For gated jobs the on-chain client is the RatingGateway contract; the
    // actual human poster lives off-chain in job_drafts. The flag treats
    // the on-chain client as the unit, which is correct for "who paid the
    // escrow that this agent is exposed to."
    clientAddress: j.clientAddress,
    budgetUsdc: j.budgetUsdc,
    completionReason: j.completionReason,
    createdAtBlock: j.createdAtBlock,
    completedAtBlock: j.completedAtBlock,
    createdAt: j.createdAt,
    updatedAt: j.updatedAt,
  }));

  const validationMapped = validationRows.map((v) => ({
    status: v.status,
    validatorAddress: v.validatorAddress,
    responseCode: v.responseCode,
  }));

  const validatorEntries = (Array.isArray(validatorCounts) ? validatorCounts : []).map(
    (r: { validator_address: string; n: string }) => ({
      validatorAddress: r.validator_address,
      count: Number(r.n),
    }),
  );

  const crossChainChains = (Array.isArray(crossChainRows) ? crossChainRows : []).map(
    (r: { chain_id: string }) => r.chain_id,
  );

  // The indexer doesn't populate agents.registered_at (only registered_at_block).
  // Derive registeredAt from the on-chain block number using a per-chain block-time
  // constant. The on-chain block is authoritative even when we don't have the
  // intervening events (pruned node, partial backfill window).
  // TODO: Indexer should populate registered_at directly from block timestamp.
  let registeredAt: Date | null = agent.registeredAt;
  if (!registeredAt && agent.registeredAtBlock > 0n) {
    const blockTimeSec = BLOCK_TIME_SECONDS[chainId] ?? 1;
    const maxBlockResult = (await rawSql.unsafe(
      `SELECT MAX(registered_at_block)::text AS max_block FROM agents WHERE chain_id = $1`,
      [chainId],
    )) as Array<{ max_block: string | null }>;
    const refBlock = maxBlockResult[0]?.max_block
      ? BigInt(maxBlockResult[0].max_block)
      : agent.registeredAtBlock;
    const blocksAgo = refBlock - agent.registeredAtBlock;
    const secondsAgo = Number(blocksAgo) * blockTimeSec;
    registeredAt = new Date(Date.now() - secondsAgo * 1000);
  }

  return {
    agentId,
    chainId,
    ownerAddress: agent.ownerAddress,
    name: agent.name,
    agentType: agent.agentType,
    capabilities: agent.capabilities,
    metadata: agent.metadata as Record<string, unknown> | null,
    registeredAt,
    feedbackCount: feedbackInWindow.length,

    feedbackEvents: feedbackScores,
    jobs: jobMapped,
    validations: validationMapped,
    validators: validatorEntries,
    crossChainChains,
  };
}
