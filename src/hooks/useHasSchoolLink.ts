import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Finding 1, 22 Sept 2026 -- PassportProgress's own "Everyone working
// with your child at school can read this." is hardcoded across all
// ten Section A-E call sites, false for a clinic-only family. Defaults
// true (the overwhelming majority of real accounts today, and never
// worse than what shipped before this fix -- same posture Tier 1 item
// 4 already established for the identical shape on /messages and the
// consent screen). passport_institution_links' own SELECT policy
// already admits the owning parent directly (owns_passport(), 0014) --
// a raw client query is safe here, unlike the director-side equivalent
// (get_passport_has_school_link, 0265), which exists specifically
// because a STAFF caller's own read is scoped to their own institution
// only, not because parents need it too.
export function useHasSchoolLink(passportId: string | null): boolean {
  const [hasSchoolLink, setHasSchoolLink] = useState(true);

  useEffect(() => {
    if (!passportId) return;
    let isMounted = true;
    createClient()
      .from("passport_institution_links")
      .select("institutions(type)")
      .eq("passport_id", passportId)
      .then(({ data }) => {
        if (!isMounted) return;
        setHasSchoolLink(
          (data ?? []).some((row) => {
            const institution = row.institutions as unknown as { type: string } | { type: string }[] | null;
            const type = Array.isArray(institution) ? institution[0]?.type : institution?.type;
            return type === "school";
          })
        );
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return hasSchoolLink;
}
