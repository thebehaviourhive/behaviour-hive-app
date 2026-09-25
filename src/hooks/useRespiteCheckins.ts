"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RespiteCheckin {
  id: string;
  checkInType: "morning" | "end_of_day";
  checkInDate: string;
  checkedInAt: string;
  note: string | null;
}

// stay_id-keyed, not "today"-keyed -- see migration 0302's own header
// for why morning_checkins couldn't be reused here.
export function useRespiteCheckins(stayId: string | null) {
  const [checkins, setCheckins] = useState<RespiteCheckin[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!stayId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("respite_stay_checkins")
      .select("id, check_in_type, check_in_date, checked_in_at, note")
      .eq("stay_id", stayId)
      .order("checked_in_at", { ascending: false });

    if (err) {
      console.error("Failed to load check-ins:", err);
      setIsLoading(false);
      return;
    }

    setCheckins(
      (data ?? []).map((row) => ({
        id: row.id,
        checkInType: row.check_in_type,
        checkInDate: row.check_in_date,
        checkedInAt: row.checked_in_at,
        note: row.note,
      }))
    );
    setIsLoading(false);
  }, [stayId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const recordCheckin = useCallback(
    async (type: "morning" | "end_of_day", note?: string) => {
      if (!stayId) return false;
      setError(null);
      const supabase = createClient();
      const { error: err } = await supabase.rpc("record_respite_stay_checkin", {
        p_stay_id: stayId,
        p_check_in_type: type,
        p_note: note ?? null,
      });
      if (err) {
        setError(err.message);
        return false;
      }
      await refresh();
      return true;
    },
    [stayId, refresh]
  );

  const todayDate = new Date().toISOString().slice(0, 10);
  const hasMorningToday = checkins.some((c) => c.checkInType === "morning" && c.checkInDate === todayDate);
  const hasEndOfDayToday = checkins.some((c) => c.checkInType === "end_of_day" && c.checkInDate === todayDate);

  return { checkins, isLoading, error, recordCheckin, hasMorningToday, hasEndOfDayToday, refresh };
}
