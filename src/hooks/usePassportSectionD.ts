"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";
import { useMyPassport } from "./useMyPassport";

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

// PRD 3, Stage 1 -- see usePassportSectionB.ts's own header note for
// the full reasoning; this hook matches it exactly. passportId is
// still returned (now sourced from useMyPassport() rather than its own
// local state) -- section-d/4/page.tsx's own passport_status="complete"
// update reads it directly.
export function usePassportSectionD() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const { passportId, isLoading: isLoadingPassportId } = useMyPassport(user?.id);
  const [record, setRecord] = useState<SectionDRecord>(EMPTY_RECORD);
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
      const { data: sectionD } = await supabase
        .from("passport_section_d")
        .select(
          "before_behaviour, before_behaviour_other, during_distress, during_distress_other, after_distress, after_distress_other, sensory_seeks, sensory_seeks_other, sensory_avoids, sensory_avoids_other, section_d_complete"
        )
        .eq("passport_id", passportId)
        .maybeSingle();

      if (!isMounted) return;

      if (sectionD) {
        setRecord(sectionD);
        setHasExistingRow(true);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, passportId, isLoadingPassportId]);

  async function save(updates: Partial<SectionDRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";
    if (!passportId) return "No passport to save to yet.";

    const merged = { ...record, ...updates };
    const supabase = createClient();

    const { error } = hasExistingRow
      ? await supabase
          .from("passport_section_d")
          .update({ user_id: user.id, ...merged })
          .eq("passport_id", passportId)
      : await supabase
          .from("passport_section_d")
          .insert({ user_id: user.id, passport_id: passportId, ...merged });

    if (!error) {
      setRecord(merged);
      setHasExistingRow(true);
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
