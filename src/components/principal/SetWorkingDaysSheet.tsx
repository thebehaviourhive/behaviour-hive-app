"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Bug 2, 22 Sept 2026 -- clinic hours were a start/end time with no
// working-days concept at all, so a parent was offered Saturday and
// Sunday sessions alongside every weekday one. Mirrors SetClinicHoursSheet's
// own shape exactly: one BottomSheet, one RPC call, the same save/
// cancel button pair.
//
// Date.getDay() convention (0=Sunday..6=Saturday), matching
// institutions.working_days and computeAvailableSlots() -- both
// produced and consumed in TypeScript, no conversion needed anywhere.

const DAYS: { value: number; label: string }[] = [
  { value: 1, label: "Mon" },
  { value: 2, label: "Tue" },
  { value: 3, label: "Wed" },
  { value: 4, label: "Thu" },
  { value: 5, label: "Fri" },
  { value: 6, label: "Sat" },
  { value: 0, label: "Sun" },
];

interface SetWorkingDaysSheetProps {
  isOpen: boolean;
  institutionId: string;
  currentWorkingDays: number[];
  onClose: () => void;
  onSaved: (newWorkingDays: number[]) => void;
}

export function SetWorkingDaysSheet({
  isOpen,
  institutionId,
  currentWorkingDays,
  onClose,
  onSaved,
}: SetWorkingDaysSheetProps) {
  const [selected, setSelected] = useState<Set<number>>(new Set(currentWorkingDays));
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    setSelected(new Set(currentWorkingDays));
    onClose();
  }

  function toggleDay(value: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) next.delete(value);
      else next.add(value);
      return next;
    });
  }

  async function handleSave() {
    if (selected.size === 0) {
      setSubmitError("At least one working day is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const workingDays = Array.from(selected).sort((a, b) => a - b);
    const { error } = await supabase.rpc("set_clinic_working_days", {
      p_institution_id: institutionId,
      p_working_days: workingDays,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(workingDays);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Working Days</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Parents will only ever be offered a booking slot on a day selected here.
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        {DAYS.map((day) => {
          const isSelected = selected.has(day.value);
          return (
            <button
              key={day.value}
              type="button"
              onClick={() => toggleDay(day.value)}
              aria-pressed={isSelected}
              className={`min-h-11 min-w-11 rounded-xl border px-4 py-2.5 text-sm font-semibold transition-colors ${
                isSelected
                  ? "border-brand-prussian-blue bg-brand-pastel-blue/40 text-brand-prussian-blue"
                  : "border-black/10 bg-white text-brand-neutral-black/60"
              }`}
            >
              {day.label}
            </button>
          );
        })}
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
