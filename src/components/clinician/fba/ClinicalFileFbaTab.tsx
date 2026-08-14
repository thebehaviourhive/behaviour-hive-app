"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { FbaSectionsReadOnly } from "@/components/passport/fba-reader/FbaSectionsReadOnly";
import { ClinicalFileFbaSections } from "./ClinicalFileFbaSections";
import type { FbaContentData, FbaReport } from "@/lib/fba/types";

interface FbaReportRow {
  id: string;
  passport_id: string;
  clinician_id: string;
  status: FbaReport["status"];
  content_data: FbaContentData;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
}

type ViewMode = "clinical" | "family";

// The Clinical File's FBA tab (Fix 2). Self-contained fetch, same
// pattern every other tab body on this page already uses (e.g.
// ClinicalTeamSection's own hook) -- everything here is derived from
// the `passportId` prop threaded down from the route param, and
// fba_reports' own RLS ("Clinicians can view their own linked FBAs":
// clinician_id = auth.uid() + is_verified_clinician + an ACTIVE
// clinician_access row for this exact passport_id -- see migration
// 0040) is what actually enforces the case-scoping: a passportId for a
// child this clinician isn't actively, verifiedly linked to simply
// returns no row, however it got into the URL. There's no separate
// client-side ownership check to keep in sync with that policy.
//
// "The completed FBA" (spec's phrasing, singular): a passport can only
// ever have one active (draft/in_progress) FBA at a time (DB-enforced,
// migration 0040), but multiple completed ones can accumulate over
// time, so this resolves to the most recently completed row -- the
// current report -- rather than an arbitrary one.
//
// AFLS REBUILD (migration 0060): no longer fetches AFLS data itself --
// both ClinicalFileFbaSections (via AflsSection) and FbaSectionsReadOnly
// self-fetch afls_assessments through their own hook, matching the Calm
// Cards precedent of independent, un-threaded fetches.
export function ClinicalFileFbaTab({ passportId, childName }: { passportId: string; childName: string }) {
  const [report, setReport] = useState<FbaReport | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewMode>("clinical");

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const { data: reportRow, error: reportError } = await supabase
      .from("fba_reports")
      .select("*")
      .eq("passport_id", passportId)
      .eq("status", "completed")
      .order("completed_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (reportError) {
      console.error("Failed to load FBA for Clinical File:", reportError);
      setLoadError("Couldn't load this child's FBA.");
      setReport(null);
      return;
    }

    if (!reportRow) {
      setReport(null);
      return;
    }

    const row = reportRow as FbaReportRow;
    setReport({
      id: row.id,
      passportId: row.passport_id,
      clinicianId: row.clinician_id,
      status: row.status,
      contentData: row.content_data ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      completedAt: row.completed_at,
    });
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (report === undefined) {
    return (
      <div className="flex flex-col gap-4">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return <InlineErrorState message={loadError} onRetry={load} />;
  }

  if (!report) {
    return (
      <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-sm text-black/50">
        No completed FBA for this child yet.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-2">
        <div className="flex rounded-full bg-black/5 p-1">
          {(["clinical", "family"] as ViewMode[]).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className={`rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors ${
                view === mode ? "bg-white text-brand-prussian-blue shadow-sm" : "text-brand-neutral-black/50"
              }`}
            >
              {mode === "clinical" ? "Clinical view" : "Family view"}
            </button>
          ))}
        </div>
        <Link
          href={`/passport/fba/${report.id}/print`}
          className="flex-shrink-0 rounded-full bg-brand-prussian-blue px-3 py-1.5 text-xs font-bold text-white shadow-sm"
        >
          Save as PDF
        </Link>
      </div>

      {view === "family" && (
        <p className="-mt-2 text-sm text-brand-neutral-black/60">
          This is the report as {childName}&apos;s family sees it.
        </p>
      )}

      <div className="flex flex-col gap-10">
        {view === "clinical" ? (
          <ClinicalFileFbaSections fbaId={report.id} passportId={passportId} report={report} />
        ) : (
          <FbaSectionsReadOnly fbaId={report.id} report={report} childName={childName} />
        )}
      </div>
    </div>
  );
}
