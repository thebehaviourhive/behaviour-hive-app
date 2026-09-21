"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ChevronRight } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useClinicianReviewState } from "@/hooks/useClinicianReviewState";
import { ClinicianAccessGate } from "@/components/clinician/ClinicianAccessGate";
import { useFbaReport } from "@/hooks/useFbaReport";
import { useAflsAssessmentsForFba } from "@/hooks/useAflsAssessmentsForFba";
import { FBA_SECTIONS, getSectionCompleteness } from "@/lib/fba/sections";
import { CompletenessDot } from "@/components/clinician/fba/CompletenessDot";
import { FbaSectionEditor, type FbaSectionEditorHandle } from "@/components/clinician/fba/FbaSectionEditor";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  in_progress: "In Progress",
  completed: "Completed",
};

export default function FbaWorkspacePage() {
  const { fbaId } = useParams<{ fbaId: string }>();
  const { user, isReady } = useRequireRole("clinician");
  const {
    isLoading: isLoadingReview,
    profile: reviewProfile,
    reviewState,
    institutionJoinPending,
    error: reviewError,
    refresh: refreshReview,
  } = useClinicianReviewState(user?.id ?? null);
  const { report, isLoading, loadError, reload } = useFbaReport(fbaId);
  const { assessments: aflsAssessments } = useAflsAssessmentsForFba(fbaId);

  const [childName, setChildName] = useState<string | null>(null);

  // FBA section rail, 15 Sept 2026 -- breadth (jump to any of fourteen
  // sections at once) alongside Previous/Next's own sequence, not an
  // alternative to it, same distinction confirmed during the desktop
  // pass's own recon. Below lg this state is simply unused -- the plain
  // card list (unchanged) is all that ever renders there, real <Link>
  // navigation to the standalone routed section page exactly as today.
  const [selectedSectionSlug, setSelectedSectionSlug] = useState<string | null>(null);
  const sectionEditorRef = useRef<FbaSectionEditorHandle>(null);

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

  // Same flush-before-navigate treatment Previous/Next/Back already
  // have (clinician desktop pass + AFLS save resilience): a rail click
  // is navigation too, and must not drop a pending save. Routes through
  // FbaSectionEditor's own imperative handle rather than duplicating
  // its flush logic here -- one implementation, reused by both the
  // component's own internal Previous/Next/Back and this external
  // caller.
  async function handleRailSelect(slug: string) {
    if (slug === selectedSectionSlug) return;
    const safe = (await sectionEditorRef.current?.flushPendingSave()) ?? true;
    if (!safe) return;
    setSelectedSectionSlug(slug);
  }

  if (!isReady) {
    return null;
  }

  return (
    <ClinicianAccessGate
      isLoading={isLoadingReview}
      profile={reviewProfile}
      reviewState={reviewState}
      institutionJoinPending={institutionJoinPending}
      error={reviewError}
      onRetry={refreshReview}
    >
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

      {/* lg:flex, not the grid the caseload/directory split views use --
          the rail's own content (a section number + title, no rich card
          detail) is narrow and short, so a fixed-width column
          (lg:w-72) reads better than a 4-of-12 grid fraction that would
          either crowd long section titles or waste width. Below lg,
          lg:flex never applies -- this is a plain block containing a
          plain block, today's single-column list, unchanged. */}
      <main className="flex flex-1 flex-col gap-2 px-4 pt-3 lg:flex-row lg:items-start lg:gap-6">
        <div className="flex flex-col gap-2 lg:w-72 lg:flex-shrink-0">
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
                const isSelected = section.slug === selectedSectionSlug;
                return (
                  <Link
                    key={section.slug}
                    href={`/clinician/fba/${fbaId}/section/${section.slug}`}
                    onClick={(e) => {
                      if (window.matchMedia("(min-width: 1024px)").matches) {
                        e.preventDefault();
                        handleRailSelect(section.slug);
                      }
                    }}
                    className={`flex items-center gap-3 rounded-2xl border p-4 shadow-sm lg:p-3 ${
                      isSelected
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
                        : "border-black/5 bg-white"
                    }`}
                  >
                    <CompletenessDot state={completeness} />
                    <div className="min-w-0 flex-1">
                      <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
                        Section {section.number}
                      </p>
                      <p className="truncate text-base font-semibold text-brand-neutral-black lg:text-sm">
                        {section.title}
                      </p>
                    </div>
                    <ChevronRight className="h-5 w-5 flex-shrink-0 text-brand-neutral-black/30 lg:hidden" />
                  </Link>
                );
              })}
            </>
          )}
        </div>

        <div className="mt-4 hidden lg:mt-0 lg:block lg:flex-1">
          {!selectedSectionSlug ? (
            <div className="rounded-2xl bg-white p-8 text-center shadow-sm">
              <p className="font-sans text-body text-brand-neutral-black/60">
                Select a section from the list to see it here.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-2xl bg-white shadow-sm">
              <FbaSectionEditor
                ref={sectionEditorRef}
                fbaId={fbaId}
                sectionId={selectedSectionSlug}
                onNavigateBack={() => setSelectedSectionSlug(null)}
                onNavigateSection={(slug) => setSelectedSectionSlug(slug)}
              />
            </div>
          )}
        </div>
      </main>
    </div>
    </ClinicianAccessGate>
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
