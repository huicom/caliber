import { Skeleton } from '@/components/ui/skeleton';

export function StatsSkeleton() {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="border border-border rounded-xl bg-bg-elev px-5 py-5"
        >
          <Skeleton className="h-3 w-20 mb-3" />
          <Skeleton className="h-7 w-24 mb-2" />
          <Skeleton className="h-3 w-16" />
        </div>
      ))}
    </div>
  );
}

export function TopAgentsSkeleton() {
  return (
    <div>
      <div className="flex items-baseline justify-between mb-4">
        <Skeleton className="h-3 w-24" />
        <Skeleton className="h-3 w-16" />
      </div>
      <div className="border border-border rounded-xl bg-bg-elev divide-y divide-border">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3">
            <Skeleton className="h-3 w-4" />
            <Skeleton className="h-9 w-9 rounded-md" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
            <Skeleton className="h-3 w-10" />
          </div>
        ))}
      </div>
    </div>
  );
}
