"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";

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

export function usePassportSectionB() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [record, setRecord] = useState<SectionBRecord>(EMPTY_RECORD);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const [{ data: passport }, { data: sectionB }] = await Promise.all([
        supabase.from("passports").select("id").eq("user_id", user!.id).maybeSingle(),
        supabase
          .from("passport_section_b")
          .select(
            "okay_signals, okay_signals_other, hard_signals, hard_signals_other, hard_triggers, hard_triggers_other, section_b_complete"
          )
          .eq("user_id", user!.id)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      setPassportId(passport?.id ?? null);
      if (sectionB) {
        setRecord(sectionB);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  async function save(updates: Partial<SectionBRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";

    const merged = { ...record, ...updates };
    const supabase = createClient();
    const { error } = await supabase.from("passport_section_b").upsert(
      {
        user_id: user.id,
        passport_id: passportId,
        ...merged,
      },
      { onConflict: "user_id" }
    );

    if (!error) {
      setRecord(merged);
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
