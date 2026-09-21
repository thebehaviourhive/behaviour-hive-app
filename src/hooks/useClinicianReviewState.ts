"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Extracted from clinician/dashboard/page.tsx's own fetchClinicianProfile
// + getReviewState, unchanged in behaviour -- QA run-through, item 4:
// only the dashboard locked a pending clinician out, every other tab
// (messages, log, insights, fba, passports, activity) was fully
// reachable and rendered a real, if empty, page instead of the same
// "pending approval" state the dashboard already shows. Pulled out here
// so every clinician page can share the exact same review-state logic
// -- computed once, the same way, everywhere -- rather than each page
// re-deriving it and drifting the way class-derived access did.
export type ClinicianReviewState = "not_submitted" | "pending_review" | "rejected" | "verified";

export interface ClinicianReviewProfile {
  specialty: string;
  verificationStatus: "pending" | "verified" | "rejected";
  hasSubmitted: boolean;
  // "behaviour_hive" | "organisation" | null (0221) -- who verified
  // this clinician and how. ClinicianAccessGate's own specialty check
  // only ever meant anything for the independent, behaviour_hive-
  // reviewed path; carried through here so that gate can tell the two
  // routes apart instead of treating every non-behavioural_psychologist
  // specialty as unsupported, regardless of route.
  verificationRoute: "behaviour_hive" | "organisation" | null;
}

export function getClinicianReviewState(profile: ClinicianReviewProfile): ClinicianReviewState {
  if (profile.verificationStatus === "verified") return "verified";
  if (profile.verificationStatus === "rejected") return "rejected";
  return profile.hasSubmitted ? "pending_review" : "not_submitted";
}

interface UseClinicianReviewStateResult {
  isLoading: boolean;
  profile: ClinicianReviewProfile | null;
  reviewState: ClinicianReviewState | null;
  // Found 21 Sept 2026, live, building the clinic role picker's own
  // real-signup proof: a clinic practitioner who has joined by
  // institution code but whose director hasn't approved them yet has
  // NO clinicians row at all -- approve_staff_join()'s own clinic
  // branch (0222) only creates one ON approval. With no clinicians
  // row, `profile` above is null, and every existing caller of this
  // hook (ClinicianAccessGate, this dashboard's own un-migrated
  // duplicate) treated a null profile as "hasn't picked a specialty
  // yet" -- the INDEPENDENT path's own next step, wrong and actively
  // misleading for someone who joined a clinic by code and is waiting
  // on their director, not on themselves. 'clinician' is never a
  // legal institution_staff role at a school (institution_staff_role_
  // check's school branch doesn't include it, 0203) -- so a pending
  // row with this role is unambiguously a clinic join, no separate
  // institution-type check needed. Query only fires when `profile` is
  // null, so it costs nothing for the far more common verified/
  // independent-pending cases.
  institutionJoinPending: boolean;
  error: string | null;
  refresh: () => void;
}

export function useClinicianReviewState(userId: string | null): UseClinicianReviewStateResult {
  const [profile, setProfile] = useState<ClinicianReviewProfile | null>(null);
  const [institutionJoinPending, setInstitutionJoinPending] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId) return;
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data, error: fetchError } = await supabase
      .from("clinicians")
      .select("specialty, verification_status, full_name, verification_route")
      .eq("user_id", userId)
      .maybeSingle();

    if (fetchError) {
      setError("Couldn't load your clinician profile.");
      setIsLoading(false);
      return;
    }

    setProfile(
      data
        ? {
            specialty: data.specialty,
            verificationStatus: data.verification_status,
            hasSubmitted: data.full_name !== null,
            verificationRoute: data.verification_route,
          }
        : null
    );

    if (!data) {
      const { data: pendingJoin } = await supabase
        .from("institution_staff")
        .select("id")
        .eq("user_id", userId)
        .eq("role", "clinician")
        .is("deactivated_at", null)
        .is("approved_at", null)
        .is("rejected_at", null)
        .limit(1)
        .maybeSingle();
      setInstitutionJoinPending(pendingJoin !== null);
    } else {
      setInstitutionJoinPending(false);
    }

    setIsLoading(false);
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return {
    isLoading,
    profile,
    reviewState: profile ? getClinicianReviewState(profile) : null,
    institutionJoinPending,
    error,
    refresh: load,
  };
}
