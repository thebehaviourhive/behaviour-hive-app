import type { SaveStatus } from "@/hooks/useFbaReport";

// Sits in the section shell's sticky header. Auto-save has no explicit
// "Save" button, so this is the only feedback a clinician gets that a
// blur actually persisted -- and, on a flaky connection, the only
// affordance to bail out of an indefinite retry loop.
export function SavedStateIndicator({
  status,
  error,
  onCancel,
}: {
  status: SaveStatus;
  error: string | null;
  onCancel: () => void;
}) {
  if (status === "saving") {
    return <span className="text-xs font-medium text-brand-neutral-black/50">Saving…</span>;
  }

  if (status === "waiting-for-connection") {
    return (
      <span className="flex items-center gap-2 text-xs font-medium text-brand-golden-brown">
        Waiting for connection…
        <button type="button" onClick={onCancel} className="underline underline-offset-2">
          Cancel
        </button>
      </span>
    );
  }

  if (status === "error") {
    return <span className="text-xs font-medium text-red-600">{error ?? "Couldn't save"}</span>;
  }

  if (status === "saved") {
    return <span className="text-xs font-medium text-green-600">Saved</span>;
  }

  return null;
}
