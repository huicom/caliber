import {
  pgTable,
  bigint,
  bigserial,
  text,
  jsonb,
  numeric,
  integer,
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
