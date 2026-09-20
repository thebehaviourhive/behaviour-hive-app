"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// QA run-through, item 7 investigation, 15 Sept 2026: PrincipalSidebar
// (mounted once, from layout.tsx, for the whole principal session) and
// PrincipalBottomNav (mounted per-page, but rendered on nearly every
// principal page) each independently resolved their own userId/
// institutionId and called useSupportButtonNavSlots -- and CSS-hidden
// (lg:hidden / hidden lg:flex) is not unmounted, so BOTH poll loops ran
// simultaneously, permanently, on every principal screen: two getUser()
// calls, two institution_staff queries, two separate 5-second
// get_my_support_alert_status() intervals. Confirmed real and wasteful
// regardless of whether it's connected to item 7's own freeze (recorded
// separately, still open).
//
// Fixed by making this the ONE place that resolves userId/institutionId
// and runs the poll, mounted once from layout.tsx alongside
// PrincipalSidebar -- both consumers now read the same context instead
// of each running their own copy.
//
// Clinical director's dashboard, Step 0 recon (Sept 2026): the NAV
// itself needed to become institution-type-aware for the first time --
// PrincipalSidebar/PrincipalBottomNav had no institutionId/institutionType
// resolution mechanism of their own at all (every individual PAGE
// resolves its own via useInstitutionType(institutionId), but nothing
// above page level ever had). Extended in THIS file rather than a
// second provider, per Daniel's own instruction: this is already the
// one place that resolves institutionId for the whole principal layout,
// so institutionType is one more derived fact from a value already in
// scope here, not a second institution_staff query running alongside
// it. usePrincipalInstitutionType() is the named accessor for callers
// that only care about type -- kept distinct from
// usePrincipalSupportAlert() so a caller reading institution type isn't
// coupled to the unrelated support-alert slot by name.
interface PrincipalSupportAlertContextValue {
  alertSlot: ReactNode;
  userId: string | null;
  institutionId: string | null;
  institutionType: InstitutionType;
  overrides: VocabularyOverrides;
  isInstitutionTypeLoading: boolean;
}

const PrincipalSupportAlertContext = createContext<PrincipalSupportAlertContextValue>({
  alertSlot: null,
  userId: null,
  institutionId: null,
  institutionType: "school",
  overrides: {},
  isInstitutionTypeLoading: true,
});

export function PrincipalSupportAlertProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionType, setInstitutionType] = useState<InstitutionType>("school");
  const [overrides, setOverrides] = useState<VocabularyOverrides>({});
  const [isInstitutionTypeLoading, setIsInstitutionTypeLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    createClient()
      .auth.getUser()
      .then(({ data }) => {
        if (isMounted) setUserId(data.user?.id ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;
    createClient()
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", userId)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle()
      .then(({ data }) => {
        if (isMounted) setInstitutionId(data?.institution_id ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [userId]);

  // Same query useInstitutionType() runs per-page -- done ONCE here
  // instead, now that the nav needs it too. institutions' own SELECT
  // policy is `using (true)` and institution_vocabulary_overrides'
  // matches it, so this is safe for any authenticated caller regardless
  // of their relationship to the institution (same reasoning
  // useInstitutionType's own header already documents).
  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsInstitutionTypeLoading(true);
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
      setIsInstitutionTypeLoading(false);
    });
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  // role: null -- a principal cannot raise (raise_support_alert()'s own
  // role check is class_teacher/sna only); they can only view and
  // acknowledge, matching useSupportButtonNavSlots' own handling of a
  // null role. This is the ONLY call to this hook on the principal
  // track now.
  const { alertSlot } = useSupportButtonNavSlots({ institutionId, userId, role: null });

  return (
    <PrincipalSupportAlertContext.Provider
      value={{ alertSlot, userId, institutionId, institutionType, overrides, isInstitutionTypeLoading }}
    >
      {children}
    </PrincipalSupportAlertContext.Provider>
  );
}

export function usePrincipalSupportAlert(): PrincipalSupportAlertContextValue {
  return useContext(PrincipalSupportAlertContext);
}

export function usePrincipalInstitutionType(): {
  institutionId: string | null;
  institutionType: InstitutionType;
  overrides: VocabularyOverrides;
  isLoading: boolean;
} {
  const { institutionId, institutionType, overrides, isInstitutionTypeLoading } = useContext(PrincipalSupportAlertContext);
  return { institutionId, institutionType, overrides, isLoading: isInstitutionTypeLoading };
}
