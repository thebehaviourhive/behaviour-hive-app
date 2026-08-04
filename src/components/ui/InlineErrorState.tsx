// Shared "this failed to load" state for read-only list/card views, so a
// real fetch or RLS error renders as a distinguishable failure rather
// than silently falling through to the same empty state shown when there
// genuinely is no data yet.
export function InlineErrorState({
  message = "Couldn't load. Please try again.",
  onRetry,
}: {
  message?: string;
  onRetry: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <div className="rounded-xl border-2 border-dashed border-red-200 bg-red-50/40 p-4 text-center">
      <p className="mb-2 font-sans text-sm text-red-700">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans text-sm font-bold text-red-700 underline underline-offset-2"
      >
        Tap to retry
      </button>
    </div>
  );
}
