"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Extracted after the pending-approval misdiagnosis was found and fixed
// three separate times, on three separate dashboards (clinic_admin,
// clinical_lead, centre_manager), each rediscovering the same shape from
// scratch: a genuinely PENDING join (approved_at null, rejected_at null)
// was misdiagnosed as "missing" and shown a scary generic error -- an
// ordinary, expected state treated as a failure. care_staff's own
// dashboard would have hit the identical gap the moment it was built,
// and was written correctly from the start only because the fix for the
// third instance was still fresh.
//
// A FOURTH, more serious instance was found retrofitting clinical_lead
// onto this hook, never previously documented: that page's own
// hand-rolled check used a SINGLE query with no `approved_at is not
// null` filter, then branched client-side on the fetched row's own
// approved_at/rejected_at columns. The branch condition
// (`approved_at === null && rejected_at === null`) is true only while
// genuinely pending -- a REJECTED lead (rejected_at set, approved_at
// still null) fails that condition and falls straight through to the
// FULLY FUNCTIONING dashboard render, not an error and not a pending
// state. A rejected lead would have seen their real scoped client list.
// A genuinely MISSING row (no institution_staff row at all, or one
// filtered out by deactivation) fell through the opposite way: the
// early-return branch fired (its own `if` condition is also true when
// `!data`), isPendingApproval was set to `Boolean(data)` = false, and
// the function returned -- leaving institutionId permanently null with
// no error and no pending message. The dashboard rendered a header with
// nothing underneath, silently.
//
// This hook is now the ONLY place any dashboard resolves "do I have a
// current, approved institution_staff row for this role" -- every one
// of the four existing dashboards (clinic-admin, clinical-lead, centre,
// care) is built on it, using the one correct two-query shape (approved
// only, THEN a separate pending-only query) three of the four already
// had right. A fifth role's dashboard has nothing to reinvent: call
// this hook, branch on `status`, render <PendingApprovalState> or
// <MembershipMissingState> from src/components/clinic/ for the two
// non-approved cases. Never hand-roll the institution_staff query again.
export type InstitutionMembershipStatus = "checking" | "approved" | "pending" | "missing";

export interface InstitutionMembershipResult {
  status: InstitutionMembershipStatus;
  institutionId: string | null;
  institutionName: string | null;
  refresh: () => void;
}

export function useInstitutionMembership(
  userId: string | undefined | null,
  role: string
): InstitutionMembershipResult {
  const [status, setStatus] = useState<InstitutionMembershipStatus>("checking");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  const check = useCallback(async () => {
    if (!userId) return;
    setStatus("checking");
    const supabase = createClient();

    const { data: approvedRow } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", userId)
      .eq("role", role)
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (approvedRow) {
      const inst = approvedRow.institutions as unknown as { name: string } | { name: string }[] | null;
      setInstitutionId(approvedRow.institution_id);
      setInstitutionName(Array.isArray(inst) ? (inst[0]?.name ?? null) : (inst?.name ?? null));
      setStatus("approved");
      return;
    }

    // Reached only when the approved-only lookup above found nothing --
    // costs an extra query solely for the pending/missing/rejected
    // cases, never the common already-approved path. Distinguishes a
    // genuinely pending join (nothing wrong) from a missing, rejected,
    // or deactivated one (a real "you can't get in" state) -- the exact
    // distinction three of the four original dashboards got right and
    // one didn't.
    const { data: pendingRow } = await supabase
      .from("institution_staff")
      .select("id")
      .eq("user_id", userId)
      .eq("role", role)
      .is("deactivated_at", null)
      .is("approved_at", null)
      .is("rejected_at", null)
      .maybeSingle();

    setInstitutionId(null);
    setInstitutionName(null);
    setStatus(pendingRow ? "pending" : "missing");
  }, [userId, role]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!isMounted) return;
      await check();
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [check, version]);

  return { status, institutionId, institutionName, refresh: () => setVersion((v) => v + 1) };
}
