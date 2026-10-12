export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />
}

export function ScreenSkeleton() {
  return (
    <div
      className="screen-skeleton"
      role="status"
      aria-label="Pobieranie danych"
    >
      <div className="stats-grid">
        <Skeleton />
        <Skeleton />
        <Skeleton />
      </div>
      <Skeleton className="skeleton-large" />
      <Skeleton className="skeleton-large" />
      <span className="sr-only">Pobieranie danych…</span>
    </div>
  )
}
