"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";

// PRD 2, Stage 3. Full-screen, not a bottom sheet -- "Enrolling creates
// the child," per the design's own instruction, a deliberate act
// weighted the same way Handover's own full-screen sheet is (a
// deliberate context switch, not a quick action). Replaces
// EnrolChildSheet.tsx entirely (its own only caller); the write itself
// is unchanged for a school -- create_school_passport() (0113/0121),
// the same RPC, same single required field.
//
// Tier 1 item 1, 21 Sept 2026, the "active harm" fix: this screen was
// the ONLY reachable "add a client" entry point at a clinic institution
// too, and it unconditionally called create_school_passport() --
// producing an `enrolments` row for a clinic client, a table that is
// structurally invisible to tags, scope, discharge, and the
// stagnation queue forever (episodes_of_care is the parallel,
// clinic-only table those all key off; see CLAUDE.md's own "reuse the
// enrolment shape means the shape, never the table" entry). Checked
// directly against production before fixing anything: zero wrong
// enrolments/episodes_of_care rows exist for the one real clinic --
// nothing to clean up, this was caught before any real client was
// added through it. Now branches on institutionType and calls
// onboard_clinic_client() (0210, already built, already tested, zero
// callers until this) for a clinic -- same uuid return shape, same
// redirect.
//
// PRD 10 Stage 2, 21 Sept 2026 -- the gate widens, and tag selection
// arrives. onboard_clinic_client() has always admitted THREE roles at
// a clinic (principal, clinic_admin, and clinician when
// practitioner_can_onboard is on) -- this screen's own gate admitted
// only "principal", so an admin or a toggle-enabled practitioner could
// never reach the one screen that lets them exercise an authority the
// backend already gave them. Widened to match. set_episode_tags()
// itself only ever admits principal/clinic_admin (0214's own header:
// "clinical_lead and clinician are not callers at all -- neither role
// is named as a tagger anywhere in PRD section 5") -- so the tag step
// below is shown only for those two, never for a practitioner, exactly
// matching what the RPC would accept if it tried.
//
// The SCHOOL branch is completely untouched -- create_school_passport()
// stays principal-only (confirmed by reading its own live 0140 body),
// so a school principal's own flow, form, and copy are byte-identical
// to before this stage.

interface TagOption {
  id: string;
  dimension: string;
  value: string;
}

type CallerRole = "principal" | "clinic_admin" | "clinician";

// Client Info (clinic-only), Daniel's decisions, Sept 2026. Entered as
// part of THIS flow, not a separate place -- two follow-up RPCs called
// right after onboard_clinic_client() succeeds, matching the tag
// step's own already-established precedent immediately below. Contact
// fields show whenever the caller can onboard at all (the same
// authorization set set_client_contact_info() itself checks -- an
// admin included); clinical fields show only when the caller isn't an
// admin (director, or a toggle-enabled practitioner), matching
// set_client_clinical_intake()'s own narrower check.
interface ContactFields {
  guardianFullName: string;
  relationshipToChild: string;
  contactEmail: string;
  contactPhone: string;
  referralSource: string;
  homeAddress: string;
}
const EMPTY_CONTACT: ContactFields = {
  guardianFullName: "",
  relationshipToChild: "",
  contactEmail: "",
  contactPhone: "",
  referralSource: "",
  homeAddress: "",
};

interface ClinicalFields {
  suspectedDiagnosis: string;
  mainConcerns: string;
  previousSupport: boolean | null;
  previousSupportDescription: string;
  clinicGoals: string;
  additionalNotes: string;
}
const EMPTY_CLINICAL: ClinicalFields = {
  suspectedDiagnosis: "",
  mainConcerns: "",
  previousSupport: null,
  previousSupportDescription: "",
  clinicGoals: "",
  additionalNotes: "",
};

