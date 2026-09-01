"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useTeacherMorningCheckins, type MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { MorningPupilCard, MorningPupilCardSkeleton } from "@/components/teacher/MorningPupilCard";
import { MorningCheckinDetailSheet } from "@/components/teacher/MorningCheckinDetailSheet";
import { TeacherQuickActions } from "@/components/teacher/TeacherQuickActions";
import { TeacherActivityCard } from "@/components/teacher/TeacherActivityCard";
import { QuestionnairePromptCard } from "@/components/questionnaire/QuestionnairePromptCard";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";
import { formatWaitingSince } from "@/lib/workQueueFormatting";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";
import { CheckIcon } from "@/components/ui/icons";

const GRID_CAP = 6;

// PRD 2, Stage 7: this dashboard's own "Needs your attention" section,
// unconditional (a teacher with zero linked passports can still own
// incidents, hold cover grants, or teach a class with no SNA -- none of
// that requires a single linked passport of their own). get_my_incidents()
// is the genuinely NEW capability here -- no query or screen anywhere in
// this codebase has ever listed a teacher's own incidents before this
// migration (0135/0136/0137); every other bucket below is either built
// on it or is its own small, dedicated, self-scoped RPC.
//
// PRD 4, Stage 2 -- work-queue rewrite, same shared WorkQueueRow the
// principal dashboard now uses (src/components/shared/WorkQueueRow.tsx),
// one definition serving both. Six buckets: attestations owed, not
// signed off, debriefs owed, attestation issues (withdrawn/stale on
// incidents I own), cover expiring today, no SNA assigned.
//
// AttestationPromptCard no longer renders on THIS page -- the component
// itself is untouched (still exactly what principal/dashboard,
// sna/passports and teacher/incidents/attestations render, unchanged,
// per PRD 4's "do not fork shared components" rule) but its single
// collapsed-count card doesn't fit a work queue whose whole point is one
// row per outstanding thing. This page now calls
// get_my_incident_attestations() directly, matching how the other five
// buckets already fetch their own RPC, and renders one row per
// not_attested/stale attestation instead of one summary card.
//
// No SQL this stage. Cover-expiring-today's Context ("Ends 3pm") reads
// institutions.temporary_access_cutoff_time directly -- an existing,
// publicly-selectable column (RLS: "Authenticated users can look up an
// institution", using(true), live since migration 0013), the same read
// /principal/school already performs for the identical value. Not a new
// RPC, not new SQL -- a new call site for an existing, already-public
// read. No-SNA-assigned's Context is genuinely absent: a standing gap
// has no meaningful "since".
//
// Incident-derived rows (not signed off, debrief owed, attestation
// issues) use LOCATION as Entity, not a child name -- get_my_incidents()
// and its siblings have never resolved real child names (only
// per-incident child_index codes), matching get_institution_incidents()'s
// own deliberate privacy boundary on the principal side.
interface MyIncidentRow {
  incident_id: string;
  occurred_at: string;
  location: string;
  child_indices: string[] | null;
  debrief_required: boolean;
  debrief_completed: boolean;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
}

interface AttestationOwedRow {
  incident_id: string;
  incident_staff_id: string;
  occurred_at: string;
  location: string;
  status: string;
  status_label: string;
  is_closed: boolean;
}

interface AttestationIssueRow {
  incident_id: string;
  incident_staff_id: string;
  occurred_at: string;
  location: string;
  staff_user_id: string;
  staff_name: string | null;
  status: string;
  status_label: string;
}

interface CoverGrantRow {
  grant_id: string;
  class_id: string;
  class_name: string;
  granted_to: string;
  granted_to_name: string | null;
}

interface SnaGapRow {
  passport_id: string;
  child_name: string;
  class_id: string;
  class_name: string;
}

