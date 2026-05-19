import { Star } from 'lucide-react';
import { cn } from '@/lib/utils';

export function ReputationStars({ score }: { score: string | null }) {
  if (score === null)
    return <span className="text-text-dim text-sm">No reputation yet</span>;

  const num = parseFloat(score);
  if (isNaN(num))
    return <span className="text-text-dim text-sm">—</span>;

  const stars = Math.round((num / 100) * 5);

  return (
    <span className="inline-flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star
          key={i}
          className={cn(
            'w-4 h-4',
            i <= stars ? 'fill-warning text-warning' : 'text-text-dim',
          )}
        />
      ))}
      <span className="font-mono text-sm ml-1">{num.toFixed(1)}</span>
    </span>
  );
}
