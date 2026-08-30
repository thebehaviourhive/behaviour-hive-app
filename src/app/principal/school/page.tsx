"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { HandOverPrincipalSheet } from "@/components/principal/HandOverPrincipalSheet";
import { SetCutoffSheet } from "@/components/principal/SetCutoffSheet";
import { SetStartTimeSheet } from "@/components/principal/SetStartTimeSheet";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";

// PRD 2, Stage 1. New top-level tab -- "School" owns settings and
// account administration, per the design's own instruction: handover
// lives here, under its own heading, "findable without hunting, never
// adjacent to routine actions" -- moved off /principal/staff, where it
// previously sat alongside ordinary deactivate actions.
//
// PRD 2, Stage 6: the cut-off-time control itself moves in from
// /principal/classes -- this page's own Stage 1 comment named this
// exact move as deferred ("Temporary access[.] is where that setting
// actually belongs once this area gets its real design"), and Stage 6
// is that design. Same inline bar pattern Classes used to show it in
// (label + value + "Change"), not a new visual pattern -- just its
// real home now that Temporary Access exists as its own live-status
// surface under Directory, distinct from this settings control.
//
// PRD 2, Stage 6 follow-up (migration 0133): a second bar, start time,
// added alongside -- activation used to be a fixed 07:30 constant with
// no control anywhere; it's now a settable sibling of the cut-off, same
// pattern, same section.

interface StaffRow {
  user_id: string;
  full_name: string;
  role: string;
  is_active: boolean;
}

export default function PrincipalSchoolPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [startTime, setStartTime] = useState<string>("07:30:00");
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [staff, setStaff] = useState<StaffRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isHandOverOpen, setIsHandOverOpen] = useState(false);
  const [isStartTimeOpen, setIsStartTimeOpen] = useState(false);
  const [isCutoffOpen, setIsCutoffOpen] = useState(false);
  const [institutionId, setInstitutionId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(name, temporary_access_start_time, temporary_access_cutoff_time)")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your institution.");
      setIsLoading(false);
      return;
    }

    const institutionRecord = staffRow.institutions as unknown as
      | { name: string; temporary_access_start_time: string | null; temporary_access_cutoff_time: string | null }
      | { name: string; temporary_access_start_time: string | null; temporary_access_cutoff_time: string | null }[]
      | null;
    const record = Array.isArray(institutionRecord) ? institutionRecord[0] : institutionRecord;
    setInstitutionName(record?.name ?? null);
    setInstitutionId(staffRow.institution_id);
    if (record?.temporary_access_start_time) {
      setStartTime(record.temporary_access_start_time);
    }
    if (record?.temporary_access_cutoff_time) {
      setCutoffTime(record.temporary_access_cutoff_time);
    }

    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_staff_roster", {
      p_institution_id: staffRow.institution_id,
      p_include_inactive: false,
      p_include_pending: false,
    });
    if (!rosterError) {
      setStaff((rosterRows ?? []) as StaffRow[]);
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">School</h1>
        {institutionName && (
          <p className="mt-0.5 text-sm text-brand-neutral-black/60">{institutionName}</p>
        )}
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Settings
              </h2>
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-brand-neutral-black">Temporary cover start time</p>
                    <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                      Starts daily at {formatTimeOfDay(startTime)}, ends at {formatTimeOfDay(cutoffTime)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsStartTimeOpen(true)}
                    className="flex-shrink-0 text-sm font-semibold text-brand-prussian-blue"
                  >
                    Change
                  </button>
                </div>

                <div className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                  <div>
                    <p className="text-sm font-semibold text-brand-neutral-black">Temporary cover cut-off</p>
                    <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                      Starts {formatTimeOfDay(startTime)}, ends daily at {formatTimeOfDay(cutoffTime)}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsCutoffOpen(true)}
                    className="flex-shrink-0 text-sm font-semibold text-brand-prussian-blue"
                  >
                    Change
                  </button>
                </div>
              </div>
            </section>

            <section>
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Account Administration
              </h2>
              <button
                type="button"
                onClick={() => setIsHandOverOpen(true)}
                className="block w-full rounded-2xl border border-brand-prussian-blue bg-white p-4 text-left shadow-sm"
              >
                <p className="text-sm font-semibold text-brand-prussian-blue">Hand Over Principal Role</p>
                <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                  Promotes another active staff member. This cannot be undone from your own account.
                </p>
              </button>
            </section>
          </>
        )}
      </main>

      <HandOverPrincipalSheet
        isOpen={isHandOverOpen}
        onClose={() => setIsHandOverOpen(false)}
        eligibleSuccessors={staff
          .filter((m) => m.is_active && m.role !== "principal")
          .map((m) => ({ userId: m.user_id, fullName: m.full_name }))}
        onHandedOver={(outcome, stayingRole) => {
          setIsHandOverOpen(false);
          if (outcome === "staying" && stayingRole) {
            router.push(getPostAuthRedirect(stayingRole));
          } else {
            router.push("/teacher/join-institution");
          }
        }}
      />

      {institutionId && (
        <SetStartTimeSheet
          isOpen={isStartTimeOpen}
          institutionId={institutionId}
          currentStartTime={startTime}
          onClose={() => setIsStartTimeOpen(false)}
          onSaved={(newStartTime) => {
            setStartTime(newStartTime);
            setIsStartTimeOpen(false);
          }}
        />
      )}

      {institutionId && (
        <SetCutoffSheet
          isOpen={isCutoffOpen}
          institutionId={institutionId}
          currentCutoffTime={cutoffTime}
          onClose={() => setIsCutoffOpen(false)}
          onSaved={(newCutoff) => {
            setCutoffTime(newCutoff);
            setIsCutoffOpen(false);
          }}
        />
      )}

      <PrincipalBottomNav />
    </div>
  );
}
