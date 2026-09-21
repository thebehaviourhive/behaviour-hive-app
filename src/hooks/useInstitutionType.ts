"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// PRD 5 Stage 1. For any surface that already has an institutionId in
// hand (StaffList/StaffDetail/ChildDetail already receive it as a prop
// today, per the Directory split view's own established threading) --
// resolves institutions.type plus that institution's own vocabulary
// overrides in one call. institutions' own SELECT policy is
// `using (true)` and institution_vocabulary_overrides' read policy
// matches it -- both readable by any authenticated user regardless of
// their own relationship to the institution, so this never needs a
// SECURITY DEFINER RPC the way the passport-scoped resolver does.
export function useInstitutionType(institutionId: string | null) {
  const [institutionType, setInstitutionType] = useState<InstitutionType>("school");
  const [overrides, setOverrides] = useState<VocabularyOverrides>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    // FOUND LIVE, 21 Sept 2026, twice in one session (useClinicianReviewState
    // had the identical defect, fixed separately): a null institutionId is a
    // PENDING state, not a resolved one -- every real caller starts with
    // institutionId = null and fills it in from its own async fetch, so
    // "no id yet" means "don't know the type yet," never "this is a school."
    // The previous version resolved null to {type: "school", isLoading:
    // false} -- a genuine "done" signal, not a placeholder -- which meant
    // any effect gating on isLoading (PrincipalClinicPage's own redirect
    // guard, the one that sent every clinic director to /principal/school)
    // could fire on the ONE stale render frame between institutionId
    // arriving and this hook's own fetch for the REAL id completing.
    // Every other caller never checked isLoading at all, so they only ever
    // flashed the wrong content for a frame (usually invisible, hidden
    // behind their own loading skeleton) -- this page's redirect was the
    // one place a stale render turned into a side effect that outlives the
    // render it happened on. Fix: null now means "still loading," full
    // stop -- institutionType stays at its safe default, but isLoading
    // stays true until there is a real id to resolve or the caller stops
    // asking (unmounts). A caller with a GENUINELY permanent null
    // institutionId (none exist in this codebase today -- every real
    // caller's own institutionId eventually resolves from its own fetch)
    // would need its own handling; this hook no longer manufactures a
    // false "resolved to school" answer to cover that case.
    if (!institutionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionType("school");
      setOverrides({});
      setIsLoading(true);
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    Promise.all([
      supabase.from("institutions").select("type").eq("id", institutionId).maybeSingle(),
      supabase.from("institution_vocabulary_overrides").select("key, value").eq("institution_id", institutionId),
    ]).then(([institutionResult, overridesResult]) => {
      if (!isMounted) return;

      setInstitutionType((institutionResult.data?.type as InstitutionType | undefined) ?? "school");

      const overrideMap: VocabularyOverrides = {};
      for (const row of overridesResult.data ?? []) {
        overrideMap[row.key] = row.value;
      }
      setOverrides(overrideMap);
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  return { institutionType, overrides, isLoading };
}
