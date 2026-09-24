"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { createClient } from "@/lib/supabase/client";

// Onboarding restructure, Sept 2026: this is the institution-code
// screen that used to sit at /role-select itself. It resolves a real
// institution, and everything after (which roles are even offered,
// what the consent copy says) follows from that institution rather than
// a self-report. Nobody picks "school" or "clinic" here -- the code
// already knows.
//
// Moved here, Sept 2026, when a plain fork (/role-select) was added in
// front of it for the confused-parent problem -- staff/school/clinic/
// respite land here after choosing "I work at..."; nothing about this
// screen's own lookup, destinations, or copy changed in the move, only
// its route and the addition of a Back control below (the only thing
// this screen didn't have anywhere to go before -- there was no "before
// it" until now).
//
// Same lookup teacher/join-institution/page.tsx's own handleJoin()
// uses (case-insensitive exact match, not a substring search), same
// two error strings -- this screen and that one now agree on what
// "not found" and "not verified yet" mean, because the previous
// version of this file inherited neither check at all (role-select
// never looked up an institution before).
export default function InstitutionCodePage() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleContinue() {
    if (!code.trim()) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { data: institution, error: lookupError } = await supabase
      .from("institutions")
      // PRD 5 Stage 1: type included so school-staff/page.tsx's own
      // role picker can call getInstitutionType() on a real value
      // (option (a) -- the caller passes it in) instead of the old
      // always-'school' stub.
      .select("id, status, type")
      .ilike("institution_code", code.trim())
      .maybeSingle();

    setIsSubmitting(false);

    if (lookupError) {
      setError(lookupError.message);
      return;
    }

    if (!institution) {
      setError("We couldn't find an institution with that code. Please check and try again.");
      return;
    }

    if (institution.status !== "verified") {
      setError("This institution hasn't been verified yet. Please try again later.");
      return;
    }

    router.push(`/role-select/school-staff?institutionId=${institution.id}&institutionType=${institution.type}`);
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Enter your organisation&apos;s code
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="mb-4 text-sm leading-relaxed text-black/60">
            Your organisation gave you a code when they set up your account. It tells us who you
            work with and what to show you.
          </p>

          <TextField
            label="Organisation code"
            type="text"
            placeholder="e.g. 7F3K9Q"
            required
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="uppercase tracking-widest"
          />

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleContinue}
            disabled={!code.trim() || isSubmitting}
            className="mt-6"
          >
            {isSubmitting ? "Checking…" : "Continue"}
          </Button>

          <button
            type="button"
            onClick={() => router.push("/role-select/no-code")}
            className="mt-4 w-full text-center text-sm font-semibold text-brand-prussian-blue"
          >
            I don&apos;t have a code, or I&apos;m a parent
          </button>

          <button
            type="button"
            onClick={() => router.push("/role-select")}
            className="mt-5 w-full text-center text-xs font-semibold text-brand-prussian-blue"
          >
            Back
          </button>
        </div>
      </div>
    </main>
  );
}
