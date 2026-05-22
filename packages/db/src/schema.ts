import {
  pgTable,
  bigint,
  bigserial,
  text,
  jsonb,
  numeric,
  integer,
  smallint,
  timestamp,
  index,
} from 'drizzle-orm/pg-core';

export interface AgentMetadata {
  name?: string;
  description?: string;
  image?: string;
  agent_type?: string;
  capabilities?: string[];
  version?: string;
  creator?: string;
  location?: string;
  [key: string]: unknown;
}

export const agents = pgTable(
  'agents',
  {
    agentId: bigint('agent_id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    ownerAddress: text('owner_address').notNull(),
    metadataUri: text('metadata_uri'),
    metadata: jsonb('metadata').$type<AgentMetadata | null>(),
    name: text('name'),
    agentType: text('agent_type'),
    capabilities: jsonb('capabilities').$type<string[] | null>(),
    // F2 (Phase 2): coarse-grained category assigned by the rule-based
    // classifier in web/scripts/classify-corpus.ts. One of:
    //   trading | validation | assistants | payments | research | content
    //   utility | services | identity | other
    // Nullable — only agents with enough metadata to classify are tagged.
    category: text('category'),
    reputationScore: numeric('reputation_score', { precision: 10, scale: 2 }),
    feedbackCount: integer('feedback_count').default(0).notNull(),
    validationStatus: text('validation_status'),
    jobsCompleted: integer('jobs_completed').default(0).notNull(),
    usdcEarned: numeric('usdc_earned', { precision: 30, scale: 6 }).default('0').notNull(),
    registeredAtBlock: bigint('registered_at_block', { mode: 'bigint' }).notNull(),
    registeredTxHash: text('registered_tx_hash').notNull(),
    registeredAt: timestamp('registered_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    ownerIdx: index('idx_agents_owner').on(table.ownerAddress),
    reputationIdx: index('idx_agents_reputation').on(table.reputationScore),
    earnedIdx: index('idx_agents_earned').on(table.usdcEarned),
    blockIdx: index('idx_agents_block').on(table.registeredAtBlock),
    nameIdx: index('idx_agents_name').on(table.name),
    capabilitiesGin: index('idx_agents_capabilities_gin').using('gin', table.capabilities),
    metadataGin: index('idx_agents_metadata_gin').using('gin', table.metadata),
    categoryIdx: index('idx_agents_category').on(table.category),
  }),
);

export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;

export const feedbackEvents = pgTable(
  'feedback_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    agentId: bigint('agent_id', { mode: 'bigint' })
      .notNull()
      .references(() => agents.agentId, { onDelete: 'cascade' }),
    validatorAddress: text('validator_address').notNull(),
    score: numeric('score', { precision: 10, scale: 2 }).notNull(),
    scoreType: integer('score_type'),
    tag: text('tag'),
    feedbackHash: text('feedback_hash'),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    txHash: text('tx_hash').notNull().unique(),
    logIndex: integer('log_index').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentIdIdx: index('idx_feedback_agent').on(table.agentId),
    blockIdx: index('idx_feedback_block').on(table.blockNumber),
    validatorIdx: index('idx_feedback_validator').on(table.validatorAddress),
  }),
);

export type FeedbackEvent = typeof feedbackEvents.$inferSelect;

export const validations = pgTable(
  'validations',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    agentId: bigint('agent_id', { mode: 'bigint' })
      .notNull()
      .references(() => agents.agentId, { onDelete: 'cascade' }),
    validatorAddress: text('validator_address').notNull(),
    requestHash: text('request_hash').notNull().unique(),
    requestUri: text('request_uri'),
    tag: text('tag'),
    status: text('status').notNull(),
    responseCode: integer('response_code'),
    responseUri: text('response_uri'),
    responseHash: text('response_hash'),
    requestedAtBlock: bigint('requested_at_block', { mode: 'bigint' }).notNull(),
    respondedAtBlock: bigint('responded_at_block', { mode: 'bigint' }),
    requestTxHash: text('request_tx_hash').notNull(),
    responseTxHash: text('response_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentIdx: index('idx_validations_agent').on(table.agentId),
    statusIdx: index('idx_validations_status').on(table.status),
    validatorIdx: index('idx_validations_validator').on(table.validatorAddress),
  }),
);

export type Validation = typeof validations.$inferSelect;

