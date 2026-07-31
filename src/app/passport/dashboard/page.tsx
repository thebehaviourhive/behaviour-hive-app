"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
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

function calculateAge(dateOfBirth: string | null): number | null {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  const today = new Date();
  let age = today.getFullYear() - dob.getFullYear();
  const monthDiff = today.getMonth() - dob.getMonth();
  if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < dob.getDate())) {
    age--;
  }
  return age;
}

function joinList(items: string[] | null | undefined, max = 3): string {
  if (!items || items.length === 0) return "Not specified";
  const shown = items.slice(0, max).join(", ");
  return items.length > max ? `${shown} +${items.length - max} more` : shown;
}

function truncateText(text: string | null | undefined, max = 90): string {
  if (!text) return "Not specified";
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export default function PassportDashboardPage() {
  const router = useRouter();
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [summary, setSummary] = useState<PassportSummaryData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const [{ data: passport }, { data: sectionB }, { data: sectionC }, { data: sectionD }] =
        await Promise.all([
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

      if (passport?.passport_status !== "complete") {
        router.replace(resumeHref);
        return;
      }

      setSummary({
        childName: passport.child_name ?? "Your child",
        age: calculateAge(passport.date_of_birth),
        school: passport.school,
        importantPeople: passport.important_people,
        diagnoses: passport.diagnoses,
        diagnosisOther: passport.diagnosis_other,
        okaySignals: sectionB?.okay_signals ?? null,
        hardSignals: sectionB?.hard_signals ?? null,
        hardTriggers: sectionB?.hard_triggers ?? null,
        communicationMethods: sectionC?.communication_methods ?? null,
        showsHappy: sectionC?.shows_happy ?? null,
        showsAnxious: sectionC?.shows_anxious ?? null,
        phrasesToAvoid: sectionC?.phrases_to_avoid ?? null,
        beforeBehaviour: sectionD?.before_behaviour ?? null,
        duringDistress: sectionD?.during_distress ?? null,
        afterDistress: sectionD?.after_distress ?? null,
        sensorySeeks: sectionD?.sensory_seeks ?? null,
        sensoryAvoids: sectionD?.sensory_avoids ?? null,
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, router]);

  if (!isRoleReady || isLoading || !summary) {
    return null;
  }

  const diagnosisText =
    summary.diagnoses && summary.diagnoses.length > 0
      ? summary.diagnoses.includes("Other") && summary.diagnosisOther
        ? joinList(summary.diagnoses.filter((d) => d !== "Other")) +
          (summary.diagnoses.length > 1 ? ", " : "") +
          summary.diagnosisOther
        : joinList(summary.diagnoses)
      : "Not specified";

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
        <SummaryCard title="About Your Child" editHref="/passport/section-a">
          <SummaryLine label="Age" value={summary.age !== null ? `${summary.age}` : "Not specified"} />
          <SummaryLine label="School" value={summary.school || "Not specified"} />
          <SummaryLine label="Diagnosis" value={diagnosisText} />
          <SummaryLine
            label="Important people"
            value={summary.importantPeople || "Not specified"}
          />
        </SummaryCard>

        <SummaryCard title="Understanding My Child" editHref="/passport/section-b/1">
          <SummaryLine label="Shows they're okay" value={joinList(summary.okaySignals)} />
          <SummaryLine label="Finds it hard when" value={joinList(summary.hardSignals)} />
          <SummaryLine label="Common triggers" value={joinList(summary.hardTriggers)} />
        </SummaryCard>

        <SummaryCard title="How my Child Communicates" editHref="/passport/section-c">
          <SummaryLine
            label="Communication methods"
            value={joinList(summary.communicationMethods)}
          />
          <SummaryLine label="Shows happy" value={truncateText(summary.showsHappy)} />
          <SummaryLine label="Shows anxious" value={truncateText(summary.showsAnxious)} />
          <SummaryLine label="Avoid" value={truncateText(summary.phrasesToAvoid)} />
        </SummaryCard>

        <SummaryCard title="How I Support my Child" editHref="/passport/section-d/1">
          <SummaryLine label="Helps before" value={joinList(summary.beforeBehaviour)} />
          <SummaryLine label="Helps during" value={joinList(summary.duringDistress)} />
          <SummaryLine label="Helps after" value={joinList(summary.afterDistress)} />
          <SummaryLine label="Sensory seeks" value={joinList(summary.sensorySeeks)} />
          <SummaryLine label="Sensory avoids" value={joinList(summary.sensoryAvoids)} />
        </SummaryCard>
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
