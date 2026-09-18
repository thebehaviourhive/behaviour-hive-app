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
  error: string | null;
  refresh: () => void;
}

export function useClinicianReviewState(userId: string | null): UseClinicianReviewStateResult {
  const [profile, setProfile] = useState<ClinicianReviewProfile | null>(null);
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
    error,
    refresh: load,
  };
}
