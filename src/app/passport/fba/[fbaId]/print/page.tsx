"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { useFbaReport } from "@/hooks/useFbaReport";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BrandMark } from "@/components/ui/BrandMark";
import { FbaSectionsReadOnly } from "@/components/passport/fba-reader/FbaSectionsReadOnly";

interface TeamMemberRow {
  teacher_id: string;
  full_name: string | null;
  role: string;
}

interface ClinicianRow {
  clinician_id: string;
  specialty: string;
}

// The PDF export (Part F). Deliberately route-independent on role: this
// page is reached from both the clinician workspace and the parent
// reader, and RLS on fba_reports/afls_assessments already scopes what each
// caller can see -- so rather than gate on one specific role via
// useRequireRole, this just checks *someone* is signed in and lets the
// query results speak (an unauthorized fbaId simply loads no report).
//
// Rendering strategy: reuse the exact same read-only section components
// as the parent reader (via FbaSectionsReadOnly) rather than a bespoke
// PDF template, so the printed document can never drift from what both
// tracks already show on screen. Output is produced client-side via
// window.print() -- there is no server-side Playwright/headless-Chrome
// step in this deployment (Playwright is a devDependency only, no
// container/VPS deploy target exists), and printing client-side is what
// makes the iOS PWA path work at all: in an installed standalone PWA,
// window.print() hands off to iOS's native Print sheet, which has its
// own Share/"Save to Files" action -- the share-sheet flow the brief
// explicitly allows for.
export default function FbaPrintPage() {
  const { fbaId } = useParams<{ fbaId: string }>();
  const router = useRouter();
  const { report, isLoading, loadError } = useFbaReport(fbaId);

  const [authChecked, setAuthChecked] = useState(false);
  const [childName, setChildName] = useState<string | null>(null);
  const [clinicianName, setClinicianName] = useState<string | null>(null);
  // Nullable independently of clinicianName -- get_passport_clinicians
  // (parent-viewer-only, same owns_passport gate get_passport_team's
  // clinician branch already has) can legitimately return nothing while
  // the name still resolves fine, e.g. a clinician viewing their own
  // export, or access since revoked. Degrades to name-alone, never
  // blocks on it.
  const [clinicianSpecialty, setClinicianSpecialty] = useState<string | null>(null);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
    });
    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
  }, []);

  const loadNames = useCallback(async () => {
    if (!report) return;
    const supabase = createClient();
    const [{ data: passport }, { data: teamRows }, { data: clinicianRows }] = await Promise.all([
      supabase.from("passports").select("child_name").eq("id", report.passportId).maybeSingle(),
      supabase.rpc("get_passport_team", { p_passport_id: report.passportId }),
      supabase.rpc("get_passport_clinicians", { p_passport_id: report.passportId }),
    ]);
    setChildName(passport?.child_name ?? null);
    const clinicianRow = ((teamRows ?? []) as TeamMemberRow[]).find(
      (row) => row.role === "clinician" && row.teacher_id === report.clinicianId
    );
    setClinicianName(clinicianRow?.full_name ?? null);
    const specialtyRow = ((clinicianRows ?? []) as ClinicianRow[]).find(
      (row) => row.clinician_id === report.clinicianId
    );
    setClinicianSpecialty(specialtyRow?.specialty ?? null);
  }, [report]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadNames();
  }, [loadNames]);

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  if (!report || report.status !== "completed") {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-brand-neutral-black/70">
          This report isn&apos;t available to export -- it must be finalized first.
        </p>
        <Link href={`/passport/fba/${fbaId}`} className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2">
          Back
        </Link>
      </div>
    );
  }

  const completedDateLabel = report.completedAt ? format(new Date(report.completedAt), "d MMMM yyyy") : "—";

  return (
    <div className="min-h-full bg-brand-off-white/40 pb-16 print:bg-white print:pb-0">
      {/* Screen-only controls -- hidden entirely when printed. */}
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 py-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export report</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-bold text-white shadow-sm"
        >
          Print / Save as PDF
        </button>
      </div>
      {isStandalone && (
        <p className="no-print px-4 pt-3 text-xs text-brand-neutral-black/60">
          On iPhone, tap Print, then use the Share icon on the preview to save this as a PDF to Files.
        </p>
      )}

      {/* The document itself -- what actually prints. */}
      <div className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-8 flex items-center gap-3 border-b-4 border-brand-prussian-blue pb-4 print-avoid-break">
          <BrandMark size={40} />
          <div>
            <p className="font-heading text-base font-bold text-brand-prussian-blue">The Behaviour Hive</p>
            <p className="text-xs text-brand-neutral-black/60">Functional Assessment Report</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl bg-brand-prussian-blue px-5 py-4 text-center print:rounded-none print-avoid-break">
          <p className="font-heading text-lg font-bold tracking-wide text-white">FUNCTIONAL BEHAVIOUR ASSESSMENT</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">
            Private and Confidential
          </p>
        </div>

        <div className="mb-10 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-black/10 p-4 text-sm print:rounded-none print-avoid-break">
          <p className="text-brand-neutral-black/50">Client</p>
          <p className="font-semibold text-brand-neutral-black">{childName ?? "—"}</p>
          <p className="text-brand-neutral-black/50">Completed by</p>
          <p className="font-semibold text-brand-neutral-black">
            {clinicianName ? formatClinicianReference(clinicianName, clinicianSpecialty) : "—"}
          </p>
          <p className="text-brand-neutral-black/50">Date completed</p>
          <p className="font-semibold text-brand-neutral-black">{completedDateLabel}</p>
        </div>

        <div className="flex flex-col gap-10 print:gap-6">
          <FbaSectionsReadOnly
            fbaId={fbaId}
            report={report}
            childName={childName}
            sectionClassName="print-avoid-break"
            isPrint
          />
        </div>

        <div className="mt-12 border-t border-black/10 pt-6 print-avoid-break">
          <p className="text-sm text-brand-neutral-black">
            This report was completed and locked by <span className="font-semibold">{clinicianName ?? "the clinician"}</span> on{" "}
            {completedDateLabel}, via The Behaviour Hive.
          </p>
          <p className="mt-1 text-xs text-brand-neutral-black/50">
            Sign-off: {clinicianName ?? "—"} · {completedDateLabel}
          </p>
        </div>
      </div>
    </div>
  );
}
