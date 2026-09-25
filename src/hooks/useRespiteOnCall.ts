"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Institution-scoped, never stay- or activation-scoped -- readable by
// any current-standing staff at the centre before any child's record is
// activated for them, matching the RLS policy's own posture exactly.
// "Current" is just the latest row by set_at; no derived status column.
export interface OnCallDesignation {
  name: string;
  phone: string;
  onCallUntil: string;
  setAt: string;
}

export function useRespiteOnCall(institutionId: string | null) {
  const [current, setCurrent] = useState<OnCallDesignation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!institutionId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error: err } = await supabase
      .from("respite_on_call_designations")
      .select("name, phone, on_call_until, set_at")
      .eq("institution_id", institutionId)
      .order("set_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (err) {
      console.error("Failed to load on-call designation:", err);
      setIsLoading(false);
      return;
    }

    setCurrent(data ? { name: data.name, phone: data.phone, onCallUntil: data.on_call_until, setAt: data.set_at } : null);
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const setOnCall = useCallback(
    async (name: string, phone: string, until: Date) => {
      if (!institutionId) return false;
      setError(null);
      const supabase = createClient();
      const { error: err } = await supabase.rpc("set_on_call", {
        p_institution_id: institutionId,
        p_name: name,
        p_phone: phone,
        p_until: until.toISOString(),
      });
      if (err) {
        setError(err.message);
        return false;
      }
      await refresh();
      return true;
    },
    [institutionId, refresh]
  );

  return { current, isLoading, error, setOnCall, refresh };
}
