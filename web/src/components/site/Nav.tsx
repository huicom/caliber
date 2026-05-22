'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import { ConnectKitButton } from 'connectkit';
import { LiveTicker } from '@/components/home/LiveTicker';

interface SubItem {
  href: string;
  label: string;
}

interface NavItem {
  label: string;
  /** Single-link items use `href`. Groups use `children`. */
  href?: string;
  children?: SubItem[];
}

const NAV: NavItem[] = [
  { label: 'home', href: '/' },
  { label: 'discover', href: '/discover' },
  {
    label: 'jobs',
    children: [
      { href: '/jobs', label: 'jobs' },
      { href: '/jobs/new', label: 'post a job' },
      { href: '/watchlist', label: 'watchlist' },
      { href: '/live', label: 'live feed' },
    ],
  },
  { label: 'methodology', href: '/methodology' },
  {
    label: 'build',
    children: [
      { href: '/developers', label: 'developer guide' },
      { href: '/integrate', label: 'integrate (code)' },
      { href: '/guide', label: 'user guide' },
      { href: '/stats', label: 'stats' },
      { href: '/agents', label: 'agent list (raw)' },
    ],
  },
];

/**
 * Caliber aperture mark — concentric rings with a copper datum dot.
 * SVG inherits `currentColor` from its link.
 */
function ApertureMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} aria-hidden="true" className="aa-brand__mark">
      <circle cx="12" cy="12" r="10.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="12" r="6.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="12" cy="12" r="2.5" fill="none" stroke="currentColor" strokeWidth="1" />
      <circle cx="20" cy="12" r="1.4" fill="var(--color-copper)" />
    </svg>
  );
}

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.href) return pathname === item.href;
  return Boolean(item.children?.some((c) => c.href === pathname));
}

export function Nav() {
  const pathname = usePathname();

  return (
    <header className="aa-header">
      <div className="aa-container aa-header__row">

        <Link href="/" className="aa-brand" aria-label="arc agents home">
          <ApertureMark />
          <span className="aa-brand__word">
            caliber<span className="aa-brand__dot">.</span>
          </span>
        </Link>

        <LiveTicker />

        <nav className="aa-nav" aria-label="primary">
          {NAV.map((item) => {
            const active = isItemActive(item, pathname);

            // Plain link
            if (item.href && !item.children) {
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={cn('aa-nav__link', active && 'aa-nav__link--active')}
                >
                  {item.label}
                </Link>
              );
            }

            // Group with submenu
            return (
              <div key={item.label} className="aa-nav__group">
                <button
                  type="button"
                  className={cn('aa-nav__link', active && 'aa-nav__link--active')}
                  aria-haspopup="menu"
                  aria-expanded="false"
                >
                  {item.label}
                  <span className="aa-nav__group__chev" aria-hidden="true">▾</span>
                </button>
                <div className="aa-nav__sub" role="menu">
                  {item.children?.map((c) => (
                    <Link
                      key={c.href}
                      href={c.href}
                      role="menuitem"
                      className={cn(
                        'aa-nav__sub__link',
                        pathname === c.href && 'aa-nav__sub__link--active',
                      )}
                    >
                      {c.label}
                    </Link>
                  ))}
                </div>
              </div>
            );
          })}
        </nav>

        <div className="aa-header__right">
          {/* ConnectKit renders its own DOM; we wrap so the visual matches `.aa-btn--primary`. */}
          <ConnectKitButton.Custom>
            {({ isConnected, show, truncatedAddress }) => (
              <button type="button" onClick={show} className="aa-btn aa-btn--primary">
                {isConnected ? truncatedAddress : 'connect wallet'}
              </button>
            )}
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  );
}
