"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useFbaReport } from "@/hooks/useFbaReport";
import { FBA_SECTIONS } from "@/lib/fba/sections";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { FbaSectionsReadOnly } from "@/components/passport/fba-reader/FbaSectionsReadOnly";
import { FbaReaderNav } from "@/components/passport/fba-reader/FbaReaderNav";
import { ApprovalBanner } from "@/components/passport/fba-reader/ApprovalBanner";

export default function FbaReaderPage() {
  const { fbaId } = useParams<{ fbaId: string }>();
  const router = useRouter();
  const { isReady } = useRequireRole("parent");
  const { report, isLoading, loadError, reload } = useFbaReport(fbaId);

  const [childName, setChildName] = useState<string | null>(null);

  const loadChildName = useCallback(async () => {
    if (!report) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("passports")
      .select("child_name")
      .eq("id", report.passportId)
      .maybeSingle();
    setChildName(data?.child_name ?? null);
  }, [report]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadChildName();
  }, [loadChildName]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="no-print sticky top-0 z-20 border-b border-black/5 bg-brand-off-white/95 px-4 pt-6 pb-4 backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <Link
            href="/passport/dashboard"
            aria-label="Back to passport"
            className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
          >
            ‹
          </Link>
          <div className="min-w-0 flex-1">
            <p className="font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/40">
              Functional Behaviour Assessment
            </p>
            <h1 className="truncate font-heading text-xl font-bold text-brand-prussian-blue">
              {childName ?? "…"}
            </h1>
          </div>
          {report && report.status === "completed" && (
            <button
              type="button"
              onClick={() => router.push(`/passport/fba/${fbaId}/print`)}
              className="flex-shrink-0 rounded-full bg-brand-prussian-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm"
            >
              Save as PDF
            </button>
          )}
        </div>

        {report && <FbaReaderNav sections={FBA_SECTIONS} />}
      </header>

      <main className="flex-1 px-4 py-6">
        {isLoading ? (
          <div className="flex flex-col gap-4">
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
            <div className="h-24 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={reload} />
        ) : !report ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-brand-neutral-black/70">This report isn&apos;t available.</p>
            <Link
              href="/passport/dashboard"
              className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
            >
              Back to your passport
            </Link>
          </div>
        ) : (
          <div className="flex flex-col gap-10">
            <FbaSectionsReadOnly
              fbaId={fbaId}
              report={report}
              childName={childName}
              // Bumped from scroll-mt-32: the sticky header is now
              // taller (back+title row + bubble row + the new sticky
              // title strip), so a plain-anchor or bubble-tap scroll
              // needs more top clearance to land the section below all
              // three, not partially under them.
              sectionClassName="scroll-mt-40"
            />
          </div>
        )}
      </main>

      {report && report.status === "completed" && (
        <div className="no-print">
          <ApprovalBanner fbaId={fbaId} childName={childName} />
        </div>
      )}
    </div>
  );
}
