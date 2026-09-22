"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";
import { QuestionnairePromptCard } from "@/components/questionnaire/QuestionnairePromptCard";
import { AssessmentRequestPromptCard } from "@/components/questionnaire/AssessmentRequestPromptCard";
import { GrantConfirmationPromptCard } from "@/components/consent/GrantConfirmationPromptCard";
import { ActiveGrantsSection } from "@/components/consent/ActiveGrantsSection";
import { ClinicalDocumentCard } from "./ClinicalDocumentCard";
import { WhatIsAnFbaSheet } from "./WhatIsAnFbaSheet";

interface ClinicianRow {
  clinician_id: string;
  full_name: string | null;
  specialty: string;
}

interface DocumentStatusRow {
  is_authorized: boolean;
  document_type: string | null;
  status: "in_progress" | "completed" | null;
  fba_id: string | null;
  started_at: string | null;
  completed_at: string | null;
  is_approved: boolean | null;
}

type FbaState =
  | { kind: "no-clinician"; passportId: string | null }
  | { kind: "clinician-no-fba"; clinicianReference: string }
  | { kind: "in-progress"; clinicianReference: string; startedAt: string }
  | { kind: "completed-pending"; fbaId: string }
  | { kind: "completed-approved"; fbaId: string; completedAt: string };

// Section 0 -- immediately below the daily update card, above the quick
// actions grid (replaces the old FbaCompletedPromptCard text-link,
// which this fully supersedes: one clear access path via the card now,
// not two competing entry points). Self-contained: fetches its own
// data, degrades to state A on any load failure rather than a broken
// card (get_passport_clinicians is reused as-is for the clinician
// connection signal + name -- not duplicated -- and
// get_child_clinical_document_status, Step 0, supplies the rest).
//
// VISIBILITY, recorded here after a real recon (21 Sept 2026) rather
// than assumed -- this section is NOT all clinic content, and does not
// need one explicit "does this child have a clinic connection" gate to
// behave correctly:
//   - QuestionnairePromptCard / AssessmentRequestPromptCard /
//     GrantConfirmationPromptCard -- things a parent must ACT on. All
//     three already query across every one of the parent's own
//     children (not scoped to this passport at all) and already render
//     nothing when there's nothing pending -- exactly "shown wherever
//     it applies", no change needed. A school can have its own
//     engaged clinician (institution-employed or parent-engaged), so a
//     school-only child can have a real pending questionnaire; gating
//     these on a clinic connection would have hidden it.
//   - The FBA card (below) is driven by get_passport_clinicians()/
//     get_child_clinical_document_status(), which key off a
//     clinician's own engagement (clinician_access), not the type of
//     institution that engaged them. A school-only child with a
//     school-engaged clinician has real clinical work here too --
//     deliberately ungated by institution type.
//   - ActiveGrantsSection is the one genuinely clinic-specific piece --
//     cross_organisation_grants can only exist when the granting
//     institution is type='clinic' (its own direction trigger), so it
//     is structurally impossible for a school-only child to ever have
//     a row there. It already rendered nothing when empty; the one
//     real fix needed was scoping its own query to THIS passport (see
//     its own header for the bug that predated this section's
//     multi-child awareness).
// A child at both a school and a clinic gets the full section for the
// same reason a school-only child gets none of the clinic-only piece:
// every card here answers its own question from real data, not from an
// institution-type flag threaded down from above.
export function ClinicalSupportSection({
  passportId,
  childName,
}: {
  passportId: string | null;
  childName: string;
}) {
  const [fbaState, setFbaState] = useState<FbaState | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isInfoSheetOpen, setIsInfoSheetOpen] = useState(false);

  useEffect(() => {
    let isMounted = true;

    // No passport yet is a permanent (not transient) condition for this
    // parent, not a "still loading" one -- resolve straight to the
    // awareness state instead of returning early and leaving isLoading
    // stuck at true forever. That early-return-without-resolving was the
    // root cause of the card rendering as a stuck skeleton (visually
    // empty) before any passport exists -- fixed here by never leaving
    // this effect without setting both fbaState and isLoading.
    if (!passportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setFbaState({ kind: "no-clinician", passportId: null });
      setIsLoading(false);
      return;
    }

    // Captured as its own const so the closure below keeps TypeScript's
    // non-null narrowing -- `passportId` itself is a prop binding, which
    // TS won't narrow inside a nested function even though it can't
    // actually change within this effect run.
    const pid = passportId;

    async function load() {
      const supabase = createClient();
      try {
        const [{ data: clinicianRows }, { data: statusRows, error: statusError }] = await Promise.all([
          supabase.rpc("get_passport_clinicians", { p_passport_id: pid }),
          supabase.rpc("get_child_clinical_document_status", { p_passport_id: pid }),
        ]);

        if (!isMounted) return;

        const clinician = ((clinicianRows ?? []) as ClinicianRow[])[0] ?? null;
        // get_child_clinical_document_status() (migration 0113) always
        // returns exactly one row now, authorized or not, FBA or not --
        // its own is_authorized column is what actually distinguishes
        // "no FBA yet" from a real document, not the row's mere
        // presence. Found live (Stage 5 Step 3's own end-to-end
        // verification, a genuinely fresh passport): with the row always
        // truthy, this used to always fall through to the "else" branch
        // below and show "FBA complete" with a broken
        // /passport/fba/null link, for every passport with no FBA at
        // all -- self-created or claimed, not specific to Stage 5. A
        // failed status RPC still degrades to "no FBA known" rather than
        // a broken card.
        const statusRow = statusError ? null : (((statusRows ?? []) as DocumentStatusRow[])[0] ?? null);
        const status = statusRow?.is_authorized && statusRow.document_type ? statusRow : null;

        if (!status) {
          setFbaState(
            clinician
              ? {
                  kind: "clinician-no-fba",
                  clinicianReference: formatClinicianReference(clinician.full_name, clinician.specialty),
                }
              : { kind: "no-clinician", passportId: pid }
          );
        } else if (status.status === "in_progress") {
          // Non-null assertions below: the RPC's own SQL sets fba_id/
          // started_at in the SAME `select into` as document_type --
          // `status` here is only reachable once document_type is
          // confirmed non-null, so these are always set together too.
          setFbaState({
            kind: "in-progress",
            clinicianReference: formatClinicianReference(clinician?.full_name, clinician?.specialty),
            startedAt: status.started_at!,
          });
        } else if (status.is_approved) {
          setFbaState({
            kind: "completed-approved",
            fbaId: status.fba_id!,
            completedAt: status.completed_at ?? status.started_at!,
          });
        } else {
          setFbaState({ kind: "completed-pending", fbaId: status.fba_id! });
        }
      } catch {
        // Any unexpected exception (network failure, RPC rejection) also
        // falls back to the awareness content -- the card must never be
        // able to render empty, on RPC error or otherwise.
        if (isMounted) setFbaState({ kind: "no-clinician", passportId: pid });
      } finally {
        if (isMounted) setIsLoading(false);
      }
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">Clinical Support</h2>

      <div className="flex flex-col gap-3">
        {/* Pending questionnaires now live at the top of this section,
            above the FBA card -- moved here from their old standalone
            slot on the dashboard. No className supplied: this div's own
            gap-3 (matching the FBA/BSP cards' own lack of self-margin)
            already provides correct spacing, and the section's existing
            px-4 (from the dashboard's <main>) already provides the
            horizontal inset. */}
        <QuestionnairePromptCard track="parent" />
        <AssessmentRequestPromptCard />
        <GrantConfirmationPromptCard />

        {isLoading || !fbaState ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
        ) : (
          <FbaCard state={fbaState} childName={childName} onOpenInfo={() => setIsInfoSheetOpen(true)} />
        )}
      </div>

      {/* PRD 10 Stage 6, item 6.3 -- "the parent revokes from wherever
          they confirmed the grant." Same section, real and wired --
          only the CONFIRMATION screen above is held back for design
          review, not revocation. */}
      <ActiveGrantsSection passportId={passportId} />

      <WhatIsAnFbaSheet isOpen={isInfoSheetOpen} onClose={() => setIsInfoSheetOpen(false)} />
    </section>
  );
}

