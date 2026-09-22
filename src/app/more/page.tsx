"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/ui/BottomNav";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { ClinicianSidebar } from "@/components/clinician/ClinicianSidebar";
import { SnaBottomNav } from "@/components/sna/SnaBottomNav";
import { TrendUpIcon } from "@/components/ui/icons";
import { getChildFirstName } from "@/lib/childDisplayName";
import { useRegions } from "@/hooks/useRegions";
import { RegionMultiSelect } from "@/components/ui/RegionMultiSelect";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";
import { CLINICAL_DOMAIN_LABEL, type ClinicalDomain } from "@/lib/clinicalDomains";
import { PassportIdBadge } from "@/components/clinic/PassportIdBadge";

const CADENCE_OPTIONS = [14, 30, 60, 90] as const;

export default function MorePage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [clinicianCode, setClinicianCode] = useState<string | null>(null);
  const [verificationRoute, setVerificationRoute] = useState<"behaviour_hive" | "organisation" | null>(null);
  const [reviewCadenceDays, setReviewCadenceDays] = useState<number | null>(null);
  const [isSavingCadence, setIsSavingCadence] = useState(false);
  const [cadenceError, setCadenceError] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [passportIds, setPassportIds] = useState<{ childName: string; passportReference: string }[]>([]);
  const [operatingCounties, setOperatingCounties] = useState<string[]>([]);
  const [isSavingCounties, setIsSavingCounties] = useState(false);
  const [countiesError, setCountiesError] = useState<string | null>(null);
  const [specialty, setSpecialty] = useState<ClinicianSpecialty | null>(null);
  const [domainTags, setDomainTags] = useState<ClinicalDomain[]>([]);
  // Finding 2, 22 Sept 2026 -- this page's role branching only ever
  // checked the literal app_metadata value, and a director/lead's own
  // role is "principal"/"clinical_lead", never "clinician" -- so a
  // director doing real clinical work (PRD 10 section 4a: every
  // clinical role is a practitioner) fell straight through every
  // branch below to the bare final `else`, the PARENT's own fallback,
  // Calm button included. Resolved the same way useRequireRole()
  // already resolves this exact ambiguity for every other clinician-
  // track page -- is_verified_clinic_director_or_lead() -- so this
  // page's own branch agrees with what every other clinician page
  // already decided about this same account.
  const [isVerifiedClinicalPractitioner, setIsVerifiedClinicalPractitioner] = useState(false);
  const { regions } = useRegions();

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const userRole = (user.app_metadata?.role as string | undefined) ?? null;
      setRole(userRole);
      setUserId(user.id);

      let isClinicalPractitioner = userRole === "clinician";

      if (userRole === "principal" || userRole === "clinical_lead") {
        const { data: isVerifiedLeadership } = await supabase.rpc("is_verified_clinic_director_or_lead");
        if (!isMounted) return;
        isClinicalPractitioner = Boolean(isVerifiedLeadership);
        setIsVerifiedClinicalPractitioner(isClinicalPractitioner);

        // Not a practising director/lead -- a school principal (this
        // check is always false for them, institution type isn't
        // clinic), or a clinic director/lead who hasn't picked a
        // specialty yet. Neither has a "More" destination of their
        // own -- their real nav (PrincipalSidebar/PrincipalBottomNav,
        // institution-type-aware) has no More tab at all -- so the
        // correct answer isn't a fabricated director-shaped More page
        // here, it's their own dashboard, per Daniel's own "on their
        // own screens, something appropriate to a director" -- their
        // own screens ARE the appropriate place, not this one.
        if (!isClinicalPractitioner) {
          router.replace(userRole === "clinical_lead" ? "/clinical-lead/dashboard" : "/principal/dashboard");
          return;
        }
      } else if (userRole === "clinic_admin") {
        // Same fallthrough, a role this page's own branch chain never
        // named at all -- admin is never a clinical role (their own
        // consent screen says so directly: "You will not see clinical
        // notes or assessments"), so there is no clinician-page content
        // to admit them to either. Same fix, same reasoning: their own
        // dashboard, not this page's parent-shaped fallback.
        router.replace("/clinic-admin/dashboard");
        return;
      }

      if (isClinicalPractitioner) {
        const { data: clinician } = await supabase
          .from("clinicians")
          .select("clinician_code, review_cadence_days, operating_counties, verification_route, specialty, domain_tags")
          .eq("user_id", user.id)
          .maybeSingle();

        if (isMounted && clinician) {
          setClinicianCode(clinician.clinician_code);
          setReviewCadenceDays(clinician.review_cadence_days);
          setOperatingCounties(clinician.operating_counties ?? []);
          setVerificationRoute(clinician.verification_route);
          setSpecialty(clinician.specialty);
          setDomainTags(clinician.domain_tags ?? []);
        }
      } else if (userRole === "parent") {
        // Parent (the only track this More page adds a Progress entry
        // for) -- needed just for the tile label, matching the quick-
        // actions grid's own "[Child]'s Progress" wording. Resolved via
        // get_my_passports() (Stage 5 Step 3) so a claimed guardian's
        // own child name shows here too, not just a self-created one.
        //
        // FIX: this used to be a negative catch-all
        // (`!userRole || (userRole !== "class_teacher" && userRole !==
        // "clinician")`) rather than an explicit "role === parent"
        // check -- harmless while parent was genuinely the only other
        // track, but it silently misclassified SNA (and would
        // misclassify any future role) as parent-like, running a
        // pointless passport lookup that can never match an SNA's own
        // row.
        const { data: myPassports } = await supabase.rpc("get_my_passports");
        const rows = (myPassports ?? []) as { passport_id: string; child_name: string; passport_reference: string }[];

        if (isMounted) {
          setChildName(rows[0]?.child_name ?? null);
          // Passport ID -- Share sheet fix, 23 Sept 2026 -- moved here
          // from the (now-deleted) Share sheet, plainly labelled, never
          // under "Share": a reference for identifying a child when a
          // parent contacts the clinic, not an access credential. Every
          // connected child shown, not just the first -- unlike the
          // Progress tile above, a parent with more than one child in
          // the system needs the right ID for the right child, and
          // showing only one would be actively wrong, not just limited.
          setPassportIds(
            rows.map((r) => ({ childName: r.child_name, passportReference: r.passport_reference }))
          );
        }
      }

      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleCadenceChange(days: number) {
    if (!userId) return;
    setIsSavingCadence(true);
    setCadenceError(null);
    const supabase = createClient();
    const { error } = await supabase
      .from("clinicians")
      .update({ review_cadence_days: days })
      .eq("user_id", userId);

    setIsSavingCadence(false);
    if (error) {
      // The control was never optimistically updated, so it's already
      // showing the pre-save value — this just makes the failure visible
      // instead of a silent no-op the clinician has no way to notice.
      setCadenceError("Couldn't save your review cadence. Please try again.");
      return;
    }

    setReviewCadenceDays(days);
  }

  // Direct table update, same as handleCadenceChange above -- never
  // touches verification_status (constraint: "do not disturb
  // verification status"). Toggling a county writes the WHOLE next
  // array optimistically, then rolls back on error, same pattern as
  // the cadence control's own error handling.
  async function handleToggleCounty(regionId: string) {
    if (!userId) return;
    const previous = operatingCounties;
    const next = previous.includes(regionId)
      ? previous.filter((id) => id !== regionId)
      : [...previous, regionId];
    setOperatingCounties(next);
    setIsSavingCounties(true);
    setCountiesError(null);
    const supabase = createClient();
    const { error } = await supabase.from("clinicians").update({ operating_counties: next }).eq("user_id", userId);
    setIsSavingCounties(false);
    if (error) {
      setOperatingCounties(previous);
      setCountiesError("Couldn't save your operating area. Please try again.");
    }
  }

  async function handleLogout() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.localStorage.clear();
    window.sessionStorage.clear();
    router.replace("/login");
  }

  if (!isReady) {
    return null;
  }

  // Stage 3 desktop pass, 15 Sept 2026: /more is a shared top-level
  // route (every track uses it), so it's never nested under /clinician/
  // layout.tsx the way every other clinician page is -- confirmed the
  // only such case (grepped every href/router.push in the clinician
  // track; everything else stays within /clinician/*). Replicating
  // that layout's own sidebar + lg:pl-64 shift here, conditionally for
  // the one role that has a persistent sidebar elsewhere, rather than
  // moving this page under /clinician/more -- that would duplicate the
  // settings UI below across two routes instead of duplicating a few
  // lines of shell markup here.
  return (
    <div className="flex min-h-full flex-1">
      {(role === "clinician" || isVerifiedClinicalPractitioner) && <ClinicianSidebar />}
      <div
        className={`flex min-h-full min-w-0 flex-1 flex-col bg-brand-off-white/40 pb-24 ${
          role === "clinician" || isVerifiedClinicalPractitioner ? "lg:pl-64" : ""
        }`}
      >
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">
          More
        </h1>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-3">
        {(role === "clinician" || isVerifiedClinicalPractitioner) && (
          <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              My Clinician Code
            </p>
            {clinicianCode ? (
              <p className="font-heading text-2xl font-bold tracking-widest text-brand-prussian-blue">
                {clinicianCode}
              </p>
            ) : verificationRoute === "organisation" && role === "principal" ? (
              // Found reusing this section for a director doing
              // clinical work (item 2/3b, 22 Sept 2026): the practitioner
              // copy below ("your director assigns your caseload")
              // is wrong for the account that IS the director -- there
              // is no one above them to do the assigning. They assign
              // themselves, from their own clinic's roster.
              <p className="text-sm text-brand-neutral-black/60">
                You don&apos;t need a code — assign yourself a caseload from your clinic&apos;s roster, the same way
                you assign anyone else.
              </p>
            ) : verificationRoute === "organisation" ? (
              // A director-approved clinic practitioner never gets a
              // code -- their director assigns their caseload directly
              // from the clinic's own roster (bulk_grant_clinician_
              // access()'s p_roster_user_id path, PRD 5 Stage 6), so
              // "will appear once verified" would be a promise this
              // account can never keep -- confirmed a real, live-since-
              // Stage-6 source of confusion, not a hypothetical.
              <p className="text-sm text-brand-neutral-black/60">
                You don&apos;t need a code — your director assigns your caseload directly.
              </p>
            ) : (
              <p className="text-sm text-brand-neutral-black/60">
                Your code will appear here once your credentials are verified.
              </p>
            )}

            <div className="my-4 h-px bg-black/10" />

            <p className="mb-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Case Review Cadence
            </p>
            <div className="flex gap-2">
              {CADENCE_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => handleCadenceChange(days)}
                  disabled={isSavingCadence}
                  className={`flex-1 rounded-xl border py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    reviewCadenceDays === days
                      ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                      : "border-black/10 bg-white text-brand-neutral-black"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
            {cadenceError && (
              <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                {cadenceError}
              </p>
            )}

            {/* Tier 1 item 6. "Operating Area" describes where an
                INDEPENDENT clinician offers services -- meaningless
                for a director-approved clinic practitioner, who works
                from their clinic's own fixed institution, not
                wherever they personally operate. Gated the same way
                the clinician_code block above already is. */}
            {verificationRoute !== "organisation" && (
              <>
                <div className="my-4 h-px bg-black/10" />

                <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Operating Area
                </p>
                <p className="mb-2 text-xs text-brand-neutral-black/50">
                  Ireland · Select all counties you operate in.
                </p>
                <RegionMultiSelect regions={regions} selected={operatingCounties} onToggle={handleToggleCounty} />
                {isSavingCounties && <p className="mt-2 text-xs text-brand-neutral-black/40">Saving…</p>}
                {countiesError && (
                  <p role="alert" className="mt-2 text-sm font-medium text-red-600">
                    {countiesError}
                  </p>
                )}
              </>
            )}

            <div className="my-4 h-px bg-black/10" />

            <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Specialty & Clinical Domains
            </p>
            {domainTags.length === 0 ? (
              // A real, functional nudge, not cosmetic -- PRD 7 Stage 3's
              // domain-tag layer only means anything once a practitioner
              // has declared their own domains; until then it falls
              // through to reachability alone for them, silently.
              // Golden Brown is this app's own attention colour, used
              // deliberately here to read as an outstanding task, which
              // this genuinely is.
              <div className="rounded-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-3">
                <p className="text-sm font-semibold text-brand-neutral-black">
                  {specialty ? "You haven't declared your clinical domains yet." : "You haven't declared your specialty or clinical domains yet."}
                </p>
                <p className="mt-1 text-xs text-brand-neutral-black/60">
                  This helps colleagues on a shared case find what&apos;s theirs to read. Nobody needs to verify it.
                </p>
                <button
                  type="button"
                  onClick={() => router.push("/clinician/specialty")}
                  className="mt-3 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
                >
                  Declare now
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => router.push("/clinician/specialty")}
                className="flex w-full items-center justify-between rounded-xl border border-black/10 bg-white p-3 text-left"
              >
                <span>
                  <span className="block text-sm font-semibold text-brand-neutral-black">
                    {specialty ? CLINICIAN_SPECIALTY_LABEL[specialty] : "Not set"}
                  </span>
                  <span className="mt-1 block text-xs text-brand-neutral-black/60">
                    {domainTags.map((d) => CLINICAL_DOMAIN_LABEL[d]).join(", ")}
                  </span>
                </span>
                <span aria-hidden className="text-black/30">
                  ›
                </span>
              </button>
            )}
          </section>
        )}

        {/* FIX: was `role !== "clinician" && role !== "class_teacher"` --
            the same negative-catch-all bug as above, which would have
            rendered this parent-only "[Child]'s Progress" tile (linking
            to /passport/progress, a useRequireRole("parent")-gated page)
            for an SNA viewer too, sending them into a redirect bounce. */}
        {role === "parent" && (
          <section>
            <button
              type="button"
              onClick={() => router.push("/passport/progress")}
              className="flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/30 text-brand-prussian-blue"
              >
                <TrendUpIcon className="h-5 w-5" />
              </span>
              <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
                {getChildFirstName(childName)}&apos;s Progress
              </span>
              <span aria-hidden className="text-black/30">
                ›
              </span>
            </button>
          </section>
        )}

        {/* Passport ID -- Share sheet fix, 23 Sept 2026. Plain reference,
            never an access credential: a clinic can identify a child by
            this when a parent calls or writes in. Deliberately NOT under
            a "Share" heading and NOT presented as something to hand
            anyone -- that's what the (now-removed) passport code used to
            look like, and it's exactly the confusion Daniel named. */}
        {role === "parent" && passportIds.length > 0 && (
          <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Passport ID
            </p>
            <p className="mb-3 text-xs text-brand-neutral-black/50">
              An identifier for contacting your child&apos;s clinic -- not a code to share, and not needed
              anywhere else in the app.
            </p>
            <div className="flex flex-col gap-2">
              {passportIds.map((p) => (
                <div key={p.passportReference} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-semibold text-brand-neutral-black">{p.childName}</span>
                  <PassportIdBadge reference={p.passportReference} />
                </div>
              ))}
            </div>
          </section>
        )}

        <section>
          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-lg"
            >
              🚪
            </span>
            <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
              Log out
            </span>
            <span aria-hidden className="text-black/30">
              ›
            </span>
          </button>
        </section>

        <p className="mt-auto pt-6 text-center text-xs text-black/40">
          The Behaviour Hive — v1.0
        </p>
      </main>

      <BottomSheet isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Are you sure you want to log out?
        </h2>

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsConfirmOpen(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            className="flex-1 rounded-2xl bg-red-600 px-5 py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSigningOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </BottomSheet>

      {/* FIX: sna previously fell through to the generic parent
          <BottomNav /> (Home/Passport/More, none of which resolve
          correctly for an SNA) since this was an if/else chain with no
          sna branch at all. */}
      {role === "class_teacher" ? (
        <TeacherBottomNav />
      ) : role === "clinician" || isVerifiedClinicalPractitioner ? (
        <ClinicianBottomNav />
      ) : role === "sna" ? (
        <SnaBottomNav />
      ) : (
        <BottomNav />
      )}
      </div>
    </div>
  );
}