export const jobs = pgTable(
  'jobs',
  {
    jobId: bigint('job_id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    clientAddress: text('client_address').notNull(),
    providerAddress: text('provider_address').notNull(),
    evaluatorAddress: text('evaluator_address'),
    budgetUsdc: numeric('budget_usdc', { precision: 30, scale: 6 }),
    budgetRaw: text('budget_raw'),
    description: text('description'),
    status: text('status').notNull(),
    deliverableHash: text('deliverable_hash'),
    completionReason: text('completion_reason'),
    expiredAt: timestamp('expired_at', { withTimezone: true }),
    createdAtBlock: bigint('created_at_block', { mode: 'bigint' }).notNull(),
    createdTxHash: text('created_tx_hash').notNull(),
    completedAtBlock: bigint('completed_at_block', { mode: 'bigint' }),
    completedTxHash: text('completed_tx_hash'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    providerIdx: index('idx_jobs_provider').on(table.providerAddress),
    clientIdx: index('idx_jobs_client').on(table.clientAddress),
    statusIdx: index('idx_jobs_status').on(table.status),
    blockIdx: index('idx_jobs_block').on(table.createdAtBlock),
    budgetIdx: index('idx_jobs_budget').on(table.budgetUsdc),
  }),
);

export type Job = typeof jobs.$inferSelect;

export const jobEvents = pgTable(
  'job_events',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    jobId: bigint('job_id', { mode: 'bigint' })
      .notNull()
      .references(() => jobs.jobId, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    actorAddress: text('actor_address').notNull(),
    blockNumber: bigint('block_number', { mode: 'bigint' }).notNull(),
    txHash: text('tx_hash').notNull().unique(),
    logIndex: integer('log_index').notNull(),
    data: jsonb('data'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    jobIdx: index('idx_job_events_job').on(table.jobId),
    blockIdx: index('idx_job_events_block').on(table.blockNumber),
    typeIdx: index('idx_job_events_type').on(table.eventType),
  }),
);

export type JobEvent = typeof jobEvents.$inferSelect;

export const indexerState = pgTable('indexer_state', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

export const jobDrafts = pgTable(
  'job_drafts',
  {
    draftId: text('draft_id')
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    draftHash: text('draft_hash').notNull(),
    chainId: text('chain_id').notNull().default('arc'),
    poster: text('poster').notNull(),
    targetAgentId: text('target_agent_id').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull(),
    budgetUsdc: text('budget_usdc').notNull(),
    minTier: smallint('min_tier').notNull(),
    minConfidence: smallint('min_confidence').notNull(),
    deadline: timestamp('deadline', { withTimezone: true }).notNull(),
    onchainJobId: text('onchain_job_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    posterIdx: index('idx_job_drafts_poster').on(table.poster),
    draftHashIdx: index('idx_job_drafts_hash').on(table.draftHash),
  }),
);

export type JobDraft = typeof jobDrafts.$inferSelect;
export type NewJobDraft = typeof jobDrafts.$inferInsert;

// Wave 3 — Rating Trajectory.
// Daily snapshot per (agent, chain, view) so the trajectory chart on the agent
// detail page can render a tier-over-time line, the stats page can show the
// registry's tier-mix evolution, and W4 (validator calibration) + W5
// (downgrade alerts) have a history to diff against.
//
// The cron job (rating/scripts/snapshot-daily.ts) inserts one PIT row per
// rateable agent per day. TTC rows are produced only when ≥180 days of
// history exist (per methodology §3.3); on a young testnet that won't fire
// for months, but the schema and view enum are ready for it.
export const ratingSnapshots = pgTable(
  'rating_snapshots',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    agentId: bigint('agent_id', { mode: 'bigint' }).notNull(),
    computedAt: timestamp('computed_at', { withTimezone: true }).notNull(),
    tier: text('tier').notNull(),
    ppd30d: numeric('ppd_30d', { precision: 8, scale: 6 }),
    lgd: numeric('lgd', { precision: 8, scale: 6 }),
    eadUsdc: text('ead_usdc'),
    confidence: text('confidence').notNull(),
    // Bitmask of risk flags as of this snapshot. Bits (matches engine FLAG_BIT):
    //   0x01 CounterpartyConcentration · 0x02 ValidatorConcentration
    //   0x04 SybilPattern · 0x08 VolumeAnomaly · 0x10 Dormancy
    // Nullable for backwards compat with snapshots taken before flag tracking.
    flags: smallint('flags'),
    view: text('view').notNull(),
    methodologyVersion: text('methodology_version').notNull(),
    interactionCount: integer('interaction_count'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    agentDayIdx: index('idx_snapshots_agent_day').on(table.agentId, table.computedAt),
    computedAtIdx: index('idx_snapshots_computed_at').on(table.computedAt),
    chainAgentIdx: index('idx_snapshots_chain_agent').on(table.chainId, table.agentId),
  }),
);

export type RatingSnapshot = typeof ratingSnapshots.$inferSelect;
export type NewRatingSnapshot = typeof ratingSnapshots.$inferInsert;

// Track 3 (Phase 2 voyage): tier-transition feed. One row per snapshot-to-
// snapshot transition that is "interesting" — first rating issued, tier
// moved up or down, flags added/removed, agent crossed into Watch or
// Inactive. Populated by snapshot-daily.ts after the day's snapshot insert.
//
// Kept narrow & append-only so the Watchlist UI + RSS feed + JSON endpoint
// can each read one table with no joins. methodology_version is included so
// transitions are interpretable even across version bumps.
export const tierTransitions = pgTable(
  'tier_transitions',
  {
    id: bigserial('id', { mode: 'bigint' }).primaryKey(),
    chainId: text('chain_id').notNull().default('arc'),
    agentId: bigint('agent_id', { mode: 'bigint' }).notNull(),
    at: timestamp('at', { withTimezone: true }).notNull(),
    // Discrete change kind. Multiple transitions per day are allowed (e.g.
    // tier_down + flag_added on the same snapshot diff). Values:
    //   first_rating · tier_up · tier_down · flag_added · flag_removed
    //   enter_watch · enter_inactive · exit_watch · exit_inactive
    kind: text('kind').notNull(),
    fromTier: text('from_tier'),
    toTier: text('to_tier').notNull(),
    fromFlags: smallint('from_flags'),
    toFlags: smallint('to_flags').notNull(),
    fromScore: smallint('from_score'),
    toScore: smallint('to_score'),
    methodologyVersion: text('methodology_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    atIdx: index('idx_transitions_at').on(table.at),
    agentIdx: index('idx_transitions_agent').on(table.agentId, table.at),
    kindIdx: index('idx_transitions_kind').on(table.kind, table.at),
  }),
);

export type TierTransition = typeof tierTransitions.$inferSelect;
export type NewTierTransition = typeof tierTransitions.$inferInsert;
