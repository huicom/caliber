'use client';

// Client-side console-key store for the Steward console mutation buttons.
// The owner/judge pastes the key once; we keep it in localStorage and attach it
// as the x-steward-console-key header on every mutation POST (freeze / mandate /
// resolve). The server (web/src/lib/steward-console-auth.ts) is the real gate —
// this is only convenience plumbing so the demo buttons work.

const STORAGE_KEY = 'steward_console_key';

export function getConsoleKey(): string {
  if (typeof window === 'undefined') return '';
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function setConsoleKey(key: string): void {
  if (typeof window === 'undefined') return;
  try {
    const trimmed = key.trim();
    if (trimmed) window.localStorage.setItem(STORAGE_KEY, trimmed);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

// Headers for a JSON mutation POST, including the console key if present.
export function consoleHeaders(json = true): Record<string, string> {
  const h: Record<string, string> = {};
  if (json) h['content-type'] = 'application/json';
  const key = getConsoleKey();
  if (key) h['x-steward-console-key'] = key;
  return h;
}

// Notify components in the same tab when the key changes (localStorage `storage`
// events only fire across tabs). Components can listen for this to re-render.
const EVENT = 'steward-console-key-changed';

export function broadcastKeyChange(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new Event(EVENT));
}

export const CONSOLE_KEY_EVENT = EVENT;
