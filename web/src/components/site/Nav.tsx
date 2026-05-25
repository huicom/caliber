'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { LiveTicker } from '@/components/home/LiveTicker';
import { ConnectButton } from '@/components/wallet/ConnectButton';

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

// Caliber site IA — five top-level items, three audience-neutral dropdowns
// grouped by content type. Decided 2026-05-22.
//
//   home · discover · activity ▾ · docs ▾ · build ▾
//
// Rationale:
//   - "discover" and "home" are the two entry points (returning vs new).
//   - "activity" surfaces what's happening on Caliber right now —
//     transitions, blocks, jobs, aggregates.
//   - "docs" answers "what is this and how does it work" — methodology
//     paper first, plain-language guides under.
//   - "build" answers "how do I integrate" — developer reference, code
//     samples, attestation verifier, raw agent list for engineers.
// Verify lives under build (off-chain verifier is a developer tool).
// Watchlist lives under activity (it's a live signal, not a builder tool).
// The user-guide stays in docs because it's how people understand
// Caliber, not how they consume it.
const NAV: NavItem[] = [
  { label: 'home', href: '/' },
  { label: 'discover', href: '/discover' },
  {
    label: 'activity',
    children: [
      { href: '/watchlist', label: 'sentinel' },
      { href: '/live', label: 'live feed' },
      { href: '/jobs', label: 'jobs' },
      { href: '/jobs/new', label: 'post a job' },
      { href: '/stats', label: 'stats' },
    ],
  },
  {
    label: 'docs',
    children: [
      { href: '/methodology', label: 'methodology' },
      { href: '/guide', label: 'user guide' },
      { href: '/builders', label: 'builders guide' },
      { href: '/docs/service', label: 'service companion' },
    ],
  },
  {
    label: 'build',
    children: [
      { href: '/developers', label: 'developer guide' },
      { href: '/integrate', label: 'integrate' },
      { href: '/verify', label: 'verify' },
      { href: '/agents', label: 'agents (raw)' },
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
      <circle cx="12" cy="12" r="1.4" fill="var(--color-copper)" />
    </svg>
  );
}

function isItemActive(item: NavItem, pathname: string): boolean {
  if (item.href) return pathname === item.href;
  return Boolean(item.children?.some((c) => c.href === pathname));
}

export function Nav() {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);

  // Close the drawer on navigation. Pathname changes on every <Link> click,
  // so this fires whenever a menu item is picked.
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  // Lock the page scroll while the drawer is open so the underlying page
  // doesn't slide around. Restore on close / unmount.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = mobileOpen ? 'hidden' : prev;
    return () => {
      document.body.style.overflow = prev;
    };
  }, [mobileOpen]);

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
          {/* Unified: MetaMask (via ConnectKit) + Google (via Circle).
              See web/src/components/wallet/ConnectButton.tsx */}
          <ConnectButton />
          <button
            type="button"
            className="aa-nav__burger"
            aria-label={mobileOpen ? 'close menu' : 'open menu'}
            aria-controls="aa-mobile-menu"
            aria-expanded={mobileOpen}
            onClick={() => setMobileOpen((v) => !v)}
          >
            {mobileOpen ? (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M6 6l12 12M6 18L18 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            ) : (
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            )}
          </button>
        </div>
      </div>

      {/* Mobile drawer — only visible ≤760px (see globals.css .aa-nav__mobile). */}
      {mobileOpen && (
        <div
          id="aa-mobile-menu"
          className="aa-nav__mobile"
          role="dialog"
          aria-modal="true"
          aria-label="primary navigation"
        >
          <nav className="aa-nav__mobile__inner" aria-label="primary mobile">
            {NAV.map((item) => {
              if (item.href && !item.children) {
                const active = pathname === item.href;
                return (
                  <Link
                    key={item.label}
                    href={item.href}
                    className={cn(
                      'aa-nav__mobile__link',
                      active && 'aa-nav__mobile__link--active',
                    )}
                  >
                    {item.label}
                  </Link>
                );
              }
              return (
                <div key={item.label} className="aa-nav__mobile__group">
                  <div className="aa-nav__mobile__group__label">{item.label}</div>
                  <div className="aa-nav__mobile__group__items">
                    {item.children?.map((c) => (
                      <Link
                        key={c.href}
                        href={c.href}
                        className={cn(
                          'aa-nav__mobile__sub',
                          pathname === c.href && 'aa-nav__mobile__sub--active',
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
        </div>
      )}
    </header>
  );
}
