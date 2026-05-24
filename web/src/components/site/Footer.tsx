import Link from 'next/link';

/**
 * Caliber-styled aperture mark for the dark footer. Same SVG as the
 * header Nav, but renders on the ink-dark backdrop.
 */
function ApertureMark() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" className="aa-brand__mark">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="20" cy="12" r="1.4" fill="var(--color-copper)" />
    </svg>
  );
}

const EXPLORE = [
  { href: '/agents', label: 'agents' },
  { href: '/jobs', label: 'jobs' },
  { href: '/live', label: 'live feed' },
  { href: '/stats', label: 'stats' },
];

const METHODOLOGY = [
  { href: '/methodology', label: 'methodology v2.0.1' },
  { href: '/methodology#3-rating-scale', label: 'rating scale' },
  { href: '/methodology#41-performance-default-definition', label: 'default definition' },
  { href: '/methodology#45-anti-gaming-controls', label: 'anti-gaming controls' },
];

const BUILD = [
  { href: '/integrate', label: 'integrate (quickstart)' },
  { href: '/developers', label: 'developer guide' },
  { href: '/guide', label: 'user guide' },
  { href: '/jobs/new', label: 'demo marketplace' },
  { href: 'https://eips.ethereum.org/EIPS/eip-8004', label: 'ERC-8004 spec ↗', external: true },
  { href: 'https://github.com/huicom/caliber', label: 'github ↗', external: true },
];

export function Footer() {
  return (
    <footer className="aa-foot">
      <div className="aa-container aa-foot__grid">

        <div className="aa-foot__col">
          <Link href="/" className="aa-brand" aria-label="arc agents">
            <ApertureMark />
            <span className="aa-brand__word">
              caliber<span className="aa-brand__dot">.</span>
            </span>
          </Link>
          <p className="aa-foot__blurb">
            an open-source explorer for the ERC-8004 agent registry on Arc.
            ratings issued under a public, versioned <strong>Caliber</strong> methodology.
          </p>
        </div>

        <nav className="aa-foot__col" aria-label="explore">
          <div className="aa-foot__title">explore</div>
          {EXPLORE.map((l) => (
            <Link key={l.href} href={l.href} className="aa-foot__link">
              {l.label}
            </Link>
          ))}
        </nav>

        <nav className="aa-foot__col" aria-label="methodology">
          <div className="aa-foot__title">methodology</div>
          {METHODOLOGY.map((l) => (
            <Link key={l.href} href={l.href} className="aa-foot__link">
              {l.label}
            </Link>
          ))}
        </nav>

        <nav className="aa-foot__col" aria-label="build">
          <div className="aa-foot__title">build</div>
          {BUILD.map((l) =>
            l.external ? (
              <a
                key={l.href}
                href={l.href}
                target="_blank"
                rel="noreferrer"
                className="aa-foot__link"
              >
                {l.label}
              </a>
            ) : (
              <Link key={l.href} href={l.href} className="aa-foot__link">
                {l.label}
              </Link>
            ),
          )}
        </nav>

      </div>

      <div className="aa-container aa-foot__ledger">
        <span className="aa-mono aa-mute">
          testnet · methodology v2.0.1 · built by pokoblue
        </span>
        <span className="aa-mono aa-mute">
          © 2026 · caliber — the rating layer for the agent economy
        </span>
      </div>
    </footer>
  );
}
