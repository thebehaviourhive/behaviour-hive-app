"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";

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

export function usePassportSectionC() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [record, setRecord] = useState<SectionCRecord>(EMPTY_RECORD);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const [{ data: passport }, { data: sectionC }] = await Promise.all([
        supabase
          .from("passports")
          .select("id, child_name")
          .eq("user_id", user!.id)
          .maybeSingle(),
        supabase
          .from("passport_section_c")
          .select(
            "communication_methods, communication_methods_other, shows_happy, shows_anxious, phrases_to_avoid, section_c_complete"
          )
          .eq("user_id", user!.id)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      setPassportId(passport?.id ?? null);
      setChildName(passport?.child_name ?? null);
      if (sectionC) {
        setRecord(sectionC);
      }
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  async function save(updates: Partial<SectionCRecord>): Promise<string | null> {
    if (!user) return "Not signed in.";

    const merged = { ...record, ...updates };
    const supabase = createClient();
    const { error } = await supabase.from("passport_section_c").upsert(
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
    childName,
    record,
    isReady: isRoleReady && !isLoading,
    save,
  };
}
