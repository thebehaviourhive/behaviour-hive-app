"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";
import { useMyPassport } from "./useMyPassport";

export interface SectionCRecord {
  communication_methods: string[] | null;
  communication_methods_other: string | null;
  shows_happy: string | null;
  shows_anxious: string | null;
  phrases_to_avoid: string | null;
  section_c_complete: boolean;
}

const EMPTY_RECORD: SectionCRecord = {
  communication_methods: null,
  communication_methods_other: null,
  shows_happy: null,
  shows_anxious: null,
  phrases_to_avoid: null,
  section_c_complete: false,
};

// PRD 3, Stage 1 -- see usePassportSectionB.ts's own header note for
// the full reasoning; this hook matches it exactly, including
// childName -- kept as its own field (not folded into record) because
// it comes from passports, not passport_section_c, same as before.
export function usePassportSectionC() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const { passportId, childName, isLoading: isLoadingPassportId } = useMyPassport(user?.id);
  const [record, setRecord] = useState<SectionCRecord>(EMPTY_RECORD);
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
      const { data: sectionC } = await supabase
        .from("passport_section_c")
        .select(
          "communication_methods, communication_methods_other, shows_happy, shows_anxious, phrases_to_avoid, section_c_complete"
        )
        .eq("passport_id", passportId)
        .maybeSingle();

      if (!isMounted) return;

      if (sectionC) {
        setRecord(sectionC);
        setHasExistingRow(true);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, passportId, isLoadingPassportId]);

  async function save(updates: Partial<SectionCRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";
    if (!passportId) return "No passport to save to yet.";

    const merged = { ...record, ...updates };
    const supabase = createClient();

    const { error } = hasExistingRow
      ? await supabase
          .from("passport_section_c")
          .update({ user_id: user.id, ...merged })
          .eq("passport_id", passportId)
      : await supabase
          .from("passport_section_c")
          .insert({ user_id: user.id, passport_id: passportId, ...merged });

    if (!error) {
      setRecord(merged);
      setHasExistingRow(true);
    }

    return error?.message ?? null;
  }

  return {
    user,
    childName,
    record,
    isReady: isRoleReady && !isLoading,
    save,
  };
}
