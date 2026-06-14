// Pipeline abort signals. Thrown from inside the `preSign` hook of
// CaliberPayer.pay() — a throw there aborts the payment BEFORE any signature is
// made (the Steward safety boundary). Each carries enough to write the ledger
// row and (for detectors) an incident, without re-running the check.

import type { DecisionStage, DetectorHit } from '@caliber/steward-core';

/** Base for any pre-sign refusal: carries the stage + machine-readable code. */
export class PreSignAbort extends Error {
  constructor(
    /** Pipeline stage that refused. */
    public readonly stage: DecisionStage,
    /** Machine code, e.g. 'per_tx_cap' | 'redirect'. */
    public readonly code: string,
    message: string,
    /** Structured detector finding, when the refusal came from a detector. */
    public readonly hit?: DetectorHit,
  ) {
    super(message);
    this.name = 'PreSignAbort';
  }
}

/** A policy cap was exceeded (stage 'policy', decision 'deny'). */
export class PolicyViolation extends PreSignAbort {
  constructor(code: string, message: string) {
    super('policy', code, message);
    this.name = 'PolicyViolation';
  }
}

/**
 * A policy rule asked to PARK the payment for human approval (decision 'hold',
 * stage 'approval'). Like the deny aborts it throws from preSign so nothing is
 * signed — but the pipeline ledgers it as a hold (HTTP 202), not a deny.
 * The approvals queue + resume lands in a later task.
 */
export class PolicyHold extends PreSignAbort {
  constructor(
    code: string,
    message: string,
    /** steward_incidents.kind to open for this hold, when the rule warrants one
     *  (e.g. 'new_counterparty'). Undefined for approval-threshold holds. */
    public readonly incidentKind?: string,
  ) {
    super('approval', code, message);
    this.name = 'PolicyHold';
  }
}

/** A runtime detector fired and DENIED (stage 'detector'); `hit` is the finding. */
export class DetectorViolation extends PreSignAbort {
  constructor(code: string, message: string, hit: DetectorHit) {
    super('detector', code, message, hit);
    this.name = 'DetectorViolation';
  }
}

/**
 * A runtime detector fired but asks to HOLD (not deny) for human approval —
 * runaway-loop, price-spike. Like the deny aborts it throws from preSign so
 * nothing is signed, but the pipeline ledgers it as a hold (HTTP 202), raises an
 * incident, and enqueues an approval. `incidentKind` names the incident to open.
 */
export class DetectorHold extends PreSignAbort {
  constructor(
    code: string,
    message: string,
    hit: DetectorHit,
    /** Which steward_incidents.kind to open for this hold. */
    public readonly incidentKind: string,
    /** Extra evidence for the incident (beyond `hit`). */
    public readonly evidence?: Record<string, unknown>,
  ) {
    super('detector', code, message, hit);
    this.name = 'DetectorHold';
  }
}

/**
 * The LLM treasurer (fast model) DOWNGRADED an otherwise-allowed payment to a
 * HOLD (stage 'treasurer', decision 'hold', HTTP 202). It can only downgrade —
 * deterministic deny/hold already returned earlier. Carries the LLM's one-line
 * reason and the model id stamped onto the ledger row. Also used for the
 * fail-closed path (LLM error + STEWARD_LLM_FALLBACK=hold).
 */
export class TreasurerHold extends PreSignAbort {
  constructor(
    message: string,
    public readonly llmModel: string | null,
  ) {
    super('treasurer', 'treasurer_hold', message);
    this.name = 'TreasurerHold';
  }
}

/** The treasurer downgraded to DENY (stage 'treasurer', decision 'deny', 403). */
export class TreasurerDeny extends PreSignAbort {
  constructor(
    message: string,
    public readonly llmModel: string | null,
  ) {
    super('treasurer', 'treasurer_deny', message);
    this.name = 'TreasurerDeny';
  }
}

/**
 * OFAC SDN screening matched the seller's payTo on the Chainalysis on-chain
 * sanctions oracle (stage 'sdn', decision 'deny', HTTP 403). Thrown from preSign
 * AFTER the detectors and BEFORE the treasurer, so a sanctioned address is denied
 * before any LLM spend — and before any signature. Carries the SDN result so the
 * ledger row + the 'sdn_hit' incident can be written without re-screening.
 *
 * Honest labeling: this is exact-match screening against the published sanctions
 * list via the Chainalysis oracle — NOT "KYT", NOT a "compliance" determination.
 */
export class SdnDeny extends PreSignAbort {
  constructor(
    message: string,
    public readonly payTo: string,
    public readonly source: string,
    public readonly checkedAt: string,
  ) {
    super('sdn', 'sdn_hit', message);
    this.name = 'SdnDeny';
  }
}

/**
 * The OFAC SDN check could NOT be performed (oracle RPC down / timeout). Steward
 * fails CLOSED: it HOLDS the payment for human approval (stage 'sdn', decision
 * 'hold', HTTP 202) rather than allow an unscreened payment to proceed. The held
 * intent enters the approvals queue like any other hold so it can be retried once
 * the oracle is reachable again.
 */
export class SdnHold extends PreSignAbort {
  constructor(message: string) {
    super('sdn', 'sdn_unavailable', message);
    this.name = 'SdnHold';
  }
}
