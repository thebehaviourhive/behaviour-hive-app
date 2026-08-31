"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";
import { useMyPassport } from "./useMyPassport";

export interface SectionBRecord {
  okay_signals: string[] | null;
  okay_signals_other: string | null;
  hard_signals: string[] | null;
  hard_signals_other: string | null;
  hard_triggers: string[] | null;
  hard_triggers_other: string | null;
  section_b_complete: boolean;
}

const EMPTY_RECORD: SectionBRecord = {
  okay_signals: null,
  okay_signals_other: null,
  hard_signals: null,
  hard_signals_other: null,
  hard_triggers: null,
  hard_triggers_other: null,
  section_b_complete: false,
};

// PRD 3, Stage 1 -- matches passport/section-a/page.tsx's own fix
// exactly, same two reasons: resolve the passport via useMyPassport()
// (guardian-aware, works for both origins -- the old .eq("user_id",
// user.id) read found nothing for a claimed guardian, correctly
// diagnosed as a NOT NULL violation waiting to happen the moment they
// tried to save, since passport_id is NOT NULL on this table), then
// branch explicitly instead of upserting. No .select() chained on
// either branch -- unlike passports, this table's SELECT policy
// (owns_passport(passport_id), 0138) never depends on anything THIS
// statement creates (the passport_guardians row it needs already
// exists, from Section A's own earlier save or the claim flow), so
// there's no same-statement race here -- but the discipline is the
// same regardless: don't request representation you don't need.
// user_id IS included in every write, insert or update -- unlike
// passports.user_id, this column carries no dual-write-trigger
// meaning, just "who most recently wrote this" (WITH CHECK requires
// it), matching morning_checkins' own established own-contributor
// semantics.
export function usePassportSectionB() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const { passportId, isLoading: isLoadingPassportId } = useMyPassport(user?.id);
  const [record, setRecord] = useState<SectionBRecord>(EMPTY_RECORD);
  const [hasExistingRow, setHasExistingRow] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user || isLoadingPassportId) return;

    if (!passportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoading(false);
      return;
    }

    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: sectionB } = await supabase
        .from("passport_section_b")
        .select(
          "okay_signals, okay_signals_other, hard_signals, hard_signals_other, hard_triggers, hard_triggers_other, section_b_complete"
        )
        .eq("passport_id", passportId)
        .maybeSingle();

      if (!isMounted) return;

      if (sectionB) {
        setRecord(sectionB);
        setHasExistingRow(true);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, passportId, isLoadingPassportId]);

  async function save(updates: Partial<SectionBRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";
    if (!passportId) return "No passport to save to yet.";

    const merged = { ...record, ...updates };
    const supabase = createClient();

    const { error } = hasExistingRow
      ? await supabase
          .from("passport_section_b")
          .update({ user_id: user.id, ...merged })
          .eq("passport_id", passportId)
      : await supabase
          .from("passport_section_b")
          .insert({ user_id: user.id, passport_id: passportId, ...merged });

    if (!error) {
      setRecord(merged);
      setHasExistingRow(true);
    }

    return error?.message ?? null;
  }

  return {
    user,
    record,
    isReady: isRoleReady && !isLoading,
    save,
  };
}
