"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PlanType } from "@/lib/clinicalPlans";

export interface ClinicalPlanSummary {
  id: string;
  planType: PlanType;
  name: string;
  planDate: string;
}

interface ClinicalPlanRow {
  id: string;
  plan_type: PlanType;
  name: string;
  plan_date: string;
}

// The clinician's own list -- a raw select, not the get_clinical_
// plans_for_passport() RPC (that RPC is the school/principal reading
// surface, gated on _clinical_plan_is_school_visible(); a clinician
// needs to see EVERY plan they authored or a domain-matched colleague
// authored, shareable or not, matching clinical_plans' own author/
// colleague SELECT policy directly).
export function useClinicalPlans(passportId: string) {
  const [plans, setPlans] = useState<ClinicalPlanSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("clinical_plans")
      .select("id, plan_type, name, plan_date")
      .eq("passport_id", passportId)
      .order("plan_date", { ascending: false });

    if (error) {
      console.error("Failed to load clinical plans:", error);
      setLoadError("Couldn't load plans.");
      setPlans(null);
      return;
    }

    setPlans(
      (data as ClinicalPlanRow[]).map((row) => ({
        id: row.id,
        planType: row.plan_type,
        name: row.name,
        planDate: row.plan_date,
      }))
    );
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const create = useCallback(
    async (planType: PlanType, name: string): Promise<{ id: string | null; error: string | null }> => {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) return { id: null, error: "You need to be signed in to create a plan." };

      // A reasonable, non-authoritative prefill from the type's own
      // default -- not server-guaranteed (see migration 0244's own
      // header on why there's no insert trigger for this), just saves
      // the clinician a step for the common case.
      const { data: typeRow } = await supabase
        .from("clinical_artefact_types")
        .select("default_domain_tags")
        .eq("artefact_type", planType)
        .single();

      const { data, error } = await supabase
        .from("clinical_plans")
        .insert({
          passport_id: passportId,
          clinician_id: user.id,
          plan_type: planType,
          name,
          domain_tags: typeRow?.default_domain_tags ?? [],
        })
        .select("id")
        .single();

      if (error) return { id: null, error: error.message };
      await load();
      return { id: data.id, error: null };
    },
    [passportId, load]
  );

  return { plans, loadError, reload: load, create };
}
