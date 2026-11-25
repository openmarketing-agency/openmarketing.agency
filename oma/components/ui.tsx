/** Streams a shared loading state while the console resolves request-time content. */

import { Skeleton } from "@/components/ui/skeleton";

export function Loading({ label }: { label: string }) {
  return (
    <div className="page-content console-loading" role="status">
      <span className="sr-only">{label}</span>
      <Skeleton className="loading-title" aria-hidden="true" />
      <Skeleton className="loading-line" aria-hidden="true" />
      <div className="loading-panel" aria-hidden="true">
        <Skeleton className="loading-line" />
        <Skeleton className="loading-line" />
      </div>
    </div>
  );
}
