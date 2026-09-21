"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useInstitutionType } from "@/hooks/useInstitutionType";

// Tier 1 item 5 of the clinic UI layer build, 21 Sept 2026. Incidents,
// Term Overview, and a class's own detail are all real only for a
// school -- a class is a school-day grouping of enrolled pupils, and
// the incident-log module (CPI/restraint records, countersigning) has
// no clinic equivalent at all (CLAUDE.md's own Directory recon: "a
// clinic's own caseload assignment already lives in the Clinicians
// segment", the identical reasoning that already hides these same
// three concepts from Directory's own segment list for a clinic
// institution). Directory hides the SEGMENT; this hook guards the
// ROUTE itself, so a clinic director can't reach the same dead
// surface by a direct URL, a bookmark, or the back button -- Daniel's
// own framing: "unreachable, not merely hidden."
//
// Redirects ONLY once institutionType has genuinely resolved to
// 'clinic' -- never while still loading (institutionType's own null-
// means-pending fix, 21 Sept 2026, is exactly what makes this safe: a
// stale render frame here would wrongly bounce a real school principal
// for one tick).
export function useGuardSchoolOnlyRoute(userId: string | null | undefined, redirectTo: string) {
  const router = useRouter();
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const { institutionType, isLoading } = useInstitutionType(institutionId);
  const [isResolvingInstitution, setIsResolvingInstitution] = useState(true);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", userId)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle()
      .then(({ data }) => {
        if (!isMounted) return;
        setInstitutionId(data?.institution_id ?? null);
        setIsResolvingInstitution(false);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  useEffect(() => {
    if (isResolvingInstitution || isLoading) return;
    if (institutionType === "clinic") {
      router.replace(redirectTo);
    }
  }, [isResolvingInstitution, isLoading, institutionType, redirectTo, router]);

  const isBlocked = !isResolvingInstitution && !isLoading && institutionType === "clinic";
  const isChecking = isResolvingInstitution || isLoading;

  return { isChecking, isBlocked };
}
