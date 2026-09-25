"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RespiteActiveChild {
  passportId: string;
  childName: string | null;
  stayId: string | null;
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
// everywhere else in this PRD.
export function useRespiteActiveChildren(institutionId: string | null) {
  const [children, setChildren] = useState<RespiteActiveChild[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const refresh = useCallback(async () => {
    if (!institutionId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_centre_active_children", {
      p_institution_id: institutionId,
    });

    if (error) {
      console.error("Failed to load active children:", error);
      setIsLoading(false);
      return;
    }

    setChildren(
      ((data ?? []) as unknown as RawActiveChildRow[]).map((row) => ({
        passportId: row.passport_id,
        childName: row.child_name,
        stayId: row.stay_id,
      }))
    );
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { children, isLoading, refresh };
}
