"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 2, Step 3. Principal-only picker over add_class_child()
// -- child roster edits are principal-only (rare, consequential, changes
// who can see a child's full record -- a different frequency and stakes
// than SNA assignment, per the fourth Step 0 answer). Candidates come
// from get_institution_child_roster() (0074), the SAME roster RPC the
// incident log already uses -- not a new or parallel roster lookup.
//
// PRD 2, Stage 5: the parent page now builds eligibleChildren from that
// roster's own current_class_id column (0129), filtered to null --
// genuinely enrolled-but-unassigned only, not "any child not already in
// THIS class" (which used to silently offer a move from another class).
// add_class_child() itself still supports moving a child between
// classes -- that capability isn't removed at the RPC layer -- but this
// picker no longer offers it as a side effect of adding someone,
// matching "Assign child to class" as its own deliberate action.

interface EligibleChild {
  passportId: string;
  childName: string;
}

interface AddClassChildSheetProps {
  isOpen: boolean;
  classId: string;
  className: string;
  eligibleChildren: EligibleChild[];
  onClose: () => void;
  onAdded: () => void;
}

export function AddClassChildSheet({ isOpen, classId, className, eligibleChildren, onClose, onAdded }: AddClassChildSheetProps) {
  const [passportId, setPassportId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setPassportId("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleAdd() {
    if (!passportId) {
      setSubmitError("Choose a child.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("add_class_child", {
      p_class_id: classId,
      p_passport_id: passportId,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onAdded();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Assign a Child to {className}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Shows children enrolled at your school who aren&apos;t currently in any class.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Child</label>
        {eligibleChildren.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
            No enrolled children are currently unassigned.
          </p>
        ) : (
          <select
            value={passportId}
            onChange={(e) => setPassportId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
          >
            <option value="">Select a child…</option>
            {eligibleChildren.map((c) => (
              <option key={c.passportId} value={c.passportId}>
                {c.childName}
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

      <Button type="button" onClick={handleAdd} disabled={isSubmitting || eligibleChildren.length === 0} className="mt-4">
        {isSubmitting ? "Assigning…" : "Assign to Class"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
