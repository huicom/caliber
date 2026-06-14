import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

// Lepton Phase 2 (D5): serve the Broker Console at the broker.poko.blue root.
// The subdomain points (via Cloudflare Tunnel) at this same Next app; here we
// rewrite its root path to /labs/broker so the console is the subdomain's home
// page. All other paths pass through unchanged.
export function middleware(req: NextRequest) {
  const host = (req.headers.get('host') || '').toLowerCase();
  if (host.startsWith('broker.')) {
    const url = req.nextUrl.clone();
    if (url.pathname === '/') {
      url.pathname = '/labs/broker';
      return NextResponse.rewrite(url);
    }
  }
  // Steward console at the steward.poko.blue root: rewrite root → /steward.
  if (host.startsWith('steward.')) {
    const url = req.nextUrl.clone();
    if (url.pathname === '/') {
      url.pathname = '/steward';
      return NextResponse.rewrite(url);
    }
  }
  return NextResponse.next();
}

export const config = {
  // Skip Next internals, API routes, and static files.
  matcher: ['/((?!_next/|api/|.*\\..*).*)'],
};
