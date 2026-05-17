import { keccak256, toHex } from 'viem';

export const IDENTITY_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
  {
    type: 'function',
    name: 'tokenURI',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'ownerOf',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const;

export const REPUTATION_ABI = [
  {
    type: 'event',
    name: 'FeedbackGiven',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'score', type: 'int128', indexed: false },
      { name: 'scoreType', type: 'uint8', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
      { name: 'filename', type: 'string', indexed: false },
      { name: 'fileURL', type: 'string', indexed: false },
      { name: 'fileType', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'function',
    name: 'getSummary',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'averageScore', type: 'int128' },
      { name: 'totalFeedback', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
] as const;

export const VALIDATION_ABI = [
  {
    type: 'event',
    name: 'ValidationRequested',
    inputs: [
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'validator', type: 'address', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'requestURI', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ValidationResponded',
    inputs: [
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'response', type: 'uint8', indexed: false },
      { name: 'responseURI', type: 'string', indexed: false },
      { name: 'responseHash', type: 'bytes32', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
    ],
  },
] as const;

export const AGENTIC_COMMERCE_ABI = [
  {
    type: 'event',
    name: 'JobCreated',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'evaluator', type: 'address', indexed: false },
      { name: 'expiredAt', type: 'uint256', indexed: false },
      { name: 'description', type: 'string', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'BudgetSet',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobFunded',
    inputs: [{ name: 'jobId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'JobSubmitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'deliverableHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobRejected',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'reasonHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

export const USDC_ABI = [
  {
    type: 'event',
    name: 'Transfer',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'value', type: 'uint256', indexed: false },
    ],
  },
] as const;

export const EVENT_TOPICS = {
  Transfer: keccak256(toHex('Transfer(address,address,uint256)')),
  FeedbackGiven: keccak256(
    toHex(
      'FeedbackGiven(uint256,address,int128,uint8,string,string,string,string,bytes32)',
    ),
  ),
  ValidationRequested: keccak256(
    toHex('ValidationRequested(bytes32,address,uint256,string)'),
  ),
  ValidationResponded: keccak256(
    toHex('ValidationResponded(bytes32,uint8,string,bytes32,string)'),
  ),
  JobCreated: keccak256(
    toHex('JobCreated(uint256,address,address,address,uint256,string)'),
  ),
  BudgetSet: keccak256(toHex('BudgetSet(uint256,uint256)')),
  JobFunded: keccak256(toHex('JobFunded(uint256)')),
  JobSubmitted: keccak256(toHex('JobSubmitted(uint256,bytes32)')),
  JobCompleted: keccak256(toHex('JobCompleted(uint256,bytes32)')),
  JobRejected: keccak256(toHex('JobRejected(uint256,bytes32)')),
} as const;
