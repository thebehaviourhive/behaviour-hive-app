"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useFbaReport } from "@/hooks/useFbaReport";
import { useAflsAssessmentsForFba } from "@/hooks/useAflsAssessmentsForFba";
import { FBA_SECTIONS, getSectionCompleteness } from "@/lib/fba/sections";
import { CompletenessDot } from "@/components/clinician/fba/CompletenessDot";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function FbaWorkspacePage() {
  const { fbaId } = useParams<{ fbaId: string }>();
  const { isReady } = useRequireRole("clinician");
  const { report, isLoading, loadError, reload } = useFbaReport(fbaId);
  const { assessments: aflsAssessments } = useAflsAssessmentsForFba(fbaId);

  const [childName, setChildName] = useState<string | null>(null);

  useEffect(() => {
    if (!report) return;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passports")
      .select("child_name")
      .eq("id", report.passportId)
      .maybeSingle()
      .then(({ data }) => {
        if (isMounted) setChildName(data?.child_name ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [report]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-2">
        <Link
          href="/clinician/fba"
          aria-label="Back to FBAs"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <div className="min-w-0 flex-1">
          <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
            Functional Behaviour Assessment
          </p>
          <h1 className="truncate font-heading text-xl font-bold text-brand-neutral-black">
            {childName ?? "…"}
          </h1>
        </div>
        {report && (
          <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
            {STATUS_LABEL[report.status]}
          </span>
        )}
      </header>

      <main className="flex flex-1 flex-col gap-2 px-4 pt-3">
        {isLoading ? (
          <>
            <SectionCardSkeleton />
            <SectionCardSkeleton />
            <SectionCardSkeleton />
          </>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : !report ? (
          <InlineErrorState message="This FBA couldn't be found." onRetry={reload} />
        ) : (
          <>
            {report.status === "completed" && (
              <p className="mb-1 rounded-2xl border border-brand-pastel-blue/40 bg-brand-pastel-blue/10 p-3 text-sm text-brand-neutral-black/70">
                This FBA is completed and read-only.
              </p>
            )}
            {FBA_SECTIONS.map((section) => {
              const completeness = getSectionCompleteness(section, report.contentData, aflsAssessments);
              return (
                <Link
                  key={section.slug}
                  href={`/clinician/fba/${fbaId}/section/${section.slug}`}
                  className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                >
                  <CompletenessDot state={completeness} />
                  <div className="min-w-0 flex-1">
                    <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
                      Section {section.number}
                    </p>
                    <p className="truncate text-base font-semibold text-brand-neutral-black">
                      {section.title}
                    </p>
                  </div>
                  <ChevronRight className="h-5 w-5 flex-shrink-0 text-brand-neutral-black/30" />
                </Link>
              );
            })}
          </>
        )}
      </main>
    </div>
  );
}

function SectionCardSkeleton() {
  return (
    <div className="flex animate-pulse items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="h-2.5 w-2.5 rounded-full bg-brand-off-white" />
      <div className="flex-1">
        <div className="h-3 w-16 rounded bg-brand-off-white" />
        <div className="mt-1.5 h-4 w-40 rounded bg-brand-off-white" />
      </div>
    </div>
  );
}
