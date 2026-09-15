"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import type { AflsAssessment, AflsScores } from "@/lib/fba/types";

// AFLS save resilience, 15 Sept 2026 -- thrown by updateAssessment when
// its caller aborts a save via `signal` (e.g. the clinician taps Cancel
// while it's waiting for connectivity). Deliberately NOT the same as a
// real failure: AflsSection's own queue catches this specifically to
// set status back to "idle" rather than "error", same distinction
// useFbaReport.ts's saveContent already makes for the generic path.
export class SaveCancelledError extends Error {}

interface AflsAssessmentRow {
  id: string;
  fba_id: string;
  assessment_date: string;
  assessor_name: string;
  scores: AflsScores;
  domain_comments: Record<string, string>;
  created_at: string;
  updated_at: string;
}

function mapRow(row: AflsAssessmentRow): AflsAssessment {
  return {
    id: row.id,
    fbaId: row.fba_id,
    assessmentDate: row.assessment_date,
    assessorName: row.assessor_name,
    scores: row.scores ?? {},
    domainComments: row.domain_comments ?? {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Clinician CRUD for one FBA's AFLS assessments -- goes straight to the
// table (no RPC) since afls_assessments' own RLS already fully covers
// "clinician CRUD on assessments of their own FBAs" (migration 0060,
// mirroring fba_calm_cards' RLS exactly). Deliberately has NO readOnly/
// status gate of its own: assessments stay addable and editable after
// the FBA is finalized (companion layer, same posture as
// useCalmCardsForFba) -- the paper assessment may be conducted and
// transcribed after the FBA locks.
export function useAflsAssessmentsForFba(fbaId: string) {
  const [assessments, setAssessments] = useState<AflsAssessment[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("afls_assessments")
      .select("*")
      .eq("fba_id", fbaId)
      // Most recent first -- the list's own default order, and matches
      // the results grid's "defaults to the most recent assessment"
      // rule directly without a separate sort there.
      .order("assessment_date", { ascending: false })
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load AFLS assessments:", error);
      setLoadError("Couldn't load AFLS assessments.");
      setIsLoading(false);
      return;
    }
    setAssessments((data ?? []).map((row) => mapRow(row as AflsAssessmentRow)));
    setIsLoading(false);
  }, [fbaId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function createAssessment(assessorName: string): Promise<AflsAssessment> {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("afls_assessments")
      .insert({ fba_id: fbaId, assessor_name: assessorName })
      .select("*")
      .single();

    if (error) throw error;
    const created = mapRow(data as AflsAssessmentRow);
    setAssessments((prev) => [created, ...prev]);
    return created;
  }

  // AFLS save resilience, 15 Sept 2026 -- brought up to the generic
  // content_data path's own standard (useFbaReport.ts's saveContent):
  // same insertWithOfflineRetry, reused rather than reimplemented, so a
  // clinician on a poor connection in this section is protected exactly
  // as they already are in the other thirteen. onStatusChange/signal are
  // both optional so this stays backward compatible with any caller that
  // doesn't need them (there are none left inside this codebase, but the
  // shape costs nothing to keep optional). The row insertWithOfflineRetry's
  // own `attempt` callback would otherwise discard (it only looks at
  // `error`) is captured into `updatedRow` via closure instead.
  async function updateAssessment(
    id: string,
    patch: Partial<{
      assessmentDate: string;
      assessorName: string;
      scores: AflsScores;
      domainComments: Record<string, string>;
    }>,
    onStatusChange?: (status: "saving" | "waiting-for-connection") => void,
    signal?: AbortSignal
  ): Promise<AflsAssessment> {
    const supabase = createClient();
    const dbPatch: Record<string, unknown> = {};
    if (patch.assessmentDate !== undefined) dbPatch.assessment_date = patch.assessmentDate;
    if (patch.assessorName !== undefined) dbPatch.assessor_name = patch.assessorName;
    if (patch.scores !== undefined) dbPatch.scores = patch.scores;
    if (patch.domainComments !== undefined) dbPatch.domain_comments = patch.domainComments;

    let updatedRow: AflsAssessmentRow | null = null;
    const result = await insertWithOfflineRetry(
      async () => {
        const { data, error } = await supabase.from("afls_assessments").update(dbPatch).eq("id", id).select("*").single();
        if (!error) updatedRow = data as AflsAssessmentRow;
        return { error };
      },
      onStatusChange ?? (() => {}),
      signal
    );

    if (result === "cancelled") throw new SaveCancelledError("Save cancelled");
    if (result) throw new Error(result);

    const updated = mapRow(updatedRow!);
    setAssessments((prev) => prev.map((a) => (a.id === id ? updated : a)));
    return updated;
  }

  async function deleteAssessment(id: string): Promise<void> {
    const supabase = createClient();
    const { error } = await supabase.from("afls_assessments").delete().eq("id", id);
    if (error) throw error;
    setAssessments((prev) => prev.filter((a) => a.id !== id));
  }

  return { assessments, isLoading, loadError, reload, createAssessment, updateAssessment, deleteAssessment };
}
