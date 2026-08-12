"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface CalmEscalationNotice {
  id: string;
  passportId: string;
  childName: string;
  occurredAt: string;
}

// The clinician dashboard's persisting red card (constraint 3B). Two
// plain queries, not a PostgREST embedded-resource select (no existing
// precedent for that pattern anywhere else in this codebase's client
// code) -- fetch unacknowledged notices (calm_escalation_notices' own
// RLS already scopes to verified, actively-linked clinicians), then
// resolve child_name for the passports involved, same two-step shape
// ReviewSection.tsx's own separate childName fetch already uses.
export function useCalmEscalationNotices() {
  const [notices, setNotices] = useState<CalmEscalationNotice[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const reload = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();

    const { data: noticeRows, error } = await supabase
      .from("calm_escalation_notices")
      .select("id, passport_id, occurred_at")
      .is("acknowledged_at", null)
      .order("occurred_at", { ascending: false });

    if (error) {
      console.error("Failed to load calm escalation notices:", error);
      setIsLoading(false);
      return;
    }

    const passportIds = Array.from(new Set((noticeRows ?? []).map((r) => r.passport_id)));
    let childNameByPassport = new Map<string, string>();
    if (passportIds.length > 0) {
      const { data: passportRows } = await supabase
        .from("passports")
        .select("id, child_name")
        .in("id", passportIds);
      childNameByPassport = new Map((passportRows ?? []).map((p) => [p.id, p.child_name as string]));
    }

    setNotices(
      (noticeRows ?? []).map((row) => ({
        id: row.id,
        passportId: row.passport_id,
        childName: childNameByPassport.get(row.passport_id) ?? "A child",
        occurredAt: row.occurred_at,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    reload();
  }, [reload]);

  async function acknowledge(noticeId: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("acknowledge_calm_escalation", { p_notice_id: noticeId });
    if (error) throw error;
    setNotices((prev) => prev.filter((n) => n.id !== noticeId));
  }

  return { notices, isLoading, reload, acknowledge };
}
