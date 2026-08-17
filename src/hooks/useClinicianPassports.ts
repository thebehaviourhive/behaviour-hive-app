"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface ClinicianPassport {
  passportId: string;
  childName: string;
  // Clinicians see the child's full name, unlike the redacted first-name
  // view teachers get (see ClinicianPassportPage's own childFullName
  // comment) -- so unlike useTeacherPassports, displayName here is just
  // childName again. Kept as its own field anyway so callers (e.g.
  // useMessageTriage's TriageGroup) can stay role-agnostic about which
  // name form a group header should use.
  displayName: string;
}

interface UseClinicianPassportsResult {
  isLoading: boolean;
  error: string | null;
  passports: ClinicianPassport[];
  refresh: () => void;
}

// Mirrors useTeacherPassports' shape (passportId + displayName, the two
// fields useMessageTriage actually needs), but sourced from
// get_clinician_passports() -- the caller's entire actively-linked,
// verified caseload, one query, no institution join (clinicians aren't
// scoped to a single institution the way teachers are).
export function useClinicianPassports(userId: string | null): UseClinicianPassportsResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [passports, setPassports] = useState<ClinicianPassport[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;

    async function load() {
      setError(null);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_clinician_passports");

      if (!isMounted) return;

      if (rpcError) {
        setError(rpcError.message);
        setIsLoading(false);
        return;
      }

      setPassports(
        ((data ?? []) as { passport_id: string; child_name: string }[]).map((row) => ({
          passportId: row.passport_id,
          childName: row.child_name || "This child",
          displayName: row.child_name || "This child",
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [userId, refreshKey]);

  return { isLoading, error, passports, refresh };
}
