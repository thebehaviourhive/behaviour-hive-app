"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { BrandMark } from "@/components/ui/BrandMark";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { Button } from "@/components/ui/Button";
import {
  fetchClinicExportDataForDirector,
  fetchSchoolExportData,
  type ClinicExportData,
  type SchoolExportData,
} from "@/lib/clinicalExport";
import { downloadAttachmentsZip } from "@/lib/attachmentsZip";
import {
  AbcLogsExportSection,
  AssessmentExportSection,
  BspExportSection,
  ClinicalContentExportSection,
  ClinicalPlanExportSection,
  FbaReportExportSection,
  IncidentsExportSection,
  SessionNoteExportSection,
} from "@/lib/clinicalExportRenderers";

// PRD 8 Stage 2 -- principal-only, both directions, one route. A clinic
// director's OWN role is 'principal' (same as a school's), matching
// every other clinic-oversight surface in this build (DirectorSessionNotesTab,
// ChildDetail) -- so which composition runs is decided by the caller's
// OWN institution's type, not by which route they're on.
//
// SCHOOL: incidents, class_teacher/sna ABC logs, published guidance --
// everything a principal already reads institution-wide via existing,
// already-proven paths. No toggle: "A class teacher exporting a child's
// full file is not something a school would want by default, and there
// is no precedent for it" (Daniel's own answer) -- principal-only, no
// exception.
//
// CLINIC: every one of the clinic's own clinicians' material, via the
// five director-read RPCs (0247, 0248) plus the two tables filtered
// client-side to this clinic's own tenure window (clinicalExport.ts's
// own header explains why a raw read isn't enough for those two).
//
// Two artefacts, not one: window.print() for the document, a separate
// "Download attachments" zip. See the clinician-side export page's own
// header for the full reasoning -- identical here.
export default function PrincipalExportPage() {
  const { passportId } = useParams<{ passportId: string }>();
  const { user, isReady } = useRequireRole("principal");

  const [direction, setDirection] = useState<"school" | "clinic" | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [clinicData, setClinicData] = useState<ClinicExportData | null>(null);
  const [schoolData, setSchoolData] = useState<SchoolExportData | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isZipping, setIsZipping] = useState(false);
  const [zipMessage, setZipMessage] = useState<string | null>(null);
  const [recorded, setRecorded] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions:institution_id(name, type)")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .maybeSingle();

    const institutionId = staffRow?.institution_id as string | undefined;
    const institution = staffRow?.institutions as unknown as { name: string; type: string } | null;
    if (!institutionId || !institution) {
      setLoadError("Couldn't resolve your own institution.");
      return;
    }
    setInstitutionName(institution.name);

    // passports has no policy granting institution staff a direct read
    // of the row (this schema's own standing rule: roster-scoped child
    // names resolve through a dedicated RPC, never a direct passports()
    // read) -- found live, in the browser pass, as a blank name in this
    // very header.
    const { data: name } = await supabase.rpc("get_child_name_for_linked_institution_staff", { p_passport_id: passportId });
    setChildName(name ?? null);

    if (institution.type === "clinic") {
      setDirection("clinic");
      setClinicData(await fetchClinicExportDataForDirector(passportId, institutionId));
    } else {
      setDirection("school");
      setSchoolData(await fetchSchoolExportData(passportId));
    }

    if (!recorded) {
      await supabase.rpc("record_clinical_export", {
        p_passport_id: passportId,
        p_institution_id: institutionId,
        p_scope: institution.type === "clinic" ? "this child's clinical record" : "this child's school record",
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
    if (!clinicData || clinicData.attachments.length === 0) return;
    setIsZipping(true);
    setZipMessage(null);
    const result = await downloadAttachmentsZip(clinicData.attachments, `${childName ?? "export"} -- attachments.zip`);
    setIsZipping(false);
    setZipMessage(
      result.failedFilenames.length > 0
        ? `Downloaded ${result.includedCount} of ${clinicData.attachments.length} files. Couldn't open: ${result.failedFilenames.join(", ")}.`
        : `Downloaded ${result.includedCount} file${result.includedCount === 1 ? "" : "s"}.`
    );
  }

  if (!isReady || (!clinicData && !schoolData && !loadError)) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
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

  const attachmentCount = clinicData?.attachments.length ?? 0;

  return (
    <div className="min-h-full bg-brand-off-white/40 pb-16 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 py-4 backdrop-blur-sm">
        <Link href={`/principal/passports/${passportId}`} aria-label="Back" className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue">
          ‹
        </Link>
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export record</p>
        <Button type="button" onClick={() => window.print()} className="!w-auto !px-4 !py-2 text-sm">
          Print / Save as PDF
        </Button>
      </div>

      {attachmentCount > 0 && (
        <div className="no-print flex flex-col gap-2 border-b border-black/5 bg-brand-off-white/95 px-4 py-3">
          <Button type="button" variant="secondary" onClick={handleDownloadAttachments} disabled={isZipping} className="!w-auto !px-4 !py-2 text-sm">
            {isZipping ? "Preparing…" : `Download attachments (${attachmentCount})`}
          </Button>
          {zipMessage && <p className="text-xs text-brand-neutral-black/60">{zipMessage}</p>}
        </div>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-8 flex items-center gap-3 border-b-4 border-brand-prussian-blue pb-4 print-avoid-break">
          <BrandMark size={40} />
          <div>
            <p className="font-heading text-base font-bold text-brand-prussian-blue">The Behaviour Hive</p>
            <p className="text-xs text-brand-neutral-black/60">
              {direction === "clinic" ? "Clinical Record Export" : "School Record Export"}
            </p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-black/10 p-4 text-sm print-avoid-break">
          <p className="text-brand-neutral-black/50">Client</p>
          <p className="font-semibold text-brand-neutral-black">{childName ?? "—"}</p>
          <p className="mt-2 text-brand-neutral-black/50">Organisation</p>
          <p className="font-semibold text-brand-neutral-black">{institutionName ?? "—"}</p>
        </div>

        {direction === "school" && schoolData && (
          <>
            <IncidentsExportSection incidents={schoolData.incidents} />
            <AbcLogsExportSection logs={schoolData.abcLogs} />
            <ClinicalContentExportSection items={schoolData.clinicalContent} />
            {schoolData.incidents.length + schoolData.abcLogs.length + schoolData.clinicalContent.length === 0 && (
              <p className="text-sm text-brand-neutral-black/60">Nothing is recorded for this child yet.</p>
            )}
          </>
        )}

        {direction === "clinic" && clinicData && (
          <>
            {clinicData.fbaReports.map((fba) => <FbaReportExportSection key={fba.id} fba={fba} />)}
            {clinicData.bsps.map((bsp) => <BspExportSection key={bsp.id} bsp={bsp} />)}
            {clinicData.clinicalPlans.map((plan) => <ClinicalPlanExportSection key={plan.id} plan={plan} />)}
            {clinicData.assessments.map((a) => <AssessmentExportSection key={a.id} assessment={a} />)}
            {clinicData.sessionNotes.map((note) => <SessionNoteExportSection key={note.id} note={note} />)}
            <ClinicalContentExportSection items={clinicData.clinicalContent} />
            <AbcLogsExportSection logs={clinicData.abcLogs} />
            {clinicData.fbaReports.length + clinicData.bsps.length + clinicData.clinicalPlans.length +
              clinicData.assessments.length + clinicData.sessionNotes.length + clinicData.clinicalContent.length +
              clinicData.abcLogs.length ===
              0 && <p className="text-sm text-brand-neutral-black/60">Nothing is recorded for this child yet.</p>}
          </>
        )}
      </div>
    </div>
  );
}
