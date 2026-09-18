"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlanType } from "@/lib/clinicalPlans";

export interface SharedClinicalPlan {
  id: string;
  planType: PlanType;
  name: string;
  planDate: string;
  body: string;
  authorName: string | null;
  createdAt: string;
}

interface SharedClinicalPlanRow {
  id: string;
  plan_type: PlanType;
  name: string;
  plan_date: string;
  body: string | null;
  author_name: string | null;
  created_at: string;
}

// The school-facing (and principal-facing) read surface --
// get_clinical_plans_for_passport(), never a raw select. This RPC's
// own authorization already resolves _clinical_plan_is_school_visible()
// (the per-instance override, falling back to the type's own default)
// and has_child_access()/the principal branch -- a clinic_only plan,
// or one a caller has no standing to see, simply doesn't appear; there
// is no separate "locked" state to check, since this table never locks.
export function useClinicalPlansForPassport(passportId: string) {
  const [plans, setPlans] = useState<SharedClinicalPlan[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_clinical_plans_for_passport", { p_passport_id: passportId });

    if (error) {
      console.error("Failed to load clinical plans:", error);
      setLoadError("Couldn't load plans.");
      setPlans(null);
      return;
    }

    setPlans(
      ((data ?? []) as SharedClinicalPlanRow[]).map((row) => ({
        id: row.id,
        planType: row.plan_type,
        name: row.name,
        planDate: row.plan_date,
        body: row.body ?? "",
        authorName: row.author_name,
        createdAt: row.created_at,
      }))
    );
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { plans, loadError, reload: load };
}
