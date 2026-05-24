'use client';

import { useState, useEffect } from 'react';

/* Animated rating specimen card — types fields in one at a time, then lands
 * the tier chip with a small pop. Real Caliber v2.0.1 fields (tier, score,
 * confidence, jobs, flags), not the old PPD/LGD/EAD framing. */

const SPEC_FIELDS = [
  { k: 'tier', v: 'Silver' },
  { k: 'score', v: '78 / 100' },
  { k: 'confidence', v: 'moderate' },
  { k: 'completed', v: '23 jobs' },
  { k: 'flags', v: 'none' },
  { k: 'methodology', v: 'v2.0.1' },
  { k: 'issued', v: '2026-05-24' },
  { k: 'issuer', v: '0xbF01…AA84' },
];

export function HeroSpecimen() {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    let p = 0;
    setPhase(0);
    const id = setInterval(() => {
      p += 1;
      if (p > 12) p = 0;
      setPhase(p);
    }, 600);
    return () => clearInterval(id);
  }, []);
  const chipKey = Math.floor(phase / 13);

  return (
    <article className="cl-spec" aria-label="signed rating specimen">
      <div className="cl-spec__head">
        <div className="cl-spec__head-l">
          <span className="cl-spec__label">subject</span>
          <span className="cl-spec__subject">0x4a73fc91…3b9</span>
        </div>
        {phase >= 9 && (
          <span
            key={chipKey}
            className="cl-spec__chip cl-spec__chip--copper cl-spec__chip--landing"
          >
            Silver
          </span>
        )}
      </div>

      <dl className="cl-spec__grid">
        {SPEC_FIELDS.map((f, i) => {
          const visible = phase > i;
          const typing = phase === i + 1 && phase <= 8;
          return (
            <div key={f.k} className="cl-spec__row">
              <div className="cl-spec__k">{f.k}</div>
              <div className={`cl-spec__v${typing ? ' cl-spec__v--typing' : ''}`}>
                {visible ? f.v : ' '}
              </div>
            </div>
          );
        })}
      </dl>

      <div className="cl-spec__foot">
        <span className="cl-spec__sig">
          <span
            className="cl-spec__sig-dot"
            style={{ opacity: phase >= 10 ? 1 : 0.2 }}
          />
          {phase >= 10 ? 'signed · EIP-712 · arc testnet' : 'awaiting signature…'}
        </span>
        <span className="cl-spec__link">verify on-chain →</span>
      </div>
    </article>
  );
}

export function ApertureBg() {
  const ticks = [];
  for (let i = 0; i < 36; i++) {
    const a = (i / 36) * Math.PI * 2;
    const r1 = i % 9 === 0 ? 44 : 46;
    const x1 = Math.cos(a) * r1;
    const y1 = Math.sin(a) * r1;
    const x2 = Math.cos(a) * 48;
    const y2 = Math.sin(a) * 48;
    ticks.push(<line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />);
  }
  return (
    <div className="cl-aperture" aria-hidden="true">
      <svg
        viewBox="-50 -50 100 100"
        className="cl-aperture__svg"
        preserveAspectRatio="xMidYMid meet"
      >
        <circle r="48" className="cl-ring-static" />
        <circle r="38" className="cl-ring-static" />
        <circle r="26" className="cl-ring-static" />
        <circle r="15" className="cl-ring-static" />
        <g className="cl-aperture__ticks">{ticks}</g>
        <circle r="48" className="cl-ring" />
        <circle r="48" className="cl-ring cl-ring--2" />
        <circle r="48" className="cl-ring cl-ring--3" />
        <g className="cl-aperture__sweep">
          <line x1="0" y1="0" x2="48" y2="0" />
        </g>
        <circle r="1.2" className="cl-datum" />
      </svg>
    </div>
  );
}
