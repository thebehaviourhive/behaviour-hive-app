"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// PRD 5 Stage 1. For any passport/child-scoped surface (ABC logger,
// FBA sections, the parent's own team card) -- these know a
// passportId, never an institutionId directly. Wraps
// get_passport_institution_vocabulary() (migration 0201), a SECURITY
// DEFINER RPC for the same reason get_approved_institution_phone()
// (0182) already is one: enrolments' own SELECT policy is staff-only,
// so a parent or clinician session reading it directly would get
// nothing back, RLS-silent.
export function usePassportInstitutionVocabulary(passportId: string | null | undefined) {
  const [institutionType, setInstitutionType] = useState<InstitutionType>("school");
  const [overrides, setOverrides] = useState<VocabularyOverrides>({});
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    if (!passportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setInstitutionType("school");
      setOverrides({});
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    const supabase = createClient();

    supabase
      .rpc("get_passport_institution_vocabulary", { p_passport_id: passportId })
      .then(({ data }) => {
        if (!isMounted) return;
        const result = data as { type?: InstitutionType; overrides?: VocabularyOverrides } | null;
        setInstitutionType(result?.type ?? "school");
        setOverrides(result?.overrides ?? {});
        setIsLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { institutionType, overrides, isLoading };
}