function FbaCard({
  state,
  childName,
  onOpenInfo,
}: {
  state: FbaState;
  childName: string;
  onOpenInfo: () => void;
}) {
  switch (state.kind) {
    case "no-clinician":
      // Parent-track Share sheet fix, 23 Sept 2026 -- "Link your
      // clinician" used to deep-link into ShareBottomSheet's own
      // clinician-code field, now removed (Part 1's own recon:
      // zero real, connectable clinician codes exist -- every
      // clinician joins via an organisation now). No action left to
      // offer here until the real connection path this recon found
      // missing is built (see CLAUDE.md's own deferred-work entry) --
      // informational only, matching the clinician-no-fba/fba-in-
      // progress states immediately below, which already have no
      // primaryAction either.
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          body={<p>Find out more about an FBA for your child.</p>}
          secondaryAction={{ label: "Find out more", onClick: onOpenInfo }}
        />
      );

    case "clinician-no-fba":
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          body={
            <p>
              Talk to {state.clinicianReference} about a Functional Behaviour Assessment for {childName}.
            </p>
          }
          secondaryAction={{ label: "Find out more", onClick: onOpenInfo }}
        />
      );

    case "in-progress":
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          borderClassName="border-l-4 border-brand-pastel-blue"
          body={
            <p>
              {state.clinicianReference} is currently conducting {childName}&apos;s assessment. We&apos;ll
              notify you when it&apos;s ready to review.
            </p>
          }
          footnote={<p>Started: {format(new Date(state.startedAt), "d MMM yyyy")}</p>}
        />
      );

    case "completed-pending":
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          borderClassName="border-l-4 border-brand-golden-brown"
          body={<p>FBA complete. Review the report to approve new strategies.</p>}
          primaryAction={{ label: "Review & Approve", href: `/passport/fba/${state.fbaId}` }}
        />
      );

    case "completed-approved":
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          borderClassName="border-l-4 border-brand-prussian-blue"
          body={<p>Completed on {format(new Date(state.completedAt), "d MMM yyyy")}.</p>}
          primaryAction={{ label: "Read Full FBA", href: `/passport/fba/${state.fbaId}` }}
          secondaryAction={{ label: "View strategies on Passport", href: "/passport/dashboard#clinical-team" }}
        />
      );
  }
}
