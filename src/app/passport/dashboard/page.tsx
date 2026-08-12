"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ShareBottomSheet } from "@/components/parent/ShareBottomSheet";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ABCTimeline } from "@/components/abc-logger/ABCTimeline";
import { PassportAccordion } from "@/components/passport/PassportAccordion";
import { ClinicalTeamSection } from "@/components/passport/clinical-team/ClinicalTeamSection";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";
import { logActivity } from "@/lib/logActivity";
import { clearPendingLogReminder } from "@/lib/calmCards/logReminder";
import {
  CLINICIAN_SPECIALTY_LABEL,
  type ClinicianSpecialty,
} from "@/lib/clinicianSpecialties";
import type { ClinicalContentItem } from "@/lib/passportClinicalContent";

interface ApprovedInstitution {
  institutionId: string;
  institutionName: string;
  approvedAt: string | null;
}

interface ConnectedClinician {
  clinicianId: string;
  fullName: string;
  specialty: string;
}

interface PassportSummaryData {
  passportId: string;
  passportCode: string | null;
  childName: string;
  age: number | null;
  school: string | null;
  importantPeople: string | null;
  diagnoses: string[] | null;
  diagnosisOther: string | null;
  okaySignals: string[] | null;
  hardSignals: string[] | null;
  hardTriggers: string[] | null;
  communicationMethods: string[] | null;
  showsHappy: string | null;
  showsAnxious: string | null;
  phrasesToAvoid: string | null;
  beforeBehaviour: string[] | null;
  duringDistress: string[] | null;
  afterDistress: string[] | null;
  sensorySeeks: string[] | null;
  sensoryAvoids: string[] | null;
}

const CARD_CLASSNAME =
  "rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-[0_4px_20px_rgba(0,79,113,0.05)]";

function calculateAge(dateOfBirth: string | null | undefined): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

// "Other" is a placeholder value in the diagnoses array — when present
// alongside real free-text in diagnosisOther, show that text as its own
// pill instead of the literal word "Other".
function getDiagnosisPills(
  diagnoses: string[] | null,
  diagnosisOther: string | null
): string[] {
  if (!diagnoses || diagnoses.length === 0) return [];
  const hasOtherWithText = diagnoses.includes("Other") && Boolean(diagnosisOther);
  if (!hasOtherWithText) return diagnoses;
  const rest = diagnoses.filter((d) => d !== "Other");
  return [...rest, diagnosisOther as string];
}

function buildSubInfoLine(age: number | null, school: string | null): string {
  const parts: string[] = [];
  if (age !== null) parts.push(`${age} years old`);
  if (school) parts.push(school);
  return parts.join(" • ");
}

