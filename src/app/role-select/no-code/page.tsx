"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { createClient } from "@/lib/supabase/client";

// Onboarding restructure, Sept 2026: the second route off role-select
// ("I don't have a code, or I'm a parent"). Two real, self-service
// paths live here today -- a parent (the claim-code gate lives later,
// from their own dashboard) and an independent clinician (self-
// verifying via PSI/CORU/BACB, never tied to an institution -- see
// this file's own onboarding-restructure plan for why institution-
// employed clinician joining is deliberately NOT built here, staying
// the manual/parked path it already is). Anyone else lands on plain,
// neutral copy -- never "school", never "clinic": which organisation
// someone's employer or a clinic is not this screen's business, only
// that they need a code from whoever runs it.
type Choice = "parent" | "clinician";

export default function NoCodeRoleSelectPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState<Choice | null>(null);

  async function handleSelect(choice: Choice) {
    if (submitting) return;

    setError(null);
    setSubmitting(choice);

    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: choice === "parent" ? "parent" : "clinician" }),
    });

    if (!response.ok) {
      const { error: responseError } = await response.json().catch(() => ({ error: null }));
      setSubmitting(null);
      setError(responseError ?? "Something went wrong. Please try again.");
      return;
    }

    // Same reason role-select's own handleContinue and school-staff's
    // handleSelect already refresh the session: the access token still
    // carries the old (missing) role claim until refreshed, and the
    // very next screen reads it.
    const supabase = createClient();
    await supabase.auth.refreshSession();

    router.push(choice === "parent" ? "/consent" : "/clinician/specialty");
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
              onClick={() => handleSelect("parent")}
              disabled={submitting !== null}
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
              {submitting === "parent" && (
                <span className="text-xs font-medium text-brand-prussian-blue">Saving…</span>
              )}
            </button>

            <button
              type="button"
              onClick={() => handleSelect("clinician")}
              disabled={submitting !== null}
              className="flex items-center gap-3 rounded-2xl border border-black/10 bg-white p-3 text-left transition-colors hover:bg-black/[0.02] disabled:opacity-60"
            >
              <span
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
                aria-hidden
              >
                🧠
              </span>
              <span className="flex-1">
                <span className="block text-sm font-semibold text-brand-neutral-black">
                  I&apos;m a clinician
                </span>
                <span className="block text-xs text-black/50">
                  Independent practitioner -- BCBA, psychologist, OT, SLT or GP, not tied to an
                  organisation
                </span>
              </span>
              {submitting === "clinician" && (
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
            disabled={submitting !== null}
            className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-60"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
