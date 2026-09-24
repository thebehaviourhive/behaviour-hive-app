"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { getRoleLabel, type Role } from "@/lib/vocabulary";
import type { InstitutionType } from "@/lib/institutionType";

// Stage 1c, Step 3. Same confirmation shape as the FBA finalize-and-lock
// pattern (ReviewSection.tsx) -- pick, confirm, no undo. The successor
// is drawn from the roster the parent page already loaded (active,
// non-principal, not self) rather than a fresh query here -- there is
// no separate "who can I hand over to" lookup, hand_over_principal()'s
// own guards are the real authority; this list is just a convenience
// picker over people who would plausibly pass them.
//
// Tier 1 item 4, 21 Sept 2026 -- institutionType-aware, both in copy
// and in the actual staying-role options offered. This was a real
// functional gap, not just wording: hand_over_principal()'s own
// staying-role set has been three-wide for a clinic since PRD 5 Stage 2
// (clinician/clinical_lead/clinic_admin, not class_teacher/sna, per
// migration 0207's own type-aware CHECK), but this sheet only ever
// offered the two school-only options -- a clinical director choosing
// "staying in another role" had no way to pick a role that would
// actually pass the RPC's own check.

type StayingRole = "class_teacher" | "sna" | "clinician" | "clinical_lead" | "clinic_admin";

interface EligibleSuccessor {
  userId: string;
  fullName: string;
}

interface HandOverPrincipalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  institutionId: string;
  institutionType: InstitutionType;
  eligibleSuccessors: EligibleSuccessor[];
  onHandedOver: (outcome: Outcome, stayingRole: StayingRole | null) => void;
}

type Outcome = "leaving" | "staying";

// respite_centre: [] -- this sheet is structurally unreachable for a
// respite institution (hand_over_principal() is principal-only, and
// PRD 11 Stage 2's own centre_manager role can never hold "principal";
// see institutionType.ts's own comment on why InstitutionType is a
// full union rather than a partial one). Empty, not omitted -- an
// honest "no valid staying roles here" rather than a value invented to
// satisfy the compiler.
const STAYING_ROLE_OPTIONS: Record<InstitutionType, StayingRole[]> = {
  school: ["class_teacher", "sna"],
  clinic: ["clinician", "clinical_lead", "clinic_admin"],
  respite_centre: [],
};

export function HandOverPrincipalSheet({
  isOpen,
  onClose,
  institutionId,
  institutionType,
  eligibleSuccessors,
  onHandedOver,
}: HandOverPrincipalSheetProps) {
  const [mode, setMode] = useState<"form" | "confirm">("form");
  const [successorId, setSuccessorId] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("leaving");
  const [stayingRole, setStayingRole] = useState<StayingRole>(STAYING_ROLE_OPTIONS[institutionType][0]);
  const [reason, setReason] = useState("");
  const orgWord = institutionType === "clinic" ? "clinic" : "school";
  const principalLabel = getRoleLabel("principal", institutionType);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setMode("form");
    setSuccessorId("");
    setOutcome("leaving");
    setStayingRole(STAYING_ROLE_OPTIONS[institutionType][0]);
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  const successorName = eligibleSuccessors.find((s) => s.userId === successorId)?.fullName ?? "";
  const canProceedToConfirm = Boolean(successorId) && reason.trim().length > 0;

  async function handleConfirm() {
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hand_over_principal", {
      p_institution_id: institutionId,
      p_successor_user_id: successorId,
      p_outcome: outcome,
      p_staying_role: outcome === "staying" ? stayingRole : null,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    const finishedOutcome = outcome;
    const finishedStayingRole = outcome === "staying" ? stayingRole : null;
    reset();
    onHandedOver(finishedOutcome, finishedStayingRole);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      {mode === "form" ? (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Hand Over {principalLabel} Role</h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            Choose an existing member of staff to become {principalLabel.toLowerCase()}. They must already be active
            at this {orgWord}.
          </p>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Successor</label>
            {eligibleSuccessors.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
                No other active staff at this {orgWord} yet -- someone must join and be approved before you can hand
                over.
              </p>
            ) : (
              <select
                value={successorId}
                onChange={(e) => setSuccessorId(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
              >
                <option value="">Select a staff member…</option>
                {eligibleSuccessors.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">What happens to you</label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setOutcome("leaving")}
                className={`rounded-xl border p-3 text-left text-sm ${
                  outcome === "leaving" ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/10"
                }`}
              >
                <span className="font-semibold text-brand-neutral-black">Leaving the {orgWord}</span>
                <span className="mt-0.5 block text-brand-neutral-black/60">
                  Your membership ends. You lose access to this {orgWord} entirely.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setOutcome("staying")}
                className={`rounded-xl border p-3 text-left text-sm ${
                  outcome === "staying" ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/10"
                }`}
              >
                <span className="font-semibold text-brand-neutral-black">Staying in another role</span>
                <span className="mt-0.5 block text-brand-neutral-black/60">
                  You keep the {institutionType === "clinic" ? "clients" : "children"} you work with. No access is
                  removed.
                </span>
              </button>
            </div>
          </div>

          {outcome === "staying" && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Your new role</label>
              <div className="flex gap-2">
                {STAYING_ROLE_OPTIONS[institutionType].map((role) => (
                  <button
                    key={role}
                    type="button"
                    onClick={() => setStayingRole(role)}
                    className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold ${
                      stayingRole === role
                        ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue"
                        : "border-black/10 text-brand-neutral-black/60"
                    }`}
                  >
                    {getRoleLabel(role as Role, institutionType)}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <Textarea
              label="Reason"
              id="handover-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={institutionType === "clinic" ? "e.g. Stepping back from the clinic" : "e.g. Retiring at the end of term"}
            />
          </div>

          <Button type="button" onClick={() => setMode("confirm")} disabled={!canProceedToConfirm} className="mt-4">
            Continue
          </Button>
          <Button type="button" variant="secondary" onClick={close} className="mt-2 !border-black/10 !text-black/60">
            Cancel
          </Button>
        </>
      ) : (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Hand Over to {successorName}?</h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            You will no longer be the {principalLabel.toLowerCase()} of this {orgWord}. This cannot be undone from
            your account -- only the new {principalLabel.toLowerCase()} can hand the role back.
          </p>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
              {submitError}
            </p>
          )}

          <Button type="button" onClick={handleConfirm} disabled={isSubmitting} className="mt-4">
            {isSubmitting ? "Handing over…" : `Hand Over ${principalLabel} Role`}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (isSubmitting) return;
              setMode("form");
            }}
            disabled={isSubmitting}
            className="mt-2 !border-black/10 !text-black/60"
          >
            Back
          </Button>
        </>
      )}
    </BottomSheet>
  );
}
