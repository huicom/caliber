import type { Log } from 'viem';
import {
  IDENTITY_ABI,
  REPUTATION_ABI,
  VALIDATION_ABI,
  AGENTIC_COMMERCE_ABI,
  EVENT_TOPICS,
} from './abis';
import { config } from './config';
import { decodeEventLog } from 'viem';

export type ParsedEvent =
  | {
      kind: 'AgentRegistered';
      agentId: bigint;
      owner: `0x${string}`;
      blockNumber: bigint;
      txHash: string;
      logIndex: number;
    }
  | {
      kind: 'FeedbackGiven';
      agentId: bigint;
      validator: `0x${string}`;
      score: bigint;
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

function decodeTransfer(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({ abi: IDENTITY_ABI, data: log.data, topics: log.topics });
  if (decoded.eventName !== 'Transfer') return null;
  const args = decoded.args as { from: `0x${string}`; to: `0x${string}`; tokenId: bigint };
  if (args.from !== '0x0000000000000000000000000000000000000000') return null;
  return {
    kind: 'AgentRegistered',
    agentId: args.tokenId,
    owner: args.to,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeFeedbackGiven(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({ abi: REPUTATION_ABI, data: log.data, topics: log.topics });
  if (decoded.eventName !== 'FeedbackGiven') return null;
  const args = decoded.args as {
    agentId: bigint;
    validator: `0x${string}`;
    score: bigint;
    scoreType: number;
    tag: string;
    filename: string;
    fileURL: string;
    fileType: string;
    feedbackHash: `0x${string}`;
  };
  return {
    kind: 'FeedbackGiven',
    agentId: args.agentId,
    validator: args.validator,
    score: args.score,
    scoreType: args.scoreType,
    tag: args.tag,
    feedbackHash: args.feedbackHash,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeValidationRequested(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: VALIDATION_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'ValidationRequested') return null;
  const args = decoded.args as {
    requestHash: `0x${string}`;
    validator: `0x${string}`;
    agentId: bigint;
    requestURI: string;
  };
  return {
    kind: 'ValidationRequested',
    requestHash: args.requestHash,
    validator: args.validator,
    agentId: args.agentId,
    requestUri: args.requestURI,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

function decodeValidationResponded(log: Log): ParsedEvent | null {
  const decoded = decodeEventLog({
    abi: VALIDATION_ABI,
    data: log.data,
    topics: log.topics,
  });
  if (decoded.eventName !== 'ValidationResponded') return null;
  const args = decoded.args as {
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
    description: string;
  };
  return {
    kind: 'JobCreated',
    jobId: args.jobId,
    client: args.client,
    provider: args.provider,
    evaluator: args.evaluator,
    expiredAt: args.expiredAt,
    description: args.description,
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
  const args = decoded.args as { jobId: bigint; deliverableHash: `0x${string}` };
  return {
    kind: 'JobSubmitted',
    jobId: args.jobId,
    deliverableHash: args.deliverableHash,
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
  const args = decoded.args as { jobId: bigint; reasonHash: `0x${string}` };
  return {
    kind: 'JobCompleted',
    jobId: args.jobId,
    reasonHash: args.reasonHash,
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
  const args = decoded.args as { jobId: bigint; reasonHash: `0x${string}` };
  return {
    kind: 'JobRejected',
    jobId: args.jobId,
    reasonHash: args.reasonHash,
    blockNumber: log.blockNumber!,
    txHash: log.transactionHash!,
    logIndex: log.logIndex!,
  };
}

const DECODERS: Record<
  string,
  (log: Log) => ParsedEvent | null
> = {
  [ID_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.Transfer.toLowerCase()) return decodeTransfer(log);
    return null;
  },
  [REP_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.FeedbackGiven.toLowerCase()) return decodeFeedbackGiven(log);
    return null;
  },
  [VAL_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.ValidationRequested.toLowerCase()) return decodeValidationRequested(log);
    if (topic === EVENT_TOPICS.ValidationResponded.toLowerCase()) return decodeValidationResponded(log);
    return null;
  },
  [COMM_LOWER]: (log) => {
    const topic = log.topics[0]?.toLowerCase();
    if (topic === EVENT_TOPICS.JobCreated.toLowerCase()) return decodeJobCreated(log);
    if (topic === EVENT_TOPICS.BudgetSet.toLowerCase()) return decodeBudgetSet(log);
    if (topic === EVENT_TOPICS.JobFunded.toLowerCase()) return decodeJobFunded(log);
    if (topic === EVENT_TOPICS.JobSubmitted.toLowerCase()) return decodeJobSubmitted(log);
    if (topic === EVENT_TOPICS.JobCompleted.toLowerCase()) return decodeJobCompleted(log);
    if (topic === EVENT_TOPICS.JobRejected.toLowerCase()) return decodeJobRejected(log);
    return null;
  },
};

export function parseLog(log: Log): ParsedEvent | null {
  const decoder = DECODERS[log.address.toLowerCase()];
  if (!decoder) return null;
  return decoder(log);
}
