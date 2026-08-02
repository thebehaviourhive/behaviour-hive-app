"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { ShareBottomSheet } from "@/components/parent/ShareBottomSheet";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";

interface ApprovedInstitution {
  institutionId: string;
  institutionName: string;
  approvedAt: string | null;
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
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [summary, setSummary] = useState<PassportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [approvedInstitutions, setApprovedInstitutions] = useState<ApprovedInstitution[]>([]);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [revokeConfirmation, setRevokeConfirmation] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState<string | null>(null);

  async function loadApprovedInstitutions(passportId: string) {
    const supabase = createClient();
    const { data: linkRows } = await supabase
      .from("passport_institution_links")
      .select("institution_id, parent_approved_at, institutions(name)")
      .eq("passport_id", passportId)
      .eq("approved_by_parent", true)
      .order("parent_approved_at", { ascending: false });

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

  async function handleRevoke(institutionId: string, institutionName: string) {
    if (!summary) return;

    setRevokeError(null);
    setRevokeConfirmation(null);

    const supabase = createClient();
    const [{ error: linkError }, { error: accessError }] = await Promise.all([
      supabase
        .from("passport_institution_links")
        .update({ approved_by_parent: false })
        .eq("passport_id", summary.passportId)
        .eq("institution_id", institutionId),
      supabase
        .from("passport_access")
        .update({ is_active: false })
        .eq("passport_id", summary.passportId)
        .eq("institution_id", institutionId),
    ]);

    if (linkError || accessError) {
      setRevokeError((linkError ?? accessError)?.message ?? "Something went wrong. Please try again.");
      return;
    }

    setRevokeConfirmation(
      `Access for ${institutionName} has been removed. They can no longer see ${summary.childName}'s passport.`
    );
    await loadApprovedInstitutions(summary.passportId);
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

        {subInfoLine && (
          <p className="mt-1 text-base text-brand-neutral-black">{subInfoLine}</p>
        )}

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

      <main className="flex flex-col gap-6 px-4">
        <ErrorBoundary fallback={fallbackCard}>
          <section className={CARD_CLASSNAME}>
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
                Understanding My Child
              </h2>
              <Link href="/passport/section-b/1" className="text-sm text-brand-prussian-blue/50">
                Edit
              </Link>
            </div>

            {sectionBEmpty ? (
              <EmptyStateBox
                prompt={`Help teachers recognise when ${summary.childName} is feeling regulated, and spot the early signs when they are finding things hard.`}
                ctaLabel="Add Signals and Triggers"
                ctaHref="/passport/section-b/1"
              />
            ) : (
              <div className="mt-5 flex flex-col gap-5">
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
          </section>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <section className={CARD_CLASSNAME}>
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
                How My Child Communicates
              </h2>
              <Link href="/passport/section-c" className="text-sm text-brand-prussian-blue/50">
                Edit
              </Link>
            </div>

            {sectionCEmpty ? (
              <EmptyStateBox
                prompt={`Every child has a voice. Share ${summary.childName}'s unique communication style so others know exactly how to connect with them.`}
                ctaLabel="Add Communication Profile"
                ctaHref="/passport/section-c"
              />
            ) : (
              <div className="mt-5 flex flex-col gap-5">
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
          </section>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <section className={CARD_CLASSNAME}>
            <div className="flex items-center justify-between">
              <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
                How I Support My Child
              </h2>
              <Link href="/passport/section-d/1" className="text-sm text-brand-prussian-blue/50">
                Edit
              </Link>
            </div>

            {sectionDEmpty ? (
              <EmptyStateBox
                prompt="What sensory tools and de-escalation strategies work best? Build a quick-reference toolkit for the classroom."
                ctaLabel="Add Support Strategies"
                ctaHref="/passport/section-d/1"
              />
            ) : (
              <div className="mt-5 flex flex-col gap-5">
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
          </section>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <section className="mt-2 mb-6">
            <h2 className="mb-4 font-accent text-sm uppercase tracking-widest text-brand-neutral-black/60">
              Manage Access
            </h2>

            {approvedInstitutions.length === 0 ? (
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
                      Revoke
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
      </main>

      <ShareBottomSheet
        isOpen={isShareOpen}
        onClose={() => setIsShareOpen(false)}
        passportId={summary.passportId}
        childName={summary.childName}
        passportCode={summary.passportCode}
        onCodeGenerated={(code) =>
          setSummary((prev) => (prev ? { ...prev, passportCode: code } : prev))
        }
        onApproved={() => loadApprovedInstitutions(summary.passportId)}
      />

      <BottomNav active="passport" passportHref="/passport/dashboard" />
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
