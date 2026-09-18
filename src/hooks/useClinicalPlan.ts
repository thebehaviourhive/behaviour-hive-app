"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import type { PlanType } from "@/lib/clinicalPlans";

export type SaveStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

export interface ClinicalPlan {
  id: string;
  passportId: string;
  clinicianId: string;
  planType: PlanType;
  name: string;
  planDate: string;
  body: string;
  schoolVisibilityOverride: "clinic_only" | "shareable" | null;
  createdAt: string;
}

interface ClinicalPlanRow {
  id: string;
  passport_id: string;
  clinician_id: string;
  plan_type: PlanType;
  name: string;
  plan_date: string;
  body: string | null;
  school_visibility_override: "clinic_only" | "shareable" | null;
  created_at: string;
}

function mapPlan(row: ClinicalPlanRow): ClinicalPlan {
  return {
    id: row.id,
    passportId: row.passport_id,
    clinicianId: row.clinician_id,
    planType: row.plan_type,
    name: row.name,
    planDate: row.plan_date,
    body: row.body ?? "",
    schoolVisibilityOverride: row.school_visibility_override,
    createdAt: row.created_at,
  };
}

type PlanFieldPatch = Partial<{
  name: string;
  planDate: string;
  body: string;
  schoolVisibilityOverride: "clinic_only" | "shareable" | null;
}>;

// No completion lock -- this table never locks (migration 0244's own
// table comment). The author may edit indefinitely, so saveField has
// no "already locked" case to guard against, unlike useAssessment's
// own equivalent.
export function useClinicalPlan(planId: string) {
  const [plan, setPlan] = useState<ClinicalPlan | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<"saved" | "cancelled" | "error">>(Promise.resolve("saved"));

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.from("clinical_plans").select("*").eq("id", planId).maybeSingle();

    if (error) {
      console.error("Failed to load clinical plan:", error);
      setLoadError("Couldn't load this plan.");
      setIsLoading(false);
      return;
    }

    setPlan(data ? mapPlan(data as ClinicalPlanRow) : null);
    setIsLoading(false);
  }, [planId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const saveField = useCallback(
    (patch: PlanFieldPatch, signal?: AbortSignal): Promise<"saved" | "cancelled" | "error"> => {
      const dbPatch: Record<string, unknown> = {};
      if ("name" in patch) dbPatch.name = patch.name;
      if ("planDate" in patch) dbPatch.plan_date = patch.planDate;
      if ("body" in patch) dbPatch.body = patch.body;
      if ("schoolVisibilityOverride" in patch) dbPatch.school_visibility_override = patch.schoolVisibilityOverride;

      const run = async (): Promise<"saved" | "cancelled" | "error"> => {
        setSaveError(null);
        const supabase = createClient();
        const result = await insertWithOfflineRetry(
          () => supabase.from("clinical_plans").update(dbPatch).eq("id", planId),
          setSaveStatus,
          signal
        );

        if (result === "cancelled") {
          setSaveStatus("idle");
          return "cancelled";
        }
        if (result) {
          setSaveStatus("error");
          setSaveError(result);
          return "error";
        }

        setPlan((prev) => (prev ? { ...prev, ...patch } : prev));
        setSaveStatus("saved");
        return "saved";
      };

      const next = saveQueueRef.current.then(run);
      saveQueueRef.current = next;
      return next;
    },
    [planId]
  );

  return { plan, isLoading, loadError, reload: load, saveField, saveStatus, saveError };
}
