"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";

// Migration 0168's own spec, verbatim: "Above 'Message about which
// student?' there should be a choice: about a student, or internal
// staff communication." Shared by teacher and principal -- both tracks
// have both kinds of message available. SNA doesn't use this at all
// (SNA-on-child-threads is deferred, so SNA's own compose flow goes
// straight to the staff sheet -- see /sna/messages).
export function ComposeKindPickerSheet({
  isOpen,
  onClose,
  studentLabel,
  onChooseStudent,
  onChooseStaff,
}: {
  isOpen: boolean;
  onClose: () => void;
  // "student" / "child" / "case" -- matches each track's own existing
  // wording for the picker one level down.
  studentLabel: string;
  onChooseStudent: () => void;
  onChooseStaff: () => void;
}) {
  return (
    <BottomSheet isOpen={isOpen} onClose={onClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">New message</h2>
      <div className="mt-4 flex flex-col gap-2">
        <button
          type="button"
          onClick={onChooseStudent}
          className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-left shadow-sm"
        >
          <span>
            <span className="block text-sm font-semibold text-brand-neutral-black">About a {studentLabel}</span>
            <span className="block text-xs text-brand-neutral-black/50">A specific child&apos;s passport</span>
          </span>
          <span className="text-lg text-brand-neutral-black/30">›</span>
        </button>
        <button
          type="button"
          onClick={onChooseStaff}
          className="flex items-center justify-between rounded-2xl border border-black/5 bg-white px-4 py-3.5 text-left shadow-sm"
        >
          <span>
            <span className="block text-sm font-semibold text-brand-neutral-black">Staff</span>
            <span className="block text-xs text-brand-neutral-black/50">Internal, not about a specific child</span>
          </span>
          <span className="text-lg text-brand-neutral-black/30">›</span>
        </button>
      </div>
    </BottomSheet>
  );
}
