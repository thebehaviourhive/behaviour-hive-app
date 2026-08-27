"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

export interface RosterChild {
  passportId: string;
  childName: string;
}

export interface RosterStaffMember {
  userId: string;
  fullName: string;
  role: string;
}

interface UseInstitutionRosterResult {
  isLoading: boolean;
  error: string | null;
  institutionId: string | null;
  children: RosterChild[];
  staff: RosterStaffMember[];
}

// The Incident Log's own roster source -- deliberately NOT
// useTeacherPassports. That hook is scoped to the caller's own
// passport_access + approved_by_parent, which is exactly right for ABC
// logging and exactly wrong here: stage-one child selection draws from
// the INSTITUTION roster with no approval gate (decisions 1 and 5), via
// get_institution_child_roster()/get_institution_staff_roster()
// (migration 0074) -- neither reachable through the ordinary table
// policies useTeacherPassports relies on.
export function useInstitutionRoster(userId: string | null): UseInstitutionRosterResult {
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [children, setChildren] = useState<RosterChild[]>([]);
  const [staff, setStaff] = useState<RosterStaffMember[]>([]);

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
        .is("deactivated_at", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        setError(staffError?.message ?? "Could not find your institution.");
        setIsLoading(false);
        return;
      }

      setInstitutionId(staffRow.institution_id);

      const [childRosterResult, staffRosterResult] = await Promise.all([
        supabase.rpc("get_institution_child_roster", { p_institution_id: staffRow.institution_id }),
        supabase.rpc("get_institution_staff_roster", { p_institution_id: staffRow.institution_id }),
      ]);

      if (!isMounted) return;

      if (childRosterResult.error || staffRosterResult.error) {
        setError(childRosterResult.error?.message ?? staffRosterResult.error?.message ?? "Could not load roster.");
        setIsLoading(false);
        return;
      }

      setChildren(
        (childRosterResult.data ?? []).map((row: { passport_id: string; child_name: string }) => ({
          passportId: row.passport_id,
          childName: row.child_name || "Unnamed child",
        }))
      );
      setStaff(
        (staffRosterResult.data ?? []).map((row: { user_id: string; full_name: string | null; role: string }) => ({
          userId: row.user_id,
          fullName: row.full_name || "Unnamed staff member",
          role: row.role,
        }))
      );
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [userId]);

  return { isLoading, error, institutionId, children, staff };
}
