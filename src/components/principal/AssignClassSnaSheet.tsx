"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 2, Stage 5. Principal-only picker over assign_class_sna() --
// mirrors AddClassTeacherSheet's own shape (a single-select picker
// over a pre-filtered candidate list, the RPC is the real authority),
// with two differences that match the underlying data model rather
// than copying it blindly: no slot cap (class_sna_assignments has
// none -- Daniel's own spec caps teachers at three and names nothing
// for SNAs), and candidates aren't filtered to exclude anyone already
// a class SNA here the way AddClassTeacherSheet's list excludes
// current teachers -- the parent page does that filtering the same
// way, this sheet just renders whatever list it's given.
//
// Deliberately its own sheet, not a mode grafted onto the shared,
// do-not-fork AssignSnaSheet.tsx (1:1 assignment, shared with the
// teacher track) -- Class SNA is a class-level relationship with no
// teacher-track equivalent at all, so there's nothing to share.

interface EligibleSna {
  userId: string;
  fullName: string;
}

interface AssignClassSnaSheetProps {
  isOpen: boolean;
  classId: string;
  className: string;
  eligibleSnas: EligibleSna[];
  onClose: () => void;
  onAssigned: () => void;
}

export function AssignClassSnaSheet({
  isOpen,
  classId,
  className,
  eligibleSnas,
  onClose,
  onAssigned,
}: AssignClassSnaSheetProps) {
  const [snaId, setSnaId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setSnaId("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleAssign() {
    if (!snaId) {
      setSubmitError("Choose an SNA.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("assign_class_sna", {
      p_class_id: classId,
      p_user_id: snaId,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onAssigned();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Assign a Class SNA to {className}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        A class SNA sees everything for every child in {className} -- not just roster-level information, the same
        standing a class teacher has. This is a standing assignment, not day-scoped cover.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">SNA</label>
        {eligibleSnas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
            No other active SNAs at this school to assign.
          </p>
        ) : (
          <select
            value={snaId}
            onChange={(e) => setSnaId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
          >
            <option value="">Select an SNA…</option>
            {eligibleSnas.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleAssign} disabled={isSubmitting || eligibleSnas.length === 0} className="mt-4">
        {isSubmitting ? "Assigning…" : "Assign Class SNA"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
