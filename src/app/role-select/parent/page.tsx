"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";

// Onboarding, Sept 2026: the parent branch of the new pre-code fork
// (/role-select). A parent's code is a CLAIM code, given to them by
// their child's school or clinic -- a different thing from the
// organisation code staff enter one screen over, and conflating the
// two under one text field was the original confusion this whole
// fork exists to fix.
//
// redeem_passport_claim_code() is identity-gated only (auth.uid() is
// null -> refused; nothing else) -- confirmed by reading its live body
// (0116) before building this, not assumed. So it's safe to call here,
// before role is set and before consent, the same way the institution
// branch resolves a real institution before any role exists yet.
// consent/page.tsx's own institutionType resolution for a parent
// already reads passport_guardians rows and explicitly anticipates a
// guardian row existing before consent -- claiming here first means
// that screen shows the right copy (school vs clinic) the very first
// time a parent sees it, rather than the generic fallback.
//
// Role is set FIRST, same order the institution branch's own role-tile
// picker uses (role, then the joining action) -- /api/set-role is a
// plain idempotent overwrite, safe to repeat on a retry.
//
// No code yet: NOT a dead end, and NOT a route back to self-created-
// passport creation (retired -- see CLAUDE.md, PRD 3/self-creation
// entries). Explains plainly that the school or clinic creates the
// record and issues the code, then continues on exactly like a parent
// who claimed successfully would -- straight to consent, landing on an
// empty (but genuine, not broken) dashboard with the same working
// claim prompt (/passport/welcome -> /passport/claim) they'd reach
// naturally from there once they do have one.
export default function ParentOnboardingPage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showNoCode, setShowNoCode] = useState(false);

  async function setParentRole(): Promise<boolean> {
    const response = await fetch("/api/set-role", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role: "parent" }),
    });

    if (!response.ok) {
      setError("Something went wrong. Please try again.");
      return false;
    }

    // Same reason role-select/institution's own flow refreshes the
    // session: the access token still carries the old (missing) role
    // claim until refreshed, and the claim RPC below runs as this user.
    const supabase = createClient();
    await supabase.auth.refreshSession();
    return true;
  }

  async function handleClaim() {
    if (!code.trim() || isSubmitting) return;

    setError(null);
    setIsSubmitting(true);

    if (!(await setParentRole())) {
      setIsSubmitting(false);
      return;
    }

    const supabase = createClient();
    const { data, error: claimError } = await supabase.rpc("redeem_passport_claim_code", {
      p_code: code.trim(),
    });

    setIsSubmitting(false);

    if (claimError) {
      // Already claimed by this same account -- not a failure, an
      // earlier attempt (this session or a prior one) already worked.
      // Treat it the same as a fresh success rather than alarming
      // someone who did nothing wrong.
      if (claimError.message.includes("already have access")) {
        router.push("/consent");
        return;
      }
      setError(claimError.message);
      return;
    }

    const claimed = data?.[0] ?? null;

    if (!claimed) {
      setError("We couldn't find a passport with that code. Please check with them and try again.");
      return;
    }

    router.push("/consent");
  }

  async function handleContinueWithoutCode() {
    if (isSubmitting) return;
    setError(null);
    setIsSubmitting(true);
    if (await setParentRole()) {
      router.push("/consent");
      return;
    }
    setIsSubmitting(false);
  }

  if (showNoCode) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex flex-col items-center gap-3 text-center">
            <BrandMark />
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
              No code yet? That&apos;s alright
            </h1>
          </div>

          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <p className="text-sm leading-relaxed text-black/70">
              Your child&apos;s school or clinic creates their record and gives you a code to link
              your account to it. If you haven&apos;t received one, ask them for it -- you
              haven&apos;t done anything wrong, this is simply how families are added.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-black/60">
              You can carry on for now, and add the code as soon as you have it.
            </p>

            {error && (
              <p role="alert" className="mt-4 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <Button type="button" onClick={handleContinueWithoutCode} disabled={isSubmitting} className="mt-5">
              {isSubmitting ? "Continuing…" : "Continue"}
            </Button>

            <button
              type="button"
              onClick={() => {
                setShowNoCode(false);
                setError(null);
              }}
              disabled={isSubmitting}
              className="mt-4 w-full text-center text-sm font-semibold text-brand-prussian-blue disabled:opacity-60"
            >
              I actually have a code
            </button>

            <button
              type="button"
              onClick={() => router.push("/role-select")}
              disabled={isSubmitting}
              className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-60"
            >
              Back
            </button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Enter your child&apos;s code
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            Your child&apos;s school or clinic gave you this code to link your account to the
            record they&apos;ve already started.
          </p>

          <label className="block text-left text-sm font-semibold text-brand-neutral-black">
            Claim code
          </label>
          <input
            type="text"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. SAM4821"
            autoCapitalize="characters"
            className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />

          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button type="button" onClick={handleClaim} disabled={!code.trim() || isSubmitting} className="mt-5">
            {isSubmitting ? "Checking…" : "Continue"}
          </Button>

          <button
            type="button"
            onClick={() => setShowNoCode(true)}
            disabled={isSubmitting}
            className="mt-4 w-full text-center text-sm font-semibold text-brand-prussian-blue disabled:opacity-60"
          >
            I don&apos;t have a code
          </button>

          <button
            type="button"
            onClick={() => router.push("/role-select")}
            disabled={isSubmitting}
            className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-60"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
