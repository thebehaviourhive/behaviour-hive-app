"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { BrandMark } from "@/components/ui/BrandMark";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { Button } from "@/components/ui/Button";
import { fetchClinicExportDataForPractitioner, type ClinicExportData } from "@/lib/clinicalExport";
import { downloadAttachmentsZip } from "@/lib/attachmentsZip";
import {
  AbcLogsExportSection,
  AssessmentExportSection,
  BspExportSection,
  ClinicalContentExportSection,
  ClinicalPlanExportSection,
  FbaReportExportSection,
  SessionNoteExportSection,
} from "@/lib/clinicalExportRenderers";

// PRD 8 Stage 2 -- a practitioner's own export: their OWN authored
// material for one client, nothing a colleague or the director added.
// Gated on institutions.practitioner_can_export_own_clients (default
// false) -- not a new access grant (the practitioner can already read
// every one of these rows, RLS already lets an author read their own),
// but a clinic's own decision about whether material is allowed to
// leave the building at all. The director's own export (everything the
// clinic's clinicians authored) lives under /principal/, not here --
// a clinic director's role is 'principal', matching every other
// clinic-oversight surface in this build (DirectorSessionNotesTab,
// ChildDetail).
//
// Two artefacts, not one (Daniel's own correction): the document itself
// stays window.print() -- real, selectable text, every read-only
// rendering purpose-built for this screen rather than reusing FBA's own
// AFLS-coupled reader (see clinicalExportRenderers.tsx's own header).
// Attachments are a separate "Download attachments" zip, fetched via
// the same signed-URL-then-real-bytes pattern useAttachments.ts already
// uses -- a signed URL cannot survive being embedded in a printed PDF,
// so there was never a version of this that could be one download.
export default function ClinicianExportPage() {
  const { passportId } = useParams<{ passportId: string }>();
  const router = useRouter();
  const { user, isReady } = useRequireRole("clinician");

  const [allowed, setAllowed] = useState<boolean | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [data, setData] = useState<ClinicExportData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipMessage, setZipMessage] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions:institution_id(name, practitioner_can_export_own_clients)")
      .eq("user_id", user.id)
      .eq("role", "clinician")
      .maybeSingle();

    const institutionId = staffRow?.institution_id as string | undefined;
    const institution = staffRow?.institutions as unknown as { name: string; practitioner_can_export_own_clients: boolean } | null;

    if (!institutionId || !institution?.practitioner_can_export_own_clients) {
      setAllowed(false);
      return;
    }
    setAllowed(true);

    // passports has no policy granting institution staff a direct read
    // of the row -- same fix as the principal-side export screen, found
    // in that one's own live browser pass.
    const [{ data: name }, exportData] = await Promise.all([
      supabase.rpc("get_child_name_for_linked_institution_staff", { p_passport_id: passportId }),
      fetchClinicExportDataForPractitioner(passportId, user.id),
    ]);
    setChildName(name ?? null);
    setData(exportData);

    if (!recorded) {
      await supabase.rpc("record_clinical_export", {
        p_passport_id: passportId,
        p_institution_id: institutionId,
        p_scope: "your own clinical records",
      });
      setRecorded(true);
    }
  }, [user, passportId, recorded]);

  useEffect(() => {
    if (!isReady) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err) => setLoadError(err instanceof Error ? err.message : "Couldn't load this export."));
  }, [isReady, load]);

  async function handleDownloadAttachments() {
    if (!data || data.attachments.length === 0) return;
    setIsZipping(true);
    setZipMessage(null);
    const result = await downloadAttachmentsZip(data.attachments, `${childName ?? "export"} -- attachments.zip`);
    setIsZipping(false);
    setZipMessage(
      result.failedFilenames.length > 0
        ? `Downloaded ${result.includedCount} of ${data.attachments.length} files. Couldn't open: ${result.failedFilenames.join(", ")}.`
        : `Downloaded ${result.includedCount} file${result.includedCount === 1 ? "" : "s"}.`
    );
  }

  if (!isReady || allowed === null) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (allowed === false) {
    return (
      <div className="flex flex-col items-center gap-3 p-12 text-center">
        <p className="text-sm text-brand-neutral-black/70">
          Exporting your own clients isn&apos;t enabled for your clinic. Ask your clinical director.
        </p>
        <button type="button" onClick={() => router.back()} className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2">
          Back
        </button>
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <InlineErrorState message={loadError} onRetry={() => load()} />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  const hasAnyContent =
    data.fbaReports.length + data.bsps.length + data.clinicalPlans.length + data.assessments.length +
      data.sessionNotes.length + data.clinicalContent.length + data.abcLogs.length >
    0;

  return (
    <div className="min-h-full bg-brand-off-white/40 pb-16 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 py-4 backdrop-blur-sm">
        <Link href={`/clinician/passport/${passportId}`} aria-label="Back" className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue">
          ‹
        </Link>
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export your records</p>
        <Button type="button" onClick={() => window.print()} className="!w-auto !px-4 !py-2 text-sm">
          Print / Save as PDF
        </Button>
      </div>

      {data.attachments.length > 0 && (
        <div className="no-print flex flex-col gap-2 border-b border-black/5 bg-brand-off-white/95 px-4 py-3">
          <Button type="button" variant="secondary" onClick={handleDownloadAttachments} disabled={isZipping} className="!w-auto !px-4 !py-2 text-sm">
            {isZipping ? "Preparing…" : `Download attachments (${data.attachments.length})`}
          </Button>
          {zipMessage && <p className="text-xs text-brand-neutral-black/60">{zipMessage}</p>}
        </div>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-8 flex items-center gap-3 border-b-4 border-brand-prussian-blue pb-4 print-avoid-break">
          <BrandMark size={40} />
          <div>
            <p className="font-heading text-base font-bold text-brand-prussian-blue">The Behaviour Hive</p>
            <p className="text-xs text-brand-neutral-black/60">Clinical Record Export -- Your Own Material</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-black/10 p-4 text-sm print-avoid-break">
          <p className="text-brand-neutral-black/50">Client</p>
          <p className="font-semibold text-brand-neutral-black">{childName ?? "—"}</p>
        </div>

        {!hasAnyContent && <p className="text-sm text-brand-neutral-black/60">Nothing of your own is recorded for this child yet.</p>}

        {data.fbaReports.map((fba) => <FbaReportExportSection key={fba.id} fba={fba} />)}
        {data.bsps.map((bsp) => <BspExportSection key={bsp.id} bsp={bsp} />)}
        {data.clinicalPlans.map((plan) => <ClinicalPlanExportSection key={plan.id} plan={plan} />)}
        {data.assessments.map((a) => <AssessmentExportSection key={a.id} assessment={a} />)}
        {data.sessionNotes.map((note) => <SessionNoteExportSection key={note.id} note={note} />)}
        <ClinicalContentExportSection items={data.clinicalContent} />
        <AbcLogsExportSection logs={data.abcLogs} />
      </div>
    </div>
  );
}
