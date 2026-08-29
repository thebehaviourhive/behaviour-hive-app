"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { LifeBuoy } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { formatClinicianReference } from "@/lib/clinicianDisplayName";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { WhatIsAnFbaSheet } from "../WhatIsAnFbaSheet";

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
}

// Same 3 RPC-backed buckets as ClinicalSupportSection's own FbaState
// (constraint 2B: "reuse the FBA card's conditional destination logic"),
// collapsed to what the unlock sheet's copy actually needs -- it doesn't
// need ClinicalSupportSection's full 5-state split (completed-pending vs
// completed-approved is a Passport-page distinction, irrelevant here:
// once an FBA is completed, whether the Calm button is live depends
// entirely on published cards, which CalmNavButton already checked
// before ever opening this sheet).
type UnlockState =
  | { kind: "no-clinician"; passportId: string | null }
  | { kind: "clinician-no-fba"; clinicianReference: string }
  | { kind: "fba-in-progress"; clinicianReference: string }
  | { kind: "fba-completed-no-cards" };

function useUnlockState(isOpen: boolean) {
  const [state, setState] = useState<UnlockState | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !isMounted) return;
      // get_my_passports() (Stage 5 Step 3) -- sees a claimed passport
      // correctly, unlike a raw .eq("user_id", ...) lookup. First result
      // only; no multi-child switcher here yet, matching useMyPassport's
      // own documented scope boundary.
      const { data: myPassports } = await supabase.rpc("get_my_passports");
      const rows = (myPassports ?? []) as { passport_id: string; child_name: string }[];

      if (!isMounted) return;
      const passportId = rows[0]?.passport_id ?? null;

      if (!passportId) {
        setState({ kind: "no-clinician", passportId: null });
        setIsLoading(false);
        return;
      }

      const [{ data: clinicianRows }, { data: statusRows, error: statusError }] = await Promise.all([
        supabase.rpc("get_passport_clinicians", { p_passport_id: passportId }),
        supabase.rpc("get_child_clinical_document_status", { p_passport_id: passportId }),
      ]);

      if (!isMounted) return;
      const clinician = ((clinicianRows ?? []) as ClinicianRow[])[0] ?? null;
      // get_child_clinical_document_status() (migration 0113) always
      // returns exactly one row now, authorized or not, FBA or not --
      // is_authorized + document_type are what actually distinguish "no
      // FBA yet" from a real document, not the row's mere presence. Same
      // fix as ClinicalSupportSection.tsx's own (found live, Stage 5
      // Step 3's end-to-end verification): without this, every passport
      // with no FBA at all landed on "fba-completed-no-cards" here,
      // showing "your clinician is preparing Calm Cards" when no
      // clinician or FBA exists at all.
      const statusRow = statusError ? null : (((statusRows ?? []) as DocumentStatusRow[])[0] ?? null);
      const status = statusRow?.is_authorized && statusRow.document_type ? statusRow : null;
      const clinicianReference = formatClinicianReference(clinician?.full_name, clinician?.specialty);

      if (!status) {
        setState(clinician ? { kind: "clinician-no-fba", clinicianReference } : { kind: "no-clinician", passportId });
      } else if (status.status === "in_progress") {
        setState({ kind: "fba-in-progress", clinicianReference });
      } else {
        // status.status === "completed" -- the sheet only opens because
        // CalmNavButton already found the button locked, so a completed
        // FBA here specifically means "no published cards yet".
        setState({ kind: "fba-completed-no-cards" });
      }
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, [isOpen]);

  return { state, isLoading };
}

export function CalmUnlockSheet({
  isOpen,
  onClose,
  childName,
}: {
  isOpen: boolean;
  onClose: () => void;
  childName: string | null;
}) {
  const { state, isLoading } = useUnlockState(isOpen);
  const [isInfoSheetOpen, setIsInfoSheetOpen] = useState(false);
  const name = childName ?? "your child";

  let body: string;
  let primaryAction: { label: string; href: string } | null;

  if (!state || isLoading) {
    body = "In difficult moments, the Calm button gives you instant, step-by-step strategies designed by your clinician specifically for your child.";
    primaryAction = null;
  } else if (state.kind === "no-clinician") {
    body = "In difficult moments, the Calm button gives you instant, step-by-step strategies designed by your clinician specifically for your child.";
    primaryAction = {
      label: "Link your clinician",
      href: state.passportId ? "/passport/dashboard?openShare=1" : "/passport/welcome",
    };
  } else if (state.kind === "clinician-no-fba") {
    body = `Talk to ${state.clinicianReference} about a Functional Behaviour Assessment for ${name}.`;
    primaryAction = null;
  } else if (state.kind === "fba-in-progress") {
    body = `${state.clinicianReference} is currently conducting ${name}'s assessment. The Calm button will unlock once it's complete and your clinician has published Calm Cards.`;
    primaryAction = null;
  } else {
    body = `Your clinician is preparing ${name}'s Calm Cards — they'll appear here soon.`;
    primaryAction = null;
  }

  return (
    <>
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-calm-pill">
            <LifeBuoy aria-hidden size={28} strokeWidth={2} className="text-calm-ink" />
          </span>
          <div>
            <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Unlock the Calm button</h2>
            <p className="mt-2 text-sm text-brand-neutral-black/70">{body}</p>
            <p className="mt-2 text-sm text-brand-neutral-black/70">
              It unlocks when {name}&apos;s Functional Behaviour Assessment is completed through The Behaviour Hive.
            </p>
          </div>

          {primaryAction && (
            <Link
              href={primaryAction.href}
              className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-center text-base font-semibold text-white"
            >
              {primaryAction.label}
            </Link>
          )}

          <button
            type="button"
            onClick={() => setIsInfoSheetOpen(true)}
            className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
          >
            Learn more about FBAs
          </button>
        </div>
      </BottomSheet>

      <WhatIsAnFbaSheet isOpen={isInfoSheetOpen} onClose={() => setIsInfoSheetOpen(false)} />
    </>
  );
}
