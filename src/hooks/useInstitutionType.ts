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

    if (!institutionId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionType("school");
      setOverrides({});
      setIsLoading(false);
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
