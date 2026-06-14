// @caliber/steward-core — pure Steward logic. Barrel export.

export type {
  Decision,
  DecisionStage,
  IncidentKind,
  DetectorHit,
  StewardDecision,
  X402Quote,
} from './types.js';

export {
  checkRedirect,
  type RedirectQuote,
  type RegisteredCounterparty,
  type RedirectResult,
} from './detectors/redirect.js';

export {
  checkRunawayLoop,
  type LoopCheckInput,
  type LoopResult,
} from './detectors/runaway-loop.js';

export {
  checkPriceSpike,
  type PriceSpikeInput,
  type PriceSpikeResult,
} from './detectors/price-spike.js';

export {
  SDN_SOURCE,
  SDN_CACHE_TTL_MS,
  isSdnCacheFresh,
  type SdnResult,
} from './detectors/sdn.js';

export {
  checkConformance,
  contentTypeIsJson,
  type ConformanceExpect,
  type ConformanceObserved,
  type ConformanceViolation,
  type ConformanceResult,
} from './conformance.js';

export {
  CompiledPolicySchema,
  parseCompiledPolicy,
  evaluatePolicy,
  DEFAULT_POLICY,
  type CompiledPolicy,
  type PolicyQuote,
  type PolicyContext,
  type PolicyVerdict,
  type PolicyOk,
  type PolicyDenied,
} from './policy.js';

export {
  createLlmClient,
  LlmError,
  type LlmClient,
  type LlmClientConfig,
  type LlmErrorKind,
  type LlmModel,
  type ChatJsonRequest,
} from './llm.js';

export {
  // domain
  CHAIN_ID,
  ZERO_ADDRESS,
  caliberDomain,
  stringToBytes32,
  // DeliverySpec
  DELIVERY_SPEC_TYPES,
  sellerUrlHash,
  schemaHashFromExpect,
  buildDeliverySpec,
  deliverySpecHash,
  signDeliverySpec,
  recoverDeliverySpecSigner,
  verifyDeliverySpecSig,
  type DeliverySpec,
  type DeliverySpecInput,
  // EvidenceAttestation
  VERDICT,
  EVIDENCE_ATTESTATION_TYPES,
  buildEvidenceAttestation,
  signEvidenceAttestation,
  evidenceAttestationHash,
  verifyEvidence,
  type VerdictValue,
  type EvidenceAttestation,
  type EvidenceAttestationInput,
  type EvidenceEnvelope,
  type EvidenceCheck,
  type EvidenceVerifyResult,
} from './eip712.js';
