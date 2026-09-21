"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { InstitutionType } from "@/lib/institutionType";

// Director/lead clinical-work switch, 21 Sept 2026. THE FBA REMAINS
// UNTOUCHED -- this is the nav-side companion to the gate change in
// useRequireRole.ts (0266): a clinical director or lead moves between
// running their clinic and doing clinical work many times a day, so
// Daniel's own instruction was a visible switch link in BOTH the
// director's nav (PrincipalSidebar/PrincipalBottomNav, and the
// clinical_lead holding page, which has no other nav surface at all)
// and the clinician's nav (ClinicianSidebar/ClinicianBottomNav) --
// never in /more, and never shown to a plain practitioner or a school
// principal.
//
// This hook covers the director/lead -> clinician direction. The
// reverse (clinician screens -> back to director dashboard) needs no
// RPC at all -- see useDirectorSwitchBack below in this same file.
//
// institutionType is passed in, not re-fetched -- PrincipalSidebar/
// PrincipalBottomNav already resolve it via usePrincipalInstitutionType()
// for their own nav-tab selection; re-querying it here would be a
// second, redundant fetch of the same fact. A clinical_lead's own role
// can only ever exist at a clinic institution (the self-link INSERT
// policy's own type-aware gating, migration ~0203) -- so the lead
// branch never needs an institutionType check at all, only the
// director (role: "principal") branch does, since that role is reused
// identically for a school principal.
export function useClinicalWorkSwitch(institutionType: InstitutionType | null) {
  const [role, setRole] = useState<string | null>(null);
  const [isVerified, setIsVerified] = useState(false);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      if (!isMounted) return;
      const userRole = data.user?.app_metadata?.role ?? null;
      setRole(userRole);

      if (userRole === "principal" || userRole === "clinical_lead") {
        // Reuses is_verified_clinic_director_or_lead() (0266) directly
        // -- the exact same check the gate itself runs -- rather than
        // re-deriving "is this caller already verified" a second way.
        // Decides only WHERE the link points (the bootstrap screen vs.
        // the real dashboard); it is never itself an admission check.
        const { data: verified } = await supabase.rpc("is_verified_clinic_director_or_lead");
        if (!isMounted) return;
        setIsVerified(Boolean(verified));
      }

      setIsReady(true);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  const shouldShow =
    isReady && (role === "clinical_lead" || (role === "principal" && institutionType === "clinic"));

  return {
    shouldShow,
    href: isVerified ? "/clinician/dashboard" : "/clinician/specialty",
  };
}

// The reverse direction: a director or lead already admitted onto a
// clinician screen (via the widened gate) sees a link back to their
// own dashboard.
//
// FOUND LIVE PROVING THE SCHOOL-PRINCIPAL-REFUSED CASE, 21 Sept 2026:
// reaching a clinician page does NOT always prove institution type =
// clinic for a 'principal' -- /clinician/strategy-bank's own gate is
// useRequireRole(["clinician", "principal"]), which admits ANY
// principal directly (the role is literally in the array), never
// routing through the widened is_verified_clinic_director_or_lead()
// check at all. A school principal legitimately reaches that page
// (correctly refused further in by its own institution-type check,
// see strategy-bank/page.tsx) and, without this check, would have seen
// a "Director" switch-back link in the clinician nav despite never
// having done anything clinic-shaped. A clinical_lead's role, unlike
// 'principal', can only ever exist at a clinic institution (the
// self-link INSERT policy's own type-aware gating) -- so only the
// 'principal' branch needs the extra check, matching
// useClinicalWorkSwitch's own identical asymmetry above. getPostAuthRedirect()
// already has a real case for both roles (principal -> /principal/dashboard,
// clinical_lead -> /clinical-lead/dashboard) -- reused directly, not
// duplicated.
export function useDirectorSwitchBack() {
  const [role, setRole] = useState<string | null>(null);
  const [isPrincipalAtClinic, setIsPrincipalAtClinic] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data }) => {
      if (!isMounted) return;
      const userRole = data.user?.app_metadata?.role ?? null;
      setRole(userRole);

      if (userRole === "principal") {
        const { data: staffRows } = await supabase
          .from("institution_staff")
          .select("institutions(type)")
          .eq("user_id", data.user!.id)
          .is("deactivated_at", null)
          .not("approved_at", "is", null);
        if (!isMounted) return;
        setIsPrincipalAtClinic(
          (staffRows ?? []).some((row) => {
            const institution = row.institutions as unknown as { type: string } | { type: string }[] | null;
            const type = Array.isArray(institution) ? institution[0]?.type : institution?.type;
            return type === "clinic";
          })
        );
      }
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return { shouldShow: role === "clinical_lead" || (role === "principal" && isPrincipalAtClinic), role };
}
