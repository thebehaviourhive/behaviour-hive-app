"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { BankStrategy, StrategyPlacement } from "@/lib/bsp/types";

interface StrategyBankRow {
  id: string;
  institution_id: string;
  title: string;
  why: string;
  how: string;
  scripted_language: string | null;
  materials_and_setup: string | null;
  default_placement: StrategyPlacement;
  caveat: string | null;
  image_asset_id: string | null;
  reference_asset_id: string | null;
  is_active: boolean;
  created_by: string;
  created_at: string;
}

function mapStrategy(row: StrategyBankRow): BankStrategy {
  return {
    id: row.id,
    institutionId: row.institution_id,
    title: row.title,
    why: row.why,
    how: row.how,
    scriptedLanguage: row.scripted_language,
    materialsAndSetup: row.materials_and_setup,
    defaultPlacement: row.default_placement,
    caveat: row.caveat,
    imageAssetId: row.image_asset_id,
    referenceAssetId: row.reference_asset_id,
    isActive: row.is_active,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export interface NewBankStrategyInput {
  title: string;
  why: string;
  how: string;
  scriptedLanguage?: string;
  materialsAndSetup?: string;
  defaultPlacement: StrategyPlacement;
  caveat?: string;
  imageAssetId?: string | null;
  referenceAssetId?: string | null;
}

// PRD 7 Stage 4 -- the clinic's own accumulated library. Starts empty;
// this hook is the mechanism, not the content. Institution-scoped, not
// per-child -- read by any current-standing institution staff, written
// (add) by any verified clinician, curated/retired (update) by the
// director only, per the table's own RLS.
export function useStrategyBank(institutionId: string | null) {
  const [strategies, setStrategies] = useState<BankStrategy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) {
      setStrategies([]);
      return;
    }
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("strategy_bank")
      .select(
        "id, institution_id, title, why, how, scripted_language, materials_and_setup, default_placement, caveat, image_asset_id, reference_asset_id, is_active, created_by, created_at"
      )
      .eq("institution_id", institutionId)
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Failed to load strategy bank:", error);
      setLoadError("Couldn't load the strategy bank.");
      setStrategies(null);
      return;
    }

    setStrategies((data as StrategyBankRow[]).map(mapStrategy));
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const addStrategy = useCallback(
    async (input: NewBankStrategyInput): Promise<{ error: string | null }> => {
      if (!institutionId) return { error: "No clinic context." };
      setIsSaving(true);
      setSaveError(null);
      const supabase = createClient();

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        setIsSaving(false);
        setSaveError("You need to be signed in.");
        return { error: "You need to be signed in." };
      }

      const { error } = await supabase.from("strategy_bank").insert({
        institution_id: institutionId,
        created_by: user.id,
        title: input.title,
        why: input.why,
        how: input.how,
        scripted_language: input.scriptedLanguage || null,
        materials_and_setup: input.materialsAndSetup || null,
        default_placement: input.defaultPlacement,
        caveat: input.caveat || null,
        image_asset_id: input.imageAssetId ?? null,
        reference_asset_id: input.referenceAssetId ?? null,
      });

      setIsSaving(false);
      if (error) {
        setSaveError(error.message);
        return { error: error.message };
      }

      await load();
      return { error: null };
    },
    [institutionId, load]
  );

  // Director-only curation/retirement -- see this file's own header. A
  // non-director's call updates zero rows silently (this codebase's own
  // documented RLS-on-UPDATE shape), so callers should reload and
  // compare rather than trust the absence of an error.
  const curateStrategy = useCallback(
    async (id: string, patch: Partial<NewBankStrategyInput> & { isActive?: boolean }): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const payload: Record<string, unknown> = {};
      if (patch.title !== undefined) payload.title = patch.title;
      if (patch.why !== undefined) payload.why = patch.why;
      if (patch.how !== undefined) payload.how = patch.how;
      if (patch.scriptedLanguage !== undefined) payload.scripted_language = patch.scriptedLanguage || null;
      if (patch.materialsAndSetup !== undefined) payload.materials_and_setup = patch.materialsAndSetup || null;
      if (patch.defaultPlacement !== undefined) payload.default_placement = patch.defaultPlacement;
      if (patch.caveat !== undefined) payload.caveat = patch.caveat || null;
      if (patch.isActive !== undefined) payload.is_active = patch.isActive;

      const { error } = await supabase.from("strategy_bank").update(payload).eq("id", id);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [load]
  );

  return { strategies, loadError, reload: load, addStrategy, isSaving, saveError, curateStrategy };
}
