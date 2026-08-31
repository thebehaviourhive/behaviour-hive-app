"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ShareBottomSheet } from "@/components/parent/ShareBottomSheet";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { ABCLogger } from "@/components/abc-logger/ABCLogger";
import { ABCTimeline } from "@/components/abc-logger/ABCTimeline";
import { PassportAccordion } from "@/components/passport/PassportAccordion";
import { ClinicalTeamSection } from "@/components/passport/clinical-team/ClinicalTeamSection";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { useStrategyEffectiveness } from "@/hooks/useStrategyEffectiveness";
import { revalidateParentCalmAccess } from "@/hooks/useParentCalmAccess";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";
import { logActivity } from "@/lib/logActivity";
import { clearPendingLogReminder } from "@/lib/calmCards/logReminder";
import {
  CLINICIAN_SPECIALTY_LABEL,
  type ClinicianSpecialty,
} from "@/lib/clinicianSpecialties";
import type { ClinicalContentItem } from "@/lib/passportClinicalContent";
import { useMessageRecipientCandidates } from "@/hooks/useMessageRecipientCandidates";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";
import { IMPORTANT_PEOPLE_TITLE } from "@/lib/passportCopy";

interface ApprovedInstitution {
  institutionId: string;
  institutionName: string;
  approvedAt: string | null;
}

