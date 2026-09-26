"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RespiteActiveChild {
  passportId: string;
  childName: string | null;
  stayId: string | null;
  // Placement-scoped (centre_manager) and activation-scoped
  // (care_staff) reach are different sets by construction -- see the
  // header comment below -- but the function's own return shape gives
  // no way to tell "on the roster" from "actually here right now" for
  // a manager's row. Resolved with a second, narrow query below rather
  // than a new RPC (Tier 1's "Current Clients" fix, reachability pass).
  isOnSite: boolean;
}

interface RawActiveChildRow {
  passport_id: string;
  child_name: string | null;
  stay_id: string | null;
}

// get_my_centre_active_children() is role-branched server-side: a
// care_staff caller sees only children with an OPEN ACTIVATION for
// them; a centre_manager sees every child with an ACTIVE PLACEMENT,
// activated or not -- matching their own placement-scoped reach
// everywhere else in this PRD. For a manager, "placed" and "on-site"
// were previously indistinguishable in the UI -- fixed by reading
// respite_activations directly (institution-wide, any current-standing
// staff, matching that table's own metadata-only read policy) to mark
// which of the placement-scoped rows also has a genuinely open
// activation right now.
export function useRespiteActiveChildren(institutionId: string | null) {
  const [children, setChildren] = useState<RespiteActiveChild[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Baseline audit, 26 Sept 2026 -- this used to console.error a failed
  // RPC and stop there, leaving `children` at whatever it already was
  // (empty, on a first load). /care/dashboard then rendered "Nothing's
  // been activated for you yet" -- identical to the genuine empty
  // state, for a care worker with a child in the room who has no way to
  // tell the two apart. loadError is the distinguishing signal; the
  // caller renders InlineErrorState instead of the empty state when
  // it's set, never both.
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!institutionId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_centre_active_children", {
      p_institution_id: institutionId,
    });

    if (error) {
      console.error("Failed to load active children:", error);
      setLoadError("Couldn't load your active children. Please try again.");
      setIsLoading(false);
      return;
    }

    const rows = (data ?? []) as unknown as RawActiveChildRow[];

    const { data: openActivations, error: activationsError } = await supabase
      .from("respite_activations")
      .select("passport_id")
      .eq("institution_id", institutionId)
      .is("closed_at", null);

    if (activationsError) {
      console.error("Failed to load open activations:", activationsError);
      setLoadError("Couldn't load your active children. Please try again.");
      setIsLoading(false);
      return;
    }

    const onSitePassportIds = new Set((openActivations ?? []).map((a) => a.passport_id as string));

    setChildren(
      rows.map((row) => ({
        passportId: row.passport_id,
        childName: row.child_name,
        stayId: row.stay_id,
        isOnSite: onSitePassportIds.has(row.passport_id),
      }))
    );
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { children, isLoading, loadError, refresh };
}
