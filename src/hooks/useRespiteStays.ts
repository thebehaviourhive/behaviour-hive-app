"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RespiteStay {
  id: string;
  startsAt: string;
  endsAt: string;
  status: "upcoming" | "current" | "completed";
}

// TIER 1 of the reachability pass -- create_respite_stay(),
// activate_respite_stay(), and close_respite_activation() all had real,
// verified RPCs and zero client callers anywhere. This hook is the
// centre_manager's own single data source for a placement's stays plus
// the actions on them; get_respite_stays_for_placement() takes an
// EPISODE id, not a passport id -- the caller resolves that first (see
// StaysSection.tsx).
export function useRespiteStays(episodeId: string | null) {
  const [stays, setStays] = useState<RespiteStay[]>([]);
  const [activeStayIds, setActiveStayIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!episodeId) {
      setIsLoading(false);
      return;
    }
    const supabase = createClient();
    const { data, error: err } = await supabase.rpc("get_respite_stays_for_placement", {
      p_episode_id: episodeId,
    });

    if (err) {
      console.error("Failed to load stays:", err);
      setIsLoading(false);
      return;
    }

    const rows = (data ?? []) as { id: string; starts_at: string; ends_at: string; status: RespiteStay["status"] }[];
    setStays(rows.map((r) => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, status: r.status })));

    // Which of these stays currently has an OPEN activation -- read
    // directly off respite_activations (institution-wide, any current-
    // standing staff, matching that table's own metadata-only posture).
    if (rows.length > 0) {
      const { data: openActivations } = await supabase
        .from("respite_activations")
        .select("stay_id")
        .in("stay_id", rows.map((r) => r.id))
        .is("closed_at", null);
      setActiveStayIds(new Set((openActivations ?? []).map((a) => a.stay_id)));
    } else {
      setActiveStayIds(new Set());
    }

    setIsLoading(false);
  }, [episodeId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    refresh();
  }, [refresh]);

  const scheduleStay = useCallback(
    async (startsAt: Date, endsAt: Date) => {
      if (!episodeId) return false;
      setError(null);
      const supabase = createClient();
      const { error: err } = await supabase.rpc("create_respite_stay", {
        p_episode_id: episodeId,
        p_starts_at: startsAt.toISOString(),
        p_ends_at: endsAt.toISOString(),
      });
      if (err) {
        setError(err.message);
        return false;
      }
      await refresh();
      return true;
    },
    [episodeId, refresh]
  );

  const activate = useCallback(
    async (stayId: string) => {
      setError(null);
      const supabase = createClient();
      const { error: err } = await supabase.rpc("activate_respite_stay", { p_stay_id: stayId });
      if (err) {
        setError(err.message);
        return false;
      }
      await refresh();
      return true;
    },
    [refresh]
  );

  const closeActivation = useCallback(
    async (stayId: string) => {
      setError(null);
      const supabase = createClient();
      // No client-facing "get the open activation's own id" RPC exists,
      // so resolve it directly -- respite_activations' own read policy
      // (any current-standing staff at the centre) already covers this.
      const { data: activation, error: lookupErr } = await supabase
        .from("respite_activations")
        .select("id")
        .eq("stay_id", stayId)
        .is("closed_at", null)
        .maybeSingle();
      if (lookupErr || !activation) {
        setError(lookupErr?.message ?? "No open activation found for this stay.");
        return false;
      }
      const { error: err } = await supabase.rpc("close_respite_activation", { p_activation_id: activation.id });
      if (err) {
        setError(err.message);
        return false;
      }
      await refresh();
      return true;
    },
    [refresh]
  );

  return { stays, activeStayIds, isLoading, error, scheduleStay, activate, closeActivation, refresh };
}
