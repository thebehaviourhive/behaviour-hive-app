import { Save, CircleCheck, TriangleAlert } from "lucide-react";
import type { SaveStatus } from "@/hooks/useFbaReport";

// Sits in the section shell's sticky header. Auto-save has no explicit
// "Save" button, so the icon itself IS the save control: it always
// reflects the single source of truth (isDirty + the hook's saveStatus)
// and is always tappable to force-flush pending state through the exact
// same save path a blur would use -- this is deliberately one control,
// not an icon plus a separate button, so there's never a moment where
// what's shown and what tapping does could disagree.
//
// Colour is never the only differentiator between unsaved and saved:
// the icon SHAPE changes too (outline save glyph vs. a filled check),
// so the states also read correctly for colour-blind users for anyone
// zoomed in past the point where the muted-vs-green distinction is easy
// to see.
export function SavedStateIndicator({
  status,
  isDirty,
  hasLoaded,
  error,
  onFlush,
  onCancel,
}: {
  status: SaveStatus;
  // True the instant local content diverges from what's actually
  // persisted -- set on every keystroke/selection/structural edit/AFLS
  // tap, cleared only once a save that covers the LATEST change
  // actually succeeds. See changeVersionRef in the routing page.
  isDirty: boolean;
  // Before the report has loaded, status is 'idle' and isDirty is
  // false -- the same shape as "loaded, clean, nothing pending". Without
  // this, the icon would show a premature green "Saved" while the
  // skeleton loader is still up, before there's anything to have saved.
  hasLoaded: boolean;
  error: string | null;
  // Flushes whatever is currently pending (including an unblurred
  // field, since local content state already reflects every keystroke)
  // through the same saveContent/saveAfls path a blur would use.
  onFlush: () => void;
  onCancel: () => void;
}) {
  if (!hasLoaded) {
    return null;
  }

  // "waiting-for-connection" and "error" share one amber/alert
  // treatment -- both mean "we tried to persist this and couldn't" --
  // but the waiting state keeps its own Cancel affordance, since that's
  // the one case where a save could otherwise retry indefinitely.
  if (status === "waiting-for-connection" || status === "error") {
    const label = status === "waiting-for-connection" ? "Offline" : "Retry";
    const a11yLabel =
      status === "waiting-for-connection"
        ? "Waiting for connection — tap to retry saving"
        : (error ?? "Couldn't save") + " — tap to retry";
    return (
      <span className="flex items-center gap-2">
        <button
          type="button"
          onClick={onFlush}
          aria-label={a11yLabel}
          className="flex items-center gap-1.5 text-xs font-semibold text-brand-golden-brown"
        >
          <TriangleAlert className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
          {label}
        </button>
        {status === "waiting-for-connection" && (
          <button type="button" onClick={onCancel} className="text-xs font-medium text-brand-golden-brown underline underline-offset-2">
            Cancel
          </button>
        )}
      </span>
    );
  }

  // Saving is still fundamentally an unsaved state -- same washed icon,
  // same shape -- just with a pulse to show something's actively in
  // flight. It must never read as green until persistence is confirmed.
  if (status === "saving") {
    return (
      <button
        type="button"
        onClick={onFlush}
        aria-label="Saving…"
        className="flex items-center gap-1.5 text-xs font-semibold text-brand-pastel-blue"
      >
        <Save className="h-4 w-4 animate-pulse" strokeWidth={2.25} aria-hidden="true" />
        <span className="animate-pulse">Saving…</span>
      </button>
    );
  }

  if (isDirty) {
    return (
      <button
        type="button"
        onClick={onFlush}
        aria-label="Unsaved changes — tap to save now"
        className="flex items-center gap-1.5 text-xs font-semibold text-brand-pastel-blue"
      >
        <Save className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
        Save
      </button>
    );
  }

  // Nothing pending and no error -- whatever's on screen is genuinely
  // what's in the database, whether that's because a save just
  // succeeded or because nothing has been touched since the report
  // loaded (in which case it's already true by definition).
  return (
    <button
      type="button"
      onClick={onFlush}
      aria-label="Saved"
      className="flex items-center gap-1.5 text-xs font-semibold text-green-600"
    >
      <CircleCheck className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      Saved
    </button>
  );
}
