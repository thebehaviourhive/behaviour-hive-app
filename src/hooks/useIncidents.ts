"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Phase 5's clinician-facing pull, via get_clinician_incidents() -- a
// verified, actively-linked clinician's own full (narrative included)
// view for one passport, gated on status <> 'draft' and clinician_access
// (see that RPC's own migration comment). Used both by the Clinical
// File's own Incident Log tab and by the FBA's DirectAssessmentSection
// pull-in, same shape, same hook -- mirrors useAbcLogs' own precedent
// exactly, including its set-state-in-effect suppression (this hook's
// only setState calls happen inside a .then() after the fetch, same
// established shape as that file).

export interface IncidentSummary {
  incidentId: string;
  occurredAt: string;
  recordedAt: string;
  location: string;
  status: string;
  category: string | null;
  narrative: string | null;
  parentSummary: string | null;
  childIndex: string;
  distressLevel: string | null;
  remainedOnSite: boolean | null;
  remainedDetail: string | null;
  anyoneInjured: boolean | null;
  debriefRequired: boolean;
  teacherSignedAt: string | null;
  countersignedAt: string | null;
  actions: { value: string; other_detail: string | null }[];
  injuries: Record<string, unknown>[];
  restrictivePractice: { planning_status: string; ncse_report_complete: boolean }[];
}

interface RawClinicianIncidentRow {
  incident_id: string;
  occurred_at: string;
  recorded_at: string;
  location: string;
  status: string;
  category: string | null;
  narrative: string | null;
  parent_summary: string | null;
  child_index: string;
  distress_level: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  anyone_injured: boolean | null;
  debrief_required: boolean;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  actions: { value: string; other_detail: string | null }[];
  injuries: Record<string, unknown>[];
  restrictive_practice: { planning_status: string; ncse_report_complete: boolean }[];
}

export function useIncidents(passportId: string) {
  const [incidents, setIncidents] = useState<IncidentSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- lets a
  // caller's own error-retry button re-run this hook's load effect in
  // place instead of a hard browser reload.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .rpc("get_clinician_incidents", { p_passport_id: passportId })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load incidents:", error);
          setLoadError("Couldn't load incidents.");
          setIsLoading(false);
          return;
        }
        setIncidents(
          ((data ?? []) as RawClinicianIncidentRow[]).map((row) => ({
            incidentId: row.incident_id,
            occurredAt: row.occurred_at,
            recordedAt: row.recorded_at,
            location: row.location,
            status: row.status,
            category: row.category,
            narrative: row.narrative,
            parentSummary: row.parent_summary,
            childIndex: row.child_index,
            distressLevel: row.distress_level,
            remainedOnSite: row.remained_on_site,
            remainedDetail: row.remained_detail,
            anyoneInjured: row.anyone_injured,
            debriefRequired: row.debrief_required,
            teacherSignedAt: row.teacher_signed_at,
            countersignedAt: row.countersigned_at,
            actions: row.actions ?? [],
            injuries: row.injuries ?? [],
            restrictivePractice: row.restrictive_practice ?? [],
          }))
        );
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId, reloadKey]);

  return { incidents, isLoading, loadError, refresh: () => setReloadKey((k) => k + 1) };
}