function childCountLabel(childIndices: string[] | null): string {
  const count = (childIndices ?? []).length;
  return `${count} child${count === 1 ? "" : "ren"} named`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export default function TeacherDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");
  const messagesAwaitingCount = useMessagesAwaitingActionCount(user?.id ?? null);

  const [selectedPupil, setSelectedPupil] = useState<MorningPupilStatus | null>(null);

  const {
    isLoading: isLoadingPassports,
    institutionId,
    passports,
  } = useTeacherPassports(user?.id ?? null);

  const { isLoading: isLoadingCheckins, pupils, redAlertCount } = useTeacherMorningCheckins(
    user?.id ?? null
  );

  const [unopenedMessagesCount, setUnopenedMessagesCount] = useState<number | null>(null);

  // ---- "Needs your attention" state ----
  const [isLoadingActionItems, setIsLoadingActionItems] = useState(true);
  const [myIncidents, setMyIncidents] = useState<MyIncidentRow[]>([]);
  const [attestationsOwed, setAttestationsOwed] = useState<AttestationOwedRow[]>([]);
  const [attestationIssues, setAttestationIssues] = useState<AttestationIssueRow[]>([]);
  const [coverGrants, setCoverGrants] = useState<CoverGrantRow[]>([]);
  const [snaGaps, setSnaGaps] = useState<SnaGapRow[]>([]);
  const [cutoffTime, setCutoffTime] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadActionItems() {
      const supabase = createClient();
      const [incidentsResult, owedResult, issuesResult, coverResult, gapsResult] = await Promise.all([
        supabase.rpc("get_my_incidents"),
        supabase.rpc("get_my_incident_attestations"),
        supabase.rpc("get_my_incident_attestation_issues"),
        supabase.rpc("get_my_cover_grants_expiring_today"),
        supabase.rpc("get_my_class_sna_gaps"),
      ]);
      if (!isMounted) return;
      if (!incidentsResult.error) setMyIncidents((incidentsResult.data ?? []) as MyIncidentRow[]);
      if (!owedResult.error) setAttestationsOwed((owedResult.data ?? []) as AttestationOwedRow[]);
      if (!issuesResult.error) setAttestationIssues((issuesResult.data ?? []) as AttestationIssueRow[]);
      if (!coverResult.error) setCoverGrants((coverResult.data ?? []) as CoverGrantRow[]);
      if (!gapsResult.error) setSnaGaps((gapsResult.data ?? []) as SnaGapRow[]);
      setIsLoadingActionItems(false);
    }
    loadActionItems();
    return () => {
      isMounted = false;
    };
  }, [user]);

  // Cover-expiring-today's Context deadline -- only fetched once an
  // institution id is known and only when there's a grant to show it
  // on, matching every other secondary read on this page's own
  // not-fatal posture.
  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function loadCutoff() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("institutions")
        .select("temporary_access_cutoff_time")
        .eq("id", institutionId)
        .maybeSingle();
      if (!isMounted || error || !data?.temporary_access_cutoff_time) return;
      setCutoffTime(data.temporary_access_cutoff_time);
    }
    loadCutoff();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadUnopenedCount() {
      const supabase = createClient();
      const { count, error: countError } = await supabase
        .from("message_recipients")
        .select("id, messages!inner(status)", { count: "exact", head: true })
        .eq("recipient_id", user!.id)
        .is("acknowledged_at", null)
        .neq("messages.status", "closed");
      if (!isMounted || countError) return;
      setUnopenedMessagesCount(count ?? 0);
    }
    loadUnopenedCount();
    return () => {
      isMounted = false;
    };
  }, [user]);

  const teacherFullName = user?.user_metadata?.full_name as string | undefined;
  const firstName = teacherFullName ? teacherFullName.split(" ")[0] : "there";

  useEffect(() => {
    if (!isReady || isLoadingPassports) return;
    if (institutionId === null) router.replace("/teacher/join-institution");
  }, [isReady, isLoadingPassports, institutionId, router]);

  if (!isReady || isLoadingPassports || institutionId === null) {
    return null;
  }

  const hasStudents = passports.length > 0;
  const gridPupils = pupils.slice(0, GRID_CAP);
  const overflowCount = pupils.length - GRID_CAP;

  const owed = attestationsOwed.filter((r) => !r.is_closed && (r.status === "not_attested" || r.status === "stale"));
  const notSignedOff = myIncidents.filter((i) => !i.teacher_signed_at);
  const debriefOwed = myIncidents.filter((i) => i.debrief_required && !i.debrief_completed);

  const actionItemsReady = !isLoadingActionItems;
  const nothingOutstanding =
    actionItemsReady &&
    owed.length === 0 &&
    notSignedOff.length === 0 &&
    debriefOwed.length === 0 &&
    attestationIssues.length === 0 &&
    coverGrants.length === 0 &&
    snaGaps.length === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <h1 className="mt-6 px-4 font-heading text-h1 font-bold text-brand-prussian-blue">
        {getGreeting()}, {firstName}
      </h1>

      {/* Unconditional -- a teacher can be named staff on an incident,
          own one, hold a cover grant, or teach a class with no SNA
          without a single linked passport of their own. */}
      <section className="mt-4 px-4">
        <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
          Needs your attention
        </h2>

        {!actionItemsReady ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
                <div className="h-5 w-[120px] flex-shrink-0 rounded bg-black/10" />
                <div className="h-4 flex-1 rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : nothingOutstanding ? (
          <div className="flex flex-col items-center gap-1 rounded-2xl bg-white p-8 text-center shadow-sm">
            <CheckIcon className="mb-2 h-6 w-6 text-brand-prussian-blue/40" />
            <p className="font-heading text-h2 font-semibold text-brand-neutral-black">All clear.</p>
            <p className="font-sans text-body text-brand-neutral-black/60">
              There are no outstanding actions requiring your attention today.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {owed.map((row) => (
              <WorkQueueRow
                key={row.incident_staff_id}
                urgent
                entity={row.location}
                exception={`${row.status_label} attestation`}
                context={formatWaitingSince(row.occurred_at)}
                actionLabel="Review"
                href={`/teacher/incidents/${row.incident_id}`}
              />
            ))}

            {notSignedOff.map((incident) => (
              <WorkQueueRow
                key={incident.incident_id}
                urgent
                entity={incident.location}
                exception={`${childCountLabel(incident.child_indices)} · not signed off`}
                context={formatWaitingSince(incident.occurred_at)}
                actionLabel="Sign off"
                href={`/teacher/incidents/${incident.incident_id}`}
              />
            ))}

            {debriefOwed.map((incident) => (
              <WorkQueueRow
                key={incident.incident_id}
                entity={incident.location}
                exception={`${childCountLabel(incident.child_indices)} · debrief owed`}
                context={formatWaitingSince(incident.occurred_at)}
                actionLabel="Complete debrief"
                href={`/teacher/incidents/${incident.incident_id}`}
              />
            ))}

            {attestationIssues.map((row) => (
              <WorkQueueRow
                key={row.incident_staff_id}
                entity={row.staff_name ?? "A staff member"}
                exception={row.status_label}
                context={formatWaitingSince(row.occurred_at)}
                actionLabel="Review"
                href={`/teacher/incidents/${row.incident_id}`}
              />
            ))}

            {coverGrants.map((row) => (
              <WorkQueueRow
                key={row.grant_id}
                entity={row.class_name}
                exception={`Covered by ${row.granted_to_name ?? "someone"}`}
                context={cutoffTime ? `Ends ${formatTimeOfDay(cutoffTime)}` : undefined}
                actionLabel="Review"
                href="/teacher/class"
              />
            ))}

            {snaGaps.map((row) => (
              <WorkQueueRow
                key={row.passport_id}
                entity={row.child_name}
                exception={`No SNA assigned · ${row.class_name}`}
                actionLabel="Review"
                href="/teacher/class"
              />
            ))}
          </div>
        )}
      </section>

      {!hasStudents ? (
        <EmptyState />
      ) : (
        <>
          <div className="scrollbar-hide mt-4 flex gap-4 overflow-x-auto px-4 py-2">
            <StatCard label="Active Pupils" value={passports.length} isAlert={false} />
            <StatCard
              label="Red Alerts Today"
              value={isLoadingCheckins ? "…" : redAlertCount}
              isAlert={!isLoadingCheckins && redAlertCount > 0}
            />
            <StatCard
              label="Unopened Messages"
              value={unopenedMessagesCount ?? "…"}
              href="/teacher/messages"
            />
          </div>

          {/* Moved here from below TeacherQuickActions -- className
              supplies this page's own mt-4/px-4 convention (every
              top-level sibling here self-margins, there's no shared
              gap container), matching the stats row above and grid
              below it. No bottom margin needed: the grid section
              already supplies its own mt-4. */}
          <QuestionnairePromptCard track="teacher" className="mt-4 px-4" />

          <section className="mt-4 grid grid-cols-2 gap-3 px-4">
            {isLoadingCheckins
              ? Array.from({ length: 6 }).map((_, i) => <MorningPupilCardSkeleton key={i} />)
              : gridPupils.map((pupil) => (
                  <MorningPupilCard
                    key={pupil.passportId}
                    pupil={pupil}
                    onTap={() => setSelectedPupil(pupil)}
                  />
                ))}
          </section>

          {!isLoadingCheckins && overflowCount > 0 && (
            <Link
              href="/teacher/morning-updates"
              className="mt-3 block w-full px-4 text-center font-sans text-sm font-bold text-brand-prussian-blue"
            >
              [ View all {pupils.length} morning updates ]
            </Link>
          )}

          <TeacherQuickActions messagesAwaitingCount={messagesAwaitingCount} />
          <TeacherActivityCard />
        </>
      )}

      <MorningCheckinDetailSheet pupil={selectedPupil} onClose={() => setSelectedPupil(null)} />

      <TeacherBottomNav />
    </div>
  );
}

