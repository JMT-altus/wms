import { Skeleton } from "@/components/ui/skeleton";
import { PageBuffering } from "@/components/ui/spinner";

/**
 * Loading state for every Forms page: the heading, a filter row and a table
 * outline paint at once, so a slow ledger query never leaves the previous
 * screen looking frozen. The rail and header come from the layout and stay put.
 */
export default function FormsLoading() {
  return (
    <div aria-busy="true">
      <div className="mb-6">
        <Skeleton className="h-3 w-24 mb-3" />
        <Skeleton className="h-10 w-72" />
        <Skeleton className="h-4 w-[480px] max-w-full mt-3" />
      </div>
      <div className="rounded-section bg-surface-card p-5" style={{ border: "1px solid var(--color-hairline)" }}>
        <div className="mb-5 flex items-center gap-2 flex-wrap">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-36" />
          ))}
        </div>
        <div className="rounded-xl overflow-hidden" style={{ border: "1px solid var(--color-hairline)" }}>
          <Skeleton className="h-9 w-full rounded-none" />
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-11 w-full rounded-none border-t border-[color:var(--color-hairline,#e5e7eb)]" />
          ))}
        </div>
      </div>
      <PageBuffering label="Loading…" />
    </div>
  );
}
