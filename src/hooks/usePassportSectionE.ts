"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";
import { useMyPassport } from "./useMyPassport";

export interface SectionERecord {
  allergies: string | null;
  medical_conditions: string | null;
  medications: string | null;
  emergency_protocol: string | null;
  intimate_care_needs: string | null;
  section_e_complete: boolean;
}

const EMPTY_RECORD: SectionERecord = {
  allergies: null,
  medical_conditions: null,
  medications: null,
  emergency_protocol: null,
  intimate_care_needs: null,
  section_e_complete: false,
};

// Medical and intimate care needs -- new Section E. Same shape as
// usePassportSectionB/C/D.ts exactly (guardian-based auth via
// useMyPassport(), explicit insert-vs-update on passport_id, never a
// user_id-keyed upsert) -- a proven-correct pattern copied, not a new
// one invented for this section.
export function usePassportSectionE() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const { passportId, isLoading: isLoadingPassportId } = useMyPassport(user?.id);
  const [record, setRecord] = useState<SectionERecord>(EMPTY_RECORD);
  const [hasExistingRow, setHasExistingRow] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);

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
      const { data: sectionE } = await supabase
        .from("passport_section_e")
        .select(
          "allergies, medical_conditions, medications, emergency_protocol, intimate_care_needs, section_e_complete, updated_at"
        )
        .eq("passport_id", passportId)
        .maybeSingle();

      if (!isMounted) return;

      if (sectionE) {
        const { updated_at, ...rest } = sectionE;
        setRecord(rest);
        setUpdatedAt(updated_at);
        setHasExistingRow(true);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, passportId, isLoadingPassportId]);

  async function save(updates: Partial<SectionERecord>): Promise<string | null> {
    if (!user) return "Not signed in.";
    if (!passportId) return "No passport to save to yet.";

    const merged = { ...record, ...updates };
    const supabase = createClient();

    const { data, error } = hasExistingRow
      ? await supabase
          .from("passport_section_e")
          .update({ user_id: user.id, ...merged })
          .eq("passport_id", passportId)
          .select("updated_at")
          .single()
      : await supabase
          .from("passport_section_e")
          .insert({ user_id: user.id, passport_id: passportId, ...merged })
          .select("updated_at")
          .single();

    if (!error) {
      setRecord(merged);
      setHasExistingRow(true);
      setUpdatedAt(data?.updated_at ?? null);
    }

    return error?.message ?? null;
  }

  return {
    user,
    passportId,
    record,
    updatedAt,
    isReady: isRoleReady && !isLoading,
    save,
  };
}
