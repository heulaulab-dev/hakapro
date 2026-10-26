import { Skeleton } from "@/components/ui/skeleton";

/**
 * Shown the instant a navigation starts (pages render on the server, so on slow mobile data the old
 * screen would otherwise sit frozen). Same rhythm as a page: title, intro, then blocks.
 *
 * Used as `loading.tsx` only on routes that never call `notFound()`: a loading boundary streams the page, so
 * the HTTP status is committed as 200 before a 404 could be raised (the stock layout keeps its real 404).
 */
export function RouteLoading() {
  return (
    <div className="flex flex-col gap-section p-4 md:p-6" aria-busy="true" data-testid="route-loading">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-3.5 w-3/4 max-w-md" />
      </div>
      <Skeleton className="h-28 w-full rounded-xl" />
      <div className="grid grid-cols-2 gap-3">
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
      </div>
      <Skeleton className="h-56 w-full rounded-xl" />
    </div>
  );
}
