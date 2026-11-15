export default function Loading() {
  return (
    <div aria-busy="true" aria-live="polite" className="animate-pulse">
      <div className="mb-2 h-6 w-48 rounded-md bg-surface-3" />
      <div className="mb-8 h-4 w-72 rounded-md bg-surface-2" />
      <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => <div key={i} className="h-28 rounded-2xl border border-line bg-surface" />)}
      </div>
      <div className="h-72 rounded-2xl border border-line bg-surface" />
    </div>
  );
}
