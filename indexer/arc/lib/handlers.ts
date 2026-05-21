import {
  db,
  agents,
  feedbackEvents,
  validations,
  jobs,
  jobEvents,
  jobDrafts,
} from '@arc-agents/db';
import { and, eq, isNull, sql as drizzleSql } from 'drizzle-orm';
import type { ParsedEvent } from './parsers';
import { publicClient } from './viem';
import { config } from './config';

// Posters submitting through RatingGateway embed a marker in the on-chain
// description so the indexer can re-join the off-chain draft (title +
// full markdown description) to the newly created job. Marker format:
//   <title>\n\narcagents:draft:0x<keccak256-hex>
const DRAFT_MARKER_RE = /arcagents:draft:(0x[0-9a-fA-F]{64})/;
function extractDraftHash(description: string): string | null {
  const m = description.match(DRAFT_MARKER_RE);
  return m ? m[1].toLowerCase() : null;
}

// The JobCreated event does NOT carry the description string — it's only
// available via the AgenticCommerce.getJob() read. We fetch it lazily here.
// One read per JobCreated event is cheap (Arc throughput) and only happens
// at job creation, not on every block.
// getJob returns a single Job struct (tuple), not 9 flat fields. The viem
// ABI must wrap the outputs in a tuple, otherwise decoding picks the wrong
// offset and big uint256 values blow up trying to coerce to Number.
const GET_JOB_ABI = [
  {
    type: 'function',
    name: 'getJob',
    stateMutability: 'view',
    inputs: [{ name: 'jobId', type: 'uint256' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'client', type: 'address' },
          { name: 'provider', type: 'address' },
          { name: 'evaluator', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'budget', type: 'uint256' },
          { name: 'expiredAt', type: 'uint256' },
          { name: 'status', type: 'uint8' },
          { name: 'hook', type: 'address' },
        ],
      },
    ],
  },
] as const;

interface OnchainJob {
  id: bigint;
  client: string;
  provider: string;
  evaluator: string;
  description: string;
  budget: bigint;
  expiredAt: bigint;
  status: number;
  hook: string;
}

async function fetchJobDescription(jobId: bigint): Promise<string> {
  try {
    const result = (await publicClient.readContract({
      address: config.AGENTIC_COMMERCE as `0x${string}`,
      abi: GET_JOB_ABI,
      functionName: 'getJob',
      args: [jobId],
    })) as OnchainJob;
    return result.description ?? '';
  } catch (err) {
    console.warn(`[indexer] getJob(${jobId}) failed — storing empty description`, err);
    return '';
  }
}

function clean(s: string | null | undefined): string {
  return (s ?? '').replace(/\u0000/g, '');
}

// On-chain expiry is a uint256. Sentinel values like type(uint256).max mean
// "no expiry" — those overflow Postgres timestamptz, so null them instead.
const MAX_EXPIRY_SECONDS = 253_402_300_799n; // year 9999
function safeExpiredAt(seconds: bigint): Date | null {
  if (seconds <= 0n || seconds > MAX_EXPIRY_SECONDS) return null;
  return new Date(Number(seconds) * 1000);
}

