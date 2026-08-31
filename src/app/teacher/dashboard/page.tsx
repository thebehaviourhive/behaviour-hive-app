"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { useTeacherPassports } from "@/hooks/useTeacherPassports";
import { useTeacherMorningCheckins, type MorningPupilStatus } from "@/hooks/useTeacherMorningCheckins";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { AddChildSheet } from "@/components/teacher/AddChildSheet";
import { MorningPupilCard, MorningPupilCardSkeleton } from "@/components/teacher/MorningPupilCard";
import { MorningCheckinDetailSheet } from "@/components/teacher/MorningCheckinDetailSheet";
import { TeacherQuickActions } from "@/components/teacher/TeacherQuickActions";
import { TeacherActivityCard } from "@/components/teacher/TeacherActivityCard";
import { QuestionnairePromptCard } from "@/components/questionnaire/QuestionnairePromptCard";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";
import { IncidentCard, formatIncidentDate, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";
import { CheckIcon } from "@/components/ui/icons";

const GRID_CAP = 6;

// PRD 2, Stage 7: this dashboard's own "Needs your attention" section,
// unconditional like AttestationPromptCard already was (a teacher with
// zero linked passports can still own incidents, hold cover grants, or
// teach a class with no SNA -- none of that requires a single linked
// passport of their own). get_my_incidents() is the genuinely NEW
// capability here -- no query or screen anywhere in this codebase has
// ever listed a teacher's own incidents before this migration
// (0135/0136/0137); every other new bucket below is either built on it
// or is its own small, dedicated, self-scoped RPC.
//
// AttestationPromptCard folds in as ONE bucket among these rather than
// staying a second, separate always-on-top surface -- same component,
// same fetch, same not_attested/stale filter, just repositioned inside
// this section and given an onCountChange callback (additive, optional)
// so its count can join this section's own empty-state computation. Its
// three OTHER render sites (principal/dashboard, sna/passports,
// teacher/incidents/attestations) are untouched -- they simply don't
// pass the new prop. The component is NOT deletable: it's still doing
// real, unmodified work everywhere else.
interface MyIncidentRow {
  incident_id: string;
  occurred_at: string;
  recorded_at: string;
  location: string;
  category: string | null;
  status: string;
  child_indices: string[] | null;
  debrief_required: boolean;
  debrief_completed: boolean;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  has_restrictive_practice: boolean;
  planning_status: string[] | null;
  ncse_report_complete: boolean[] | null;
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

// Adapts a MyIncidentRow (self-scoped, no institution-wide fields) onto
// IncidentCard's own InstitutionIncidentRow shape -- owning_teacher_name/
// created_by_name/is_inherited are always "me"/null/false here (this
// caller IS the owner by construction, and inheritance never transfers
// to a teacher, only to a principal), not fields get_my_incidents()
// needs to return itself.
function toIncidentCardRow(row: MyIncidentRow): InstitutionIncidentRow {
  return {
    ...row,
    owning_teacher_name: null,
    created_by_name: null,
    is_inherited: false,
    inherited_from_name: null,
    inherited_transferred_at: null,
  };
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

  const [isAddChildOpen, setIsAddChildOpen] = useState(false);
  const [selectedPupil, setSelectedPupil] = useState<MorningPupilStatus | null>(null);

  const {
    isLoading: isLoadingPassports,
    institutionId,
    institutionCode,
    passports,
    refresh,
  } = useTeacherPassports(user?.id ?? null);

  const { isLoading: isLoadingCheckins, pupils, redAlertCount } = useTeacherMorningCheckins(
    user?.id ?? null
  );

  const [unopenedMessagesCount, setUnopenedMessagesCount] = useState<number | null>(null);

  // ---- "Needs your attention" state ----
  const [isLoadingActionItems, setIsLoadingActionItems] = useState(true);
  const [myIncidents, setMyIncidents] = useState<MyIncidentRow[]>([]);
  const [attestationIssues, setAttestationIssues] = useState<AttestationIssueRow[]>([]);
  const [coverGrants, setCoverGrants] = useState<CoverGrantRow[]>([]);
  const [snaGaps, setSnaGaps] = useState<SnaGapRow[]>([]);
  // null until AttestationPromptCard's own fetch reports in -- kept out
  // of the empty-state computation until then, so the reassuring card
  // never flashes and then gets replaced once that count arrives.
  const [attestationsOwedCount, setAttestationsOwedCount] = useState<number | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadActionItems() {
      const supabase = createClient();
      const [incidentsResult, issuesResult, coverResult, gapsResult] = await Promise.all([
        supabase.rpc("get_my_incidents"),
        supabase.rpc("get_my_incident_attestation_issues"),
        supabase.rpc("get_my_cover_grants_expiring_today"),
        supabase.rpc("get_my_class_sna_gaps"),
      ]);
      if (!isMounted) return;
      if (!incidentsResult.error) setMyIncidents((incidentsResult.data ?? []) as MyIncidentRow[]);
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

  const handleAttestationCountChange = useCallback((count: number) => {
    setAttestationsOwedCount(count);
  }, []);

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

  const notSignedOff = myIncidents.filter((i) => !i.teacher_signed_at);
  const debriefOwed = myIncidents.filter((i) => i.debrief_required && !i.debrief_completed);

  const actionItemsReady = !isLoadingActionItems && attestationsOwedCount !== null;
  const nothingOutstanding =
    actionItemsReady &&
    notSignedOff.length === 0 &&
    debriefOwed.length === 0 &&
    attestationIssues.length === 0 &&
    attestationsOwedCount === 0 &&
    coverGrants.length === 0 &&
    snaGaps.length === 0;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <h1 className="mt-6 px-4 font-heading text-2xl font-bold text-brand-prussian-blue">
        {getGreeting()}, {firstName}
      </h1>

      {/* Unconditional, like the section it replaces -- a teacher can be
          named staff on an incident, own one, hold a cover grant, or
          teach a class with no SNA without a single linked passport of
          their own. */}
      <section className="mt-4 px-4">
        <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
          Needs your attention
        </h2>

        {actionItemsReady && nothingOutstanding ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-brand-neutral-black/60">
            <CheckIcon className="h-5 w-5 flex-shrink-0 text-brand-prussian-blue/40" />
            <p>Nothing needs your attention right now.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <AttestationPromptCard onCountChange={handleAttestationCountChange} />

            {notSignedOff.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                  Not signed off
                </h3>
                <div className="flex flex-col gap-2">
                  {notSignedOff.map((incident) => (
                    <IncidentCard key={incident.incident_id} incident={toIncidentCardRow(incident)} needsSignoff />
                  ))}
                </div>
              </div>
            )}

            {debriefOwed.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                  Debrief{debriefOwed.length === 1 ? "" : "s"} owed
                </h3>
                <div className="flex flex-col gap-2">
                  {debriefOwed.map((incident) => (
                    <IncidentCard key={incident.incident_id} incident={toIncidentCardRow(incident)} />
                  ))}
                </div>
              </div>
            )}

            {attestationIssues.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                  Attestation{attestationIssues.length === 1 ? "" : "s"} needing a look
                </h3>
                <div className="flex flex-col gap-2">
                  {attestationIssues.map((row) => (
                    <Link
                      key={row.incident_staff_id}
                      href={`/teacher/incidents/${row.incident_id}`}
                      className="block rounded-2xl border border-brand-golden-brown/30 bg-white p-4 shadow-sm"
                    >
                      <p className="text-sm font-semibold text-brand-neutral-black">
                        {row.staff_name ?? "A staff member"}
                      </p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/60">
                        {formatIncidentDate(row.occurred_at)} · {row.location}
                      </p>
                      <p className="mt-1.5 text-xs font-semibold text-brand-golden-brown">{row.status_label}</p>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {coverGrants.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                  Cover expiring today
                </h3>
                <div className="flex flex-col gap-2">
                  {coverGrants.map((row) => (
                    <div key={row.grant_id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <p className="text-sm font-semibold text-brand-neutral-black">{row.class_name}</p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/60">
                        Covered by {row.granted_to_name ?? "someone"} until today&apos;s cut-off
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {snaGaps.length > 0 && (
              <div>
                <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                  No SNA assigned
                </h3>
                <div className="flex flex-col gap-2">
                  {snaGaps.map((row) => (
                    <div key={row.passport_id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <p className="text-sm font-semibold text-brand-neutral-black">{row.child_name}</p>
                      <p className="mt-0.5 text-xs text-brand-neutral-black/60">{row.class_name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </section>

      {!hasStudents ? (
        <EmptyState
          institutionCode={institutionCode}
          onAddChild={() => setIsAddChildOpen(true)}
        />
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

      {institutionId && (
        <AddChildSheet
          isOpen={isAddChildOpen}
          onClose={() => setIsAddChildOpen(false)}
          teacherId={user!.id}
          teacherName={(user!.user_metadata?.full_name as string | undefined) ?? "A teacher"}
          institutionId={institutionId}
          institutionCode={institutionCode}
          onAdded={refresh}
        />
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

function EmptyState({
  institutionCode,
  onAddChild,
}: {
  institutionCode: string | null;
  onAddChild: () => void;
}) {
  const [copied, setCopied] = useState(false);

  function handleCopy() {
    if (!institutionCode) return;
    navigator.clipboard.writeText(institutionCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div className="flex flex-1 flex-col items-center px-4 pt-6 text-center">
      <p className="mb-6 font-sans text-sm leading-relaxed text-brand-neutral-black/60">
        This is where you will see your students&apos; daily check-ins. Your
        dashboard is currently empty.
      </p>

      <div className="w-full rounded-3xl border border-brand-off-white bg-white p-6 shadow-sm">
        <p className="mb-2 font-accent text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
          Your Institution Code
        </p>
        <div className="mb-4 flex items-center justify-between rounded-2xl border border-dashed border-brand-prussian-blue/30 bg-brand-pastel-blue/10 px-5 py-4">
          <span className="font-heading text-2xl font-bold tracking-[0.2em] text-brand-prussian-blue">
            {institutionCode ?? "——————"}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            disabled={!institutionCode}
            className="rounded-full bg-brand-prussian-blue px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {copied ? "Copied!" : "Copy Code"}
          </button>
        </div>
        <p className="font-sans text-sm leading-relaxed text-brand-neutral-black/60">
          Share this unique Institution Code with parents. Once they link
          their child&apos;s passport to this code, they will appear right
          here.
        </p>
      </div>

      <button
        type="button"
        onClick={onAddChild}
        className="mt-6 w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white shadow-sm"
      >
        Add Child
      </button>

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
