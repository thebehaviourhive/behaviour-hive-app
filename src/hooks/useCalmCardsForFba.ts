"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapCalmCardRow, type CalmCard, type CalmCardDoorType } from "@/lib/calmCards/types";

// Clinician authoring CRUD for one FBA's Calm Cards -- goes straight to
// the table (no RPC) since fba_calm_cards' own RLS already fully covers
// "clinician CRUD on cards of their own FBAs", the same direct-table
// posture ReviewSection's finalize action already uses for fba_reports.
// Deliberately has NO readOnly/status gate of its own: unlike
// fba_reports content, Calm Cards stay editable after the FBA is
// finalized (see migration 0053's header comment) -- that's what makes
// the retro-add path work, so this hook must never branch on the FBA's
// status.
export function useCalmCardsForFba(fbaId: string) {
  const [cards, setCards] = useState<CalmCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fba_calm_cards")
      .select("*")
      .eq("fba_id", fbaId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("Failed to load calm cards:", error);
      setLoadError("Couldn't load Calm Cards.");
      setIsLoading(false);
      return;
    }
    setCards((data ?? []).map(mapCalmCardRow));
    setIsLoading(false);
  }, [fbaId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function createCard(input: {
    strategyRef: string;
    title: string;
    steps: string[];
    doorType: CalmCardDoorType;
    triggerTags: string[];
    strategyTypeId?: string | null;
  }) {
    const supabase = createClient();
    const { data, error } = await supabase
      .from("fba_calm_cards")
      .insert({
        fba_id: fbaId,
        strategy_ref: input.strategyRef,
        title: input.title,
        steps: input.steps,
        door_type: input.doorType,
        trigger_tags: input.triggerTags,
        strategy_type_id: input.strategyTypeId ?? null,
        is_published: false,
      })
      .select("*")
      .single();

    if (error) throw error;
    const card = mapCalmCardRow(data);
    setCards((prev) => [...prev, card]);
    return card;
  }

  async function updateCard(
    id: string,
    patch: Partial<{
      title: string;
      steps: string[];
      doorType: CalmCardDoorType;
      triggerTags: string[];
      isPublished: boolean;
      strategyTypeId: string | null;
    }>
  ) {
    const supabase = createClient();
    const dbPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) dbPatch.title = patch.title;
    if (patch.steps !== undefined) dbPatch.steps = patch.steps;
    if (patch.doorType !== undefined) dbPatch.door_type = patch.doorType;
    if (patch.triggerTags !== undefined) dbPatch.trigger_tags = patch.triggerTags;
    if (patch.isPublished !== undefined) dbPatch.is_published = patch.isPublished;
    if (patch.strategyTypeId !== undefined) dbPatch.strategy_type_id = patch.strategyTypeId;

    const { data, error } = await supabase
      .from("fba_calm_cards")
      .update(dbPatch)
      .eq("id", id)
      .select("*")
      .single();

    if (error) throw error;
    const card = mapCalmCardRow(data);
    setCards((prev) => prev.map((c) => (c.id === id ? card : c)));
    return card;
  }

  async function deleteCard(id: string) {
    const supabase = createClient();
    const { error } = await supabase.from("fba_calm_cards").delete().eq("id", id);
    if (error) throw error;
    setCards((prev) => prev.filter((c) => c.id !== id));
  }

  return { cards, isLoading, loadError, reload, createCard, updateCard, deleteCard };
}
