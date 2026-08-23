"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";

export interface SectionDRecord {
  before_behaviour: string[] | null;
  before_behaviour_other: string | null;
  during_distress: string[] | null;
  during_distress_other: string | null;
  after_distress: string[] | null;
  after_distress_other: string | null;
  sensory_seeks: string[] | null;
  sensory_seeks_other: string | null;
  sensory_avoids: string[] | null;
  sensory_avoids_other: string | null;
  section_d_complete: boolean;
}

const EMPTY_RECORD: SectionDRecord = {
  before_behaviour: null,
  before_behaviour_other: null,
  during_distress: null,
  during_distress_other: null,
  after_distress: null,
  after_distress_other: null,
  sensory_seeks: null,
  sensory_seeks_other: null,
  sensory_avoids: null,
  sensory_avoids_other: null,
  section_d_complete: false,
};

export function usePassportSectionD() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [record, setRecord] = useState<SectionDRecord>(EMPTY_RECORD);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const [{ data: passport }, { data: sectionD }] = await Promise.all([
        supabase.from("passports").select("id").eq("user_id", user!.id).maybeSingle(),
        supabase
          .from("passport_section_d")
          .select(
            "before_behaviour, before_behaviour_other, during_distress, during_distress_other, after_distress, after_distress_other, sensory_seeks, sensory_seeks_other, sensory_avoids, sensory_avoids_other, section_d_complete"
          )
          .eq("user_id", user!.id)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      setPassportId(passport?.id ?? null);
      if (sectionD) {
        setRecord(sectionD);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  async function save(updates: Partial<SectionDRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";

    const merged = { ...record, ...updates };
    const supabase = createClient();
    const { error } = await supabase.from("passport_section_d").upsert(
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
    passportId,
    record,
    isReady: isRoleReady && !isLoading,
    save,
  };
}
