"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RespiteReportCheckin {
  id: string;
  checkInType: "morning" | "end_of_day";
  checkInDate: string;
  note: string | null;
}

export interface RespiteReportAbcEntry {
  id: string;
  incidentDate: string;
  behaviours: string[];
  behaviourOther: string | null;
}

export interface RespiteStayReportData {
  stayId: string;
  passportId: string;
  childName: string | null;
  startsAt: string;
  endsAt: string;
  existingReportId: string | null;
  existingBody: string | null;
  finalizedAt: string | null;
  checkins: RespiteReportCheckin[];
  abcEntries: RespiteReportAbcEntry[];
}

// TIER 2 of the reachability pass -- finalize_respite_stay_report() and
// get_respite_stays_awaiting_report() both had real, verified RPCs and
// no screen. This hook assembles the reference material a manager
// reviews before writing the report body: check-ins (placement-scoped,
// reliably readable regardless of activation state -- 0299/0300/0302)
// and ABC entries for THIS STAY specifically -- get_abc_logs() has no
// stay_id in its own return shape by design (0298/0299's own comments),
// so the stay-scoped id whitelist is resolved via a SEPARATE raw query
// selecting only {id, stay_id}, never perceived_function, then joined
// client-side against get_abc_logs()'s already-redacted rows.
//
// Handover messages are NOT assembled here -- Stage 5's own decision
// made handover activation-scoped for BOTH roles (unlike every other
// Stage 4 target, which stays placement-scoped for the manager). Once
// this stay's activation closes -- which finalize_respite_stay_report()
// does atomically, in the same transaction as finalising -- handover
// messages for this stay may become unreadable to the manager. The
// report screen itself reads them (via useMessageThread, the same
// component RespiteChildRecord already uses) BEFORE finalising, while
// the activation is still open; this hook stays out of that so the
// report screen's own message thread can refresh independently.
export function useRespiteReport(stayId: string | null) {
  const [data, setData] = useState<RespiteStayReportData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [isFinalizing, setIsFinalizing] = useState(false);

  const refresh = useCallback(async () => {
    if (!stayId) {
      setIsLoading(false);
      return;
    }
    setLoadError(null);
    const supabase = createClient();

    const { data: stay, error: stayErr } = await supabase
      .from("respite_stays")
      .select("id, passport_id, starts_at, ends_at")
      .eq("id", stayId)
      .maybeSingle();

    if (stayErr || !stay) {
      setLoadError(stayErr?.message ?? "Couldn't find this stay.");
      setIsLoading(false);
      return;
    }

    const [summary, report, checkinRows, stayAbcIds] = await Promise.all([
      supabase.rpc("get_respite_child_summary", { p_passport_id: stay.passport_id }),
      supabase
        .from("respite_post_stay_reports")
        .select("id, body, finalized_at")
        .eq("stay_id", stayId)
        .maybeSingle(),
      supabase
        .from("respite_stay_checkins")
        .select("id, check_in_type, check_in_date, note")
        .eq("stay_id", stayId)
        .order("checked_in_at", { ascending: true }),
      // Deliberately {id, stay_id} only -- never perceived_function.
      supabase.from("abc_logs").select("id, stay_id").eq("passport_id", stay.passport_id).eq("stay_id", stayId),
    ]);

    const stayAbcIdSet = new Set((stayAbcIds.data ?? []).map((r) => r.id as string));
    let abcEntries: RespiteReportAbcEntry[] = [];
    if (stayAbcIdSet.size > 0) {
      const { data: logsRpc } = await supabase.rpc("get_abc_logs", { p_passport_id: stay.passport_id });
      abcEntries = ((logsRpc ?? []) as { id: string; incident_date: string; behaviours: string[] | null; behaviour_other: string | null }[])
        .filter((l) => stayAbcIdSet.has(l.id))
        .map((l) => ({
          id: l.id,
          incidentDate: l.incident_date,
          behaviours: l.behaviours ?? [],
          behaviourOther: l.behaviour_other,
        }));
    }

    setData({
      stayId: stay.id,
      passportId: stay.passport_id,
      childName: summary.data?.[0]?.child_name ?? null,
      startsAt: stay.starts_at,
      endsAt: stay.ends_at,
      existingReportId: report.data?.id ?? null,
      existingBody: report.data?.body ?? null,
      finalizedAt: report.data?.finalized_at ?? null,
      checkins: (checkinRows.data ?? []).map((c) => ({
        id: c.id,
        checkInType: c.check_in_type,
        checkInDate: c.check_in_date,
        note: c.note,
      })),
      abcEntries,
    });
    setIsLoading(false);
  }, [stayId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const finalize = useCallback(
    async (body: string) => {
      if (!stayId) return false;
      setFinalizeError(null);
      setIsFinalizing(true);
      const supabase = createClient();
      const { error } = await supabase.rpc("finalize_respite_stay_report", {
        p_stay_id: stayId,
        p_body: body,
      });
      setIsFinalizing(false);
      if (error) {
        setFinalizeError(error.message);
        return false;
      }
      await refresh();
      return true;
    },
    [stayId, refresh]
  );

  return { data, isLoading, loadError, refresh, finalize, isFinalizing, finalizeError };
}
