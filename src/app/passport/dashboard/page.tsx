"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { ErrorBoundary } from "@/components/ui/ErrorBoundary";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";

interface PassportSummaryData {
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

// Defensive against non-array/empty values — Supabase should always return
// either an array or null for these columns, but a missing field should
// never be able to crash the summary render.
function joinList(items: unknown, max = 3): string {
  if (!Array.isArray(items) || items.length === 0) return "Not specified";
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

function truncateText(text: unknown, max = 90): string {
  if (typeof text !== "string" || text.length === 0) return "Not specified";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatDiagnosisText(
  diagnoses: unknown,
  diagnosisOther: unknown
): string {
  if (!Array.isArray(diagnoses) || diagnoses.length === 0) {
    return "Not specified";
  }
  const hasOther = diagnoses.includes("Other") && typeof diagnosisOther === "string" && diagnosisOther;
  if (!hasOther) {
    return joinList(diagnoses);
  }
  const rest = diagnoses.filter((d) => d !== "Other");
  return rest.length > 0 ? `${joinList(rest)}, ${diagnosisOther}` : String(diagnosisOther);
}

export default function PassportDashboardPage() {
  const router = useRouter();
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [summary, setSummary] = useState<PassportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

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
              "child_name, date_of_birth, school, important_people, diagnoses, diagnosis_other, passport_status, section_a_complete"
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
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 text-center">
        <p className="text-sm text-black/60">{loadError}</p>
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

  const diagnosisText = formatDiagnosisText(summary.diagnoses, summary.diagnosisOther);

  const fallbackCard = (
    <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-sm text-black/60">
        This section couldn&apos;t be displayed. Your saved answers are safe —
        try reloading the page.
      </p>
    </section>
  );

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {summary.childName}&apos;s Passport
        </h1>
        <button
          type="button"
          className="flex-shrink-0 rounded-full border border-black/10 bg-white px-4 py-2 text-xs font-semibold text-brand-neutral-black"
        >
          Download / Share
        </button>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-4">
        <ErrorBoundary fallback={fallbackCard}>
          <SummaryCard title="About Your Child" editHref="/passport/section-a">
            <SummaryLine
              label="Age"
              value={summary.age !== null ? `${summary.age}` : "Not specified"}
            />
            <SummaryLine label="School" value={summary.school || "Not specified"} />
            <SummaryLine label="Diagnosis" value={diagnosisText} />
            <SummaryLine
              label="Important people"
              value={summary.importantPeople || "Not specified"}
            />
          </SummaryCard>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <SummaryCard title="Understanding My Child" editHref="/passport/section-b/1">
            <SummaryLine label="Shows they're okay" value={joinList(summary.okaySignals)} />
            <SummaryLine label="Finds it hard when" value={joinList(summary.hardSignals)} />
            <SummaryLine label="Common triggers" value={joinList(summary.hardTriggers)} />
          </SummaryCard>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <SummaryCard title="How my Child Communicates" editHref="/passport/section-c">
            <SummaryLine
              label="Communication methods"
              value={joinList(summary.communicationMethods)}
            />
            <SummaryLine label="Shows happy" value={truncateText(summary.showsHappy)} />
            <SummaryLine label="Shows anxious" value={truncateText(summary.showsAnxious)} />
            <SummaryLine label="Avoid" value={truncateText(summary.phrasesToAvoid)} />
          </SummaryCard>
        </ErrorBoundary>

        <ErrorBoundary fallback={fallbackCard}>
          <SummaryCard title="How I Support my Child" editHref="/passport/section-d/1">
            <SummaryLine label="Helps before" value={joinList(summary.beforeBehaviour)} />
            <SummaryLine label="Helps during" value={joinList(summary.duringDistress)} />
            <SummaryLine label="Helps after" value={joinList(summary.afterDistress)} />
            <SummaryLine label="Sensory seeks" value={joinList(summary.sensorySeeks)} />
            <SummaryLine label="Sensory avoids" value={joinList(summary.sensoryAvoids)} />
          </SummaryCard>
        </ErrorBoundary>
      </main>

      <BottomNav active="passport" passportHref="/passport/dashboard" />
    </div>
  );
}

function SummaryCard({
  title,
  editHref,
  children,
}: {
  title: string;
  editHref: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-heading text-base font-semibold text-brand-neutral-black">
          {title}
        </h2>
        <Link
          href={editHref}
          className="rounded-full border border-brand-prussian-blue px-3 py-1 text-xs font-semibold text-brand-prussian-blue"
        >
          Edit
        </Link>
      </div>
      <div className="flex flex-col gap-1.5">{children}</div>
    </section>
  );
}

function SummaryLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-xs text-black/70">
      <span className="font-semibold text-black/50">{label}: </span>
      {value}
    </p>
  );
}
