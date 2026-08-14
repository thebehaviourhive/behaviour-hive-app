"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { AflsAssessment, AflsScores } from "@/lib/fba/types";

interface AflsAssessmentRow {
  id: string;
  fba_id: string;
  assessment_date: string;
  assessor_name: string;
  scores: AflsScores;
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

  async function updateAssessment(
    id: string,
    patch: Partial<{ assessmentDate: string; assessorName: string; scores: AflsScores }>
  ): Promise<AflsAssessment> {
    const supabase = createClient();
    const dbPatch: Record<string, unknown> = {};
    if (patch.assessmentDate !== undefined) dbPatch.assessment_date = patch.assessmentDate;
    if (patch.assessorName !== undefined) dbPatch.assessor_name = patch.assessorName;
    if (patch.scores !== undefined) dbPatch.scores = patch.scores;

    const { data, error } = await supabase
      .from("afls_assessments")
      .update(dbPatch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    const updated = mapRow(data as AflsAssessmentRow);
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
