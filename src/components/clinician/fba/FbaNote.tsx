// Small informational note box for the placeholder states named in the
// brief -- QABF/MAS results pending completion, ABC integration "coming
// in the next update", Finalize arriving later. Softer than
// InlineErrorState (this isn't a failure), warmer than a bare paragraph.
export function FbaNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-brand-pastel-blue/40 bg-brand-pastel-blue/10 p-4">
      <p className="text-sm text-brand-neutral-black/70">{children}</p>
    </div>
  );
}
