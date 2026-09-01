"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName, getChildFirstName } from "@/lib/childDisplayName";

interface AccessibleChildRow {
  passport_id: string;
  child_name: string;
  diagnoses: string[] | null;
  diagnosis_other: string | null;
  access_source: "direct_grant" | "class_teacher" | "class_sna";
  source_detail: string | null;
}

export interface TeacherPassport {
  passportId: string;
  childName: string;
  firstName: string;
  displayName: string;
  diagnoses: string[] | null;
  diagnosisOther: string | null;
  // Optional -- only get_my_accessible_children()'s own rows carry a
  // real value. useSnaChildren.ts extends this same interface (SnaChild)
  // for two OTHER sources this migration didn't touch (temporary class
  // cover, 1:1 child_assignments) -- it already carries its own
  // isTemporary/isAssigned flags for those, so leaving these undefined
  // there is honest, not a gap: neither source maps onto this
  // three-value vocabulary without inventing a meaning it doesn't have.
  accessSource?: "direct_grant" | "class_teacher" | "class_sna";
  sourceDetail?: string | null;
}

interface UseTeacherPassportsResult {
  isLoading: boolean;
  error: string | null;
  institutionId: string | null;
  institutionCode: string | null;
  passports: TeacherPassport[];
  refresh: () => void;
}

// The thirteenth instance of "access granted correctly, screens read
// the wrong thing" -- this hook's own query used to be exactly that
// wrong thing. It read passport_access directly, with no idea
// class_children/class_teachers/class_sna_assignments exist, so a
// class-assigned teacher with zero passport_access rows was invisible
// to every one of the five surfaces sharing this hook (Students,
// dashboard, ABC log picker, messages, and via useTeacherMorningCheckins,
// the morning grid and morning-updates page) -- even though
// has_class_teacher_access() (0104, widened 0130) has always correctly
// granted them real RLS-level access underneath. Confirmed empirically
// before this fix (migration 0148): a real fixture, class-only teacher,
// zero passport_access rows, passport SELECT/ABC insert/teacher_update
// insert all worked as that teacher's own session -- the database was
// never the problem, this query was.
//
// get_my_accessible_children() (0148) is the one true definition of
// "this teacher's students" now, in the database, not here -- every
// source (direct grant, class-teacher membership, class-tier SNA
// assignment) in one call, so the next access source added has to be
// remembered in one function, not this hook.
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

      // approved_at is not null alongside deactivated_at is null -- a
      // pending or rejected row must resolve the same as "no row at all"
      // here, so this hook's existing "no institution -> join form"
      // fallback (every dashboard using this hook already redirects on a
      // null institutionId) correctly bounces them to join-institution's
      // own four-way status page, not a broken empty dashboard.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", userId)
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
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

      const { data: childRows, error: childError } = await supabase.rpc("get_my_accessible_children");

      if (!isMounted) return;

      if (childError) {
        setError(childError.message);
        setIsLoading(false);
        return;
      }

      setPassports(
        ((childRows ?? []) as AccessibleChildRow[]).map((row) => ({
          passportId: row.passport_id,
          childName: row.child_name || "This child",
          firstName: getChildFirstName(row.child_name),
          displayName: getChildDisplayName(row.child_name),
          diagnoses: row.diagnoses,
          diagnosisOther: row.diagnosis_other,
          accessSource: row.access_source,
          sourceDetail: row.source_detail,
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
