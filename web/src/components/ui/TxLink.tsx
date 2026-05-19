import { arcscanTxUrl } from '@/lib/format';
import { ExternalLink } from 'lucide-react';

export function TxLink({ hash }: { hash: string }) {
  return (
    <a
      href={arcscanTxUrl(hash)}
      target="_blank"
      rel="noreferrer"
      className="inline-flex items-center gap-1 font-mono text-xs text-fg-dim hover:text-accent transition-colors"
    >
      {hash.slice(0, 10)}…{hash.slice(-6)}
      <ExternalLink className="w-3 h-3" />
    </a>
  );
}
