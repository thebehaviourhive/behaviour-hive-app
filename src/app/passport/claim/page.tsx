"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

// PRD 1, Stage 5, Step 3, Requirement 4. One-shot flow, same shape as
// AddChildSheet.tsx's own lookup_passport_by_code() convention (0116's
// own comment names this file explicitly as the precedent):
// redeem_passport_claim_code() both validates AND claims in the same
// call -- there is no separate "preview, then confirm" step server-side,
// so this screen doesn't invent one. What IS a genuine confirmation is
// the RETURNED child_name -- minimal disclosure (first name + last
// initial, the RPC's own v_display_name), shown only after a successful
// claim, never before -- a wrong code never discloses whose child it
// belonged to.
//
// Every refusal message below is redeem_passport_claim_code()'s own
// thrown exception text, shown as-is -- already specific, honest, and
// actionable (0114/0115/0116's own design), not re-worded here. The one
// exception is "not found": that case is a deliberate ZERO-ROW SUCCESS,
// not a thrown error (0116's own fix, so the rate-limit insert ahead of
// it survives) -- this screen supplies its own copy for that one case.
export default function PassportClaimPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("parent");
  const [code, setCode] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [claimedChildName, setClaimedChildName] = useState<string | null>(null);
  // Tier 1 item 4, 21 Sept 2026 -- unknown until AFTER a successful
  // claim (a code could belong to either a school or a clinic; nothing
  // before the claim resolves it), so the pre-lookup copy stays
  // deliberately neutral, matching /role-select's own established
  // "organisation" wording for the identical not-yet-known case. The
  // success screen resolves the real institution(s) this passport is
  // now linked to, exactly once, to say something true instead.
  const [isClinicOnly, setIsClinicOnly] = useState(false);

  async function handleClaim() {
    if (!code.trim()) return;

    setError(null);
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
      setError(
        "We couldn't find a passport with that code. Please check with them and try again."
      );
      return;
    }

    const { data: linkRows } = await supabase
      .from("passport_institution_links")
      .select("institution_id")
      .eq("passport_id", claimed.passport_id);
    const institutionIds = Array.from(new Set((linkRows ?? []).map((r) => r.institution_id)));
    if (institutionIds.length > 0) {
      const { data: institutionRows } = await supabase.from("institutions").select("type").in("id", institutionIds);
      const types = new Set((institutionRows ?? []).map((r) => r.type as string));
      setIsClinicOnly(types.has("clinic") && !types.has("school"));
    }

    setIsSubmitting(false);
    setClaimedChildName(claimed.child_name);
  }

  if (!isReady) {
    return null;
  }

  if (claimedChildName) {
    return (
      <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
        <div className="w-full max-w-sm text-center">
          <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
            <span
              aria-hidden
              className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-100 text-3xl"
            >
              ✅
            </span>
            <h1 className="font-heading text-xl font-semibold text-brand-neutral-black">
              You now have access to {claimedChildName}&apos;s passport
            </h1>
            <p className="mt-2 text-sm leading-relaxed text-black/60">
              {isClinicOnly
                ? "You'll see everything your clinic's own team has already added, and you can pick up wherever they left off."
                : "You'll see everything the school and clinical team have already added, and you can pick up wherever they left off."}
            </p>
            <Button
              type="button"
              onClick={() => router.push("/passport/dashboard")}
              className="mt-6"
            >
              Go to {claimedChildName}&apos;s passport
            </Button>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            Enter your code
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <p className="text-sm leading-relaxed text-black/70">
            Your child&apos;s organisation gave you a code to link your
            account to the record they&apos;ve already started.
          </p>

          <label className="mt-5 block text-left text-sm font-semibold text-brand-neutral-black">
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

          <Button
            type="button"
            onClick={handleClaim}
            disabled={!code.trim() || isSubmitting}
            className="mt-5"
          >
            {isSubmitting ? "Checking…" : "Claim passport"}
          </Button>

          {/* Stage 2, 15 Sept 2026: self-creation retired -- there is no
              longer an alternative path this could route to, so this is
              now explanatory copy, not a link. Every family gets their
              code from their child's organisation. Deliberately neutral
              -- a code can come from either a school or a clinic, and
              nothing here yet knows which. */}
          <p className="mt-4 text-sm text-black/50">
            Don&apos;t have a code? Ask your child&apos;s organisation --
            they can generate one for you.
          </p>
        </div>
      </div>
    </main>
  );
}