export async function applyEvents(events: ParsedEvent[], chainId = 'arc'): Promise<void> {
  if (events.length === 0) return;

  const blockTimestampCache = new Map<bigint, Date>();

  async function getBlockTimestamp(blockNumber: bigint): Promise<Date | null> {
    if (blockTimestampCache.has(blockNumber)) {
      return blockTimestampCache.get(blockNumber)!;
    }
    try {
      const block = await publicClient.getBlock({ blockNumber });
      const ts = new Date(Number(block.timestamp) * 1000);
      blockTimestampCache.set(blockNumber, ts);
      return ts;
    } catch {
      return null;
    }
  }

  await db.transaction(async (tx) => {
    for (const e of events) {
      switch (e.kind) {
        case 'AgentRegistered': {
          const registeredAt = await getBlockTimestamp(e.blockNumber);
          await tx
            .insert(agents)
            .values({
              chainId,
              agentId: e.agentId,
              ownerAddress: e.owner.toLowerCase(),
              metadataUri: clean(e.metadataUri),
              registeredAtBlock: e.blockNumber,
              registeredTxHash: e.txHash,
              registeredAt,
            })
            .onConflictDoNothing();
          break;
        }

        case 'FeedbackGiven':
          // Backfill safety net: if the agent was registered before our
          // backfill window we won't have its Registered event. Insert a
          // placeholder row so the FK on feedback_events passes. ON CONFLICT
          // DO NOTHING means a real Registered event landing later (or a
          // pre-existing real row) wins.
          await tx
            .insert(agents)
            .values({
              chainId,
              agentId: e.agentId,
              ownerAddress: '',
              registeredAtBlock: 0n,
              registeredTxHash: '',
            })
            .onConflictDoNothing();

          await tx
            .insert(feedbackEvents)
            .values({
              chainId,
              agentId: e.agentId,
              validatorAddress: e.validator.toLowerCase(),
              score: e.score.toString(),
              scoreType: e.scoreType,
              tag: clean(e.tag),
              feedbackHash: clean(e.feedbackHash),
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
            })
            .onConflictDoNothing();

          await tx.execute(drizzleSql`
            UPDATE agents SET
              reputation_score = (SELECT AVG(score) FROM feedback_events WHERE agent_id = ${e.agentId}),
              feedback_count = (SELECT COUNT(*) FROM feedback_events WHERE agent_id = ${e.agentId}),
              updated_at = NOW()
            WHERE agent_id = ${e.agentId}
          `);
          break;

        case 'ValidationRequested':
          // Same placeholder safety net — agent may be pre-window.
          //
          // TODO: Schema migration — add job_id column to validations table so
          // §4.1b default attribution can be per-job rather than per-agent.
          // Proposal:
          //   ALTER TABLE validations ADD COLUMN job_id bigint REFERENCES jobs(job_id);
          //   -- nullable because existing rows lack the FK
          // Then ValidationRequested/Responded parsers in parsers.ts must decode
          // and pass job_id through. Without this join, the rating engine's
          // isJobInDefault over-attributes FAILED validations to all terminal jobs.
          await tx
            .insert(agents)
            .values({
              chainId,
              agentId: e.agentId,
              ownerAddress: '',
              registeredAtBlock: 0n,
              registeredTxHash: '',
            })
            .onConflictDoNothing();

          await tx
            .insert(validations)
            .values({
              chainId,
              agentId: e.agentId,
              validatorAddress: e.validator.toLowerCase(),
              requestHash: clean(e.requestHash),
              requestUri: clean(e.requestUri),
              status: 'PENDING',
              requestedAtBlock: e.blockNumber,
              requestTxHash: e.txHash,
            })
            .onConflictDoNothing();
          break;

        case 'ValidationResponded':
          await tx
            .update(validations)
            .set({
              responseCode: e.response,
              responseUri: clean(e.responseUri),
              responseHash: clean(e.responseHash),
              tag: clean(e.tag),
              status: e.response === 100 ? 'PASSED' : 'FAILED',
              respondedAtBlock: e.blockNumber,
              responseTxHash: e.txHash,
              updatedAt: new Date(),
            })
            .where(eq(validations.requestHash, e.requestHash));

          {
            const v = await tx
              .select()
              .from(validations)
              .where(eq(validations.requestHash, e.requestHash))
              .limit(1);
            if (v[0]) {
              await tx
                .update(agents)
                .set({
                  validationStatus: v[0].status,
                  updatedAt: new Date(),
                })
                .where(eq(agents.agentId, v[0].agentId));
            }
          }
          break;

        case 'JobCreated': {
          // The event only carries jobId/client/provider/evaluator/expiredAt/hook
          // — description is in contract storage, fetched on demand.
          const onchainDescription = await fetchJobDescription(e.jobId);
          const rawDescription = clean(onchainDescription);
          const draftHash = extractDraftHash(rawDescription);

          // If the on-chain description carries a draft marker, look up the
          // matching draft and persist the full off-chain description.
          // Otherwise fall back to whatever was passed on-chain.
          let resolvedDescription = rawDescription;
          if (draftHash) {
            const [draft] = await tx
              .select({
                description: jobDrafts.description,
                title: jobDrafts.title,
              })
              .from(jobDrafts)
              .where(
                and(
                  eq(jobDrafts.draftHash, draftHash),
                  eq(jobDrafts.chainId, chainId),
                  isNull(jobDrafts.onchainJobId),
                ),
              )
              .limit(1);
            if (draft) {
              resolvedDescription = `${draft.title}\n\n${draft.description}`;
              await tx
                .update(jobDrafts)
                .set({ onchainJobId: e.jobId.toString() })
                .where(eq(jobDrafts.draftHash, draftHash));
            }
          }

          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: e.client.toLowerCase(),
              providerAddress: e.provider.toLowerCase(),
              evaluatorAddress: e.evaluator.toLowerCase(),
              description: resolvedDescription,
              status: 'Open',
              expiredAt: safeExpiredAt(e.expiredAt),
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'created',
              actorAddress: e.client.toLowerCase(),
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { evaluator: e.evaluator, description: rawDescription },
            })
            .onConflictDoNothing();
          break;
        }

        case 'BudgetSet': {
          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: '',
              providerAddress: '',
              status: 'Open',
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          const intPart = e.amount / 1_000_000n;
          const fracPart = e.amount % 1_000_000n;
          const budgetUsdc = `${intPart}.${fracPart.toString().padStart(6, '0')}`;
          await tx
            .update(jobs)
            .set({
              budgetUsdc,
              budgetRaw: e.amount.toString(),
              updatedAt: new Date(),
            })
            .where(eq(jobs.jobId, e.jobId));

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'budgetSet',
              actorAddress: '',
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { amount: e.amount.toString() },
            })
            .onConflictDoNothing();
          break;
        }

        case 'JobFunded':
          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: '',
              providerAddress: '',
              status: 'Open',
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .update(jobs)
            .set({
              status: 'Funded',
              updatedAt: new Date(),
            })
            .where(eq(jobs.jobId, e.jobId));

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'funded',
              actorAddress: '',
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: {},
            })
            .onConflictDoNothing();
          break;

        case 'JobSubmitted':
          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: '',
              providerAddress: '',
              status: 'Open',
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .update(jobs)
            .set({
              status: 'Submitted',
              deliverableHash: e.deliverableHash,
              updatedAt: new Date(),
            })
            .where(eq(jobs.jobId, e.jobId));

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'submitted',
              actorAddress: '',
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { deliverableHash: e.deliverableHash },
            })
            .onConflictDoNothing();
          break;

        case 'JobCompleted': {
          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: '',
              providerAddress: '',
              status: 'Open',
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .update(jobs)
            .set({
              status: 'Completed',
              completionReason: e.reasonHash,
              completedAtBlock: e.blockNumber,
              completedTxHash: e.txHash,
              updatedAt: new Date(),
            })
            .where(eq(jobs.jobId, e.jobId));

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'completed',
              actorAddress: '',
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { reasonHash: e.reasonHash },
            })
            .onConflictDoNothing();

          const job = await tx
            .select()
            .from(jobs)
            .where(eq(jobs.jobId, e.jobId))
            .limit(1);
          if (job[0]) {
            await tx.execute(drizzleSql`
              UPDATE agents SET
                jobs_completed = (
                  SELECT COUNT(*) FROM jobs
                  WHERE LOWER(provider_address) = LOWER(${job[0].providerAddress})
                    AND status = 'Completed'
                ),
                usdc_earned = COALESCE((
                  SELECT SUM(budget_usdc) FROM jobs
                  WHERE LOWER(provider_address) = LOWER(${job[0].providerAddress})
                    AND status = 'Completed'
                    AND budget_usdc IS NOT NULL
                ), 0),
                updated_at = NOW()
              WHERE LOWER(owner_address) = LOWER(${job[0].providerAddress})
            `);
          }
          break;
        }

        case 'JobRejected':
          await tx
            .insert(jobs)
            .values({
              chainId,
              jobId: e.jobId,
              clientAddress: '',
              providerAddress: '',
              status: 'Open',
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .update(jobs)
            .set({
              status: 'Rejected',
              completionReason: e.reasonHash,
              updatedAt: new Date(),
            })
            .where(eq(jobs.jobId, e.jobId));

          await tx
            .insert(jobEvents)
            .values({
              chainId,
              jobId: e.jobId,
              eventType: 'rejected',
              actorAddress: '',
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { reasonHash: e.reasonHash },
            })
            .onConflictDoNothing();
          break;
      }
    }
  });
}
