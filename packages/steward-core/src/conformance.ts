// Tier-0 delivery conformance (Steward Phase 1, task 17).
//
// The pre-sign hooks (policy, redirect, price-spike) are the safety boundary
// BEFORE money moves. Conformance is the mirror-image check AFTER money moved:
// the seller took the payment — did it actually deliver what a well-behaved
// buyer expects? A seller that pockets a nanopayment and returns HTML gibberish,
// an over-size blob, a missed deadline, or a JSON `{ ok: false, retry: true }`
// refusal has been paid for nothing. We can't claw the payment back (honest
// ledger: the row stays 'allow'/'settled'), but we RECORD the non-conformance as
// an incident so the human — and the LLM narrator — can see who shortchanged us.
//
// Pure function, same contract as the detectors: the caller does all the I/O
// (issues the request, hashes the body, parses JSON) and hands us only the
// already-observed facts. No DB, no fetch, no clock. The pipeline owns the
// `node:crypto` sha256 + the JSON parse; this file owns ONLY the rule logic.

/**
 * What the caller asked us to verify about the delivered response. Every field
 * is optional; an omitted field disables that rule (see the defaulting note on
 * the pipeline side — the HTTP layer fills sensible defaults before calling).
 */
export interface ConformanceExpect {
  /** Require the paid body to parse as JSON. */
  json?: boolean;
  /** Reject bodies larger than this many bytes. */
  maxBytes?: number;
  /** Reject when the round-trip latency exceeded this many milliseconds. */
  deadlineMs?: number;
  /**
   * Treat a JSON body whose `ok === false` (on a 2xx paid response) as an
   * error-semantics violation: the seller took money and returned a
   * refusal / retry-bait instead of the goods.
   */
  okField?: boolean;
}

/** The facts the pipeline observed about the (already-settled) response. */
export interface ConformanceObserved {
  /** HTTP status of the paid response. */
  status: number;
  /** Response Content-Type header (lower-cased value or null). */
  contentType: string | null;
  /** Raw body size in bytes. */
  bytes: number;
  /** Round-trip latency in milliseconds. */
  latencyMs: number;
  /** True if the body parsed as JSON (null when not attempted). */
  parsedOk: boolean | null;
  /**
   * The value of the body's `ok` field when the body is a JSON object with an
   * `ok` key; null/undefined when the body has no such key (or isn't JSON).
   */
  bodyOkField: boolean | null | undefined;
  /** sha256 of the raw body (hex) — carried into the incident evidence. */
  sha256: string;
}

/** One broken expectation. `rule` is the machine code; `detail` is human text. */
export interface ConformanceViolation {
  rule: 'content_type' | 'parse' | 'max_bytes' | 'deadline' | 'ok_field' | 'status';
  detail: string;
}

export interface ConformanceResult {
  violations: ConformanceViolation[];
}

/** Does a Content-Type header claim JSON? (`application/json`, `+json`, …) */
export function contentTypeIsJson(contentType: string | null): boolean {
  if (!contentType) return false;
  const ct = contentType.toLowerCase();
  return ct.includes('application/json') || ct.includes('+json');
}

/**
 * Run the Tier-0 conformance checks. Returns every violation found (the caller
 * decides severity / whether to open an incident). A clean delivery returns
 * `{ violations: [] }`.
 */
export function checkConformance(
  expect: ConformanceExpect,
  observed: ConformanceObserved,
): ConformanceResult {
  const violations: ConformanceViolation[] = [];

  // A non-2xx paid response is itself a delivery failure (the seller settled but
  // errored). 5xx is the post-settle-failure case handled separately by the
  // pipeline, but we still flag any non-2xx here for completeness.
  if (observed.status < 200 || observed.status >= 300) {
    violations.push({
      rule: 'status',
      detail: `paid response returned non-2xx status ${observed.status}`,
    });
  }

  if (expect.json) {
    // The seller claimed JSON but the body didn't parse → parse violation.
    // The seller didn't even claim JSON → content_type violation.
    if (!contentTypeIsJson(observed.contentType)) {
      violations.push({
        rule: 'content_type',
        detail: `expected a JSON content-type, got ${observed.contentType ?? '(none)'}`,
      });
    }
    if (observed.parsedOk === false) {
      violations.push({
        rule: 'parse',
        detail: 'paid response body did not parse as JSON',
      });
    }
  }

  if (typeof expect.maxBytes === 'number' && observed.bytes > expect.maxBytes) {
    violations.push({
      rule: 'max_bytes',
      detail: `body ${observed.bytes} bytes exceeds max ${expect.maxBytes}`,
    });
  }

  if (typeof expect.deadlineMs === 'number' && observed.latencyMs > expect.deadlineMs) {
    violations.push({
      rule: 'deadline',
      detail: `latency ${observed.latencyMs}ms exceeds deadline ${expect.deadlineMs}ms`,
    });
  }

  if (expect.okField && observed.bodyOkField === false) {
    violations.push({
      rule: 'ok_field',
      detail: 'seller took payment but returned ok=false (refusal / retry-bait)',
    });
  }

  return { violations };
}