export default function PassportDashboardPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [summary, setSummary] = useState<PassportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvedInstitutions, setApprovedInstitutions] = useState<ApprovedInstitution[]>([]);
  const [connectedClinicians, setConnectedClinicians] = useState<ConnectedClinician[]>([]);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [focusClinicianCodeOnOpen, setFocusClinicianCodeOnOpen] = useState(false);
  const [revokeConfirmation, setRevokeConfirmation] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [clinicianRevokeConfirmation, setClinicianRevokeConfirmation] = useState<string | null>(null);
  const [clinicianRevokeError, setClinicianRevokeError] = useState<string | null>(null);
  const [isAbcLoggerOpen, setIsAbcLoggerOpen] = useState(false);
  const [timelineRefreshKey, setTimelineRefreshKey] = useState(0);
  // Calm log-nudge backfill (Stage 3C) -- calmEpisodeId is only ever
  // non-null when ABCLogger was opened via that specific deep link, and
  // is what onComplete below uses to call attach_calm_episode_abc_log.
  // calmBehaviour is the "behaviour if a chip was selected" prefill.
  const [calmEpisodeId, setCalmEpisodeId] = useState<string | null>(null);
  const [calmBehaviour, setCalmBehaviour] = useState<string | null>(null);
  const [institutionsError, setInstitutionsError] = useState<string | null>(null);
  const [cliniciansError, setCliniciansError] = useState<string | null>(null);

  // Accordion state: "About Your Child" is expanded by default, every
  // other section starts collapsed -- independent toggling, so opening
  // one never affects another. A #section-id in the URL (e.g.
  // #clinical-team) ADDS that section to the expanded set rather than
  // replacing it, matching "independent toggling" -- arriving via a
  // deep link doesn't collapse the default-open section.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["about-your-child"]));
  const [clinicalTeamItems, setClinicalTeamItems] = useState<ClinicalContentItem[] | null>(null);
  const hasHandledHashRef = useRef(false);

  function toggleSection(id: string) {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // Runs once, after the page's own data has loaded (so the target
  // section actually exists in the DOM to expand/scroll to). Scrolling
  // is deferred past the accordion's own 300ms grid-rows transition
  // (see PassportAccordion) so it lands on the section's real expanded
  // position, not where it was still collapsed.
  useEffect(() => {
    if (!summary || hasHandledHashRef.current || typeof window === "undefined") return;
    hasHandledHashRef.current = true;
    const hash = window.location.hash.replace("#", "");
    if (!hash) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setExpandedSections((prev) => new Set(prev).add(hash));
    const timer = setTimeout(() => {
      document.getElementById(hash)?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 350);
    return () => clearTimeout(timer);
  }, [summary]);

  async function loadApprovedInstitutions(passportId: string) {
    setInstitutionsError(null);
    const supabase = createClient();
    const { data: linkRows, error } = await supabase
      .from("passport_institution_links")
      .select("institution_id, parent_approved_at, institutions(name)")
      .eq("passport_id", passportId)
      .eq("approved_by_parent", true)
      .order("parent_approved_at", { ascending: false });

    if (error) {
      console.error("Failed to load approved institutions:", error);
      setInstitutionsError("Couldn't load connected schools.");
      return;
    }

    setApprovedInstitutions(
      (linkRows ?? []).map((row) => {
        const institution = row.institutions as unknown as { name: string } | null;
        return {
          institutionId: row.institution_id,
          institutionName: institution?.name ?? "Unknown school",
          approvedAt: row.parent_approved_at,
        };
      })
    );
  }

  async function loadConnectedClinicians(passportId: string) {
    setCliniciansError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_passport_clinicians", {
      p_passport_id: passportId,
    });

    if (error) {
      console.error("Failed to load connected clinicians:", error);
      setCliniciansError("Couldn't load your clinical team.");
      return;
    }

    setConnectedClinicians(
      (data ?? []).map(
        (row: { clinician_id: string; full_name: string | null; specialty: string }) => ({
          clinicianId: row.clinician_id,
          fullName: row.full_name ?? "A clinician",
          specialty: row.specialty,
        })
      )
    );
  }

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      try {
        const supabase = createClient();
        const [
          { data: passport },
          { data: sectionB },
          { data: sectionC },
          { data: sectionD },
        ] = await Promise.all([
          supabase
            .from("passports")
            .select(
              "id, passport_code, child_name, date_of_birth, school, important_people, diagnoses, diagnosis_other, passport_status, section_a_complete"
            )
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_b")
            .select("okay_signals, hard_signals, hard_triggers, section_b_complete")
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_c")
            .select(
              "communication_methods, shows_happy, shows_anxious, phrases_to_avoid, section_c_complete"
            )
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_d")
            .select(
              "before_behaviour, during_distress, after_distress, sensory_seeks, sensory_avoids, section_d_complete"
            )
            .eq("user_id", user!.id)
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        const resumeHref = getPassportResumeHref({
          passportStatus:
            (passport?.passport_status as "not_started" | "in_progress" | "complete" | null) ??
            null,
          sectionAComplete: Boolean(passport?.section_a_complete),
          sectionB: sectionB
            ? {
                okaySignals: sectionB.okay_signals,
                hardSignals: sectionB.hard_signals,
                hardTriggers: sectionB.hard_triggers,
                complete: sectionB.section_b_complete,
              }
            : null,
          sectionCComplete: Boolean(sectionC?.section_c_complete),
          sectionD: sectionD
            ? {
                beforeBehaviour: sectionD.before_behaviour,
                duringDistress: sectionD.during_distress,
                afterDistress: sectionD.after_distress,
                complete: sectionD.section_d_complete,
              }
            : null,
        });

        // Compare against the SAME resume calculation used everywhere else,
        // rather than the raw passport_status flag in isolation. If every
        // section is actually complete, resumeHref already resolves back to
        // this page — redirecting there in that case would just replace
        // this route with itself and never render, leaving a blank screen
        // that persists across reloads (the flag and the real per-section
        // completion state can disagree, e.g. right after editing a
        // completed section).
        if (resumeHref !== "/passport/dashboard") {
          router.replace(resumeHref);
          return;
        }

        setSummary({
          passportId: passport!.id,
          passportCode: (passport?.passport_code as string | null) ?? null,
          childName: (passport?.child_name as string | null) || "Your child",
          age: calculateAge(passport?.date_of_birth),
          school: (passport?.school as string | null) ?? null,
          importantPeople: (passport?.important_people as string | null) ?? null,
          diagnoses: Array.isArray(passport?.diagnoses) ? passport.diagnoses : null,
          diagnosisOther: (passport?.diagnosis_other as string | null) ?? null,
          okaySignals: Array.isArray(sectionB?.okay_signals) ? sectionB.okay_signals : null,
          hardSignals: Array.isArray(sectionB?.hard_signals) ? sectionB.hard_signals : null,
          hardTriggers: Array.isArray(sectionB?.hard_triggers) ? sectionB.hard_triggers : null,
          communicationMethods: Array.isArray(sectionC?.communication_methods)
            ? sectionC.communication_methods
            : null,
          showsHappy: (sectionC?.shows_happy as string | null) ?? null,
          showsAnxious: (sectionC?.shows_anxious as string | null) ?? null,
          phrasesToAvoid: (sectionC?.phrases_to_avoid as string | null) ?? null,
          beforeBehaviour: Array.isArray(sectionD?.before_behaviour)
            ? sectionD.before_behaviour
            : null,
          duringDistress: Array.isArray(sectionD?.during_distress)
            ? sectionD.during_distress
            : null,
          afterDistress: Array.isArray(sectionD?.after_distress)
            ? sectionD.after_distress
            : null,
          sensorySeeks: Array.isArray(sectionD?.sensory_seeks) ? sectionD.sensory_seeks : null,
          sensoryAvoids: Array.isArray(sectionD?.sensory_avoids)
            ? sectionD.sensory_avoids
            : null,
        });
        setIsLoading(false);

        await loadApprovedInstitutions(passport!.id);
        await loadConnectedClinicians(passport!.id);
      } catch (err) {
        if (!isMounted) return;
        console.error("Failed to load passport dashboard:", err);
        setLoadError(
          "We couldn't load your child's passport. Please check your connection and try again."
        );
        setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
    // Re-fetches fresh on every mount — this page is always reached via a
    // real navigation (bottom nav / edit-and-return), never kept alive
    // across visits, so there is no stale-data path to guard against here.
  }, [user, router]);

  // Lets the dashboard's "ABC Log" quick action jump straight into the
  // logger instead of just landing here and requiring an extra tap on the
  // existing "+ Log Incident" button below.
  useEffect(() => {
    if (!summary || searchParams.get("logIncident") !== "1") return;
    // Reacting to an external system (the URL query param) and performing
    // a navigation side effect together -- a genuine effect, not state
    // that could be derived during render.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsAbcLoggerOpen(true);
    // Calm log-nudge deep link (Stage 3C) -- captured into state BEFORE
    // router.replace() strips the query string, since ABCLogger mounts
    // after this effect runs, not during it.
    const episodeId = searchParams.get("calmEpisodeId");
    const behaviour = searchParams.get("behaviour");
    if (episodeId) setCalmEpisodeId(episodeId);
    if (behaviour) setCalmBehaviour(behaviour);
    router.replace("/passport/dashboard");
  }, [summary, searchParams, router]);

  // Deep-link from the Clinical Support card's "Link your clinician" CTA
  // (parent already has a passport, just no clinician linked yet) --
  // same query-param-then-replace pattern as logIncident above.
  useEffect(() => {
    if (!summary || searchParams.get("openShare") !== "1") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsShareOpen(true);
    setFocusClinicianCodeOnOpen(true);
    router.replace("/passport/dashboard");
  }, [summary, searchParams, router]);

  if (!isRoleReady || isLoading) {
    return null;
  }

  if (loadError) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-safe-ivory px-4 text-center">
        <p className="text-sm text-brand-neutral-black/70">{loadError}</p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-full bg-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-white"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!summary) {
    return null;
  }

  // Revokes at the institution level: updates every passport_access row for
  // this institution, not just one teacher's. Teacher trust is
  // institution-scoped -- a parent approves a school, not an individual
  // teacher -- so revoking removes the whole school's access in one action.
  // This is intentionally asymmetric with handleRevokeClinician below,
  // where trust is scoped to one named individual instead. No code change
  // needed here; documenting the asymmetry as designed.
  async function handleRevoke(institutionId: string, institutionName: string) {
    if (!summary) return;

    setRevokeError(null);
    setRevokeConfirmation(null);

    const supabase = createClient();
    const [
      { data: linkRows, error: linkError },
      { data: accessRows, error: accessError },
    ] = await Promise.all([
      supabase
        .from("passport_institution_links")
        .update({ approved_by_parent: false })
        .eq("passport_id", summary.passportId)
        .eq("institution_id", institutionId)
        .select("id"),
      supabase
        .from("passport_access")
        .update({ is_active: false })
        .eq("passport_id", summary.passportId)
        .eq("institution_id", institutionId)
        .select("id"),
    ]);

    if (linkError || accessError) {
      setRevokeError((linkError ?? accessError)?.message ?? "Something went wrong. Please try again.");
      return;
    }

    // A matching row in neither table means there was nothing left to
    // revoke (already revoked, or the link never existed) — a parent must
    // never see a "removed" confirmation when nothing actually changed.
    if (!linkRows?.length && !accessRows?.length) {
      setRevokeError("Nothing was removed — this access may already have been revoked.");
      return;
    }

    if (user) {
      logActivity({
        passportId: summary.passportId,
        actorId: user.id,
        eventType: "access_revoked",
        eventDescription: "Teacher access removed",
      });
    }

    setRevokeConfirmation(
      `Access for ${institutionName} has been removed. They can no longer see ${summary.childName}'s passport.`
    );
    await loadApprovedInstitutions(summary.passportId);
  }

  // Revokes at the individual level: only this clinician's own
  // clinician_access row is touched. Clinicians are connected one at a
  // time by their personal code (no institution grouping), so trust is
  // scoped to the named individual -- the intentional counterpart to
  // handleRevoke's institution-wide scope above.
  async function handleRevokeClinician(
    clinicianId: string,
    clinicianName: string,
    specialty: string
  ) {
    if (!summary) return;

    setClinicianRevokeError(null);
    setClinicianRevokeConfirmation(null);

    const supabase = createClient();
    const { data, error } = await supabase
      .from("clinician_access")
      .update({ is_active: false })
      .eq("passport_id", summary.passportId)
      .eq("clinician_id", clinicianId)
      .select("id");

    if (error) {
      setClinicianRevokeError(error.message);
      return;
    }

    if (!data?.length) {
      setClinicianRevokeError("Nothing was removed — this access may already have been revoked.");
      return;
    }

    if (user) {
      const specialtyLabel =
        CLINICIAN_SPECIALTY_LABEL[specialty as ClinicianSpecialty] ?? specialty;
      logActivity({
        passportId: summary.passportId,
        actorId: user.id,
        eventType: "access_revoked",
        eventDescription: `${specialtyLabel} access removed`,
      });
    }

    setClinicianRevokeConfirmation(
      `Access for ${clinicianName} has been removed. They can no longer see ${summary.childName}'s passport.`
    );
    await loadConnectedClinicians(summary.passportId);
  }

  const diagnosisPills = getDiagnosisPills(summary.diagnoses, summary.diagnosisOther);
  const subInfoLine = buildSubInfoLine(summary.age, summary.school);

  const hasOkay = (summary.okaySignals?.length ?? 0) > 0;
  const hasHard = (summary.hardSignals?.length ?? 0) > 0;
  const hasTriggers = (summary.hardTriggers?.length ?? 0) > 0;
  const sectionBEmpty = !hasOkay && !hasHard && !hasTriggers;

  const hasCommMethods = (summary.communicationMethods?.length ?? 0) > 0;
  const hasShowsHappy = Boolean(summary.showsHappy);
  const hasShowsAnxious = Boolean(summary.showsAnxious);
  const hasPhrasesToAvoid = Boolean(summary.phrasesToAvoid);
  const sectionCEmpty =
    !hasCommMethods && !hasShowsHappy && !hasShowsAnxious && !hasPhrasesToAvoid;

  const hasBefore = (summary.beforeBehaviour?.length ?? 0) > 0;
  const hasDuring = (summary.duringDistress?.length ?? 0) > 0;
  const hasAfter = (summary.afterDistress?.length ?? 0) > 0;
  const hasSeeks = (summary.sensorySeeks?.length ?? 0) > 0;
  const hasAvoids = (summary.sensoryAvoids?.length ?? 0) > 0;
  const sectionDEmpty = !hasBefore && !hasDuring && !hasAfter && !hasSeeks && !hasAvoids;

  // Accordion header pill counts -- real counts derived from the same
  // data each section already renders, not a separate source of truth.
  // A count of 0 renders no pill at all (undefined), matching how these
  // sections already self-hide their content rather than show an empty
  // "0 items".
  const aboutCount = [summary.age !== null, Boolean(summary.school), Boolean(summary.importantPeople)].filter(
    Boolean
  ).length;
  const understandingCount =
    (summary.okaySignals?.length ?? 0) + (summary.hardSignals?.length ?? 0) + (summary.hardTriggers?.length ?? 0);
  const communicatesCount =
    (summary.communicationMethods?.length ?? 0) +
    (hasShowsHappy ? 1 : 0) +
    (hasShowsAnxious ? 1 : 0) +
    (hasPhrasesToAvoid ? 1 : 0);
  const supportCount =
    (summary.beforeBehaviour?.length ?? 0) +
    (summary.duringDistress?.length ?? 0) +
    (summary.afterDistress?.length ?? 0) +
    (summary.sensorySeeks?.length ?? 0) +
    (summary.sensoryAvoids?.length ?? 0);

  const fallbackCard = (
    <section className={CARD_CLASSNAME}>
      <p className="text-sm text-brand-neutral-black/60">
        This section couldn&apos;t be displayed. Your saved answers are safe —
        try reloading the page.
      </p>
    </section>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-6">
        <div className="flex items-start justify-between gap-3">
          <p className="font-accent text-sm uppercase tracking-wide text-brand-neutral-black">
            The Behavioural Passport Of
          </p>
          <button
            type="button"
            onClick={() => setIsShareOpen(true)}
            aria-label="Share passport"
            className="flex-shrink-0 rounded-full bg-white p-2 text-brand-prussian-blue shadow-sm"
          >
            <ShareIcon />
          </button>
        </div>

        <h1 className="mt-1 font-heading text-4xl font-bold leading-tight text-brand-prussian-blue">
          {summary.childName}
        </h1>

        {diagnosisPills.length > 0 ? (
          <>
            <p className="mt-4 mb-2 font-accent text-xs font-bold uppercase tracking-widest text-brand-neutral-black/60">
              Diagnoses and neurotypes
            </p>
            <div className="flex flex-wrap gap-2">
              {diagnosisPills.map((pill) => (
                <span
                  key={pill}
                  className="rounded-full border border-brand-pastel-blue bg-brand-pastel-blue/40 px-4 py-1.5 font-accent text-sm font-semibold text-brand-prussian-blue"
                >
                  {pill}
                </span>
              ))}
            </div>
          </>
        ) : (
          <Link
            href="/passport/section-a"
            className="mt-4 inline-block font-accent text-xs font-bold text-brand-golden-brown underline"
          >
            + Add diagnoses or neurotype
          </Link>
        )}
      </header>

      <div className="px-4">
        <button
          type="button"
          onClick={() => setIsAbcLoggerOpen(true)}
          className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue"
        >
          + Log Incident
        </button>
      </div>

      <main className="flex flex-col gap-6 px-4 pt-6">
        {/* The two access cards -- permanently visible, never collapsed,
            same behaviour as before (share/revoke/approvals/code entry
            all unchanged); only the visual treatment (consistent card
            chrome, gap-4 grouping) and position (moved above the
            accordion content) changed. */}
        <div className="flex flex-col gap-4">
          <ErrorBoundary fallback={fallbackCard}>
            <section className={CARD_CLASSNAME}>
              <h2 className="mb-4 font-heading text-lg font-bold text-brand-prussian-blue">Manage Access</h2>

              {institutionsError ? (
                <InlineErrorState
                  message={institutionsError}
                  onRetry={() => loadApprovedInstitutions(summary.passportId)}
                />
              ) : approvedInstitutions.length === 0 ? (
                <p className="text-center text-sm text-brand-neutral-black/60">
                  No schools approved yet. Tap the share button above to approve
                  your child&apos;s school.
                </p>
              ) : (
                <div>
                  {approvedInstitutions.map((institution) => (
                    <div
                      key={institution.institutionId}
                      className="mb-2 flex items-center justify-between rounded-xl bg-brand-off-white/50 p-4"
                    >
                      <p className="font-bold text-brand-neutral-black">
                        {institution.institutionName}
                      </p>
                      <button
                        type="button"
                        onClick={() =>
                          handleRevoke(institution.institutionId, institution.institutionName)
                        }
                        className="text-sm font-bold text-brand-golden-brown"
                      >
                        Revoke Access
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {revokeConfirmation && (
                <p className="mt-3 rounded-xl bg-brand-off-white/50 px-4 py-3 text-sm text-brand-neutral-black">
                  {revokeConfirmation}
                </p>
              )}
              {revokeError && (
                <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                  {revokeError}
                </p>
              )}
            </section>
          </ErrorBoundary>

          <ErrorBoundary fallback={fallbackCard}>
            <section className={CARD_CLASSNAME}>
              <h2 className="mb-4 font-heading text-lg font-bold text-brand-prussian-blue">Clinical Team</h2>

              {cliniciansError ? (
                <InlineErrorState
                  message={cliniciansError}
                  onRetry={() => loadConnectedClinicians(summary.passportId)}
                />
              ) : connectedClinicians.length === 0 ? (
                <p className="text-center text-sm text-brand-neutral-black/60">
                  No clinicians connected yet. Tap the share button above to
                  connect a clinician using their code.
                </p>
              ) : (
                <div>
                  {connectedClinicians.map((clinician) => (
                    <div
                      key={clinician.clinicianId}
                      className="mb-2 flex items-center justify-between rounded-xl bg-brand-off-white/50 p-4"
                    >
                      <div>
                        <p className="font-bold text-brand-neutral-black">
                          {clinician.fullName}
                        </p>
                        <p className="text-xs text-brand-neutral-black/60">
                          {CLINICIAN_SPECIALTY_LABEL[clinician.specialty as ClinicianSpecialty] ??
                            clinician.specialty}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          handleRevokeClinician(
                            clinician.clinicianId,
                            clinician.fullName,
                            clinician.specialty
                          )
                        }
                        className="text-sm font-bold text-brand-golden-brown"
                      >
                        Revoke Access
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {clinicianRevokeConfirmation && (
                <p className="mt-3 rounded-xl bg-brand-off-white/50 px-4 py-3 text-sm text-brand-neutral-black">
                  {clinicianRevokeConfirmation}
                </p>
              )}
              {clinicianRevokeError && (
                <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                  {clinicianRevokeError}
                </p>
              )}
            </section>
          </ErrorBoundary>
        </div>

        <div aria-hidden className="h-px bg-black/5" />

        {/* Fetches "From your Clinical Team" content once, headlessly --
            always mounted once summary is ready (independent of whether
            its own accordion below is expanded), so the accordion's
            collapsed-state pill count is never stuck waiting on an
            expand to trigger the fetch. Renders nothing itself. */}
        <ClinicalTeamDataLoader passportId={summary.passportId} onLoaded={setClinicalTeamItems} />

        <div className="flex flex-col gap-3">
          <PassportAccordion
            id="about-your-child"
            title="About Your Child"
            hint={aboutCount > 0 ? `${aboutCount} items` : undefined}
            editHref="/passport/section-a"
            isExpanded={expandedSections.has("about-your-child")}
            onToggle={() => toggleSection("about-your-child")}
          >
            {subInfoLine || summary.importantPeople ? (
              <div className="flex flex-col gap-3">
                {subInfoLine && <p className="text-sm text-brand-neutral-black">{subInfoLine}</p>}
                {summary.importantPeople && (
                  <div>
                    <h3 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
                      Important People
                    </h3>
                    <p className="mt-1 text-sm text-brand-neutral-black">{summary.importantPeople}</p>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-brand-neutral-black/60">No additional details added yet.</p>
            )}
          </PassportAccordion>

          <ErrorBoundary fallback={fallbackCard}>
            <PassportAccordion
              id="understanding-my-child"
              title="Understanding My Child"
              hint={understandingCount > 0 ? `${understandingCount} items` : undefined}
              editHref="/passport/section-b/1"
              isExpanded={expandedSections.has("understanding-my-child")}
              onToggle={() => toggleSection("understanding-my-child")}
            >
              {sectionBEmpty ? (
                <EmptyStateBox
                  prompt={`Help teachers recognise when ${summary.childName} is feeling regulated, and spot the early signs when they are finding things hard.`}
                  ctaLabel="Add Signals and Triggers"
                  ctaHref="/passport/section-b/1"
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {hasOkay && (
                    <ChipGroup
                      heading="When I am okay, you might see me..."
                      items={summary.okaySignals!}
                      variant="okay"
                    />
                  )}
                  {hasHard && (
                    <ChipGroup
                      heading="When I am finding things hard..."
                      items={summary.hardSignals!}
                      variant="hard"
                    />
                  )}
                  {hasTriggers && (
                    <ChipGroup
                      heading="What can make things hard for me..."
                      items={summary.hardTriggers!}
                      variant="hard"
                    />
                  )}
                </div>
              )}
            </PassportAccordion>
          </ErrorBoundary>

          <ErrorBoundary fallback={fallbackCard}>
            <PassportAccordion
              id="how-my-child-communicates"
              title="How My Child Communicates"
              hint={communicatesCount > 0 ? `${communicatesCount} items` : undefined}
              editHref="/passport/section-c"
              isExpanded={expandedSections.has("how-my-child-communicates")}
              onToggle={() => toggleSection("how-my-child-communicates")}
            >
              {sectionCEmpty ? (
                <EmptyStateBox
                  prompt={`Every child has a voice. Share ${summary.childName}'s unique communication style so others know exactly how to connect with them.`}
                  ctaLabel="Add Communication Profile"
                  ctaHref="/passport/section-c"
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {hasCommMethods && (
                    <ChipGroup
                      heading="Communication methods"
                      items={summary.communicationMethods!}
                      variant="okay"
                    />
                  )}
                  {hasShowsHappy && (
                    <QuoteBox
                      heading={`How ${summary.childName} shows they are happy`}
                      text={summary.showsHappy!}
                    />
                  )}
                  {hasShowsAnxious && (
                    <QuoteBox
                      heading={`How ${summary.childName} shows they are anxious`}
                      text={summary.showsAnxious!}
                    />
                  )}
                  {hasPhrasesToAvoid && (
                    <QuoteBox heading="Phrases to avoid" text={summary.phrasesToAvoid!} />
                  )}
                </div>
              )}
            </PassportAccordion>
          </ErrorBoundary>

          <ErrorBoundary fallback={fallbackCard}>
            <PassportAccordion
              id="how-i-support-my-child"
              title="How I Support My Child"
              hint={supportCount > 0 ? `${supportCount} strategies` : undefined}
              editHref="/passport/section-d/1"
              isExpanded={expandedSections.has("how-i-support-my-child")}
              onToggle={() => toggleSection("how-i-support-my-child")}
            >
              {sectionDEmpty ? (
                <EmptyStateBox
                  prompt="What sensory tools and de-escalation strategies work best? Build a quick-reference toolkit for the classroom."
                  ctaLabel="Add Support Strategies"
                  ctaHref="/passport/section-d/1"
                />
              ) : (
                <div className="flex flex-col gap-5">
                  {hasBefore && (
                    <VerticalChipList heading="What helps before a behaviour" items={summary.beforeBehaviour!} />
                  )}
                  {hasDuring && (
                    <VerticalChipList heading="What helps during distress" items={summary.duringDistress!} />
                  )}
                  {hasAfter && (
                    <VerticalChipList heading="What helps after distress" items={summary.afterDistress!} />
                  )}

                  {(hasSeeks || hasAvoids) && (
                    <div>
                      <h3 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
                        Sensory Profile
                      </h3>
                      <div
                        className={
                          hasSeeks && hasAvoids ? "mt-2 grid grid-cols-2 gap-4" : "mt-2"
                        }
                      >
                        {hasSeeks && (
                          <div>
                            <h4 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
                              Sensory Seeks
                            </h4>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {summary.sensorySeeks!.map((item, index) => (
                                <span
                                  key={index}
                                  className="rounded-lg bg-brand-pastel-blue/20 px-3 py-1.5 text-sm font-semibold text-brand-prussian-blue"
                                >
                                  + {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                        {hasAvoids && (
                          <div>
                            <h4 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
                              Sensory Avoids
                            </h4>
                            <div className="mt-2 flex flex-wrap gap-2">
                              {summary.sensoryAvoids!.map((item, index) => (
                                <span
                                  key={index}
                                  className="rounded-lg bg-brand-pastel-blue/20 px-3 py-1.5 text-sm font-semibold text-brand-prussian-blue"
                                >
                                  − {item}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </PassportAccordion>
          </ErrorBoundary>

          {/* Self-hides entirely until something is approved into it --
              same behaviour as the old ParentClinicalTeamCard, just now
              accordion-wrapped instead of its own standalone card (its
              own heading/wrapper would be redundant nested inside the
              accordion's identical chrome). */}
          {clinicalTeamItems && clinicalTeamItems.length > 0 && (
            <ErrorBoundary fallback={fallbackCard}>
              <PassportAccordion
                id="clinical-team"
                title="From your Clinical Team"
                hint={`${clinicalTeamItems.length} items`}
                isExpanded={expandedSections.has("clinical-team")}
                onToggle={() => toggleSection("clinical-team")}
              >
                <ClinicalTeamSection items={clinicalTeamItems} viewerRole="parent" />
              </PassportAccordion>
            </ErrorBoundary>
          )}
        </div>

        <ErrorBoundary fallback={fallbackCard}>
          <section className="mt-2 mb-6">
            <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">Incident Timeline</h2>
            <ABCTimeline key={timelineRefreshKey} passportId={summary.passportId} viewerRole="parent" />
          </section>
        </ErrorBoundary>
      </main>

      <ShareBottomSheet
        isOpen={isShareOpen}
        onClose={() => {
          setIsShareOpen(false);
          setFocusClinicianCodeOnOpen(false);
        }}
        passportId={summary.passportId}
        childName={summary.childName}
        passportCode={summary.passportCode}
        focusClinicianCode={focusClinicianCodeOnOpen}
        onCodeGenerated={(code) =>
          setSummary((prev) => (prev ? { ...prev, passportCode: code } : prev))
        }
        onApproved={() => loadApprovedInstitutions(summary.passportId)}
        onClinicianConnected={() => loadConnectedClinicians(summary.passportId)}
      />

      {isAbcLoggerOpen && (
        <ABCLogger
          passportId={summary.passportId}
          childName={summary.childName}
          role="parent"
          initialPrefill={calmBehaviour ? { behaviours: [calmBehaviour] } : undefined}
          onComplete={(newLogId) => {
            setIsAbcLoggerOpen(false);
            setTimelineRefreshKey((key) => key + 1);
            // Calm log-nudge backfill (Stage 3C) -- fire-and-forget, same
            // posture as logActivity: this must never block or surface an
            // error over an ABC log that already saved successfully.
            if (calmEpisodeId && newLogId) {
              const supabase = createClient();
              supabase
                .rpc("attach_calm_episode_abc_log", { p_episode_id: calmEpisodeId, p_abc_log_id: newLogId })
                .then(({ error }) => {
                  if (error) console.error("Failed to attach calm episode's abc log:", error);
                });
              // "Clearing on logging" (constraint 3C) -- this is the
              // [Log it] path completing, as distinct from the parent
              // dashboard's own [Dismiss] on the reminder card itself.
              if (user) clearPendingLogReminder(user.id);
            }
            setCalmEpisodeId(null);
            setCalmBehaviour(null);
          }}
          onDismiss={() => {
            setIsAbcLoggerOpen(false);
            setCalmEpisodeId(null);
            setCalmBehaviour(null);
          }}
        />
      )}

      <BottomNav passportHref="/passport/dashboard" />
    </div>
  );
}

function ShareIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5" aria-hidden>
      <path
        d="M12 3v12m0-12l4 4m-4-4l-4 4M5 12v7a1 1 0 001 1h12a1 1 0 001-1v-7"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function EmptyStateBox({
  prompt,
  ctaLabel,
  ctaHref,
}: {
  prompt: string;
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="mt-4 flex flex-col items-center justify-center rounded-xl border-2 border-dashed border-brand-pastel-blue bg-brand-pastel-blue/10 p-6 text-center">
      <span aria-hidden className="mb-3 text-2xl text-brand-prussian-blue opacity-60">
        ✨
      </span>
      <p className="mb-4 text-sm text-brand-neutral-black">{prompt}</p>
      <Link
        href={ctaHref}
        className="rounded-full bg-brand-prussian-blue px-5 py-2.5 text-sm font-bold text-white"
      >
        {ctaLabel}
      </Link>
    </div>
  );
}

function ChipGroup({
  heading,
  items,
  variant,
}: {
  heading: string;
  items: string[];
  variant: "okay" | "hard";
}) {
  const chipClassName =
    variant === "okay"
      ? "bg-brand-pastel-blue/20 text-brand-prussian-blue"
      : "border border-brand-golden-brown/20 bg-brand-golden-brown/10 text-brand-golden-brown";

  return (
    <div>
      <h3 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
        {heading}
      </h3>
      <div className="mt-2 flex flex-wrap gap-2">
        {items.map((item, index) => (
          <span
            key={index}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${chipClassName}`}
          >
            {item}
          </span>
        ))}
      </div>
    </div>
  );
}

function QuoteBox({ heading, text }: { heading: string; text: string }) {
  return (
    <div>
      <h3 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
        {heading}
      </h3>
      <div className="mt-2 rounded-r-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4">
        <p className="text-base italic leading-relaxed text-brand-neutral-black">{text}</p>
      </div>
    </div>
  );
}

function VerticalChipList({ heading, items }: { heading: string; items: string[] }) {
  return (
    <div>
      <h3 className="font-accent text-xs font-bold uppercase tracking-[0.1em] text-brand-neutral-black/60">
        {heading}
      </h3>
      <div className="mt-2">
        {items.map((item, index) => (
          <div
            key={index}
            className="mb-2 flex w-full items-center rounded-lg bg-brand-off-white/30 p-3 text-sm font-medium text-brand-prussian-blue"
          >
            {item}
          </div>
        ))}
      </div>
    </div>
  );
}

// Headless: renders nothing itself, exists purely to run
// usePassportClinicalContent and hand the result up to the page via
// onLoaded. Kept as its own component (rather than calling the hook
// directly in PassportDashboardPage) because the page already has an
// early `if (!summary) return null` before summary.passportId exists --
// React's rules of hooks forbid calling a hook after a conditional
// return in the same component, so this is mounted only once summary
// is confirmed non-null, where passportId is guaranteed to be real.
function ClinicalTeamDataLoader({
  passportId,
  onLoaded,
}: {
  passportId: string;
  onLoaded: (items: ClinicalContentItem[]) => void;
}) {
  const { items, isLoading, loadError } = usePassportClinicalContent(passportId);

  useEffect(() => {
    if (!isLoading && !loadError) onLoaded(items);
    // onLoaded is a setState function (stable identity), so it's safe to
    // omit -- including it would only ever add a no-op re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isLoading, loadError]);

  return null;
}
