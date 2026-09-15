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

      // approved_at is not null alongside deactivated_at is null -- see
      // useTeacherPassports.ts's matching comment; a pending or rejected
      // caller must resolve as "no institution" here too.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", userId)
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
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

      // QA run-through, item 3: a child whose enrolment has ended still
      // appeared here, selectable for a brand new incident. get_
      // institution_child_roster() (live def: migration 0129) already
      // returns enrolment_ended_at (added 0122, deliberately non-
      // filtering at the RPC level so callers could opt in) -- this is
      // that opt-in, since this is genuinely a NEW-record picker, not a
      // browse view: an incident about a still-enrolled child needs
      // every current member of staff selectable regardless of THEIR
      // own individual has_child_access(), which is exactly why this
      // hook exists instead of useTeacherPassports -- but "no approval
      // gate on the STAFF side" was never meant to also mean "no
      // enrolment gate on the CHILD side".
      setChildren(
        (childRosterResult.data ?? [])
          .filter((row: { enrolment_ended_at: string | null }) => !row.enrolment_ended_at)
          .map((row: { passport_id: string; child_name: string }) => ({
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
