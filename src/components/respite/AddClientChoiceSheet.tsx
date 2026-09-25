"use client";

import { BottomSheet } from "@/components/ui/BottomSheet";

// The centre_manager dashboard build, 25 Sept 2026 -- shared by
// /centre/dashboard's own "+ Add a client" quick action and /centre/
// children's identical primary action, so the two entry points open the
// same picker rather than each hand-rolling their own copy of it. Two
// real, distinct RPCs behind the two choices -- see OnboardRespiteClientSheet.tsx's
// own header for why onboarding a genuinely new client is real, not
// invented.
export function AddClientChoiceSheet({
  onClose,
  onPickRedeem,
  onPickOnboard,
}: {
  onClose: () => void;
  onPickRedeem: () => void;
  onPickOnboard: () => void;
}) {
  return (
    <BottomSheet isOpen onClose={onClose}>
      <div className="p-4">
        <h2 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">Add a client</h2>
        <p className="mb-4 text-sm text-brand-neutral-black/70">
          Do they already have a record from a clinic, or is this their first time on the system?
        </p>
        <button
          type="button"
          onClick={onPickRedeem}
          className="mb-2 block w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-sm"
        >
          <p className="font-semibold text-brand-neutral-black">Link an existing record</p>
          <p className="text-sm text-black/60">A family member has a code from a clinic.</p>
        </button>
        <button
          type="button"
          onClick={onPickOnboard}
          className="block w-full rounded-2xl border border-black/10 bg-white p-4 text-left shadow-sm"
        >
          <p className="font-semibold text-brand-neutral-black">Start a new record</p>
          <p className="text-sm text-black/60">Nothing exists for them here yet.</p>
        </button>
      </div>
    </BottomSheet>
  );
}
