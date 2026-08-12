"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// CLINICIAN CASE VIEW ONLY (constraint 1B: "the clinician's case view
// shows whether the child's Calm button is live"). Reads fba_calm_cards
// directly (not get_my_child_calm_cards -- that RPC is parent-only,
// gated by owns_passport, and would return zero rows for any clinician
// caller by construction). Relies on fba_calm_cards' own clinician RLS,
// which scopes to FBAs where the CALLING clinician is fr.clinician_id --
// so on a case that has changed hands, a clinician who didn't author the
// completed FBA won't see its cards here even if they're published and
// the button is genuinely live for the parent. Acceptable for v1 (single
// clinician per case is the common shape); a future multi-clinician
// handoff would need a wider check.
export function useCalmButtonLiveStatus(passportId: string) {
  const [isLive, setIsLive] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const supabase = createClient();
    supabase
      .from("fba_calm_cards")
      .select("id, is_published, fba_reports!inner(status, passport_id)")
      .eq("fba_reports.passport_id", passportId)
      .eq("fba_reports.status", "completed")
      .eq("is_published", true)
      .limit(1)
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load calm button status:", error);
          setIsLoading(false);
          return;
        }
        setIsLive((data?.length ?? 0) > 0);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return { isLive, isLoading };
}
