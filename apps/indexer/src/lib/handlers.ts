import {
  db,
  agents,
  feedbackEvents,
  validations,
  jobs,
  jobEvents,
} from '@arc-agents/db';
import { eq, sql as drizzleSql } from 'drizzle-orm';
import type { ParsedEvent } from './parsers';

export async function applyEvents(events: ParsedEvent[]): Promise<void> {
  if (events.length === 0) return;

  await db.transaction(async (tx) => {
    for (const e of events) {
      switch (e.kind) {
        case 'AgentRegistered':
          await tx
            .insert(agents)
            .values({
              agentId: e.agentId,
              ownerAddress: e.owner.toLowerCase(),
              metadataUri: e.metadataUri,
              registeredAtBlock: e.blockNumber,
              registeredTxHash: e.txHash,
            })
            .onConflictDoNothing();
          break;

        case 'FeedbackGiven':
          await tx
            .insert(feedbackEvents)
            .values({
              agentId: e.agentId,
              validatorAddress: e.validator.toLowerCase(),
              score: e.score.toString(),
              scoreType: e.scoreType,
              tag: e.tag,
              feedbackHash: e.feedbackHash,
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
          await tx
            .insert(validations)
            .values({
              agentId: e.agentId,
              validatorAddress: e.validator.toLowerCase(),
              requestHash: e.requestHash,
              requestUri: e.requestUri,
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
              responseUri: e.responseUri,
              responseHash: e.responseHash,
              tag: e.tag,
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

        case 'JobCreated':
          await tx
            .insert(jobs)
            .values({
              jobId: e.jobId,
              clientAddress: e.client.toLowerCase(),
              providerAddress: e.provider.toLowerCase(),
              evaluatorAddress: e.evaluator.toLowerCase(),
              description: e.description,
              status: 'Open',
              expiredAt: new Date(Number(e.expiredAt) * 1000),
              createdAtBlock: e.blockNumber,
              createdTxHash: e.txHash,
            })
            .onConflictDoNothing();

          await tx
            .insert(jobEvents)
            .values({
              jobId: e.jobId,
              eventType: 'created',
              actorAddress: e.client.toLowerCase(),
              blockNumber: e.blockNumber,
              txHash: e.txHash,
              logIndex: e.logIndex,
              data: { evaluator: e.evaluator, description: e.description },
            })
            .onConflictDoNothing();
          break;

        case 'BudgetSet': {
          await tx
            .insert(jobs)
            .values({
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
