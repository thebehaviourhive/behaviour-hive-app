"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { RoleLabel } from "@/components/ui/RoleLabel";
import type { InstitutionType } from "@/lib/institutionType";
import type { VocabularyOverrides } from "@/lib/vocabulary";

// Staff Lifecycle Stage 1b, Step 3. Same shape as DeactivateStaffSheet --
// a name, a decision, a reason where one's required -- but this one has
// two possible outcomes instead of one, so "which action is live" is its
// own bit of state rather than a single confirm button. No preview RPC
// here unlike deactivation: a pending person has nothing behind them yet
// (no grants, no incidents) for a principal to be warned about.
//
// Reused unmodified on /centre/dashboard, PRD 11 Stage 2 -- this
// component was already institutionType-agnostic in its own plumbing
// (takes the prop, doesn't assume), it just had two hand-written
// institutionType ternaries with only two branches. Fixed as part of
// making it genuinely reachable by a third type, per the fail-closed
// sweep -- a centre manager approving someone was about to see
// "immediate access to this school", the exact silent-wrong-landing
// shape Stage 1 recon named.
const INSTITUTION_NOUN: Record<InstitutionType, string> = {
  school: "this school",
  clinic: "your clinic",
  respite_centre: "your centre",
};

const REJECTION_REASON_PLACEHOLDER: Record<InstitutionType, string> = {
  school: "e.g. Couldn't confirm they work at this school",
  clinic: "e.g. Couldn't confirm they work at this clinic",
  respite_centre: "e.g. Couldn't confirm they work at this centre",
};

interface PendingStaffMember {
  id: string;
  full_name: string;
  role: string;
}

interface ReviewStaffJoinSheetProps {
  member: PendingStaffMember;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
  institutionType: InstitutionType;
  overrides: VocabularyOverrides;
}

export function ReviewStaffJoinSheet({
  member,
  isOpen,
  onClose,
  onResolved,
  institutionType,
  overrides,
}: ReviewStaffJoinSheetProps) {
  const [mode, setMode] = useState<"choose" | "reject">("choose");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setMode("choose");
    setReason("");
    setSubmitError(null);
  }

  async function handleApprove() {
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("approve_staff_join", { p_institution_staff_id: member.id });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onResolved();
  }

  async function handleReject() {
    if (!reason.trim()) {
      setSubmitError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("reject_staff_join", {
      p_institution_staff_id: member.id,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onResolved();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (isSubmitting) return;
        reset();
        onClose();
      }}
    >
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">{member.full_name}</h2>
      <p className="mt-1 text-sm text-brand-neutral-black/60">
        Requesting to join as <RoleLabel role={member.role} institutionType={institutionType} overrides={overrides} />.
      </p>

      {mode === "choose" ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-brand-neutral-black/70">
            Approving gives them immediate access to {INSTITUTION_NOUN[institutionType]}.
            Rejecting keeps them out -- they can request again later, and this decision stays on record either way.
          </p>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
              {submitError}
            </p>
          )}

          <Button type="button" onClick={handleApprove} disabled={isSubmitting} className="mt-4">
            {isSubmitting ? "Approving…" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSubmitError(null);
              setMode("reject");
            }}
            disabled={isSubmitting}
            className="mt-2 !border-brand-golden-brown !text-brand-golden-brown"
          >
            Reject
          </Button>
        </>
      ) : (
        <>
          <div className="mt-4">
            <Textarea
              label="Reason"
              id="rejection-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={REJECTION_REASON_PLACEHOLDER[institutionType]}
            />
          </div>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
              {submitError}
            </p>
          )}

          {/* Destructive, not "needs attention" -- see
              ReasonConfirmSheet's own comment on this exact pattern. */}
          <Button type="button" onClick={handleReject} disabled={isSubmitting} className="mt-4">
            {isSubmitting ? "Rejecting…" : "Confirm Rejection"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setSubmitError(null);
              setMode("choose");
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
