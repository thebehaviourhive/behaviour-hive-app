"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import type { AflsScoresData, FbaAflsData, FbaContentData, FbaReport, FbaStatus } from "@/lib/fba/types";

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

interface FbaAflsRow {
  id: string;
  fba_id: string;
  scores_data: AflsScoresData;
  summary: string | null;
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

function mapAfls(row: FbaAflsRow): FbaAflsData {
  return {
    id: row.id,
    fbaId: row.fba_id,
    scoresData: row.scores_data ?? {},
    summary: row.summary,
  };
}

export type SaveStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

export function useFbaReport(fbaId: string) {
  const [report, setReport] = useState<FbaReport | null>(null);
  const [afls, setAfls] = useState<FbaAflsData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const [{ data: reportRow, error: reportError }, { data: aflsRow, error: aflsError }] = await Promise.all([
      supabase.from("fba_reports").select("*").eq("id", fbaId).maybeSingle(),
      supabase.from("fba_afls_data").select("*").eq("fba_id", fbaId).maybeSingle(),
    ]);

    if (reportError) {
      console.error("Failed to load FBA report:", reportError);
      setLoadError("Couldn't load this FBA.");
      setIsLoading(false);
      return;
    }

    setReport(reportRow ? mapReport(reportRow as FbaReportRow) : null);
    if (aflsError) {
      console.error("Failed to load AFLS data:", aflsError);
      // Non-fatal -- AFLS just hasn't been started yet in the common
      // case, and the section 11 editor creates the row on first save.
    }
    setAfls(aflsRow ? mapAfls(aflsRow as FbaAflsRow) : null);
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

  const saveAfls = useCallback(
    async (nextScores: AflsScoresData, nextSummary: string | null, controller?: AbortController) => {
      setSaveError(null);
      const supabase = createClient();

      const result = await insertWithOfflineRetry(
        () =>
          afls
            ? supabase
                .from("fba_afls_data")
                .update({ scores_data: nextScores, summary: nextSummary })
                .eq("id", afls.id)
            : supabase
                .from("fba_afls_data")
                .insert({ fba_id: fbaId, scores_data: nextScores, summary: nextSummary }),
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

      setAfls((prev) =>
        prev
          ? { ...prev, scoresData: nextScores, summary: nextSummary }
          : { id: "", fbaId, scoresData: nextScores, summary: nextSummary }
      );
      // A fresh insert doesn't carry back the real row id -- reload once
      // so later saves target the correct row via update rather than
      // repeatedly inserting.
      if (!afls) await load();
      setSaveStatus("saved");
    },
    [afls, fbaId, load]
  );

  return { report, afls, isLoading, loadError, reload: load, saveContent, saveAfls, saveStatus, saveError };
}
