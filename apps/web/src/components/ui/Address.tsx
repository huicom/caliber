'use client';

import { useState } from 'react';
import { Copy, ExternalLink, Check } from 'lucide-react';
import { truncateAddress, arcscanAddressUrl } from '@/lib/format';
import { toast } from 'sonner';

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
      <span>{full ? value : truncateAddress(value)}</span>
      <button
        onClick={async () => {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          toast.success('Address copied');
          setTimeout(() => setCopied(false), 1500);
        }}
        className="text-text-dim hover:text-text"
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
        className="text-text-dim hover:text-text"
      >
        <ExternalLink className="w-3 h-3" />
      </a>
    </span>
  );
}
