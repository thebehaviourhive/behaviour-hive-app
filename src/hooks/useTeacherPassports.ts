"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName, getChildFirstName } from "@/lib/childDisplayName";

export interface TeacherPassport {
  passportId: string;
  childName: string;
  firstName: string;
  displayName: string;
  diagnoses: string[] | null;
  diagnosisOther: string | null;
}

interface UseTeacherPassportsResult {
  isLoading: boolean;
  error: string | null;
  institutionId: string | null;
  institutionCode: string | null;
  passports: TeacherPassport[];
  refresh: () => void;
}

// A passport_access row alone isn't enough to count as "this teacher's
// student" -- the parent's approval (passport_institution_links) must also
// be in place, otherwise revoking either side wouldn't drop the child from
// view. This join is the one true definition of "real student" shared by
// the dashboard stats, morning grid, ABC log passport-select, and the
// Students page -- kept in one place rather than four copies of the same
// two-step query.
export function useTeacherPassports(userId: string | null): UseTeacherPassportsResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionCode, setInstitutionCode] = useState<string | null>(null);
  const [passports, setPassports] = useState<TeacherPassport[]>([]);
  const [refreshKey, setRefreshKey] = useState(0);

  const refresh = useCallback(() => setRefreshKey((k) => k + 1), []);

  useEffect(() => {
    if (!userId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      setError(null);

      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", userId)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError) {
        setError(staffError.message);
        setIsLoading(false);
        return;
      }

      if (!staffRow) {
        setInstitutionId(null);
        setInstitutionCode(null);
        setPassports([]);
        setIsLoading(false);
        return;
      }

      setInstitutionId(staffRow.institution_id);

      const { data: institutionRow } = await supabase
        .from("institutions")
        .select("institution_code")
        .eq("id", staffRow.institution_id)
        .maybeSingle();

      if (!isMounted) return;
      setInstitutionCode(institutionRow?.institution_code ?? null);

      const { data: accessRows, error: accessError } = await supabase
        .from("passport_access")
        .select("passport_id, institution_id")
        .eq("teacher_id", userId)
        .eq("is_active", true);

      if (!isMounted) return;

      if (accessError) {
        setError(accessError.message);
        setIsLoading(false);
        return;
      }

      const candidatePassportIds = Array.from(
        new Set((accessRows ?? []).map((row) => row.passport_id))
      );

      if (candidatePassportIds.length === 0) {
        setPassports([]);
        setIsLoading(false);
        return;
      }

      const { data: linkRows, error: linkError } = await supabase
        .from("passport_institution_links")
        .select("passport_id, institution_id")
        .in("passport_id", candidatePassportIds)
        .eq("approved_by_parent", true);

      if (!isMounted) return;

      if (linkError) {
        setError(linkError.message);
        setIsLoading(false);
        return;
      }

      const approvedPairs = new Set(
        (linkRows ?? []).map((row) => `${row.passport_id}|${row.institution_id}`)
      );

      const passportIds = (accessRows ?? [])
        .filter((row) => approvedPairs.has(`${row.passport_id}|${row.institution_id}`))
        .map((row) => row.passport_id);

      if (passportIds.length === 0) {
        setPassports([]);
        setIsLoading(false);
        return;
      }

      const { data: passportRows, error: passportError } = await supabase
        .from("passports")
        .select("id, child_name, diagnoses, diagnosis_other")
        .in("id", passportIds);

      if (!isMounted) return;

      if (passportError) {
        setError(passportError.message);
        setIsLoading(false);
        return;
      }

      setPassports(
        (passportRows ?? []).map((row) => ({
          passportId: row.id,
          childName: row.child_name || "This child",
          firstName: getChildFirstName(row.child_name),
          displayName: getChildDisplayName(row.child_name),
          diagnoses: row.diagnoses,
          diagnosisOther: row.diagnosis_other,
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [userId, refreshKey]);

  return { isLoading, error, institutionId, institutionCode, passports, refresh };
}
