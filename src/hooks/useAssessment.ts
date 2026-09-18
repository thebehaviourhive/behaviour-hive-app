"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import type { AssessmentRecordType } from "@/hooks/useAssessmentInstruments";

// PRD 7 Stage 1 -- the assessment record's own save hook. Same queue-
// not-abort shape as useSessionNote.ts's saveField: every field here is
// an independent column (or a whole-jsonb-blob column treated as one
// unit -- responses, subscale_totals, scores), so a chained queue is
// correct and simpler than an abort-and-restart approach.
export type SaveStatus = "idle" | "saving" | "waiting-for-connection" | "saved" | "error";

export interface SubscaleTotal {
  label: string;
  total: string;
}

export interface ScoreEntry {
  label: string;
  value: string;
}

export interface Assessment {
  id: string;
  passportId: string;
  clinicianId: string;
  instrumentId: string;
  instrumentName: string;
  instrumentItemCount: number | null;
  instrumentResponseScale: string[] | null;
  recordType: AssessmentRecordType;
  assessmentDate: string;
  completedAt: string | null;
  // Response sheet.
  respondentType: "parent" | "school_staff" | "interview" | null;
  responses: Record<string, string>;
  subscaleTotals: SubscaleTotal[];
  // External record.
  instrumentVersion: string;
  administratorName: string;
  location: string;
  scores: ScoreEntry[];
  interpretation: string;
  // Respondent completion (PRD 7 -- the parent/school-facing flow).
  assignedRespondentId: string | null;
  assignedAt: string | null;
  lastRemindedAt: string | null;
  instruction: string;
}

interface AssessmentRow {
  id: string;
  passport_id: string;
  clinician_id: string;
  instrument_id: string;
  record_type: AssessmentRecordType;
  assessment_date: string;
  completed_at: string | null;
  respondent_type: "parent" | "school_staff" | "interview" | null;
  responses: Record<string, string> | null;
  subscale_totals: SubscaleTotal[] | null;
  instrument_version: string | null;
  administrator_name: string | null;
  location: string | null;
  scores: ScoreEntry[] | null;
  interpretation: string | null;
  assigned_respondent_id: string | null;
  assigned_at: string | null;
  last_reminded_at: string | null;
  instruction: string | null;
  assessment_instruments: { name: string; item_count: number | null; response_scale: string[] | null } | null;
}

function mapAssessment(row: AssessmentRow): Assessment {
  return {
    id: row.id,
    passportId: row.passport_id,
    clinicianId: row.clinician_id,
    instrumentId: row.instrument_id,
    instrumentName: row.assessment_instruments?.name ?? "Unknown instrument",
    instrumentItemCount: row.assessment_instruments?.item_count ?? null,
    instrumentResponseScale: row.assessment_instruments?.response_scale ?? null,
    recordType: row.record_type,
    assessmentDate: row.assessment_date,
    completedAt: row.completed_at,
    respondentType: row.respondent_type,
    responses: row.responses ?? {},
    subscaleTotals: row.subscale_totals ?? [],
    instrumentVersion: row.instrument_version ?? "",
    administratorName: row.administrator_name ?? "",
    location: row.location ?? "",
    scores: row.scores ?? [],
    interpretation: row.interpretation ?? "",
    assignedRespondentId: row.assigned_respondent_id,
    assignedAt: row.assigned_at,
    lastRemindedAt: row.last_reminded_at,
    instruction: row.instruction ?? "",
  };
}

type AssessmentFieldPatch = Partial<{
  assessmentDate: string;
  respondentType: "parent" | "school_staff" | "interview" | null;
  responses: Record<string, string>;
  subscaleTotals: SubscaleTotal[];
  instrumentVersion: string;
  administratorName: string;
  location: string;
  scores: ScoreEntry[];
  interpretation: string;
  completedAt: string;
  instruction: string;
}>;

