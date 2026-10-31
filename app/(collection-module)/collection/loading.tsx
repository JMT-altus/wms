import { Skeleton } from "@/components/ui/skeleton";
import { PageBuffering } from "@/components/ui/spinner";

/**
 * Loading state for every Collection page (Tracker, Dashboard, Master, Commitments
 * & Escalations). These pages read the whole company list on each request, so a
 * moment passes before anything paints; this shows the page's shape instead of a
 * frozen previous screen. Scoped to the Collection routes only.
 */
export default function CollectionLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-4">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-40" />
        ))}
      </div>
      <div className="overflow-hidden rounded-section border border-[color:var(--color-hairline,#e5e7eb)]">
        <Skeleton className="h-10 w-full rounded-none" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-none border-t border-[color:var(--color-hairline,#e5e7eb)]" />
        ))}
      </div>
      <PageBuffering label="Loading…" />
    </div>
  );
}
