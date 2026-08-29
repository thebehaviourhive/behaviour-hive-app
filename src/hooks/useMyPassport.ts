"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface MyPassportSummary {
  passportId: string | null;
  childName: string | null;
  hasMultiple: boolean;
  isLoading: boolean;
  error: boolean;
}

// PRD 1, Stage 5, Step 3 -- the single canonical resolver for "the
// signed-in parent's own passport", replacing the fourteen independent
// .from("passports").eq("user_id", user.id).maybeSingle() queries this
// app used to have scattered across it. Each of those had two real bugs:
//
// (a) INVISIBILITY -- a CLAIMED passport (guardianship recorded in
//     passport_guardians, migration 0113) has no row where
//     passports.user_id equals the claiming guardian's own id, so every
//     one of those fourteen queries returned null for a guardian who had
//     just successfully claimed their child's passport.
// (b) CRASH -- .maybeSingle() throws the moment two rows match, which
//     couldn't happen under the old one-owner-per-passport model but is
//     now a real possibility (passports.user_id unique still holds one
//     passport per column value, but a parent can now be a guardian --
//     via passport_guardians -- of more than one child's passport at
//     once).
//
// get_my_passports() (migration 0114) is SECURITY DEFINER and resolves
// via passport_guardians directly, so it sees a claimed passport
// correctly and returns a LIST rather than crashing on more than one.
//
// SCOPE: takes the FIRST passport only (the RPC's own ordering --
// alphabetical by child_name) when a parent has more than one. There is
// no multi-child switcher UI yet -- that's real, separate, future work,
// not attempted here. hasMultiple is returned specifically so a screen
// CAN surface "you have more than one child" if it chooses to, rather
// than the limitation being silently invisible.
export function useMyPassport(userId: string | null | undefined): MyPassportSummary {
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [hasMultiple, setHasMultiple] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_my_passports");

      if (!isMounted) return;

      if (rpcError) {
        console.error("Failed to load passports:", rpcError);
        setError(true);
        setIsLoading(false);
        return;
      }

      const rows = (data ?? []) as { passport_id: string; child_name: string }[];
      setPassportId(rows[0]?.passport_id ?? null);
      setChildName(rows[0]?.child_name ?? null);
      setHasMultiple(rows.length > 1);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  return { passportId, childName, hasMultiple, isLoading, error };
}
