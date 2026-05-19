import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  Open: 'bg-accent-2/15 text-accent-2 border-accent-2/30',
  Funded: 'bg-warn/15 text-warn border-warn/30',
  Submitted: 'bg-fg-mute/10 text-fg-mute border-border-hi',
  Completed: 'bg-accent/15 text-accent border-accent/30',
  Rejected: 'bg-danger/15 text-danger border-danger/30',
  Expired: 'bg-fg-dim/10 text-fg-dim border-border',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'inline-flex items-center font-mono uppercase tracking-[0.1em] text-[10px] px-2 py-0.5 rounded border',
        STATUS_STYLES[status] ?? 'bg-fg-mute/10 text-fg-mute border-border-hi',
      )}
    >
      {status}
    </span>
  );
}
