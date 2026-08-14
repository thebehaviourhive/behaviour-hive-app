"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import type { FbaContentData, FbaReport, FbaStatus } from "@/lib/fba/types";

interface FbaReportRow {
  id: string;
  passport_id: string;
  clinician_id: string;
  status: FbaStatus;
  content_data: FbaContentData;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

function mapReport(row: FbaReportRow): FbaReport {
  return {
    id: row.id,
    passportId: row.passport_id,
    clinicianId: row.clinician_id,
    status: row.status,
    contentData: row.content_data ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    completedAt: row.completed_at,
  };
}

export type SaveStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

// AFLS REBUILD (migration 0060): AFLS scoring no longer lives here --
// afls_assessments is its own multi-row-per-FBA table with its own
// CRUD hook (useAflsAssessmentsForFba), matching the Calm Cards
// precedent (useCalmCardsForFba) of a self-contained hook rather than
// threading everything through this one. Callers that need AFLS
// completeness (the workspace section list, ReviewSection, the parent
// reader/PDF) each call that hook directly.
export function useFbaReport(fbaId: string) {
  const [report, setReport] = useState<FbaReport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const { data: reportRow, error: reportError } = await supabase
      .from("fba_reports")
      .select("*")
      .eq("id", fbaId)
      .maybeSingle();

    if (reportError) {
      console.error("Failed to load FBA report:", reportError);
      setLoadError("Couldn't load this FBA.");
      setIsLoading(false);
      return;
    }

    setReport(reportRow ? mapReport(reportRow as FbaReportRow) : null);
    setIsLoading(false);
  }, [fbaId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const saveContent = useCallback(
    async (nextContent: FbaContentData, controller?: AbortController) => {
      setSaveError(null);
      const supabase = createClient();

      // A draft's first save moves it to in_progress -- the clinician has
      // now genuinely started the assessment, not just created the shell.
      const nextStatus = report?.status === "draft" ? "in_progress" : report?.status;

      const result = await insertWithOfflineRetry(
        () =>
          supabase
            .from("fba_reports")
            .update({ content_data: nextContent, status: nextStatus })
            .eq("id", fbaId),
        setSaveStatus,
        controller?.signal
      );

      if (result === "cancelled") {
        setSaveStatus("idle");
        return;
      }
      if (result) {
        setSaveStatus("error");
        setSaveError(result);
        return;
      }

      setReport((prev) => (prev ? { ...prev, contentData: nextContent, status: nextStatus ?? prev.status } : prev));
      setSaveStatus("saved");
    },
    [fbaId, report?.status]
  );

  return { report, isLoading, loadError, reload: load, saveContent, saveStatus, saveError };
}