export function useAssessment(assessmentId: string) {
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const saveQueueRef = useRef<Promise<"saved" | "cancelled" | "error">>(Promise.resolve("saved"));

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("assessments")
      .select("*, assessment_instruments(name, item_count, response_scale)")
      .eq("id", assessmentId)
      .maybeSingle();

    if (error) {
      console.error("Failed to load assessment:", error);
      setLoadError("Couldn't load this assessment.");
      setIsLoading(false);
      return;
    }

    setAssessment(data ? mapAssessment(data as unknown as AssessmentRow) : null);
    setIsLoading(false);
  }, [assessmentId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const saveField = useCallback(
    (patch: AssessmentFieldPatch, signal?: AbortSignal): Promise<"saved" | "cancelled" | "error"> => {
      const dbPatch: Record<string, unknown> = {};
      if ("assessmentDate" in patch) dbPatch.assessment_date = patch.assessmentDate;
      if ("respondentType" in patch) dbPatch.respondent_type = patch.respondentType;
      if ("responses" in patch) dbPatch.responses = patch.responses;
      if ("subscaleTotals" in patch) dbPatch.subscale_totals = patch.subscaleTotals;
      if ("instrumentVersion" in patch) dbPatch.instrument_version = patch.instrumentVersion;
      if ("administratorName" in patch) dbPatch.administrator_name = patch.administratorName;
      if ("location" in patch) dbPatch.location = patch.location;
      if ("scores" in patch) dbPatch.scores = patch.scores;
      if ("interpretation" in patch) dbPatch.interpretation = patch.interpretation;
      if ("completedAt" in patch) dbPatch.completed_at = patch.completedAt;
      if ("instruction" in patch) dbPatch.instruction = patch.instruction;

      const run = async (): Promise<"saved" | "cancelled" | "error"> => {
        setSaveError(null);
        const supabase = createClient();
        const result = await insertWithOfflineRetry(
          () => supabase.from("assessments").update(dbPatch).eq("id", assessmentId),
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

        setAssessment((prev) => (prev ? { ...prev, ...patch } : prev));
        setSaveStatus("saved");
        return "saved";
      };

      const next = saveQueueRef.current.then(run);
      saveQueueRef.current = next;
      return next;
    },
    [assessmentId]
  );

  // Completing is its own deliberate write, not folded into saveField's
  // queue -- same reasoning as useSessionNote's share(): re-fetches
  // afterward rather than assuming the write landed, and it's the one
  // action that changes what the UPDATE policy will accept on this row
  // ever again (completed_at is null is the lock's own USING clause).
  const complete = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = createClient();
    const { error } = await supabase
      .from("assessments")
      .update({ completed_at: new Date().toISOString() })
      .eq("id", assessmentId);
    if (error) return { error: error.message };
    await load();
    return { error: null };
  }, [assessmentId, load]);

  // Respondent completion -- three thin RPC wrappers, each re-fetching
  // afterward rather than trusting the write landed, same discipline as
  // complete() above. All three route through SECURITY DEFINER RPCs,
  // never a raw client update -- assigned_respondent_id/assigned_at/
  // last_reminded_at have no client-facing UPDATE grant at all (0239),
  // so a raw .update() targeting them would silently touch nothing.
  const assignRespondent = useCallback(
    async (respondentId: string): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const { error } = await supabase.rpc("assign_assessment_respondent", {
        p_assessment_id: assessmentId,
        p_respondent_id: respondentId,
      });
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [assessmentId, load]
  );

  const unassignRespondent = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = createClient();
    const { error } = await supabase.rpc("unassign_assessment_respondent", { p_assessment_id: assessmentId });
    if (error) return { error: error.message };
    await load();
    return { error: null };
  }, [assessmentId, load]);

  const remindRespondent = useCallback(async (): Promise<{ error: string | null }> => {
    const supabase = createClient();
    const { error } = await supabase.rpc("remind_assessment_respondent", { p_assessment_id: assessmentId });
    if (error) return { error: error.message };
    await load();
    return { error: null };
  }, [assessmentId, load]);

  return {
    assessment,
    isLoading,
    loadError,
    reload: load,
    saveField,
    saveStatus,
    saveError,
    complete,
    assignRespondent,
    unassignRespondent,
    remindRespondent,
  };
}
