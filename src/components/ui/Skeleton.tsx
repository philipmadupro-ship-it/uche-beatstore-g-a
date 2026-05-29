/**
 * Skeleton primitives — reusable loading placeholders that replace
 * full-page spinners. Uses the `.skeleton-shimmer` sweep from globals.css.
 *
 * Pattern: render a layout that mirrors the real content's shape so the
 * page doesn't reflow when data lands (cumulative layout shift = 0).
 */

import { cn } from '@/lib/utils';

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn('skeleton-shimmer rounded-lg', className)} />;
}

/** A row of KPI stat cards — used on sales / analytics headers. */
export function SkeletonStatStrip({ count = 4 }: { count?: number }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mb-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-xl border border-[#1f1a13] bg-[#14110d] px-4 py-3">
          <Skeleton className="h-2.5 w-12 mb-2" />
          <Skeleton className="h-5 w-16" />
        </div>
      ))}
    </div>
  );
}

/** A horizontal row of square cover cards — mirrors a home/library row. */
export function SkeletonCardRow({ count = 6 }: { count?: number }) {
  return (
    <div className="space-y-2.5">
      <Skeleton className="h-3 w-32" />
      <div className="flex gap-2.5 overflow-hidden">
        {Array.from({ length: count }).map((_, i) => (
          <div key={i} className="shrink-0 w-[130px] sm:w-[150px]">
            <Skeleton className="w-full aspect-square rounded-xl mb-2" />
            <Skeleton className="h-2.5 w-3/4 mb-1.5" />
            <Skeleton className="h-2 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** A vertical list of rows — mirrors a table/list view. */
export function SkeletonList({ rows = 8 }: { rows?: number }) {
  return (
    <div className="rounded-2xl border border-[#1f1a13] bg-[#14110d] divide-y divide-[#1a160f] overflow-hidden">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="w-9 h-9 rounded-md shrink-0" />
          <div className="flex-1 min-w-0">
            <Skeleton className="h-3 w-1/3 mb-1.5" />
            <Skeleton className="h-2 w-1/5" />
          </div>
          <Skeleton className="h-3 w-12" />
        </div>
      ))}
    </div>
  );
}
