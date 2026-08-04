// Shared offline-retry helper used by the teacher EOD wizard and the
// strategy ledger sheet: both submit a single insert that should never
// crash or clear the parent's/teacher's in-progress form if connectivity
// drops mid-submit, and should resume automatically once it's back.

export function isNetworkError(error: unknown): boolean {
  if (typeof navigator !== "undefined" && !navigator.onLine) return true;
  if (!error) return false;
  const message = error instanceof Error ? error.message : String(error);
  return /fetch|network/i.test(message);
}

export function waitForReconnect(signal?: AbortSignal): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    function cleanup() {
      window.removeEventListener("online", handleOnline);
      signal?.removeEventListener("abort", handleAbort);
    }
    function handleOnline() {
      cleanup();
      resolve();
    }
    function handleAbort() {
      cleanup();
      resolve();
    }
    window.addEventListener("online", handleOnline);
    signal?.addEventListener("abort", handleAbort);
  });
}

// Retries `attempt` forever whenever it fails with what looks like a
// connectivity problem, waiting for the browser's `online` event between
// tries. Any other kind of failure (validation, RLS, etc.) is returned
// immediately instead of retried. Passing `signal` lets the caller give
// the user a way out of an indefinite wait -- aborting resolves with
// "cancelled" instead of retrying again.
export async function insertWithOfflineRetry(
  attempt: () => PromiseLike<{ error: { message: string } | null }>,
  onStatusChange: (status: "saving" | "waiting-for-connection") => void,
  signal?: AbortSignal
): Promise<string | null | "cancelled"> {
  for (;;) {
    if (signal?.aborted) return "cancelled";
    onStatusChange("saving");
    try {
      const { error } = await attempt();
      if (!error) return null;
      if (!isNetworkError(error)) return error.message;
    } catch (err) {
      if (!isNetworkError(err)) {
        return err instanceof Error ? err.message : "Something went wrong.";
      }
    }
    if (signal?.aborted) return "cancelled";
    onStatusChange("waiting-for-connection");
    await waitForReconnect(signal);
  }
}
