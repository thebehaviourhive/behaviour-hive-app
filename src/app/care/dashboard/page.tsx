"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { BrandMark } from "@/components/ui/BrandMark";

// PRD 11 Stage 2, item 7: care staff's own landing, matching /centre's
// posture exactly -- a real screen, not a redirect loop, honest that
// nothing is built here yet. A care worker's real job (reading a
// child's record while they're on site, ABC logs, handovers) all
// depends on the access model and activation -- Stage 3+, not this
// migration's. Nothing to invent here that would look more finished
// than it is.
//
// Care staff always join PENDING (derive_staff_join_approval() has no
// bootstrap branch for this role -- only centre_manager gets one) --
// unlike the original static version of this page, which unconditionally
// said "You're all set" regardless of approval state, a real, live
// false claim for the exact case that is this role's ordinary first
// experience. Fixed the same way this codebase has already fixed the
// identical mistake twice before (clinic_admin, clinical_lead): resolve
// approval state first, show PendingApprovalState honestly while
// waiting, never assert access nobody granted yet.
export default function CareStaffDashboardPage() {
  const { user, isReady } = useRequireRole("care_staff");
  const [isLoading, setIsLoading] = useState(true);
  const [isPendingApproval, setIsPendingApproval] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "care_staff")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffRow) {
      setIsLoading(false);
      return;
    }

    const { data: pendingRow } = await supabase
      .from("institution_staff")
      .select("id")
      .eq("user_id", user.id)
      .eq("role", "care_staff")
      .is("deactivated_at", null)
      .is("approved_at", null)
      .is("rejected_at", null)
      .maybeSingle();

    if (pendingRow) {
      setIsPendingApproval(true);
    } else {
      setError("Could not find your centre.");
    }
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!isMounted || !isReady) return;
      await load();
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [isReady, load]);

  if (!isReady || isLoading) {
    return null;
  }

  if (isPendingApproval) {
    return <PendingApprovalState waitingFor="centre manager" />;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">You&apos;re all set</h1>
        </div>

        {error ? (
          <p role="alert" className="text-sm font-medium text-red-600">
            {error}
          </p>
        ) : (
          <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="text-sm leading-relaxed text-black/60">
              Your account is ready. A child&apos;s record will appear here once one is active during a stay --
              that part isn&apos;t built yet.
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
