"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";

// Onboarding restructure, Sept 2026, corrected same day per Daniel's
// own model correction: THERE IS NO INDEPENDENT CLINICIAN. Every
// clinician belongs to an organisation -- a school's in-house BCBA and
// a clinic's practitioners both join by their organisation's code (the
// same top-level /role-select entry every school-staff role uses); a
// clinical director gets a code from us directly, the same manual gate
// an institution's first principal goes through. A self-service
// "I'm a clinician, no organisation" tile contradicted that model and
// would have been something to police later -- removed.
//
// This screen is now PARENT ONLY. The specialty-then-verify path at
// /clinician/specialty -- the one real clinician onboarding that
// exists today, used by the trial school's own psychologist, approved
// manually via approve_clinician() -- is NOT deleted and still works
// exactly as before. It's just no longer reachable by tapping a tile
// here: reaching it now requires app_metadata.role already being
// "clinician", which nothing in this app's own UI sets any more (see
// /api/set-role's own comment -- "clinician" was deliberately dropped
// from its self-service allow-list in the same change). Getting a
// specific, vetted person into that state is a manual, one-off
// Behaviour Hive operation -- scripts/admin/set-clinician-role.mjs --
// matching the precedent already established for institution creation
// itself (CLAUDE.md: "institution creation being manual is
// deliberate"). Once set, their very next sign-in lands them on
// /clinician/specialty automatically, via the same
// resolveOnboardingDestination()/useRequireRole gating every other
// role already goes through -- no separate UI page needed.
//
// The copy below stays exactly as neutral as before this correction --
// never "school", never "clinic": which organisation someone's
// employer or a clinic is not this screen's business, only that they
// need a code from whoever runs it.
export default function NoCodeRoleSelectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSelectParent() {
    if (submitting) return;

    setError(null);
    setSubmitting(true);

    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "parent" }),
    });

    if (!response.ok) {
      const { error: responseError } = await response.json().catch(() => ({ error: null }));
      setSubmitting(false);
      setError(responseError ?? "Something went wrong. Please try again.");
      return;
    }

    // Same reason role-select's own handleContinue and school-staff's
    // handleSelect already refresh the session: the access token still
    // carries the old (missing) role claim until refreshed, and the
    // very next screen reads it.
    const supabase = createClient();
    await supabase.auth.refreshSession();

    router.push("/consent");
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Who are you?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <div className="flex flex-col gap-3">
            <button
              type="button"
              onClick={handleSelectParent}
              disabled={submitting}
              className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02] disabled:opacity-60"
            >
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                aria-hidden
              >
                ❤
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-brand-neutral-black">
                  Parent or carer
                </span>
                <span className="block text-xs text-black/50">
                  Building a passport for my child
                </span>
              </span>
              {submitting && (
                <span className="text-xs font-medium text-brand-prussian-blue">Saving…</span>
              )}
            </button>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <p className="mt-5 text-sm leading-relaxed text-black/50">
            If your organisation gave you a code, go back and enter it. If you&apos;re not sure,
            contact your organisation&apos;s administrator.
          </p>

          <button
            type="button"
            onClick={() => router.push("/role-select")}
            disabled={submitting}
            className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-60"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
