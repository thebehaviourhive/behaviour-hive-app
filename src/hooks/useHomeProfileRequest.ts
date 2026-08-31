"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "./useRequireRole";

export interface HomeProfileRecord {
  what_works_at_home: string;
  sleep: string;
  food: string;
  sensory_needs_home: string;
  history_before_this_school: string;
  previous_settings_feedback: string;
}

const EMPTY_RECORD: HomeProfileRecord = {
  what_works_at_home: "",
  sleep: "",
  food: "",
  sensory_needs_home: "",
  history_before_this_school: "",
  previous_settings_feedback: "",
};

// PRD 3, Stage 3 -- the home column's own answering flow. Deliberately
// its own hook, not folded into usePassportSectionB/C/D's pattern: this
// is request-scoped (one row per requestId, not per passport), and a
// guardian reaching a request that isn't theirs -- someone else's own
// URL, typed or guessed -- gets a clean "not found", not their co-
// guardian's private answer. The explicit .eq("recipient_id", user.id)
// below is that guard; RLS would refuse the WRITE either way (0141's
// own recipient_id = auth.uid() policy), but failing closed on the READ
// too means no accidental exposure via a misdirected link.
export function useHomeProfileRequest(requestId: string) {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [status, setStatus] = useState<"sent" | "in_progress" | "completed" | null>(null);
  const [record, setRecord] = useState<HomeProfileRecord>(EMPTY_RECORD);
  const [isLoading, setIsLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!user || !requestId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data } = await supabase
        .from("passport_home_profile_requests")
        .select(
          "passport_id, status, what_works_at_home, sleep, food, sensory_needs_home, history_before_this_school, previous_settings_feedback, passports(child_name), institutions(name)"
        )
        .eq("id", requestId)
        .eq("recipient_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (!data) {
        setNotFound(true);
        setIsLoading(false);
        return;
      }

      const passport = data.passports as unknown as { child_name: string | null } | null;
      const institution = data.institutions as unknown as { name: string } | null;

      setPassportId(data.passport_id);
      setChildName(passport?.child_name ?? null);
      setInstitutionName(institution?.name ?? null);
      setStatus(data.status as "sent" | "in_progress" | "completed");
      setRecord({
        what_works_at_home: data.what_works_at_home ?? "",
        sleep: data.sleep ?? "",
        food: data.food ?? "",
        sensory_needs_home: data.sensory_needs_home ?? "",
        history_before_this_school: data.history_before_this_school ?? "",
        previous_settings_feedback: data.previous_settings_feedback ?? "",
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, requestId]);

  async function save(
    updates: Partial<HomeProfileRecord>,
    nextStatus: "in_progress" | "completed"
  ): Promise<string | null> {
    if (!user) return "Not signed in.";
    const merged = { ...record, ...updates };
    const supabase = createClient();
    const { error } = await supabase
      .from("passport_home_profile_requests")
      .update({ ...merged, status: nextStatus })
      .eq("id", requestId)
      .eq("recipient_id", user.id);

    if (!error) {
      setRecord(merged);
      setStatus(nextStatus);
    }
    return error?.message ?? null;
  }

  return {
    isReady: isRoleReady && !isLoading,
    notFound,
    passportId,
    childName,
    institutionName,
    status,
    record,
    save,
  };
}