// Cross-organisation link path -- CLAUDE.md's own "A SCHOOL CANNOT
// LINK ITSELF TO A CHILD WHO ALREADY HAS A CLINIC-CREATED PASSPORT"
// entry, and the migration that closes it (0294). SCHOOL-ONLY for now
// (see that migration's own header on the reverse direction), which is
// why the "Link an existing record" tile below only ever renders for
// institutionType === "school" -- offering it at a clinic would be a
// dead end nothing behind it can serve yet.
//
// Its own top-level mode, not folded into the existing form: "choose"
// is the new first screen (this page's own entry point now, for every
// one of the four hard-coded hrefs that land here), "new" is the
// existing enrol/onboard form below, byte-identical, just gated behind
// one extra tap; "link" is the new peek-then-commit flow.
type EnrolMode = "choose" | "new" | "link";

function LinkExistingPassportForm({
  institutionId,
  institutionName,
  onBack,
}: {
  institutionId: string;
  institutionName: string | null;
  onBack: () => void;
}) {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [isPeeking, setIsPeeking] = useState(false);
  const [peekError, setPeekError] = useState<string | null>(null);
  const [peeked, setPeeked] = useState<{ passportId: string; childName: string } | null>(null);
  const [isCommitting, setIsCommitting] = useState(false);
  const [commitError, setCommitError] = useState<string | null>(null);

  async function handlePeek() {
    if (!code.trim()) return;
    setIsPeeking(true);
    setPeekError(null);
    const supabase = createClient();
    const { data, error: peekErr } = await supabase.rpc("peek_institution_link_code", {
      p_code: code.trim(),
    });
    setIsPeeking(false);

    if (peekErr) {
      setPeekError(peekErr.message);
      return;
    }
    const rows = (data ?? []) as { passport_id: string; child_name: string }[];
    if (rows.length === 0) {
      setPeekError("We couldn't find a record with that code. Please check with the family and try again.");
      return;
    }
    setPeeked({ passportId: rows[0].passport_id, childName: rows[0].child_name });
  }

  async function handleConfirm() {
    setIsCommitting(true);
    setCommitError(null);
    const supabase = createClient();
    const { data: passportId, error: redeemErr } = await supabase.rpc("redeem_institution_link_code", {
      p_institution_id: institutionId,
      p_code: code.trim(),
    });
    setIsCommitting(false);

    if (redeemErr) {
      setCommitError(redeemErr.message);
      return;
    }
    router.push(`/principal/passports/${passportId}`);
  }

  if (peeked) {
    return (
      <>
        <p className="text-sm text-brand-neutral-black/70">
          Link <span className="font-semibold text-brand-neutral-black">{peeked.childName}</span> to{" "}
          {institutionName ?? "your school"}?
        </p>
        <p className="mt-2 text-xs text-brand-neutral-black/50">
          This gives your school the same record you&apos;d see if you enrolled this child yourself -- their
          passport sections and enrolment. It never includes anything from a clinic they may also be connected to.
        </p>

        {commitError && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {commitError}
          </p>
        )}

        <Button type="button" onClick={handleConfirm} disabled={isCommitting} className="mt-6 lg:w-auto">
          {isCommitting ? "Linking…" : `Link ${peeked.childName}`}
        </Button>
        <button
          type="button"
          onClick={() => {
            setPeeked(null);
            setCode("");
            setCommitError(null);
          }}
          className="mt-2 block w-full lg:inline-block lg:w-auto rounded-2xl border border-black/10 px-6 py-3 text-center text-sm font-semibold text-black/60"
        >
          Not this child? Try a different code
        </button>
      </>
    );
  }

  return (
    <>
      <p className="text-sm text-brand-neutral-black/70">
        Ask the family for the code from their child&apos;s passport. This connects your school to a record that
        already exists elsewhere -- it never creates a new one.
      </p>

      <label className="mt-6 block text-sm font-semibold text-brand-neutral-black" htmlFor="enrol-link-code">
        Link code
      </label>
      <input
        id="enrol-link-code"
        type="text"
        value={code}
        onChange={(e) => setCode(e.target.value)}
        placeholder="e.g. SAM-1234"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {peekError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {peekError}
        </p>
      )}

      <Button type="button" onClick={handlePeek} disabled={!code.trim() || isPeeking} className="mt-6 lg:w-auto">
        {isPeeking ? "Looking up…" : "Look Up Code"}
      </Button>
      <button
        type="button"
        onClick={onBack}
        className="mt-2 block w-full lg:inline-block lg:w-auto rounded-2xl border border-black/10 px-6 py-3 text-center text-sm font-semibold text-black/60"
      >
        Cancel
      </button>
    </>
  );
}

