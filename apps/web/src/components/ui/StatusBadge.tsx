import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

const STATUS_STYLES: Record<string, string> = {
  Open: 'bg-blue-500/10 text-blue-400 border-blue-500/30',
  Funded: 'bg-amber-500/10 text-amber-400 border-amber-500/30',
  Submitted: 'bg-purple-500/10 text-purple-400 border-purple-500/30',
  Completed: 'bg-success/10 text-success border-success/30',
  Rejected: 'bg-danger/10 text-danger border-danger/30',
  Expired: 'bg-text-dim/10 text-text-dim border-text-dim/30',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <Badge
      variant="outline"
      className={cn('font-mono text-xs', STATUS_STYLES[status] ?? '')}
    >
      {status}
    </Badge>
  );
}
