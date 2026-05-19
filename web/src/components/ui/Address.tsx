'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { truncateAddress, arcscanAddressUrl } from '@/lib/format';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export function Address({
  value,
  full = false,
}: {
  value: string;
  full?: boolean;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-sm">
      <span className="text-fg-mute">
        {full ? value : truncateAddress(value)}
      </span>
      <button
        type="button"
        aria-label="Copy address"
        onClick={async (e) => {
          e.preventDefault();
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast('Address copied', {
            duration: 800,
            className: 'arc-toast-accent',
            style: {
              borderColor: 'var(--color-accent)',
              color: 'var(--color-accent)',
            },
          });
          setTimeout(() => setCopied(false), 1500);
        }}
        className={cn(
          'transition-colors',
          copied ? 'text-accent' : 'text-fg-dim hover:text-fg',
        )}
      >
        {copied ? (
          <Check className="w-3 h-3" />
        ) : (
          <Copy className="w-3 h-3" />
        )}
      </button>
      <a
        href={arcscanAddressUrl(value)}
        target="_blank"
        rel="noreferrer"
        aria-label="View on ArcScan"
        className="text-fg-dim hover:text-accent transition-colors"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </span>
  );
}
