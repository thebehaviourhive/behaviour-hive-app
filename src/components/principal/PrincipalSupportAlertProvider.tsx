"use client";

import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useSupportButtonNavSlots } from "@/hooks/useSupportButtonNavSlots";

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
interface PrincipalSupportAlertContextValue {
  alertSlot: ReactNode;
  userId: string | null;
}

const PrincipalSupportAlertContext = createContext<PrincipalSupportAlertContextValue>({
  alertSlot: null,
  userId: null,
});

export function PrincipalSupportAlertProvider({ children }: { children: ReactNode }) {
  const [userId, setUserId] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);

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

  // role: null -- a principal cannot raise (raise_support_alert()'s own
  // role check is class_teacher/sna only); they can only view and
  // acknowledge, matching useSupportButtonNavSlots' own handling of a
  // null role. This is the ONLY call to this hook on the principal
  // track now.
  const { alertSlot } = useSupportButtonNavSlots({ institutionId, userId, role: null });

  return (
    <PrincipalSupportAlertContext.Provider value={{ alertSlot, userId }}>
      {children}
    </PrincipalSupportAlertContext.Provider>
  );
}

export function usePrincipalSupportAlert(): PrincipalSupportAlertContextValue {
  return useContext(PrincipalSupportAlertContext);
}
