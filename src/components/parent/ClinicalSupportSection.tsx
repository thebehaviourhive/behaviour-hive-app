"use client";

import { useEffect, useState } from "react";
import { format } from "date-fns";
import { createClient } from "@/lib/supabase/client";
import { getClinicianLastName } from "@/lib/clinicianDisplayName";
import { ClinicalDocumentCard } from "./ClinicalDocumentCard";
import { WhatIsAnFbaSheet } from "./WhatIsAnFbaSheet";

interface ClinicianRow {
  clinician_id: string;
  full_name: string | null;
  specialty: string;
}

interface DocumentStatusRow {
  document_type: string;
  status: "in_progress" | "completed";
  fba_id: string;
  started_at: string;
  completed_at: string | null;
  is_approved: boolean;
}

type FbaState =
  | { kind: "no-clinician"; passportId: string | null }
  | { kind: "clinician-no-fba"; clinicianLastName: string }
  | { kind: "in-progress"; clinicianLastName: string; startedAt: string }
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
        // A failed status RPC degrades to "no FBA known" rather than a
        // broken card -- the clinician-connection signal alone still
        // resolves a sensible (if less specific) state A/B.
        const status = statusError ? null : (((statusRows ?? []) as DocumentStatusRow[])[0] ?? null);

        if (!status) {
          setFbaState(
            clinician
              ? { kind: "clinician-no-fba", clinicianLastName: getClinicianLastName(clinician.full_name) }
              : { kind: "no-clinician", passportId: pid }
          );
        } else if (status.status === "in_progress") {
          setFbaState({
            kind: "in-progress",
            clinicianLastName: getClinicianLastName(clinician?.full_name),
            startedAt: status.started_at,
          });
        } else if (status.is_approved) {
          setFbaState({ kind: "completed-approved", fbaId: status.fba_id, completedAt: status.completed_at ?? status.started_at });
        } else {
          setFbaState({ kind: "completed-pending", fbaId: status.fba_id });
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
        {isLoading || !fbaState ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
        ) : (
          <FbaCard state={fbaState} childName={childName} onOpenInfo={() => setIsInfoSheetOpen(true)} />
        )}

        <ClinicalDocumentCard
          title="Behaviour Support Plan"
          body={<p>Behaviour Support Plans are currently in development.</p>}
          disabled
          disabledPillLabel="Coming Soon"
        />
      </div>

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
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          body={<p>Find out more about an FBA for your child.</p>}
          primaryAction={{
            label: "Link your clinician",
            // Can't link a clinician to a passport that doesn't exist yet --
            // creation is the true next step when there's no passport at
            // all. Once a passport exists, deep-link straight to the
            // access/linking area on the passport page, landing with the
            // clinician-code entry visible.
            href: state.passportId ? "/passport/dashboard?openShare=1" : "/passport/welcome",
          }}
          secondaryAction={{ label: "Find out more", onClick: onOpenInfo }}
        />
      );

    case "clinician-no-fba":
      return (
        <ClinicalDocumentCard
          title="Functional Behaviour Assessment"
          body={
            <p>
              Talk to Dr. {state.clinicianLastName} about a Functional Behaviour Assessment for {childName}.
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
              Dr. {state.clinicianLastName} is currently conducting {childName}&apos;s assessment.
              We&apos;ll notify you when it&apos;s ready to review.
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
