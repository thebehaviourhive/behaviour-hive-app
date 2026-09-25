"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";

// TIER 3, item 5 of the reachability pass -- a director needs to
// generate a code to hand a respite centre. generate_institution_
// link_code_for_clinic() (0297) is atomic revoke-then-reissue -- the
// same precedent generate_passport_claim_code() already established --
// so a plain "Generate a new code" button is always safe to re-click,
// invalidating any prior unused code by construction. Deliberately NOT
// the parent-side InstitutionLinkCodeSection's own pattern of a
// separate status RPC after generating: passport_link_codes has no
// client-facing SELECT policy at all, and get_institution_link_code_
// status() is owns_passport()-gated -- parent-only, unusable here.
// "Nothing new in the database" for this build phase, so there is no
// "show your current code" state to read back; the code is shown once,
// at the moment it's generated, and the director is told plainly it
// won't be shown again.
export function ClinicLinkCodeSection({ passportId }: { passportId: string }) {
  const [code, setCode] = useState<string | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleGenerate() {
    setIsGenerating(true);
    setError(null);
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("generate_institution_link_code_for_clinic", {
      p_passport_id: passportId,
    });
    setIsGenerating(false);
    if (err) {
      setError(err.message);
      return;
    }
    setCode(data as string);
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
        Respite centre link code
      </h2>
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="text-sm text-brand-neutral-black/70">
          Generate a code to hand a respite centre, so they can link this child to a stay without you sharing
          anything clinical.
        </p>

        {code && (
          <div className="mt-3 rounded-xl bg-brand-off-white/60 p-3 text-center">
            <p className="text-2xl font-bold tracking-widest text-brand-neutral-black">{code}</p>
            <p className="mt-1 text-xs text-black/50">
              Shown once -- write it down or share it with the centre now. Generating a new code invalidates this
              one if it hasn&apos;t been used yet.
            </p>
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-red-600">
            {error}
          </p>
        )}

        <button
          type="button"
          onClick={handleGenerate}
          disabled={isGenerating}
          className="mt-3 w-full rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
        >
          {isGenerating ? "Generating…" : code ? "Generate a new code" : "Generate a code"}
        </button>
      </div>
    </section>
  );
}