function StatCard({
  label,
  value,
  isAlert,
  isSubdued,
  href,
}: {
  label: string;
  value: string | number;
  isAlert?: boolean;
  isSubdued?: boolean;
  // Optional tap-through (e.g. Unopened Messages -> the triage view).
  // Deliberately styled identically to a non-alert card either way --
  // this must never borrow the Red Alerts treatment (zero-urgency rule
  // applies to every stat, not just teacher-facing ones).
  href?: string;
}) {
  const className = "min-w-[130px] flex-shrink-0 rounded-xl border border-brand-off-white bg-white p-4 shadow-sm";
  const content = (
    <>
      <p className="font-accent text-xs uppercase text-brand-neutral-black/60">{label}</p>
      <p
        className={`mt-1 font-heading text-2xl font-bold ${
          isSubdued
            ? "text-brand-neutral-black/30"
            : isAlert
              ? "text-red-600"
              : "text-brand-neutral-black"
        }`}
      >
        {value}
      </p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}

// PRD 3, Stage 2 -- was a card promising "share your Institution Code
// with parents, once they link their child's passport to this code,
// they will appear right here" plus an "Add Child" button opening
// AddChildSheet. Both endpoints of that flow are gone this stage
// (ShareBottomSheet's own parent-approval half, and AddChildSheet
// itself) -- the school connects a class teacher to their students by
// the principal granting access now, not by a code changing hands. This
// empty state says that plainly instead of describing a flow that no
// longer does anything.
function EmptyState() {
  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-6 text-center">
      <p className="mb-2 font-sans text-sm leading-relaxed text-brand-neutral-black/60">
        This is where you will see your students&apos; daily check-ins. Your
        dashboard is currently empty.
      </p>
      <p className="mb-6 font-sans text-sm leading-relaxed text-brand-neutral-black/60">
        Ask your principal to grant you access to your students &mdash;
        once they do, your students will appear here.
      </p>

      {/* Incident Log stamping is institution-roster-scoped, not
          passport_access-scoped (decision 5) -- reachable even with zero
          ordinary students linked, so it can't live only inside
          TeacherQuickActions below (which this empty state replaces
          entirely). Caught live: without this, a teacher with no
          passport_access grants yet had no way to reach the stamp at
          all despite being fully entitled to create one. */}
      <Link
        href="/teacher/incidents/new"
        className="mt-3 w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-center text-base font-semibold text-brand-prussian-blue"
      >
        Record Incident
      </Link>
    </div>
  );
}
