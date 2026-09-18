"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type {
  BspRecord,
  BspStrategy,
  TargetBehaviourEntry,
  TriggerEntry,
  SettingEventEntry,
  StrategyPlacement,
} from "@/lib/bsp/types";

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

interface BspStrategyRow {
  id: string;
  bsp_id: string;
  source_bank_strategy_id: string | null;
  title: string;
  why: string;
  how: string;
  scripted_language: string | null;
  materials_and_setup: string | null;
  placement: StrategyPlacement;
  caveat: string | null;
  image_asset_id: string | null;
  reference_asset_id: string | null;
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

function mapStrategy(row: BspStrategyRow): BspStrategy {
  return {
    id: row.id,
    bspId: row.bsp_id,
    sourceBankStrategyId: row.source_bank_strategy_id,
    title: row.title,
    why: row.why,
    how: row.how,
    scriptedLanguage: row.scripted_language,
    materialsAndSetup: row.materials_and_setup,
    placement: row.placement,
    caveat: row.caveat,
    imageAssetId: row.image_asset_id,
    referenceAssetId: row.reference_asset_id,
  };
}

const BSP_COLUMNS =
  "id, passport_id, institution_id, clinician_id, source_fba_id, status, target_behaviours, triggers, setting_events, precursors, current_frequency, signed_at, signed_by, supersedes_id, created_at, updated_at";

const STRATEGY_COLUMNS =
  "id, bsp_id, source_bank_strategy_id, title, why, how, scripted_language, materials_and_setup, placement, caveat, image_asset_id, reference_asset_id";

// PRD 7 Stage 4 -- one plan. Draft is editable; active/superseded are
// locked -- enforced at the database (bsp's own UPDATE policy WITH
// CHECK requires status stay 'draft'), so every write here that isn't
// through sign_bsp()/create_bsp_revision() simply no-ops once the plan
// is locked, same shape as every other "RLS on UPDATE silently
// filters" case in this codebase -- callers should reload and compare,
// never trust the absence of an error alone.
export function useBsp(bspId: string) {
  const [bsp, setBsp] = useState<BspRecord | null>(null);
  const [strategies, setStrategies] = useState<BspStrategy[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const [{ data: bspRow, error: bspErr }, { data: stratRows, error: stratErr }] = await Promise.all([
      supabase.from("bsp").select(BSP_COLUMNS).eq("id", bspId).single(),
      supabase.from("bsp_strategies").select(STRATEGY_COLUMNS).eq("bsp_id", bspId).order("created_at", { ascending: true }),
    ]);

    if (bspErr || !bspRow) {
      console.error("Failed to load BSP:", bspErr);
      setLoadError("Couldn't load this plan.");
      setBsp(null);
      return;
    }
    if (stratErr) {
      console.error("Failed to load BSP strategies:", stratErr);
      setLoadError("Couldn't load this plan's strategies.");
      return;
    }

    setBsp(mapBsp(bspRow as BspRow));
    setStrategies((stratRows as BspStrategyRow[]).map(mapStrategy));
  }, [bspId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const saveFields = useCallback(
    async (
      patch: Partial<
        Pick<BspRecord, "targetBehaviours" | "triggers" | "settingEvents" | "precursors" | "currentFrequency">
      >
    ): Promise<{ error: string | null }> => {
      setIsSaving(true);
      setActionError(null);
      const supabase = createClient();
      const payload: Record<string, unknown> = {};
      if (patch.targetBehaviours !== undefined) payload.target_behaviours = patch.targetBehaviours;
      if (patch.triggers !== undefined) payload.triggers = patch.triggers;
      if (patch.settingEvents !== undefined) payload.setting_events = patch.settingEvents;
      if (patch.precursors !== undefined) payload.precursors = patch.precursors;
      if (patch.currentFrequency !== undefined) payload.current_frequency = patch.currentFrequency;

      const { data, error } = await supabase.from("bsp").update(payload).eq("id", bspId).select("id");
      setIsSaving(false);

      if (error) {
        setActionError(error.message);
        return { error: error.message };
      }
      if (!data || data.length === 0) {
        // No thrown error, no rows touched -- the plan is locked.
        setActionError("This plan is locked and can no longer be edited.");
        return { error: "This plan is locked and can no longer be edited." };
      }

      await load();
      return { error: null };
    },
    [bspId, load]
  );

  const addFreshStrategy = useCallback(
    async (input: {
      title: string;
      why: string;
      how: string;
      scriptedLanguage?: string;
      materialsAndSetup?: string;
      placement: StrategyPlacement;
      caveat?: string;
    }): Promise<{ error: string | null }> => {
      setActionError(null);
      const supabase = createClient();
      const { error } = await supabase.from("bsp_strategies").insert({
        bsp_id: bspId,
        title: input.title,
        why: input.why,
        how: input.how,
        scripted_language: input.scriptedLanguage || null,
        materials_and_setup: input.materialsAndSetup || null,
        placement: input.placement,
        caveat: input.caveat || null,
      });
      if (error) {
        setActionError(error.message);
        return { error: error.message };
      }
      await load();
      return { error: null };
    },
    [bspId, load]
  );

  // The copy itself happens server-side, in add_bank_strategy_to_bsp()
  // -- never a client-side insert of fields read off the bank row. See
  // that RPC's own comment for why: this is the one place a client-
  // trusted copy would have been easy to get subtly wrong.
  const addFromBank = useCallback(
    async (bankStrategyId: string): Promise<{ error: string | null }> => {
      setActionError(null);
      const supabase = createClient();
      const { error } = await supabase.rpc("add_bank_strategy_to_bsp", {
        p_bsp_id: bspId,
        p_bank_strategy_id: bankStrategyId,
      });
      if (error) {
        setActionError(error.message);
        return { error: error.message };
      }
      await load();
      return { error: null };
    },
    [bspId, load]
  );

  const updateStrategy = useCallback(
    async (
      strategyId: string,
      patch: Partial<{
        title: string;
        why: string;
        how: string;
        scriptedLanguage: string;
        materialsAndSetup: string;
        placement: StrategyPlacement;
        caveat: string;
      }>
    ): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const payload: Record<string, unknown> = {};
      if (patch.title !== undefined) payload.title = patch.title;
      if (patch.why !== undefined) payload.why = patch.why;
      if (patch.how !== undefined) payload.how = patch.how;
      if (patch.scriptedLanguage !== undefined) payload.scripted_language = patch.scriptedLanguage || null;
      if (patch.materialsAndSetup !== undefined) payload.materials_and_setup = patch.materialsAndSetup || null;
      if (patch.placement !== undefined) payload.placement = patch.placement;
      if (patch.caveat !== undefined) payload.caveat = patch.caveat || null;

      const { error } = await supabase.from("bsp_strategies").update(payload).eq("id", strategyId);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [load]
  );

  const removeStrategy = useCallback(
    async (strategyId: string): Promise<{ error: string | null }> => {
      const supabase = createClient();
      const { error } = await supabase.from("bsp_strategies").delete().eq("id", strategyId);
      if (error) return { error: error.message };
      await load();
      return { error: null };
    },
    [load]
  );

  const sign = useCallback(async (): Promise<{ error: string | null }> => {
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("sign_bsp", { p_bsp_id: bspId });
    setIsSaving(false);
    if (error) {
      setActionError(error.message);
      return { error: error.message };
    }
    await load();
    return { error: null };
  }, [bspId, load]);

  return {
    bsp,
    strategies,
    loadError,
    reload: load,
    saveFields,
    isSaving,
    actionError,
    addFreshStrategy,
    addFromBank,
    updateStrategy,
    removeStrategy,
    sign,
  };
}
