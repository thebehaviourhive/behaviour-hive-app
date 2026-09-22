"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Extracted from ConnectedPassportsSection.tsx, 23 Sept 2026, so the
// same real write path (redeem_passport_claim_code(), unchanged --
// same RPC, same server-side rate limiting, same refusal text shown
// as-is) can live in two places: PROMINENT (a parent with zero
// passports connected -- their only way in, dashboard-level card,
// unchanged from how it always looked) and QUIET (a parent who already
// has at least one child connected -- a small text link that expands
// into the same form, moved off the dashboard onto the passport screen
// itself, per Daniel's own instruction: "most parents have one child
// in the system and it should not take dashboard space").
//
// Copy stays deliberately neutral -- never "your school", never "your
// clinic" -- matching the onboarding restructure's own standing rule:
// a code can come from either, and nothing here knows which until
// it's redeemed.
export function ClaimCodeEntry({
  variant,
  onConnected,
}: {
  variant: "prominent" | "quiet";
  onConnected?: (childName: string) => void;
}) {
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justConnectedName, setJustConnectedName] = useState<string | null>(null);
  // The quiet variant starts collapsed -- a single line of text, no
  // input visible, until tapped. The prominent variant is always
  // "expanded" (it has no collapsed state at all).
  const [isExpanded, setIsExpanded] = useState(variant === "prominent");

  async function handleConnect() {
    if (!code.trim()) return;
    setError(null);
    setJustConnectedName(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data, error: claimError } = await supabase.rpc("redeem_passport_claim_code", {
      p_code: code.trim(),
    });

    if (claimError) {
      setIsSubmitting(false);
      setError(claimError.message);
      return;
    }

    const claimed = data?.[0] ?? null;
    if (!claimed) {
      setIsSubmitting(false);
      setError("We couldn't find a passport with that code. Please check it and try again.");
      return;
    }

    setCode("");
    setJustConnectedName(claimed.child_name);
    setIsSubmitting(false);
    onConnected?.(claimed.child_name);
  }

  if (variant === "quiet" && !isExpanded) {
    return (
      <button
        type="button"
        onClick={() => setIsExpanded(true)}
        className="text-xs font-semibold text-brand-prussian-blue"
      >
        Have a code for another child? Enter it here.
      </button>
    );
  }

  const containerClassName =
    variant === "prominent" ? "rounded-2xl border border-black/5 bg-white p-4 shadow-sm" : "";

  return (
    <div className={containerClassName}>
      {variant === "prominent" ? (
        <>
          <p className="text-sm font-semibold text-brand-neutral-black">
            Enter your child&apos;s passport code
          </p>
          <p className="mt-1 text-xs text-black/50">
            You&apos;ll be given a code to link your account to your child&apos;s passport. Have a code for
            another child? Enter it here too.
          </p>
        </>
      ) : (
        <p className="text-xs font-semibold text-brand-neutral-black">
          Have a code for another child? Enter it here.
        </p>
      )}

      <div className="mt-3 flex gap-2">
        <input
          type="text"
          value={code}
          onChange={(e) => {
            setCode(e.target.value);
            setError(null);
          }}
          placeholder="e.g. SAM4821"
          autoCapitalize="characters"
          autoFocus={variant === "quiet"}
          className="min-w-0 flex-1 rounded-xl border border-black/10 bg-white px-3.5 py-2.5 text-sm uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
        <button
          type="button"
          onClick={handleConnect}
          disabled={!code.trim() || isSubmitting}
          className="flex-shrink-0 rounded-xl bg-brand-prussian-blue px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-40"
        >
          {isSubmitting ? "Connecting…" : "Connect"}
        </button>
      </div>

      {error && (
        <p role="alert" className="mt-2.5 text-xs font-medium text-red-600">
          {error}
        </p>
      )}
      {justConnectedName && (
        <p className="mt-2.5 text-xs font-medium text-green-700">
          Connected to {justConnectedName}&apos;s passport.
        </p>
      )}
    </div>
  );
}
