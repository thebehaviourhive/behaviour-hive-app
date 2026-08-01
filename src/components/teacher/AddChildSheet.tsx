"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";

export function AddChildSheet({
  isOpen,
  onClose,
}: {
  isOpen: boolean;
  onClose: () => void;
}) {
  const [accessCode, setAccessCode] = useState("");
  const [showPlaceholderMessage, setShowPlaceholderMessage] = useState(false);

  function handleClose() {
    setAccessCode("");
    setShowPlaceholderMessage(false);
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Add a Child
      </h2>
      <p className="mt-1 text-sm text-black/60">
        Enter the access code shared by the child&apos;s parent to view their
        passport.
      </p>

      <label className="mt-5 block text-sm font-semibold text-brand-neutral-black">
        Enter access code
      </label>
      <input
        type="text"
        value={accessCode}
        onChange={(e) => setAccessCode(e.target.value)}
        placeholder="e.g. 7F3K9Q"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {showPlaceholderMessage && (
        <p className="mt-3 rounded-xl bg-brand-pastel-blue/20 px-4 py-3 text-sm text-brand-neutral-black">
          Access code authentication coming soon. This will link the
          child&apos;s passport to your dashboard.
        </p>
      )}

      <button
        type="button"
        onClick={() => setShowPlaceholderMessage(true)}
        disabled={!accessCode.trim()}
        className="mt-5 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        Confirm
      </button>
    </BottomSheet>
  );
}
