// Steward core types — the shared vocabulary of a payment decision.
//
// Pure logic only: no Express, no DB, no Circle SDK. The pipeline in
// services/steward, the thin client in packages/steward-client, and the web
// console all speak in these terms.

// Re-export the seller-quote shape from the x402 buyer client so detectors and
// the pipeline inspect exactly the requirement that would be signed. Importing
// the type (not the runtime) keeps steward-core free of the Circle SDK.
export type { X402Quote } from '@caliber/x402-client';

/** Where a payment ends up. */
export type Decision = 'allow' | 'hold' | 'deny';

/**
 * Which pipeline stage reached the verdict. Mirrors `steward_payments`'s
 * `decision_stage` column. Ordering reflects pipeline order; `executed` is the
 * terminal happy-path stage (the payment settled).
 */
export type DecisionStage =
  | 'frozen'
  | 'policy'
  | 'detector'
  | 'sdn'
  | 'treasurer'
  | 'approval'
  | 'executed';

/** Detector / SDN / settlement anomaly kinds — mirror `steward_incidents.kind`. */
export type IncidentKind =
  | 'runaway_loop'
  | 'price_spike'
  | 'redirect'
  | 'new_counterparty'
  | 'conformance'
  | 'sdn_hit'
  | 'settle_mismatch';

/** One detector's structured finding, surfaced on the ledger's `detector_hits`. */
export interface DetectorHit {
  /** Detector name, e.g. 'redirect'. */
  detector: string;
  /** True when the detector fired. */
  hit: boolean;
  /** Free-form evidence; detector-specific keys (expected/got/…). */
  [key: string]: unknown;
}

/**
 * The verdict Steward reaches for one payment intent. `detectorHits` carries any
 * structured detector findings that informed (or caused) the decision.
 */
export interface StewardDecision {
  decision: Decision;
  stage: DecisionStage;
  reasoning: string;
  detectorHits?: DetectorHit[];
}
