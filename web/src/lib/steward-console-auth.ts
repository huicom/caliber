import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';

// Auth gate for the Steward console MUTATION routes (freeze / mandate / resolve).
// These routes change treasury state and must not be drivable by anonymous public
// traffic on steward.poko.blue. The Telegram owner path is gated separately; this
// is the second authenticated path, designed so hackathon judges (given the key)
// can still drive the demo from the web console.
//
// Contract:
//   - Reads the `x-steward-console-key` request header.
//   - Compares it to process.env.STEWARD_CONSOLE_KEY in constant time.
//   - FAILS CLOSED: if STEWARD_CONSOLE_KEY is unset/empty → 503 (never default-open).
//   - On mismatch (or missing header) → 401.
//   - On match → returns null (caller proceeds).
//
// Usage (top of a POST handler):
//   const denied = requireConsoleKey(req);
//   if (denied) return denied;

const HEADER = 'x-steward-console-key';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  // timingSafeEqual throws on length mismatch — guard it, but still run a
  // comparison so timing doesn't leak the length difference.
  if (ab.length !== bb.length) {
    // Compare against self to spend roughly equivalent time, then fail.
    timingSafeEqual(ab, ab);
    return false;
  }
  return timingSafeEqual(ab, bb);
}

export function requireConsoleKey(req: Request): NextResponse | null {
  const expected = process.env.STEWARD_CONSOLE_KEY;

  // Fail closed: never allow mutations if no key is configured.
  if (!expected || expected.length === 0) {
    return NextResponse.json(
      { error: 'console_key_not_configured' },
      { status: 503 },
    );
  }

  const provided = req.headers.get(HEADER) ?? '';
  if (!safeEqual(provided, expected)) {
    return NextResponse.json(
      { error: 'unauthorized', detail: 'Invalid or missing console key.' },
      { status: 401 },
    );
  }

  return null;
}
