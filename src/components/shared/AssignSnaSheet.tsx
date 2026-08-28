"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 2, Step 3. Shared between the principal's class-detail
// page (any child at the school) and the class teacher's own class page
// (their own class's children only) -- the UI doesn't decide who's
// allowed to do this, assign_sna_to_child()/end_child_assignment() do,
// server-side (principal, or the child's own current class teacher).
// One component, two callers, per the same "one implementation" rule
// the rest of this stage was built to.
//
// Reassignment is two RPC calls, not one: assign_sna_to_child() refuses
// a second concurrent SNA by design (the one-active-assignment-per-child
// cap), so swapping requires ending the current assignment first, then
// assigning the new one. If the first call succeeds and the second
// fails, the child is left with NO assigned SNA rather than silently
// still holding the old one -- surfaced honestly in the error rather
// than papered over, since there is no single atomic RPC for this yet.

interface EligibleSna {
  userId: string;
  fullName: string;
}

interface CurrentAssignment {
  id: string;
  snaUserId: string;
  snaName: string;
}

interface AssignSnaSheetProps {
  isOpen: boolean;
  passportId: string;
  institutionId: string;
  childName: string;
  currentAssignment: CurrentAssignment | null;
  eligibleSnas: EligibleSna[];
  onClose: () => void;
  onChanged: () => void;
}

export function AssignSnaSheet({
  isOpen,
  passportId,
  institutionId,
  childName,
  currentAssignment,
  eligibleSnas,
  onClose,
  onChanged,
}: AssignSnaSheetProps) {
  const [snaId, setSnaId] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const isReassigning = Boolean(currentAssignment);

  function reset() {
    setSnaId("");
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!snaId) {
      setSubmitError("Choose an SNA.");
      return;
    }
    if (isReassigning && !reason.trim()) {
      setSubmitError("A reason is required to end the current assignment.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();

    if (currentAssignment) {
      const { error: endError } = await supabase.rpc("end_child_assignment", {
        p_child_assignment_id: currentAssignment.id,
        p_reason: reason.trim(),
      });
      if (endError) {
        setIsSubmitting(false);
        setSubmitError(endError.message);
        return;
      }
    }

    const { error: assignError } = await supabase.rpc("assign_sna_to_child", {
      p_passport_id: passportId,
      p_user_id: snaId,
      p_institution_id: institutionId,
    });
    setIsSubmitting(false);
    if (assignError) {
      setSubmitError(
        currentAssignment
          ? `${currentAssignment.snaName}'s assignment ended, but the new assignment failed: ${assignError.message}. ${childName} currently has no assigned SNA.`
          : assignError.message
      );
      return;
    }
    reset();
    onChanged();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        {isReassigning ? `Reassign ${childName}'s SNA` : `Assign an SNA to ${childName}`}
      </h2>

      {currentAssignment && (
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          Currently assigned to <span className="font-semibold">{currentAssignment.snaName}</span>. Choosing someone
          new ends that assignment first.
        </p>
      )}

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">SNA</label>
        {eligibleSnas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
            No active SNAs at this school to assign.
          </p>
        ) : (
          <select
            value={snaId}
            onChange={(e) => setSnaId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
          >
            <option value="">Select an SNA…</option>
            {eligibleSnas
              .filter((s) => s.userId !== currentAssignment?.snaUserId)
              .map((s) => (
                <option key={s.userId} value={s.userId}>
                  {s.fullName}
                </option>
              ))}
          </select>
        )}
      </div>

      {isReassigning && (
        <div className="mt-4">
          <Textarea
            label="Reason for ending the current assignment"
            id="assign-sna-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="e.g. SNA reallocated"
          />
        </div>
      )}

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSubmit} disabled={isSubmitting || eligibleSnas.length === 0} className="mt-4">
        {isSubmitting ? "Saving…" : isReassigning ? "Reassign" : "Assign"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
