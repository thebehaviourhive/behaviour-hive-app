"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 2, Step 3. Principal-only picker over add_class_teacher()
// -- the RPC itself is the real authority (class_teacher role only,
// position cap of 3), this is just a convenience list over people who
// would plausibly pass it. Candidates are pre-filtered by the parent
// page to active, approved class_teacher staff not already teaching
// this class.

interface EligibleTeacher {
  userId: string;
  fullName: string;
}

interface AddClassTeacherSheetProps {
  isOpen: boolean;
  classId: string;
  className: string;
  eligibleTeachers: EligibleTeacher[];
  slotsRemaining: number;
  onClose: () => void;
  onAdded: () => void;
}

export function AddClassTeacherSheet({
  isOpen,
  classId,
  className,
  eligibleTeachers,
  slotsRemaining,
  onClose,
  onAdded,
}: AddClassTeacherSheetProps) {
  const [teacherId, setTeacherId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setTeacherId("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleAdd() {
    if (!teacherId) {
      setSubmitError("Choose a teacher.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("add_class_teacher", {
      p_class_id: classId,
      p_user_id: teacherId,
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
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Add a Teacher to {className}</h2>

      {slotsRemaining <= 0 ? (
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          This class already has three teachers -- remove one before adding another.
        </p>
      ) : (
        <>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            Up to three teachers can teach a class, all with equal standing. {slotsRemaining} slot
            {slotsRemaining === 1 ? "" : "s"} left.
          </p>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Teacher</label>
            {eligibleTeachers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
                No other active class teachers at this school to add.
              </p>
            ) : (
              <select
                value={teacherId}
                onChange={(e) => setTeacherId(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
              >
                <option value="">Select a teacher…</option>
                {eligibleTeachers.map((t) => (
                  <option key={t.userId} value={t.userId}>
                    {t.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>
        </>
      )}

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      {slotsRemaining > 0 && (
        <Button type="button" onClick={handleAdd} disabled={isSubmitting || eligibleTeachers.length === 0} className="mt-4">
          {isSubmitting ? "Adding…" : "Add Teacher"}
        </Button>
      )}
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        {slotsRemaining <= 0 ? "Close" : "Cancel"}
      </Button>
    </BottomSheet>
  );
}
