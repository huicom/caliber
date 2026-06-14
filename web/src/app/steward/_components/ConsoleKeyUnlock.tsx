'use client';

import { useEffect, useState } from 'react';
import {
  getConsoleKey,
  setConsoleKey,
  broadcastKeyChange,
  CONSOLE_KEY_EVENT,
} from './consoleKey';

// Small "unlock" control in the Steward nav. Judges paste the shared console key
// once; it's stored in localStorage and sent on every mutation POST. The server
// is the real gate — this just makes the demo buttons usable.

export function ConsoleKeyUnlock() {
  const [hasKey, setHasKey] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  useEffect(() => {
    const sync = () => setHasKey(getConsoleKey().length > 0);
    sync();
    window.addEventListener(CONSOLE_KEY_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(CONSOLE_KEY_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  function save() {
    setConsoleKey(draft);
    broadcastKeyChange();
    setHasKey(draft.trim().length > 0);
    setDraft('');
    setEditing(false);
  }

  function clear() {
    setConsoleKey('');
    broadcastKeyChange();
    setHasKey(false);
    setDraft('');
    setEditing(false);
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="font-mono text-[11px] px-2.5 py-1 rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-mute)] hover:text-[var(--color-ink)] hover:border-[var(--color-ink)] transition-colors"
        title={
          hasKey
            ? 'Console key set — you can act'
            : 'Enter the console key to act (freeze / mandate / resolve)'
        }
      >
        {hasKey ? '● unlocked' : '○ enter console key'}
      </button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <input
        type="password"
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') setEditing(false);
        }}
        placeholder="console key"
        className="font-mono text-[11px] w-40 px-2 py-1 rounded-[2px] border border-[var(--color-hairline)] bg-[var(--color-paper)] text-[var(--color-ink)] focus:outline-none focus:border-[var(--color-copper)]"
      />
      <button
        type="button"
        onClick={save}
        className="font-mono text-[11px] px-2 py-1 rounded-[2px] border border-[var(--color-ink)] bg-[var(--color-ink)] text-[var(--color-paper)] hover:bg-[var(--color-copper)] hover:border-[var(--color-copper)] transition-colors"
      >
        save
      </button>
      {hasKey ? (
        <button
          type="button"
          onClick={clear}
          className="font-mono text-[11px] px-2 py-1 rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-mute)] hover:text-[var(--color-signal-down)] hover:border-[var(--color-signal-down)] transition-colors"
        >
          clear
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditing(false)}
          className="font-mono text-[11px] px-2 py-1 rounded-[2px] border border-[var(--color-hairline)] text-[var(--color-mute)] hover:text-[var(--color-ink)] transition-colors"
        >
          cancel
        </button>
      )}
    </div>
  );
}
