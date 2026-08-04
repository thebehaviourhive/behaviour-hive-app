// supabase-js's AuthError parsing doesn't recognize every error response
// shape it can be handed (confirmed: a 500 with a top-level string `code`
// rather than the numeric status/error_code shape it expects) and falls
// back to an object whose `.message` stringifies to the literal text
// "{}" -- shown to the user as-is unless callers guard against it. This
// treats anything that isn't a real, non-empty, human-readable string as
// unusable and substitutes the caller's fallback instead.
export function getAuthErrorMessage(error: unknown, fallback: string): string {
  if (!error || typeof error !== "object" || !("message" in error)) {
    return fallback;
  }

  const message = (error as { message?: unknown }).message;
  if (typeof message !== "string") {
    return fallback;
  }

  const trimmed = message.trim();
  if (!trimmed || /^\{.*\}$/.test(trimmed)) {
    return fallback;
  }

  return trimmed;
}