export default function EnrolChildPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole(["principal", "clinic_admin", "clinician"]);
  const [mode, setMode] = useState<EnrolMode>("choose");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [callerRole, setCallerRole] = useState<CallerRole | null>(null);
  const [practitionerCanOnboard, setPractitionerCanOnboard] = useState(false);
  const [isResolvingCaller, setIsResolvingCaller] = useState(true);
  const { institutionType, isLoading: isInstitutionTypeLoading } = useInstitutionType(institutionId);
  const [childName, setChildName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tagOptions, setTagOptions] = useState<TagOption[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [isLoadingTags, setIsLoadingTags] = useState(false);

  const [contact, setContact] = useState<ContactFields>(EMPTY_CONTACT);
  const [clinical, setClinical] = useState<ClinicalFields>(EMPTY_CLINICAL);

  // Resolves which of the caller's own institution_staff rows is the
  // one that actually applies here -- a school-engaged clinician (a
  // real, long-standing pattern) must never see a clinic-shaped form,
  // and a clinician at a clinic where the toggle is off must be told
  // plainly, not shown a form that would fail at submit.
  useEffect(() => {
    if (!isReady || !user) return;
    let isMounted = true;
    const supabase = createClient();

    supabase
      .from("institution_staff")
      .select("institution_id, role, institutions(name, type, practitioner_can_onboard)")
      .eq("user_id", user.id)
      .in("role", ["principal", "clinic_admin", "clinician"])
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .then(({ data }) => {
        if (!isMounted) return;
        const rows = (data ?? []) as Array<{
          institution_id: string;
          role: CallerRole;
          institutions:
            | { name: string; type: string; practitioner_can_onboard: boolean }
            | { name: string; type: string; practitioner_can_onboard: boolean }[]
            | null;
        }>;

        function resolveInstitution(row: (typeof rows)[number]) {
          const inst = row.institutions;
          return Array.isArray(inst) ? inst[0] : inst;
        }

        // Prefer a row that's actually eligible to onboard at a clinic
        // (director/admin always, a practitioner only when the toggle
        // is on) -- falling back to a plain principal row, which
        // preserves the original school-only behaviour exactly.
        const eligibleClinicRow = rows.find((row) => {
          const inst = resolveInstitution(row);
          if (inst?.type !== "clinic") return false;
          if (row.role === "principal" || row.role === "clinic_admin") return true;
          return row.role === "clinician" && inst.practitioner_can_onboard;
        });
        const fallbackPrincipalRow = rows.find((row) => row.role === "principal");
        const chosen = eligibleClinicRow ?? fallbackPrincipalRow ?? null;

        if (chosen) {
          const inst = resolveInstitution(chosen);
          setInstitutionId(chosen.institution_id);
          setInstitutionName(inst?.name ?? null);
          setCallerRole(chosen.role);
          setPractitionerCanOnboard(Boolean(inst?.practitioner_can_onboard));
        }
        setIsResolvingCaller(false);
      });

    return () => {
      isMounted = false;
    };
  }, [isReady, user]);

  const isClinic = institutionType === "clinic";
  const canTag = isClinic && (callerRole === "principal" || callerRole === "clinic_admin");
  const canOnboard =
    !isResolvingCaller &&
    !isInstitutionTypeLoading &&
    institutionId !== null &&
    (isClinic
      ? callerRole === "principal" || callerRole === "clinic_admin" || (callerRole === "clinician" && practitionerCanOnboard)
      : callerRole === "principal");
  // Matches set_client_contact_info()'s own check exactly -- anyone who
  // can onboard can enter contact details, admin included.
  const canShowContact = isClinic && canOnboard;
  // Matches set_client_clinical_intake()'s own check -- narrower than
  // contact: never an admin, regardless of anything else.
  const canShowClinical = isClinic && canOnboard && callerRole !== "clinic_admin";

  useEffect(() => {
    if (!canTag || !institutionId) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoadingTags(true);
    const supabase = createClient();
    supabase
      .from("institution_tags")
      .select("id, dimension, value")
      .eq("institution_id", institutionId)
      .eq("is_active", true)
      .order("dimension")
      .order("value")
      .then(({ data }) => {
        if (isMounted) {
          setTagOptions((data ?? []) as TagOption[]);
          setIsLoadingTags(false);
        }
      });
    return () => {
      isMounted = false;
    };
  }, [canTag, institutionId]);

  const tagsByDimension = useMemo(() => {
    const map = new Map<string, TagOption[]>();
    for (const tag of tagOptions) {
      if (!map.has(tag.dimension)) map.set(tag.dimension, []);
      map.get(tag.dimension)!.push(tag);
    }
    return Array.from(map.entries());
  }, [tagOptions]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  async function handleEnrol() {
    if (!user || !childName.trim() || !institutionId) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { data: passportId, error: enrolError } = isClinic
      ? await supabase.rpc("onboard_clinic_client", {
          p_institution_id: institutionId,
          p_client_name: childName.trim(),
        })
      : await supabase.rpc("create_school_passport", {
          p_institution_id: institutionId,
          p_child_name: childName.trim(),
        });

    if (enrolError) {
      setIsSubmitting(false);
      setError(enrolError.message);
      return;
    }

    // The one-shot tagging window (0214): set_episode_tags() is only
    // called when the director/admin actually picked at least one tag.
    // A zero-selection submit skips this entirely -- per the decided
    // behaviour, the window stays open for a later visit, since
    // nothing was actually tagged yet.
    if (canTag && selectedTagIds.size > 0) {
      const { data: episodeRow } = await supabase
        .from("episodes_of_care")
        .select("id")
        .eq("passport_id", passportId)
        .eq("institution_id", institutionId)
        .is("ended_at", null)
        .maybeSingle();

      if (episodeRow) {
        const tags = Array.from(selectedTagIds)
          .map((id) => tagOptions.find((t) => t.id === id))
          .filter((t): t is TagOption => Boolean(t))
          .map((t) => ({ dimension: t.dimension, value: t.value }));
        await supabase.rpc("set_episode_tags", { p_episode_id: episodeRow.id, p_tags: tags });
      }
    }

    // Client Info (clinic-only), Daniel's decision 1: entered as part
    // of this same flow, but the passport already exists by the time
    // either of these runs -- a failure here means "fill it in later",
    // never a broken client, and never a reason to offer redoing
    // onboarding (which would create a duplicate child). Each call is
    // independent; a blank section is simply skipped (nothing was
    // typed, nothing to save), matching the tag step's own "zero
    // selection, nothing to call" convention above. On a genuine
    // failure, the section is flagged via a query param rather than
    // blocking the redirect -- the client record itself is where it
    // gets retried, per Daniel's own instruction.
    let missingSection: "contact" | "clinical" | null = null;

    const hasContactInput = Object.values(contact).some((v) => v.trim() !== "");
    if (canShowContact && hasContactInput) {
      const { error: contactError } = await supabase.rpc("set_client_contact_info", {
        p_passport_id: passportId,
        p_institution_id: institutionId,
        p_guardian_full_name: contact.guardianFullName,
        p_relationship_to_child: contact.relationshipToChild,
        p_contact_email: contact.contactEmail,
        p_contact_phone: contact.contactPhone,
        p_referral_source: contact.referralSource,
        p_home_address: contact.homeAddress,
      });
      if (contactError) missingSection = "contact";
    }

    const hasClinicalInput =
      clinical.suspectedDiagnosis.trim() !== "" ||
      clinical.mainConcerns.trim() !== "" ||
      clinical.previousSupport !== null ||
      clinical.previousSupportDescription.trim() !== "" ||
      clinical.clinicGoals.trim() !== "" ||
      clinical.additionalNotes.trim() !== "";
    if (canShowClinical && hasClinicalInput) {
      const { error: clinicalError } = await supabase.rpc("set_client_clinical_intake", {
        p_passport_id: passportId,
        p_institution_id: institutionId,
        p_suspected_diagnosis: clinical.suspectedDiagnosis,
        p_main_concerns: clinical.mainConcerns,
        p_previous_support: clinical.previousSupport,
        p_previous_support_description: clinical.previousSupportDescription,
        p_clinic_goals: clinical.clinicGoals,
        p_additional_notes: clinical.additionalNotes,
      });
      // Contact's own failure (if any) takes priority -- only ever one
      // section flagged at a time, and contact is entered first.
      if (clinicalError && !missingSection) missingSection = "clinical";
    }

    setIsSubmitting(false);

    const missingParam = missingSection ? `?missingSection=${missingSection}` : "";

    // Found proving this flow live: /principal/passports/[passportId]
    // is principal-only, correctly -- decision #3's own boundary ("an
    // admin sees no clinical content") means an admin must never reach
    // it, and that page's own gate already refuses them. The admin's
    // own client record (/clinic-admin/client/[passportId]) is where
    // Contact Info -- the only section an admin can ever see -- and the
    // claim-code section both live.
    if (callerRole === "clinic_admin") {
      router.push(`/clinic-admin/client/${passportId}${missingParam}`);
      return;
    }
    // A practitioner's own client record is ClinicalFileDetail
    // (/clinician/passport/[passportId], gated useRequireRole
    // "clinician") -- a genuinely separate, role-exclusive surface from
    // the director's ChildDetail (useRequireRole "principal"). Sending
    // a clinician to the director's own route was a real, pre-existing
    // bug this flow's own onboarding gate already outgrew (a
    // toggle-enabled practitioner could onboard here since PRD 10 Stage
    // 2, but every redirect afterward sent them somewhere their own
    // role gate refuses) -- fixed here since "editable afterward from
    // the client's record" (decision 1) is unsatisfiable for this role
    // otherwise.
    if (callerRole === "clinician") {
      router.push(`/clinician/passport/${passportId}${missingParam}`);
      return;
    }
    router.push(`/principal/passports/${passportId}${missingParam}`);
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        {mode === "choose" ? (
          <Link
            href="/principal/directory?segment=children"
            aria-label="Back"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
          >
            ‹
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setMode("choose")}
            aria-label="Back"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
          >
            ‹
          </button>
        )}
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">
          {mode === "link" ? "Link an Existing Record" : isClinic ? "Add a Client" : "Enrol a Child"}
        </h1>
      </header>

      <main className="flex-1 px-4">
        {mode === "choose" ? (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-brand-neutral-black/70">
              {isClinic
                ? "Add a client who has never been on this system before, or connect a record they already have elsewhere."
                : "Enrol a child who has never been on this system before, or connect a record they already have elsewhere."}
            </p>
            <button
              type="button"
              onClick={() => setMode("new")}
              className="rounded-2xl border-2 border-brand-prussian-blue bg-white px-5 py-4 text-left"
            >
              <p className="font-heading text-base font-bold text-brand-prussian-blue">
                {isClinic ? "Add a New Client" : "Enrol a New Child"}
              </p>
              <p className="mt-1 text-sm text-brand-neutral-black/60">
                {isClinic
                  ? "Nothing exists for them here yet."
                  : "Nothing exists for them here yet."}
              </p>
            </button>
            {/* School-only for now -- see the migration's own header
                (0294) on why the reverse direction (a school-created
                record linking to a clinic) isn't offered here at all
                rather than shown and refused. */}
            {!isClinic && (
              <button
                type="button"
                onClick={() => setMode("link")}
                className="rounded-2xl border-2 border-brand-prussian-blue bg-white px-5 py-4 text-left"
              >
                <p className="font-heading text-base font-bold text-brand-prussian-blue">Link an Existing Record</p>
                <p className="mt-1 text-sm text-brand-neutral-black/60">
                  They already have a record from a clinic or another organisation, and a family member has given you
                  a code.
                </p>
              </button>
            )}
          </div>
        ) : mode === "link" ? (
          institutionId ? (
            <LinkExistingPassportForm
              institutionId={institutionId}
              institutionName={institutionName}
              onBack={() => setMode("choose")}
            />
          ) : null
        ) : !isResolvingCaller && !isInstitutionTypeLoading && !canOnboard ? (
          <p className="text-sm text-brand-neutral-black/60">
            You don&apos;t have permission to add a client here.
          </p>
        ) : (
          <>
            <p className="text-sm text-brand-neutral-black/70">
              {isClinic
                ? "Creates a new record for this client, started by your clinic. Their parent or guardian claims it later using a code you generate from their own record page — this doesn't require them to do anything yet."
                : "Creates a new passport for this child, started by your school. Their parent or guardian claims it later using a code you generate from their own passport page — this doesn't require them to do anything yet."}
            </p>

            <label className="mt-6 block text-sm font-semibold text-brand-neutral-black" htmlFor="enrol-child-name">
              {isClinic ? "Client's name" : "Child's name"}
            </label>
            <input
              id="enrol-child-name"
              type="text"
              value={childName}
              onChange={(e) => setChildName(e.target.value)}
              placeholder="e.g. Sam Murphy"
              className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
            />

            {canShowContact && (
              <div className="mt-6">
                <p className="mb-1 font-sans text-sm font-semibold text-brand-neutral-black">Contact Info (optional)</p>
                <p className="mb-3 text-xs text-brand-neutral-black/50">
                  Rather than asking the family to enter this again, enter what your pre-consultation form already
                  collected -- the parent confirms it&apos;s right when they claim. Leave anything blank to fill in later.
                </p>
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={contact.guardianFullName}
                    onChange={(e) => setContact((c) => ({ ...c, guardianFullName: e.target.value }))}
                    placeholder="Parent or guardian's full name"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={contact.relationshipToChild}
                    onChange={(e) => setContact((c) => ({ ...c, relationshipToChild: e.target.value }))}
                    placeholder="Relationship to the child"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="email"
                    value={contact.contactEmail}
                    onChange={(e) => setContact((c) => ({ ...c, contactEmail: e.target.value }))}
                    placeholder="Contact email"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="tel"
                    value={contact.contactPhone}
                    onChange={(e) => setContact((c) => ({ ...c, contactPhone: e.target.value }))}
                    placeholder="Phone"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={contact.referralSource}
                    onChange={(e) => setContact((c) => ({ ...c, referralSource: e.target.value }))}
                    placeholder="How they heard about the clinic"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={contact.homeAddress}
                    onChange={(e) => setContact((c) => ({ ...c, homeAddress: e.target.value }))}
                    placeholder="Home address"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                </div>
              </div>
            )}

            {canShowClinical && (
              <div className="mt-6">
                <p className="mb-1 font-sans text-sm font-semibold text-brand-neutral-black">Clinical Intake (optional)</p>
                <p className="mb-3 text-xs text-brand-neutral-black/50">
                  Never visible to a school, and never becomes a formal diagnosis on the passport. Leave anything
                  blank to fill in later.
                </p>
                <div className="flex flex-col gap-3">
                  <input
                    type="text"
                    value={clinical.suspectedDiagnosis}
                    onChange={(e) => setClinical((c) => ({ ...c, suspectedDiagnosis: e.target.value }))}
                    placeholder="Suspected diagnosis"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={clinical.mainConcerns}
                    onChange={(e) => setClinical((c) => ({ ...c, mainConcerns: e.target.value }))}
                    placeholder="Main concerns or behaviours"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <div>
                    <p className="mb-1.5 text-sm text-brand-neutral-black/70">Previous support or services?</p>
                    <div className="flex gap-2">
                      {[
                        { label: "Yes", value: true },
                        { label: "No", value: false },
                      ].map((option) => {
                        const isSelected = clinical.previousSupport === option.value;
                        return (
                          <button
                            key={option.label}
                            type="button"
                            onClick={() => setClinical((c) => ({ ...c, previousSupport: option.value }))}
                            aria-pressed={isSelected}
                            className={`min-h-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                              isSelected
                                ? "border-brand-prussian-blue bg-brand-pastel-blue/40 text-brand-prussian-blue"
                                : "border-black/10 bg-white text-brand-neutral-black/60"
                            }`}
                          >
                            {option.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <input
                    type="text"
                    value={clinical.previousSupportDescription}
                    onChange={(e) => setClinical((c) => ({ ...c, previousSupportDescription: e.target.value }))}
                    placeholder="Description of previous support"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={clinical.clinicGoals}
                    onChange={(e) => setClinical((c) => ({ ...c, clinicGoals: e.target.value }))}
                    placeholder="What they want from working with the clinic"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                  <input
                    type="text"
                    value={clinical.additionalNotes}
                    onChange={(e) => setClinical((c) => ({ ...c, additionalNotes: e.target.value }))}
                    placeholder="Anything else they want the clinic to know"
                    className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                  />
                </div>
              </div>
            )}

            {canTag && (
              <div className="mt-6">
                <p className="mb-1 font-sans text-sm font-semibold text-brand-neutral-black">Tags (optional)</p>
                <p className="mb-3 text-xs text-brand-neutral-black/50">
                  You can only set these once, right now — any later change goes through a request. Leave everything
                  unselected to decide later; nothing here is required.
                </p>
                {isLoadingTags ? (
                  <div className="h-[60px] animate-pulse rounded-xl bg-white" />
                ) : tagsByDimension.length === 0 ? (
                  <p className="text-xs text-brand-neutral-black/50">
                    No tags configured yet for your clinic — nothing to select.
                  </p>
                ) : (
                  <div className="flex flex-col gap-3">
                    {tagsByDimension.map(([dimension, options]) => (
                      <div key={dimension}>
                        <p className="mb-1.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                          {dimension}
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {options.map((tag) => {
                            const isSelected = selectedTagIds.has(tag.id);
                            return (
                              <button
                                key={tag.id}
                                type="button"
                                onClick={() => toggleTag(tag.id)}
                                aria-pressed={isSelected}
                                className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                                  isSelected
                                    ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                                    : "border-black/10 bg-white text-brand-neutral-black"
                                }`}
                              >
                                {tag.value}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
                {error}
              </p>
            )}

            <Button
              type="button"
              onClick={handleEnrol}
              disabled={!childName.trim() || isSubmitting || !institutionId}
              className="mt-6 lg:w-auto"
            >
              {isSubmitting ? (isClinic ? "Adding…" : "Enrolling…") : isClinic ? "Add Client" : "Enrol Child"}
            </Button>
            <Link
              href="/principal/directory?segment=children"
              className="mt-2 block w-full lg:inline-block lg:w-auto rounded-2xl border border-black/10 px-6 py-3 text-center text-sm font-semibold text-black/60"
            >
              Cancel
            </Link>
          </>
        )}
      </main>
    </div>
  );
}
