/**
 * Figure 1 — Caliber Rating Pipeline.
 *
 * Replaces the static `/methodology/rating-pipeline.png` placeholder with a
 * native HTML/SVG schematic per the design handoff (Caliber Methodology
 * Figure v4). Reads left → right: features → math → score → rating.
 *
 * Substituted into the methodology paper via ReactMarkdown's
 * `components.img` override when the markdown source references
 * `rating-pipeline.png`.
 */
export function RatingPipelineFigure() {
  return (
    <div className="fig not-prose" aria-label="rating pipeline schematic">
      <header className="fig__head">
        <span>
          <b>fig. 1</b> — rating pipeline
        </span>
        <span className="fig__head__r">
          <b>read left → right</b>
          <span>· each stage builds on the last</span>
        </span>
      </header>

      <div className="fig__stages">
        <div className="fig__stage">
          <div className="fig__stage__num">// step 01 · foundation</div>
          <div className="fig__stage__name">The features</div>
          <span className="fig__stage__sub">deterministic summaries · 9 fields</span>
        </div>
        <div className="fig__stage fig__stage--gap"><span>·</span></div>
        <div className="fig__stage">
          <div className="fig__stage__num">// step 02 · transformation</div>
          <div className="fig__stage__name">The math</div>
          <span className="fig__stage__sub">three techniques, each disclosed</span>
        </div>
        <div className="fig__stage fig__stage--gap"><span>·</span></div>
        <div className="fig__stage">
          <div className="fig__stage__num">// step 02.b · composition</div>
          <div className="fig__stage__name">The score</div>
          <span className="fig__stage__sub">weighted sum · revised in public</span>
        </div>
        <div className="fig__stage fig__stage--gap"><span>·</span></div>
        <div className="fig__stage">
          <div className="fig__stage__num">// step 03 · output</div>
          <div className="fig__stage__name">Rating</div>
          <span className="fig__stage__sub">tier + score + ci</span>
        </div>
      </div>

      <div className="fig__body">
        {/* Wire overlay removed — at this rendered scale the curves
            collided with the composite card and the inline labels were
            clipped, adding more noise than signal. The column headers
            ("read left → right · each stage builds on the last") plus
            the weight chips inside the composite already communicate
            the flow without needing connector lines. */}

        {/* Column 1 — features */}
        <div className="fig__features">
          <div className="feat-group">
            <div className="feat-group__h"><b>performance</b><span>· 4 fields</span></div>
            <ul className="feat-group__list">
              <li>completion_rate <span>ratio</span></li>
              <li>dispute_rate <span>ratio</span></li>
              <li>delivery_latency_p50 <span>seconds</span></li>
              <li>delivery_latency_cv <span>unitless</span></li>
            </ul>
          </div>
          <div className="feat-group">
            <div className="feat-group__h"><b>network</b><span>· 3 fields</span></div>
            <ul className="feat-group__list">
              <li>unique_counterparties <span>count</span></li>
              <li>unique_validators <span>count</span></li>
              <li>counterparty_hhi <span>index</span></li>
            </ul>
          </div>
          <div className="feat-group feat-group--risk">
            <div className="feat-group__h"><b>risk</b><span>· 2 fields</span></div>
            <ul className="feat-group__list">
              <li>settled_usdc_volume <span>usdc</span></li>
              <li>self_deal_share <span>ratio</span></li>
            </ul>
          </div>
        </div>

        {/* Column 2 — operations */}
        <div className="fig__ops">
          <article className="fig-op">
            <header className="fig-op__head">
              <span className="fig-op__num">// 2.1 · credibility weighting</span>
              <span className="fig-op__weight">→ 50%</span>
            </header>
            <h4 className="fig-op__title">Credibility weighting</h4>
            <p className="fig-op__body">
              Blends agent record with population mean. Small samples pull toward
              average. Actuarial method, 1960s.
            </p>
            <p className="fig-op__inputs">
              <b>inputs:</b>{' '}
              <code>completion_rate, dispute_rate, latency_p50, latency_cv</code>
              <br />
              <b>output:</b> smoothed reliability score
            </p>
          </article>

          <article className="fig-op">
            <header className="fig-op__head">
              <span className="fig-op__num">// 2.2 · forward-looking estimate</span>
              <span className="fig-op__weight">→ 25%</span>
            </header>
            <h4 className="fig-op__title">Forward-looking estimate</h4>
            <p className="fig-op__body">
              Recency-weighted probability of next-job success. Handles in-flight
              jobs. Returns point + interval.
            </p>
            <p className="fig-op__inputs">
              <b>inputs:</b> <code>completion_rate, dispute_rate</code> (recency)
              <br />
              <b>output:</b> p̂ + 90% interval
            </p>
          </article>

          <article className="fig-op fig-op--watch">
            <header className="fig-op__head">
              <span className="fig-op__num">// 2.3 · risk flags</span>
              <span className="fig-op__weight">→ override</span>
            </header>
            <h4 className="fig-op__title">Risk flags</h4>
            <p className="fig-op__body">
              Disclosed heuristics — concentration, sybil pattern, volume anomaly,
              dormancy. One fire → Watch tier.
            </p>
            <p className="fig-op__inputs">
              <b>inputs:</b>{' '}
              <code>counterparty_hhi, self_deal_share, settled_usdc_volume</code>
              <br />
              <b>output:</b> boolean per heuristic
            </p>
          </article>
        </div>

        {/* Column 3 — composite formula */}
        <div className="fig__composite">
          <div className="fig-comp__h">
            <b>score</b>
            <span>step 02.b</span>
          </div>
          <div className="fig-comp__formula">
            <span>score</span> <span className="sym">=</span> Σ{' '}
            <span className="sym">w</span>
            <sub>i</sub> · <span className="sym">x</span>
            <sub>i</sub>
          </div>
          <div className="fig-comp__terms">
            <span className="pct">50%</span>
            <span className="lbl">smoothed reliability</span>
            <span className="src">← 2.1</span>
            <span className="pct">25%</span>
            <span className="lbl">forward estimate</span>
            <span className="src">← 2.2</span>
            <span className="pct">15%</span>
            <span className="lbl">network diversity</span>
            <span className="src">← features</span>
            <span className="pct">10%</span>
            <span className="lbl">latency consistency</span>
            <span className="src">← features</span>
          </div>
          <p className="fig-comp__foot">
            weights revised in public · changes ship as methodology v(n+1)
          </p>
        </div>

        {/* Column 4 — rating card */}
        <div className="fig__rating">
          <div className="fig-rate__h">// signed attestation</div>

          <div className="fig-rate__tier">
            <svg className="fig-rate__mark" viewBox="0 0 32 32" aria-hidden="true">
              <circle className="fig-rate__mark__ring" cx="16" cy="16" r="14" />
              <circle className="fig-rate__mark__ring" cx="16" cy="16" r="10" />
              <circle className="fig-rate__mark__ring" cx="16" cy="16" r="6" />
              <circle cx="16" cy="16" r="3" fill="var(--tier-gold)" />
            </svg>
            <div className="fig-rate__name">Gold</div>
            <div className="fig-rate__lbl">tier · observed</div>
          </div>

          <div className="fig-rate__score">
            <div className="fig-rate__score__n">
              85<sup>/100</sup>
            </div>
            <div className="fig-rate__lbl">score</div>
          </div>

          <div className="fig-rate__conf">
            <div className="fig-rate__conf__n">± 4.8</div>
            <div className="fig-rate__lbl">90% interval</div>
          </div>
        </div>
      </div>

      <footer className="fig__foot">
        <span>
          <b>methodology v2.0.1</b> · published &amp; version-pinned · re-runs nightly
        </span>
        <span>every wire above is auditable in the open registry</span>
      </footer>
    </div>
  );
}
