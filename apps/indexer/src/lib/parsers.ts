import type { Log } from 'viem';
import { decodeEventLog } from 'viem';
import {
  IDENTITY_ABI,
  REPUTATION_ABI,
  VALIDATION_ABI,
  AGENTIC_COMMERCE_ABI,
  EVENT_TOPICS,
} from './abis';
import { config } from './config';

export type ParsedEvent =
  | {
      kind: 'AgentRegistered';
      agentId: bigint;
      owner: `0x${string}`;
      metadataUri: string | null;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'FeedbackGiven';
      agentId: bigint;
      validator: `0x${string}`;
      /** Normalized to value / 10^valueDecimals, stored as numeric(10,2). */
      score: string;
      /** Kept for back-compat with the existing score_type column. */
      scoreType: number;
      tag: string;
      feedbackHash: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'ValidationRequested';
      requestHash: string;
      validator: `0x${string}`;
      agentId: bigint;
      requestUri: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'ValidationResponded';
      requestHash: string;
      response: number;
      responseUri: string;
      responseHash: string;
      tag: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'JobCreated';
      jobId: bigint;
      client: `0x${string}`;
      provider: `0x${string}`;
      evaluator: `0x${string}`;
      expiredAt: bigint;
      /** Real event doesn't carry the description; fetched lazily via getJob() if needed. */
      description: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'BudgetSet';
      jobId: bigint;
      amount: bigint;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'JobFunded';
      jobId: bigint;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'JobSubmitted';
      jobId: bigint;
      deliverableHash: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'JobCompleted';
      jobId: bigint;
      reasonHash: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'JobRejected';
      jobId: bigint;
      reasonHash: string;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    };

const ID_LOWER = config.IDENTITY_REGISTRY.toLowerCase();
const REP_LOWER = config.REPUTATION_REGISTRY.toLowerCase();
const VAL_LOWER = config.VALIDATION_REGISTRY.toLowerCase();
const COMM_LOWER = config.AGENTIC_COMMERCE.toLowerCase();

/** Normalize an (int128 value, uint8 decimals) score pair to a fixed-point
 *  decimal string suitable for the numeric(10,2) reputation column.
 *  e.g. (95, 0) → "95.00";  (9500, 2) → "95.00";  (-50, 0) → "-50.00".
 */
function normalizeScore(value: bigint, decimals: number): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const scaled = decimals === 0 ? Number(abs) : Number(abs) / 10 ** decimals;
  const fixed = scaled.toFixed(2);
  return negative ? `-${fixed}` : fixed;
}

function decodeRegistered(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: IDENTITY_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'Registered') return null;
  const args = decoded.args as {
    agentId: bigint;
    agentURI: string;
    owner: `0x${string}`;
  };
  return {
    kind: 'AgentRegistered',
    agentId: args.agentId,
    owner: args.owner,
    metadataUri: args.agentURI || null,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeNewFeedback(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: REPUTATION_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'NewFeedback') return null;
  const args = decoded.args as {
    agentId: bigint;
    clientAddress: `0x${string}`;
    feedbackIndex: bigint;
    value: bigint;
    valueDecimals: number;
    tag1: string;
    tag2: string;
    endpoint: string;
    feedbackURI: string;
    feedbackHash: `0x${string}`;
  };
  return {
    kind: 'FeedbackGiven',
    agentId: args.agentId,
    // The on-chain "validator" of feedback is the client who left it.
    validator: args.clientAddress,
    score: normalizeScore(args.value, args.valueDecimals),
    scoreType: Number(args.valueDecimals),
    tag: args.tag1 || args.tag2 || '',
    feedbackHash: args.feedbackHash,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeValidationRequest(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: VALIDATION_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'ValidationRequest') return null;
  const args = decoded.args as {
    validatorAddress: `0x${string}`;
    agentId: bigint;
    requestURI: string;
    requestHash: `0x${string}`;
  };
  return {
    kind: 'ValidationRequested',
    requestHash: args.requestHash,
    validator: args.validatorAddress,
    agentId: args.agentId,
    requestUri: args.requestURI,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeValidationResponse(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: VALIDATION_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'ValidationResponse') return null;
  const args = decoded.args as {
    validatorAddress: `0x${string}`;
    agentId: bigint;
    requestHash: `0x${string}`;
    response: number;
    responseURI: string;
    responseHash: `0x${string}`;
    tag: string;
  };
  return {
    kind: 'ValidationResponded',
    requestHash: args.requestHash,
    response: args.response,
    responseUri: args.responseURI,
    responseHash: args.responseHash,
    tag: args.tag,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeJobCreated(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'JobCreated') return null;
  const args = decoded.args as {
    jobId: bigint;
    client: `0x${string}`;
    provider: `0x${string}`;
    evaluator: `0x${string}`;
    expiredAt: bigint;
    hook: `0x${string}`;
  };
  return {
    kind: 'JobCreated',
    jobId: args.jobId,
    client: args.client,
    provider: args.provider,
    evaluator: args.evaluator,
    expiredAt: args.expiredAt,
    // Description is no longer in the event; could be fetched via getJob().
    description: '',
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeBudgetSet(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'BudgetSet') return null;
  const args = decoded.args as { jobId: bigint; amount: bigint };
  return {
    kind: 'BudgetSet',
    jobId: args.jobId,
    amount: args.amount,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeJobFunded(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'JobFunded') return null;
  const args = decoded.args as { jobId: bigint };
  return {
    kind: 'JobFunded',
    jobId: args.jobId,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeJobSubmitted(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'JobSubmitted') return null;
  const args = decoded.args as { jobId: bigint; deliverable: `0x${string}` };
  return {
    kind: 'JobSubmitted',
    jobId: args.jobId,
    deliverableHash: args.deliverable,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeJobCompleted(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'JobCompleted') return null;
  const args = decoded.args as { jobId: bigint; reason: `0x${string}` };
  return {
    kind: 'JobCompleted',
    jobId: args.jobId,
    reasonHash: args.reason,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeJobRejected(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: AGENTIC_COMMERCE_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'JobRejected') return null;
  const args = decoded.args as { jobId: bigint; reason: `0x${string}` };
  return {
    kind: 'JobRejected',
    jobId: args.jobId,
    reasonHash: args.reason,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

const DECODERS: Record<string, (log: Log) => ParsedEvent | null> = {
  [ID_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.Registered.toLowerCase())
      return decodeRegistered(log);
    return null;
  },
  [REP_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.NewFeedback.toLowerCase())
      return decodeNewFeedback(log);
    return null;
  },
  [VAL_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.ValidationRequest.toLowerCase())
      return decodeValidationRequest(log);
    if (topic === EVENT_TOPICS.ValidationResponse.toLowerCase())
      return decodeValidationResponse(log);
    return null;
  },
  [COMM_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.JobCreated.toLowerCase())
      return decodeJobCreated(log);
    if (topic === EVENT_TOPICS.BudgetSet.toLowerCase())
      return decodeBudgetSet(log);
    if (topic === EVENT_TOPICS.JobFunded.toLowerCase())
      return decodeJobFunded(log);
    if (topic === EVENT_TOPICS.JobSubmitted.toLowerCase())
      return decodeJobSubmitted(log);
    if (topic === EVENT_TOPICS.JobCompleted.toLowerCase())
      return decodeJobCompleted(log);
    if (topic === EVENT_TOPICS.JobRejected.toLowerCase())
      return decodeJobRejected(log);
    return null;
  },
};

export function parseLog(log: Log): ParsedEvent | null {
  const decoder = DECODERS[log.address.toLowerCase()];
  if (!decoder) return null;
  return decoder(log);
}
