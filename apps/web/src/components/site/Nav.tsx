'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Github, Menu } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  useLive,
  useNowTick,
  formatRelative,
} from '@/components/live/LiveContext';
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/agents', label: 'Agents' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/live', label: 'Live Feed' },
  { href: '/stats', label: 'Stats' },
];

function ArcMark({ className }: { className?: string }) {
  // Flat geometric mark — an upward arc + a dot underneath.
  // Reads as "arc" both visually and semantically. Uses currentColor
  // so it inherits whatever color the parent sets.
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden
      className={className}
    >
      <path
        d="M3 17 A 9 9 0 0 1 21 17"
        stroke="currentColor"
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <circle cx="12" cy="20" r="1.4" fill="currentColor" />
    </svg>
  );
}

function LiveCursor() {
  useNowTick(1000);
  const { lastBlock, lastEventAt, isConnected } = useLive();
  const ago = formatRelative(lastEventAt);

  return (
    <div className="hidden sm:flex items-center gap-2 pl-4 ml-1 border-l border-border h-6">
      <span
        className={cn(
          'live-pulse',
          !isConnected && 'opacity-40 [&::after]:!hidden',
        )}
        aria-hidden
      />
      <span className="font-mono text-xs text-fg-mute">
        {lastBlock ? (
          <>
            <span className="text-fg-dim">#</span>
            <span className="text-fg">
              {Number(lastBlock).toLocaleString()}
            </span>
            {ago ? (
              <span className="text-fg-dim ml-2">· {ago}</span>
            ) : null}
          </>
        ) : (
          <span className="text-fg-dim">connecting…</span>
        )}
      </span>
    </div>
  );
}

export function Nav() {
  const pathname = usePathname();

  return (
    <TooltipProvider delayDuration={150}>
      <nav className="sticky top-0 z-50 border-b border-border bg-bg/85 backdrop-blur supports-[backdrop-filter]:bg-bg/70">
        <div className="mx-auto max-w-[1200px] flex items-center justify-between px-6 md:px-12 h-14">
          {/* === Left: brand + live cursor === */}
          <div className="flex items-center gap-3 min-w-0">
            <Link
              href="/"
              className="flex items-center gap-2.5 text-accent shrink-0"
            >
              <ArcMark className="w-5 h-5" />
              <span className="font-semibold text-fg tracking-tight text-[15px]">
                ArcAgents
              </span>
            </Link>
            <LiveCursor />
          </div>

          {/* === Center: links === */}
          <div className="hidden md:flex items-center gap-6">
            {NAV_LINKS.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={cn(
                    'relative font-mono text-[13px] tracking-wide transition-colors py-1 border-b-2 border-transparent',
                    active
                      ? 'border-accent text-fg'
                      : 'text-fg-mute hover:text-fg',
                  )}
                >
                  {l.label}
                </Link>
              );
            })}
          </div>

          {/* === Right: testnet pill + github + mobile menu === */}
          <div className="flex items-center gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span
                  className="font-mono text-[10.5px] uppercase tracking-[0.15em] px-2 py-1 rounded border border-border-hi text-fg-mute cursor-default select-none"
                  tabIndex={0}
                >
                  Testnet
                </span>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                Arc testnet · chain 5042002
              </TooltipContent>
            </Tooltip>

            <a
              href="https://github.com/huicom/arc-agents-explorer"
              target="_blank"
              rel="noreferrer"
              aria-label="GitHub repository"
              className="text-fg-dim hover:text-fg transition-colors"
            >
              <Github className="w-4 h-4" />
            </a>

            <DropdownMenu>
              <DropdownMenuTrigger
                className="md:hidden text-fg-mute hover:text-fg"
                aria-label="Open menu"
              >
                <Menu className="w-5 h-5" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {NAV_LINKS.map((l) => (
                  <DropdownMenuItem key={l.href} asChild>
                    <Link
                      href={l.href}
                      className="font-mono text-[13px]"
                    >
                      {l.label}
                    </Link>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </nav>
    </TooltipProvider>
  );
}
