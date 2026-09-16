"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

interface BottomSheetProps {
  isOpen: boolean;
  onClose: () => void;
  children: ReactNode;
}

// Below lg: a bottom-anchored sheet, unchanged -- the right idiom on a
// phone. At lg+: a centred modal, not a sheet stuck to the bottom edge
// of an otherwise-empty screen. The three dismissal paths -- backdrop
// click (existing), Escape (new, was missing entirely at every width
// before this), and the X (new, lg+ only, top-left) -- all call the
// SAME `onClose` prop, so any caller-side guard against closing mid-
// submit (e.g. School's own `onClose={() => !isSigningOut && ...}`)
// is automatically respected by all three, not just the backdrop.
export function BottomSheet({ isOpen, onClose, children }: BottomSheetProps) {
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = "";
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-4">
      <button
        type="button"
        aria-label="Close"
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
      />
      <div className="relative z-10 max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-t-3xl bg-white p-6 shadow-lg lg:max-w-lg lg:rounded-3xl lg:px-8 lg:pb-8 lg:pt-12">
        <div className="mx-auto mb-4 h-1.5 w-12 rounded-full bg-black/10 lg:hidden" />
        <button
          type="button"
          aria-label="Close"
          onClick={onClose}
          className="absolute left-4 top-4 hidden h-8 w-8 items-center justify-center rounded-full text-brand-neutral-black/40 transition-colors hover:bg-black/5 hover:text-brand-neutral-black/70 lg:flex"
        >
          <X size={18} strokeWidth={2} aria-hidden />
        </button>
        {children}
      </div>
    </div>
  );
}
