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
import { cn } from '@/lib/utils';

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/agents', label: 'Agents' },
  { href: '/jobs', label: 'Jobs' },
  { href: '/live', label: 'Live Feed' },
  { href: '/stats', label: 'Stats' },
];

export function Nav() {
  const pathname = usePathname();

  return (
    <nav className="sticky top-0 z-50 border-b border-border bg-bg/90 backdrop-blur">
      <div className="mx-auto max-w-7xl flex items-center justify-between px-4 h-14">
        <Link href="/" className="flex items-center gap-2">
          <span
            className="inline-block w-6 h-6 rounded bg-gradient-to-br from-brand to-purple-700"
            aria-hidden
          />
          <span className="font-semibold text-lg">ArcAgents</span>
        </Link>

        <div className="hidden md:flex items-center gap-1">
          {NAV_LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={cn(
                'px-3 py-1.5 rounded text-sm transition',
                pathname === l.href
                  ? 'text-text bg-bg-muted'
                  : 'text-text-muted hover:text-text hover:bg-bg-subtle',
              )}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="flex items-center gap-3">
          <span className="hidden md:inline text-xs text-text-dim">
            Bangkok 🇹🇭
          </span>
          <a
            href="https://github.com/huicom/arc-agents-explorer"
            target="_blank"
            rel="noreferrer"
            className="text-text-muted hover:text-text"
          >
            <Github className="w-4 h-4" />
          </a>
          <DropdownMenu>
            <DropdownMenuTrigger className="md:hidden">
              <Menu className="w-5 h-5" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {NAV_LINKS.map((l) => (
                <DropdownMenuItem key={l.href} asChild>
                  <Link href={l.href}>{l.label}</Link>
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </nav>
  );
}
