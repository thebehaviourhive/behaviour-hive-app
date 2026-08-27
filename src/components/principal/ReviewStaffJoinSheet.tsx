"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Staff Lifecycle Stage 1b, Step 3. Same shape as DeactivateStaffSheet --
// a name, a decision, a reason where one's required -- but this one has
// two possible outcomes instead of one, so "which action is live" is its
// own bit of state rather than a single confirm button. No preview RPC
// here unlike deactivation: a pending person has nothing behind them yet
// (no grants, no incidents) for a principal to be warned about.

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
}

const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Class Teacher",
  sna: "SNA",
  principal: "Principal",
  institution_admin: "Institution Admin",
};

export function ReviewStaffJoinSheet({ member, isOpen, onClose, onResolved }: ReviewStaffJoinSheetProps) {
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
        Requesting to join as {ROLE_LABEL[member.role] ?? member.role}.
      </p>

      {mode === "choose" ? (
        <>
          <p className="mt-4 text-sm leading-relaxed text-brand-neutral-black/70">
            Approving gives them immediate access to this school. Rejecting keeps them out -- they can request again
            later, and this decision stays on record either way.
          </p>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
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
              placeholder="e.g. Couldn't confirm they work at this school"
            />
          </div>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {submitError}
            </p>
          )}

          <Button
            type="button"
            onClick={handleReject}
            disabled={isSubmitting}
            className="mt-4 !bg-brand-golden-brown"
          >
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
