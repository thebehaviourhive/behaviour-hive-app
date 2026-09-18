"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BspRecord, TargetBehaviourEntry, TriggerEntry, SettingEventEntry } from "@/lib/bsp/types";

interface BspRow {
  id: string;
  passport_id: string;
  institution_id: string | null;
  clinician_id: string;
  source_fba_id: string | null;
  status: "draft" | "active" | "superseded";
  target_behaviours: TargetBehaviourEntry[];
  triggers: TriggerEntry[];
  setting_events: SettingEventEntry[];
  precursors: string | null;
  current_frequency: string | null;
  signed_at: string | null;
  signed_by: string | null;
  supersedes_id: string | null;
  created_at: string;
  updated_at: string;
}

function mapBsp(row: BspRow): BspRecord {
  return {
    id: row.id,
    passportId: row.passport_id,
    institutionId: row.institution_id,
    clinicianId: row.clinician_id,
    sourceFbaId: row.source_fba_id,
    status: row.status,
    targetBehaviours: row.target_behaviours ?? [],
    triggers: row.triggers ?? [],
    settingEvents: row.setting_events ?? [],
    precursors: row.precursors,
    currentFrequency: row.current_frequency,
    signedAt: row.signed_at,
    signedBy: row.signed_by,
    supersedesId: row.supersedes_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const BSP_COLUMNS =
  "id, passport_id, institution_id, clinician_id, source_fba_id, status, target_behaviours, triggers, setting_events, precursors, current_frequency, signed_at, signed_by, supersedes_id, created_at, updated_at";

// Every BSP this caller can read for this child -- their own drafts,
// their own or a domain-matched colleague's active/superseded plans.
// RLS does the actual scoping; this just orders them for display.
export function useBspsForPassport(passportId: string) {
  const [plans, setPlans] = useState<BspRecord[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("bsp")
      .select(BSP_COLUMNS)
      .eq("passport_id", passportId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load BSPs for passport:", error);
      setLoadError("Couldn't load behaviour support plans.");
      setPlans(null);
      return;
    }

    setPlans((data as BspRow[]).map(mapBsp));
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  return { plans, loadError, reload: load };
}
