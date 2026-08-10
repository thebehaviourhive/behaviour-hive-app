"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/logActivity";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";
import { FBA_SECTIONS, getSectionCompleteness } from "@/lib/fba/sections";
import { CompletenessDot } from "../CompletenessDot";
import { FbaNote } from "../FbaNote";
import { BottomSheet } from "@/components/ui/BottomSheet";
import type { FbaAflsData, FbaContentData } from "@/lib/fba/types";

// Sections that gate the [Finalize & Lock] action -- the brief's own
// floor ("the narratives, target behaviours, and recommendations at
// minimum"), read as: the two core clinical-conclusion narratives
// (Clinical Overview, Hypothesised Functions), Target Behaviours,
// Recommendations, and the Conclusion/sign-off. Everything else
// (Assessment Methods, Triggers, Indirect/Direct Assessment, AFLS,
// Consent) can legitimately be thin or empty on some assessments and
// isn't required to lock.
const REQUIRED_SECTION_SLUGS = ["2", "5", "9", "12", "13"];

// Section 14: read-only progress overview + the one genuinely
// destructive action in the whole module. Self-contained (fetches its
// own child_name, matching ClientProfileSection's own-query pattern)
// rather than threading another prop through the routing page for a
// single display string.
export function ReviewSection({
  fbaId,
  passportId,
  content,
  afls,
  readOnly,
  onFinalized,
}: {
  fbaId: string;
  passportId: string;
  content: FbaContentData;
  afls: FbaAflsData | null;
  readOnly: boolean;
  // Only ever called from the clinician workspace, where finalizing is
  // possible -- readOnly callers (the parent reader) never render the
  // button that would invoke this, so a no-op is a safe default rather
  // than making every caller thread through a callback it'll never use.
  onFinalized?: () => void;
}) {
  const [childName, setChildName] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isFinalizing, setIsFinalizing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("passports")
      .select("child_name")
      .eq("id", passportId)
      .maybeSingle()
      .then(({ data }) => {
        if (isMounted) setChildName(data?.child_name ?? null);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  const sections = FBA_SECTIONS.filter((section) => section.kind !== "review");
  const completions = sections.map((section) => ({
    section,
    state: getSectionCompleteness(section, content, afls),
  }));
  const completeCount = completions.filter((c) => c.state === "complete").length;

  const requiredSections = sections.filter((s) => REQUIRED_SECTION_SLUGS.includes(s.slug));
  const requiredComplete = requiredSections.every(
    (s) => getSectionCompleteness(s, content, afls) === "complete"
  );

  async function handleFinalize() {
    setError(null);
    setIsFinalizing(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setIsFinalizing(false);
      setError("Your session has expired. Please sign in again.");
      return;
    }

    // The Stage 1 completed-lock (USING status <> 'completed') only
    // blocks updates on an ALREADY-completed row -- this is the one
    // legitimate transition into it, and completed_at is stamped by the
    // existing DB trigger, not set here.
    const { error: updateError } = await supabase
      .from("fba_reports")
      .update({ status: "completed" })
      .eq("id", fbaId);

    if (updateError) {
      console.error("Failed to finalize FBA:", updateError);
      setIsFinalizing(false);
      setError("Couldn't finalize this FBA. Please try again.");
      return;
    }

    // "completed by [Specialty]", matching the wording ABCLogger already
    // uses for clinician-authored activity entries.
    const { data: clinicianRow } = await supabase
      .from("clinicians")
      .select("specialty")
      .eq("user_id", user.id)
      .maybeSingle();
    const specialtyLabel = clinicianRow?.specialty
      ? (CLINICIAN_SPECIALTY_LABEL[clinicianRow.specialty as ClinicianSpecialty] ?? "Clinician")
      : "Clinician";

    logActivity({
      passportId,
      actorId: user.id,
      eventType: "fba_completed",
      eventDescription: `Functional Behaviour Assessment completed by ${specialtyLabel}`,
    });

    setIsFinalizing(false);
    setIsConfirmOpen(false);
    onFinalized?.();
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
        <p className="font-heading text-lg font-bold text-brand-neutral-black">
          {completeCount} of {sections.length} sections complete
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {completions.map(({ section, state }) => (
          <div
            key={section.slug}
            className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-3"
          >
            <CompletenessDot state={state} />
            <p className="text-sm font-medium text-brand-neutral-black">{section.title}</p>
          </div>
        ))}
      </div>

      {readOnly ? (
        <>
          <FbaNote>This FBA is finalized and locked.</FbaNote>
          <Link
            href={`/passport/fba/${fbaId}/print`}
            className="block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-center text-base font-semibold text-white"
          >
            Save as PDF
          </Link>
        </>
      ) : (
        <>
          {!requiredComplete && (
            <FbaNote>
              Finish the required sections before finalizing: Clinical Overview &amp; Primary Findings,
              Target Behaviours, Hypothesised Behavioural Functions, Recommendations, and Conclusion.
            </FbaNote>
          )}

          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            disabled={!requiredComplete}
            className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            Finalize &amp; Lock FBA
          </button>

          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <BottomSheet isOpen={isConfirmOpen} onClose={() => !isFinalizing && setIsConfirmOpen(false)}>
            <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
              Finalize &amp; Lock?
            </h2>
            <p className="mt-2 text-sm text-brand-neutral-black/70">
              This is permanent. Once locked, the FBA becomes read-only and can never be edited again
              {childName ? ` — ${childName}'s` : " — the"} parent will be notified and able to read
              the full report.
            </p>

            <button
              type="button"
              onClick={handleFinalize}
              disabled={isFinalizing}
              className="mt-6 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isFinalizing ? "Finalizing…" : "Finalize & Lock"}
            </button>
            <button
              type="button"
              onClick={() => setIsConfirmOpen(false)}
              disabled={isFinalizing}
              className="mt-2 w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60 disabled:opacity-40"
            >
              Cancel
            </button>
          </BottomSheet>
        </>
      )}
    </div>
  );
}
