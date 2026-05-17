import { keccak256, toHex } from 'viem';

/* === IdentityRegistry ===
 * The real contract is an ERC-721 that emits BOTH standard `Transfer` AND a
 * custom `Registered(uint256 indexed agentId, string agentURI, address indexed owner)`
 * event. The latter is more useful: it carries the URI in the event so we don't
 * have to call tokenURI() after the fact.
 */
export const IDENTITY_ABI = [
  {
    type: 'event',
    name: 'Registered',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'agentURI', type: 'string', indexed: false },
      { name: 'owner', type: 'address', indexed: true },
    ],
  },
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
    type: 'event',
    name: 'URIUpdated',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'newURI', type: 'string', indexed: false },
      { name: 'updatedBy', type: 'address', indexed: true },
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

/* === ReputationRegistry ===
 * Real event is NewFeedback, not FeedbackGiven. Three indexed args
 * (agentId, clientAddress, indexedTag1 — the last is a hashed string).
 * The score is a (value, valueDecimals) pair — int128 with adjustable
 * fixed-point decimals — so a "95.00" score is encoded as value=95,
 * decimals=0, or value=9500, decimals=2, etc.
 */
export const REPUTATION_ABI = [
  {
    type: 'event',
    name: 'NewFeedback',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
      { name: 'value', type: 'int128', indexed: false },
      { name: 'valueDecimals', type: 'uint8', indexed: false },
      { name: 'indexedTag1', type: 'string', indexed: true },
      { name: 'tag1', type: 'string', indexed: false },
      { name: 'tag2', type: 'string', indexed: false },
      { name: 'endpoint', type: 'string', indexed: false },
      { name: 'feedbackURI', type: 'string', indexed: false },
      { name: 'feedbackHash', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'FeedbackRevoked',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ResponseAppended',
    inputs: [
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'clientAddress', type: 'address', indexed: true },
      { name: 'feedbackIndex', type: 'uint64', indexed: false },
      { name: 'responder', type: 'address', indexed: true },
      { name: 'responseURI', type: 'string', indexed: false },
      { name: 'responseHash', type: 'bytes32', indexed: false },
    ],
  },
] as const;

/* === ValidationRegistry ===
 * Real events are ValidationRequest / ValidationResponse (singular, no -ed).
 * They each carry 3 indexed fields.
 */
export const VALIDATION_ABI = [
  {
    type: 'event',
    name: 'ValidationRequest',
    inputs: [
      { name: 'validatorAddress', type: 'address', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'requestURI', type: 'string', indexed: false },
      { name: 'requestHash', type: 'bytes32', indexed: true },
    ],
  },
  {
    type: 'event',
    name: 'ValidationResponse',
    inputs: [
      { name: 'validatorAddress', type: 'address', indexed: true },
      { name: 'agentId', type: 'uint256', indexed: true },
      { name: 'requestHash', type: 'bytes32', indexed: true },
      { name: 'response', type: 'uint8', indexed: false },
      { name: 'responseURI', type: 'string', indexed: false },
      { name: 'responseHash', type: 'bytes32', indexed: false },
      { name: 'tag', type: 'string', indexed: false },
    ],
  },
] as const;

/* === AgenticCommerce ===
 * Most events gained a second indexed address compared to what the indexer
 * previously assumed. JobCreated's last arg is `hook` (address), not the
 * `description` string the old ABI expected (description is only available
 * via getJob() now). PaymentReleased is a new event for actual USDC payouts.
 */
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
      { name: 'hook', type: 'address', indexed: false },
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
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobSubmitted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'deliverable', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobCompleted',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'evaluator', type: 'address', indexed: true },
      { name: 'reason', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobRejected',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'rejector', type: 'address', indexed: true },
      { name: 'reason', type: 'bytes32', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'JobExpired',
    inputs: [{ name: 'jobId', type: 'uint256', indexed: true }],
  },
  {
    type: 'event',
    name: 'PaymentReleased',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'client', type: 'address', indexed: true },
      { name: 'amount', type: 'uint256', indexed: false },
    ],
  },
  {
    type: 'event',
    name: 'ProviderSet',
    inputs: [
      { name: 'jobId', type: 'uint256', indexed: true },
      { name: 'provider', type: 'address', indexed: true },
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
  Registered: keccak256(toHex('Registered(uint256,string,address)')),
  URIUpdated: keccak256(toHex('URIUpdated(uint256,string,address)')),
  NewFeedback: keccak256(
    toHex(
      'NewFeedback(uint256,address,uint64,int128,uint8,string,string,string,string,string,bytes32)',
    ),
  ),
  FeedbackRevoked: keccak256(
    toHex('FeedbackRevoked(uint256,address,uint64)'),
  ),
  ResponseAppended: keccak256(
    toHex('ResponseAppended(uint256,address,uint64,address,string,bytes32)'),
  ),
  ValidationRequest: keccak256(
    toHex('ValidationRequest(address,uint256,string,bytes32)'),
  ),
  ValidationResponse: keccak256(
    toHex(
      'ValidationResponse(address,uint256,bytes32,uint8,string,bytes32,string)',
    ),
  ),
  JobCreated: keccak256(
    toHex('JobCreated(uint256,address,address,address,uint256,address)'),
  ),
  BudgetSet: keccak256(toHex('BudgetSet(uint256,uint256)')),
  JobFunded: keccak256(toHex('JobFunded(uint256,address,uint256)')),
  JobSubmitted: keccak256(toHex('JobSubmitted(uint256,address,bytes32)')),
  JobCompleted: keccak256(toHex('JobCompleted(uint256,address,bytes32)')),
  JobRejected: keccak256(toHex('JobRejected(uint256,address,bytes32)')),
  JobExpired: keccak256(toHex('JobExpired(uint256)')),
  PaymentReleased: keccak256(toHex('PaymentReleased(uint256,address,uint256)')),
  Refunded: keccak256(toHex('Refunded(uint256,address,uint256)')),
  ProviderSet: keccak256(toHex('ProviderSet(uint256,address)')),
} as const;