interface ConnectedClinician {
  clinicianAccessId: string;
  clinicianId: string;
  fullName: string;
  specialty: string;
  // Stage 7: which authority engaged this clinician -- 'parent' or
  // 'institution' (with the engaging school's own name) -- symmetry
  // with the principal's own view: a school connecting a clinician for
  // this child is not something a parent should discover by accident.
  engagedBy: "parent" | "institution";
  engagedByInstitutionName: string | null;
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

// Same dismiss-once localStorage convention as parent-dashboard's own
// getDismissKey (passportCardDismissed:${userId}) -- keyed by passportId
// here since the hint is about THIS passport's own share history, not a
// per-user preference. Permanent once written: opening the share sheet
// (from any of its three entry points) writes this immediately, so a
// force-quit mid-flow still leaves the hint gone on reload.
function getShareHintDismissKey(passportId: string) {
  return `shareHintDismissed:${passportId}`;
}

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
  const { passportId, isLoading: isLoadingPassportId } = useMyPassport(user?.id);
  const [summary, setSummary] = useState<PassportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvedInstitutions, setApprovedInstitutions] = useState<ApprovedInstitution[]>([]);
  const [connectedClinicians, setConnectedClinicians] = useState<ConnectedClinician[]>([]);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [focusClinicianCodeOnOpen, setFocusClinicianCodeOnOpen] = useState(false);
  const [isShareHintDismissed, setIsShareHintDismissed] = useState(false);
  const [clinicianRevokeConfirmation, setClinicianRevokeConfirmation] = useState<string | null>(null);
  const [clinicianRevokeError, setClinicianRevokeError] = useState<string | null>(null);
  const [clinicianRevokeTarget, setClinicianRevokeTarget] = useState<ConnectedClinician | null>(null);
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
  // Stage 3A: "View log" on an incident-note message deep-links here as
  // #abc-log-<id> -- parsed once on mount (the page's own generic hash
  // effect elsewhere still fires too and harmlessly no-ops, since no
  // element literally has this id; the real scroll+highlight is
  // ABCTimeline's own ref-based mechanism, driven by this parsed value).
  const [highlightAbcLogId, setHighlightAbcLogId] = useState<string | null>(null);
  // Non-null while the "Also send a message about this?" compose sheet
  // is open, scoped to the just-saved log's id.
  const [composeAbcLogId, setComposeAbcLogId] = useState<string | null>(null);
  const [messagesInstitutionPhone, setMessagesInstitutionPhone] = useState<string | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const match = window.location.hash.match(/^#abc-log-(.+)$/);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (match) setHighlightAbcLogId(match[1]);
  }, []);

  // Stage 3A compose prefill data -- fetched whenever a passport is
  // known, ready before "Also send a message about this?" is ever
  // tapped rather than fetched fresh at that moment.
  const { candidates: messageCandidates } = useMessageRecipientCandidates(summary?.passportId ?? null);
  const { categories: messageCategories } = useMessageCategories("parent");
  const incidentNoteCategoryId = messageCategories.find((category) => category.label === "Incident note")?.id;
  // Parent-logged -> linked teacher(s), per the brief's sensible default
  // (still adjustable via the compose sheet's normal recipient picker).
  const defaultIncidentRecipientIds = messageCandidates
    .filter((candidate) => candidate.role === "class_teacher")
    .map((candidate) => candidate.recipientId);

  useEffect(() => {
    if (!summary?.passportId) return;
    let isMounted = true;
    fetchApprovedInstitutionPhone(createClient(), summary.passportId).then((phone) => {
      if (isMounted) setMessagesInstitutionPhone(phone);
    });
    return () => {
      isMounted = false;
    };
  }, [summary?.passportId]);

  // Accordion state: "About Your Child" is expanded by default, every
  // other section starts collapsed -- independent toggling, so opening
  // one never affects another. A #section-id in the URL (e.g.
  // #clinical-team) ADDS that section to the expanded set rather than
  // replacing it, matching "independent toggling" -- arriving via a
  // deep link doesn't collapse the default-open section.
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set(["about-your-child"]));
  const [clinicalTeamItems, setClinicalTeamItems] = useState<ClinicalContentItem[] | null>(null);
  // Regression fix: this dashboard used to render the standalone
  // ParentClinicalTeamCard (which owned its own useStrategyEffectiveness
  // call), before being restructured to inline ClinicalTeamSection
  // directly -- that restructure dropped the helpedCounts wiring
  // entirely, silently disabling the "Helped N times" counter here even
  // though the underlying data was always fine (confirmed live: the
  // same strategies show correct counts in the clinician's Effectiveness
  // view). Threaded through the same headless-loader pattern as
  // clinicalTeamItems below, for the same rules-of-hooks reason.
  const [helpedCounts, setHelpedCounts] = useState<Record<string, number>>({});
  const hasHandledHashRef = useRef(false);
  const hasReadShareHintDismissRef = useRef(false);

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

  // Reads the dismiss flag exactly once per mount (the ref guard matters
  // here, not just the `summary` dependency -- summary's own identity
  // changes again once code generation resolves, and re-reading then
  // would just read back the "true" this same session already wrote).
  useEffect(() => {
    if (!summary || hasReadShareHintDismissRef.current) return;
    hasReadShareHintDismissRef.current = true;
    setIsShareHintDismissed(
      window.localStorage.getItem(getShareHintDismissKey(summary.passportId)) === "true"
    );
  }, [summary]);

  // The one function every "open the share sheet" entry point calls --
  // the header pill, the Manage Access primary button, AND the
  // ?openShare=1 deep link below -- so the first-time hint's permanent
  // dismissal (constraint 3) can never be missed from one entry point
  // while wired correctly from another. Writing the flag on OPEN rather
  // than on some later success event is deliberate: the hint's whole
  // job is done the moment a parent finds and taps the share affordance,
  // regardless of what they do inside the sheet next.
  const openShareSheet = useCallback(
    (focusClinician = false) => {
      if (summary && !isShareHintDismissed) {
        window.localStorage.setItem(getShareHintDismissKey(summary.passportId), "true");
        setIsShareHintDismissed(true);
      }
      setIsShareOpen(true);
      if (focusClinician) setFocusClinicianCodeOnOpen(true);
    },
    [summary, isShareHintDismissed]
  );

  // PRD 3, Stage 2 -- dropped the .eq("approved_by_parent", true) filter.
  // That flag was a genuine consent record when a parent approving a
  // school by code was the only way a link got created; it's a
  // compatibility default now (create_school_passport() always sets it
  // true, since a school-created child has no parent action to record --
  // see that function's own comment and CLAUDE.md). Filtering on it here
  // would hide every future link, not just show approved ones: the
  // column no longer distinguishes "connected" from "not yet connected."
  async function loadApprovedInstitutions(passportId: string) {
    setInstitutionsError(null);
    const supabase = createClient();
    const { data: linkRows, error } = await supabase
      .from("passport_institution_links")
      .select("institution_id, parent_approved_at, institutions(name)")
      .eq("passport_id", passportId)
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
        (row: {
          clinician_access_id: string;
          clinician_id: string;
          full_name: string | null;
          specialty: string;
          engaged_by: "parent" | "institution";
          engaged_by_institution_name: string | null;
        }) => ({
          clinicianAccessId: row.clinician_access_id,
          clinicianId: row.clinician_id,
          fullName: row.full_name ?? "A clinician",
          specialty: row.specialty,
          engagedBy: row.engaged_by,
          engagedByInstitutionName: row.engaged_by_institution_name,
        })
      )
    );
  }

  useEffect(() => {
    if (!user || isLoadingPassportId) return;
    let isMounted = true;

    async function load() {
      try {
        // No passport at all (get_my_passports() came back empty) --
        // same destination as the old "no row" case: off to the wizard.
        if (!passportId) {
          router.replace("/passport/welcome");
          return;
        }

        const supabase = createClient();
        // The extra fields getPassportResumeHref/this page's own summary
        // need beyond what get_my_passports() returns (id + child_name
        // only) -- a follow-up .eq("id", ...) read, safe post-migration
        // 0117 (passports' SELECT policy is owns_passport()-based) for a
        // claimed guardian too, not just a self-created one.
        //
        // sectionB/C/D now read .eq("passport_id", passportId), not
        // .eq("user_id", user.id) -- PRD 3 Stage 1 (migration 0138) made
        // these tables guardian-writable, so the old reasoning here ("a
        // claimed guardian's passport can never have rows in these
        // tables") no longer holds, and the old query shape has a sharper
        // failure mode than just "claimed guardians see nothing": once
        // two guardians can both write the SAME section, the row's
        // user_id reflects whoever saved LAST (see usePassportSectionB's
        // own header note), so a guardian who didn't personally write the
        // most recent entry would see their own child's real, complete
        // data as empty on their own dashboard. passport_id is the
        // correct key regardless of authorship or who wrote last.
        const [
          { data: passport },
          { data: sectionB },
          { data: sectionC },
          { data: sectionD },
        ] = await Promise.all([
          supabase
            .from("passports")
            .select(
              "user_id, passport_code, child_name, date_of_birth, school, important_people, diagnoses, diagnosis_other, passport_status, section_a_complete"
            )
            .eq("id", passportId)
            .maybeSingle(),
          supabase
            .from("passport_section_b")
            .select("okay_signals, hard_signals, hard_triggers, section_b_complete")
            .eq("passport_id", passportId)
            .maybeSingle(),
          supabase
            .from("passport_section_c")
            .select(
              "communication_methods, shows_happy, shows_anxious, phrases_to_avoid, section_c_complete"
            )
            .eq("passport_id", passportId)
            .maybeSingle(),
          supabase
            .from("passport_section_d")
            .select(
              "before_behaviour, during_distress, after_distress, sensory_seeks, sensory_avoids, section_d_complete"
            )
            .eq("passport_id", passportId)
            .maybeSingle(),
        ]);

        if (!isMounted) return;

        // A CLAIMED passport (this parent isn't its passports.user_id --
        // that's either a different guardian's self-created row, or null
        // for a school-created one) skips the guided wizard-resume flow:
        // getPassportResumeHref only ever runs for isSelfCreated. Section
        // A/B/C/D are all guardian-writable now (PRD 3 Stage 1, migration
        // 0138) -- a claimed guardian CAN edit every section, just not
        // through the sequential wizard redirect; the section cards below
        // link straight to /passport/section-{a,b/1,c,d/1}, which resolve
        // and save correctly for a claimed guardian too (useMyPassport()-
        // based, same as this page). Kept this way deliberately, not a
        // leftover limitation: routing a claimed guardian through
        // getPassportResumeHref would send a not_started claimed passport
        // to /passport/welcome, which (now that welcome itself redirects
        // a parent who already has ANY passport straight back here) is a
        // genuine infinite redirect loop, not just wrong copy. Found live,
        // driving this exact case end-to-end, not by inspection. A
        // claimed guardian always lands on this dashboard itself, however
        // incomplete the underlying data is -- the section cards below
        // already have their own "nothing added yet"
        // empty states for exactly this shape.
        const isSelfCreated = passport?.user_id === user!.id;

        const resumeHref = isSelfCreated
          ? getPassportResumeHref({
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
            })
          : "/passport/dashboard";

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
          passportId,
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

        await loadApprovedInstitutions(passportId);
        await loadConnectedClinicians(passportId);
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
  }, [user, router, passportId, isLoadingPassportId]);

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
    openShareSheet(true);
    router.replace("/passport/dashboard");
  }, [summary, searchParams, router, openShareSheet]);

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

  // Revokes at the individual level: only this clinician's own
  // clinician_access row is touched. Clinicians are connected one at a
  // time by their personal code (no institution grouping), so trust is
  // scoped to the named individual -- the parent's own remaining revoke
  // authority, now that a school's own access is no longer the parent's
  // to revoke (removed; the school owns the child's file once enrolled,
  // the same way ending an enrolment is a principal's action).
  //
  // Stage 7: revoke_clinician_access() (0123) is the only write path
  // now -- the old direct .update() this used to do was silently
  // refused by RLS the moment 0123's own migration dropped the bare
  // policy it depended on. The RPC also enforces the split: a parent
  // can only revoke their OWN engaged_by='parent' rows, so this handler
  // is only ever reachable from the UI for a clinician the parent
  // themselves engaged -- an institution-engaged one shows read-only,
  // no revoke button at all (see the render below).
  async function handleRevokeClinician(clinician: ConnectedClinician, reason: string) {
    const supabase = createClient();
    const { error } = await supabase.rpc("revoke_clinician_access", {
      p_clinician_access_id: clinician.clinicianAccessId,
      p_reason: reason,
    });

    if (error) {
      return { error: error.message };
    }

    if (user && summary) {
      const specialtyLabel =
        CLINICIAN_SPECIALTY_LABEL[clinician.specialty as ClinicianSpecialty] ?? clinician.specialty;
      logActivity({
        passportId: summary.passportId,
        actorId: user.id,
        eventType: "access_revoked",
        eventDescription: `${specialtyLabel} access removed`,
      });
    }

    return { error: null };
  }

  const diagnosisPills = getDiagnosisPills(summary.diagnoses, summary.diagnosisOther);
  const subInfoLine = buildSubInfoLine(summary.age, summary.school);

  // "Never shared" per the brief's own three-part definition: no code
  // ever generated (passportCode is only ever set the moment the share
  // sheet is first opened, via generateCode's auto-trigger -- see
  // ShareBottomSheet), no approved schools, no connected clinicians.
  // showShareHint additionally requires the dismiss flag not already
  // set, so a passport that WAS genuinely shared but somehow lost its
  // localStorage flag (a different device/browser) still correctly
  // shows no cue -- the data check alone is what "a shared passport
  // shows no cue" actually depends on.
  const hasNeverShared =
    !summary.passportCode && approvedInstitutions.length === 0 && connectedClinicians.length === 0;
  const showShareHint = hasNeverShared && !isShareHintDismissed;

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
        {/* Header Share pill removed (UI refinements round) -- the
            Manage Access card's "Share [child]'s Passport" button below
            is now the sole canonical entry point; it calls the exact
            same openShareSheet() as this pill used to, so the sheet
            itself and the ?openShare=1 deep link (FBA card, Calm unlock
            sheet) are entirely unaffected. Child identity remains the
            header's sole anchor. */}
        <p className="font-accent text-sm uppercase tracking-wide text-brand-neutral-black">
          The Behavioural Passport Of
        </p>

        <h1 className="mt-1 font-heading text-4xl font-bold leading-tight text-brand-prussian-blue">
          {summary.childName}
        </h1>

        {diagnosisPills.length > 0 ? (
          <>
            {/* FIX: was "Diagnoses and neurotypes" -- read oddly once
                Awaiting Diagnosis/No diagnosis became real selectable
                values (a passport showing only "No diagnosis" under a
                "Diagnoses" label reads as self-contradictory). This
                label now covers a real diagnosis, a neurotype, or a
                status equally naturally. */}
            <p className="mt-4 mb-2 font-accent text-xs font-bold uppercase tracking-widest text-brand-neutral-black/60">
              Diagnoses, neurotypes &amp; status
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

              {/* The primary door into sharing (constraint 2) -- the
                  pinned access cards are exactly where a hunting parent
                  looks first. Same shared sheet as the header pill, via
                  the same openShareSheet() entry point -- one flow, two
                  doors. showShareHint's one-time "Start here" badge
                  (constraint 3) sits on this button specifically since
                  it's the button most naturally in a first-time
                  parent's eyeline, not the smaller header pill. */}
              <div className="relative mb-4">
                <button
                  type="button"
                  onClick={() => openShareSheet()}
                  className="flex w-full items-center justify-center gap-2 rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
                >
                  <ShareIcon />
                  Share {summary.childName}&apos;s Passport
                </button>
                {showShareHint && (
                  <span
                    aria-hidden
                    className="absolute -right-2 -top-2 animate-pulse rounded-full bg-brand-golden-brown px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white shadow-sm"
                  >
                    Start here
                  </span>
                )}
              </div>

              {/* Deliberately read-only and purely informational -- PRD 3
                  Stage 2 resolved the open question this comment used to
                  pose. The school connects itself to a child now
                  (create_school_passport() at creation, or a claim code
                  the school issues) -- there is no parent approve/revoke
                  action here at all, and the heading and empty state say
                  so plainly rather than implying the parent granted or
                  could grant this link. */}
              <h3 className="mb-2 text-sm font-semibold text-brand-neutral-black/70">
                Connected Schools
              </h3>
              {institutionsError ? (
                <InlineErrorState
                  message={institutionsError}
                  onRetry={() => loadApprovedInstitutions(summary.passportId)}
                />
              ) : approvedInstitutions.length === 0 ? (
                <p className="text-center text-sm text-brand-neutral-black/60">
                  No schools connected yet. Your child&apos;s school connects
                  itself once they add your child&apos;s passport.
                </p>
              ) : (
                <div>
                  {approvedInstitutions.map((institution) => (
                    <div
                      key={institution.institutionId}
                      className="mb-2 rounded-xl bg-brand-off-white/50 p-4"
                    >
                      <p className="font-bold text-brand-neutral-black">
                        {institution.institutionName}
                      </p>
                    </div>
                  ))}
                </div>
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
                        {/* Stage 7 symmetry requirement: a school connecting
                            a clinician for this child is not something a
                            parent should discover by accident -- shown for
                            every row, not just the institution-engaged ones,
                            so "connected by you" is equally explicit. */}
                        <p className="mt-0.5 text-xs text-brand-neutral-black/40">
                          {clinician.engagedBy === "parent"
                            ? "Connected by you"
                            : `Connected by ${clinician.engagedByInstitutionName ?? "the school"}`}
                        </p>
                      </div>
                      {clinician.engagedBy === "parent" ? (
                        <button
                          type="button"
                          onClick={() => setClinicianRevokeTarget(clinician)}
                          className="text-sm font-bold text-brand-golden-brown"
                        >
                          Revoke Access
                        </button>
                      ) : (
                        <span className="text-xs text-brand-neutral-black/40">
                          Managed by school
                        </span>
                      )}
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
        <ClinicalTeamDataLoader
          passportId={summary.passportId}
          onLoaded={setClinicalTeamItems}
          onHelpedCountsLoaded={setHelpedCounts}
        />

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
                      {IMPORTANT_PEOPLE_TITLE}
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
                <ClinicalTeamSection items={clinicalTeamItems} viewerRole="parent" helpedCounts={helpedCounts} />
              </PassportAccordion>
            </ErrorBoundary>
          )}
        </div>

        <ErrorBoundary fallback={fallbackCard}>
          <section className="mt-2 mb-6">
            <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">Incident Timeline</h2>
            <ABCTimeline
              key={timelineRefreshKey}
              passportId={summary.passportId}
              viewerRole="parent"
              highlightLogId={highlightAbcLogId}
            />
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
        onClinicianConnected={() => {
          loadConnectedClinicians(summary.passportId);
          // Connecting a clinician is the concrete moment the unlock
          // sheet's own "link a clinician" journey completes -- a
          // genuinely access-changing event worth an immediate
          // revalidate rather than waiting for the next natural
          // navigation (which would pick it up anyway, just later).
          revalidateParentCalmAccess();
        }}
      />

      <ReasonConfirmSheet
        isOpen={Boolean(clinicianRevokeTarget)}
        title="Revoke clinician access"
        description={
          clinicianRevokeTarget
            ? `${clinicianRevokeTarget.fullName} will no longer be able to see ${summary.childName}'s passport. Please give a reason.`
            : ""
        }
        confirmLabel="Revoke Access"
        submittingLabel="Revoking..."
        onClose={() => setClinicianRevokeTarget(null)}
        onConfirm={(reason) => {
          if (!clinicianRevokeTarget) return Promise.resolve({ error: "No clinician selected." });
          return handleRevokeClinician(clinicianRevokeTarget, reason);
        }}
        onConfirmed={() => {
          const target = clinicianRevokeTarget;
          setClinicianRevokeTarget(null);
          setClinicianRevokeError(null);
          if (target) {
            setClinicianRevokeConfirmation(
              `Access for ${target.fullName} has been removed. They can no longer see ${summary.childName}'s passport.`
            );
          }
          loadConnectedClinicians(summary.passportId);
        }}
      />

      {isAbcLoggerOpen && (
        <ABCLogger
          passportId={summary.passportId}
          childName={summary.childName}
          role="parent"
          initialPrefill={calmBehaviour ? { behaviours: [calmBehaviour] } : undefined}
          onOfferMessage={(newLogId) => setComposeAbcLogId(newLogId)}
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

      {/* Stage 3A: "Also send a message about this?" -- pre-configured,
          not locked; every field below is still the normal adjustable
          compose sheet. */}
      {composeAbcLogId && incidentNoteCategoryId && (
        <ComposeMessageSheet
          isOpen={Boolean(composeAbcLogId)}
          onClose={() => setComposeAbcLogId(null)}
          passportId={summary.passportId}
          childName={summary.childName}
          candidates={messageCandidates}
          categories={messageCategories}
          institutionPhone={messagesInstitutionPhone}
          onSent={() => setTimelineRefreshKey((key) => key + 1)}
          initialCategoryId={incidentNoteCategoryId}
          initialRecipientIds={defaultIncidentRecipientIds}
          bodyPlaceholder="All settled now — just so you know…"
          abcLogId={composeAbcLogId}
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
  onHelpedCountsLoaded,
}: {
  passportId: string;
  onLoaded: (items: ClinicalContentItem[]) => void;
  onHelpedCountsLoaded: (counts: Record<string, number>) => void;
}) {
  const { items, isLoading, loadError } = usePassportClinicalContent(passportId);
  const { helpedCounts, isLoading: isHelpedCountsLoading } = useStrategyEffectiveness(passportId);

  useEffect(() => {
    if (!isLoading && !loadError) onLoaded(items);
    // onLoaded is a setState function (stable identity), so it's safe to
    // omit -- including it would only ever add a no-op re-run.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, isLoading, loadError]);

  useEffect(() => {
    if (!isHelpedCountsLoading) onHelpedCountsLoaded(helpedCounts);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [helpedCounts, isHelpedCountsLoading]);

  return null;
}
