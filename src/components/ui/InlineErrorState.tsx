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
    <div className="rounded-xl border-2 border-dashed border-brand-golden-brown/40 bg-brand-golden-brown/10 p-4 text-center">
      <p className="mb-2 font-sans text-sm text-brand-golden-brown">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="font-sans text-sm font-bold text-brand-golden-brown underline underline-offset-2"
      >
        Tap to retry
      </button>
    </div>
  );
}
