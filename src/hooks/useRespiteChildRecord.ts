"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The first-five-minutes screen's own single data source -- everything
// it assembles, in one hook, mirroring how every other respite piece in
// this PRD reads: raw table selects where RLS alone is the gate
// (sections, bsp, bsp_strategies, calm cards, clinical_plans, respite_
// stays), the one narrow RPC where Stage 4 deliberately left the base
// table ungranted (get_respite_child_summary, for passports itself).
//
// "SINCE LAST TIME" -- no new schema, per Stage 5's own recon: respite_
// stays is already institution-wide readable (0297), so the prior
// stay's own ends_at is free to read; each section's own updated_at is
// already activation/placement-gated (Stage 4). The diff itself is
// computed here, client-side, against nothing that wasn't already
// readable.
export interface RespiteChildRecordData {
  childName: string | null;
  dateOfBirth: string | null;
  sectionB: { hard_triggers: string[] | null; hard_triggers_other: string | null; updated_at: string } | null;
  sectionC: {
    communication_methods: string[] | null;
    phrases_to_avoid: string[] | null;
    updated_at: string;
  } | null;
  sectionD: { during_distress: string | null; after_distress: string | null; updated_at: string } | null;
  sectionE: {
    allergies: string | null;
    medical_conditions: string | null;
    medications: string | null;
    emergency_protocol: string | null;
    intimate_care_needs: string | null;
    updated_at: string;
  } | null;
  bspStrategies: {
    id: string;
    title: string;
    why: string;
    how: string;
    scripted_language: string | null;
    materials_and_setup: string | null;
    caveat: string | null;
  }[];
  calmCards: { id: string; title: string; steps: string[]; door_type: "prevention" | "deescalation" }[];
  crisisPlan: { id: string; name: string; body: string | null; plan_date: string } | null;
  currentStayId: string | null;
  priorStayEndsAt: string | null;
  sectionsChangedSinceLastStay: boolean;
}

const EMPTY: RespiteChildRecordData = {
  childName: null,
  dateOfBirth: null,
  sectionB: null,
  sectionC: null,
  sectionD: null,
  sectionE: null,
  bspStrategies: [],
  calmCards: [],
  crisisPlan: null,
  currentStayId: null,
  priorStayEndsAt: null,
  sectionsChangedSinceLastStay: false,
};

export function useRespiteChildRecord(passportId: string | null, institutionId: string | null) {
  const [data, setData] = useState<RespiteChildRecordData>(EMPTY);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!passportId || !institutionId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();

    const [summary, sectionB, sectionC, sectionD, sectionE, bsp, stays] = await Promise.all([
      supabase.rpc("get_respite_child_summary", { p_passport_id: passportId }),
      supabase
        .from("passport_section_b")
        .select("hard_triggers, hard_triggers_other, updated_at")
        .eq("passport_id", passportId)
        .maybeSingle(),
      supabase
        .from("passport_section_c")
        .select("communication_methods, phrases_to_avoid, updated_at")
        .eq("passport_id", passportId)
        .maybeSingle(),
      supabase
        .from("passport_section_d")
        .select("during_distress, after_distress, updated_at")
        .eq("passport_id", passportId)
        .maybeSingle(),
      supabase
        .from("passport_section_e")
        .select("allergies, medical_conditions, medications, emergency_protocol, intimate_care_needs, updated_at")
        .eq("passport_id", passportId)
        .maybeSingle(),
      supabase.from("bsp").select("id").eq("passport_id", passportId).eq("status", "active").maybeSingle(),
      supabase
        .from("respite_stays")
        .select("id, starts_at, ends_at")
        .eq("passport_id", passportId)
        .eq("institution_id", institutionId)
        .order("starts_at", { ascending: false }),
    ]);

    if (summary.error) {
      console.error("Failed to load respite child record:", summary.error);
      setLoadError("Couldn't load this child's record. Please try again.");
      setIsLoading(false);
      return;
    }

    let bspStrategies: RespiteChildRecordData["bspStrategies"] = [];
    if (bsp.data?.id) {
      const { data: strategies } = await supabase
        .from("bsp_strategies")
        .select("id, title, why, how, scripted_language, materials_and_setup, caveat")
        .eq("bsp_id", bsp.data.id);
      bspStrategies = strategies ?? [];
    }

    const { data: fbaRows } = await supabase.from("fba_reports").select("id").eq("passport_id", passportId);
    const fbaIds = (fbaRows ?? []).map((r) => r.id);
    let calmCards: RespiteChildRecordData["calmCards"] = [];
    if (fbaIds.length > 0) {
      const { data: cards } = await supabase
        .from("fba_calm_cards")
        .select("id, title, steps, door_type, fba_id")
        .in("fba_id", fbaIds)
        .eq("is_published", true);
      calmCards = (cards ?? []).map((c) => ({ id: c.id, title: c.title, steps: c.steps, door_type: c.door_type }));
    }

    const { data: plan } = await supabase
      .from("clinical_plans")
      .select("id, name, body, plan_date")
      .eq("passport_id", passportId)
      .eq("plan_type", "crisis_plan")
      .order("plan_date", { ascending: false })
      .limit(1)
      .maybeSingle();

    const stayRows = stays.data ?? [];
    const now = Date.now();
    const currentStay =
      stayRows.find((s) => new Date(s.starts_at).getTime() <= now && now <= new Date(s.ends_at).getTime()) ??
      stayRows[0] ??
      null;
    const priorStay = stayRows
      .filter((s) => s.id !== currentStay?.id && new Date(s.ends_at).getTime() < now)
      .sort((a, b) => new Date(b.ends_at).getTime() - new Date(a.ends_at).getTime())[0] ?? null;

    const summaryRow = summary.data?.[0] ?? null;
    const sections = [sectionB.data, sectionC.data, sectionD.data, sectionE.data];
    const sectionsChangedSinceLastStay = Boolean(
      priorStay &&
        sections.some((s) => s && new Date(s.updated_at).getTime() > new Date(priorStay.ends_at).getTime())
    );

    setData({
      childName: summaryRow?.child_name ?? null,
      dateOfBirth: summaryRow?.date_of_birth ?? null,
      sectionB: sectionB.data ?? null,
      sectionC: sectionC.data ?? null,
      sectionD: sectionD.data ?? null,
      sectionE: sectionE.data ?? null,
      bspStrategies,
      calmCards,
      crisisPlan: plan ?? null,
      currentStayId: currentStay?.id ?? null,
      priorStayEndsAt: priorStay?.ends_at ?? null,
      sectionsChangedSinceLastStay,
    });
    setIsLoading(false);
  }, [passportId, institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  return { data, isLoading, loadError, refresh };
}
