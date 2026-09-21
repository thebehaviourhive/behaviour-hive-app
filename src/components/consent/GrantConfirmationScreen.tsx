"use client";

import { useState } from "react";
import { ConsentEmphasis, ConsentTick } from "@/components/consent/ConsentScreenShell";

// PRD 10 Stage 6, item 6.2 -- "this is a consent screen, and it
// deserves the care the consent work got... follow the consent screen
// design -- the medtech-sharp one... not the warm parent-track style,
// because this is a decision rather than a view." Section 7 flags this
// one for Daniel to see before it is wired in.
//
// Deliberately NOT a literal reuse of ConsentScreenShell -- that shell
// hardcodes a single "Continue" action and the onboarding-specific
// "Before you start" eyebrow, built for the five role-agreement
// screens' own shape (several ticks, one path forward). This is a
// genuine two-outcome decision (confirm or decline, either a real,
// final answer) with an optional reason on decline -- a different
// interaction shape wearing the identical visual vocabulary: same
// type scale, same colours, same ConsentTick/ConsentEmphasis
// primitives, imported directly rather than redefined, so neither can
// drift from the other.
//
// STOPPED BEFORE WIRING, per instruction -- onConfirm/onDecline are
// real props with a real signature, but this screen's own caller
// currently passes no-ops. Everything else is real: real grant data,
// real school name, real document list, a real working tick gating
// the buttons.

export interface GrantConfirmationScreenProps {
  clinicName: string;
  schoolName: string;
  childName: string;
  scopeItems: string[]; // 'fba_report' | 'bsp'
  onConfirm: () => Promise<{ error: string | null }>;
  onDecline: (reason: string) => Promise<{ error: string | null }>;
  onConfirmed: () => void;
  onDeclined: () => void;
}

const SCOPE_LABELS: Record<string, string> = {
  fba_report: "their Functional Behaviour Assessment (FBA)",
  bsp: "their Behaviour Support Plan (BSP)",
};

function describeScope(scopeItems: string[]): string {
  const labels = scopeItems.map((s) => SCOPE_LABELS[s] ?? s);
  if (labels.length === 1) return labels[0];
  if (labels.length === 2) return `${labels[0]} and ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")}, and ${labels[labels.length - 1]}`;
}

export function GrantConfirmationScreen({
  clinicName,
  schoolName,
  childName,
  scopeItems,
  onConfirm,
  onDecline,
  onConfirmed,
  onDeclined,
}: GrantConfirmationScreenProps) {
  const [hasRead, setHasRead] = useState(false);
  const [isDeclining, setIsDeclining] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConfirm() {
    setIsSubmitting(true);
    setError(null);
    const { error: confirmError } = await onConfirm();
    setIsSubmitting(false);
    if (confirmError) {
      setError(confirmError);
      return;
    }
    onConfirmed();
  }

  async function handleDecline() {
    setIsSubmitting(true);
    setError(null);
    const { error: declineError } = await onDecline(declineReason);
    setIsSubmitting(false);
    if (declineError) {
      setError(declineError);
      return;
    }
    onDeclined();
  }

  return (
    <main className="flex min-h-full flex-1 justify-center bg-white px-6 py-5 font-consent">
      <div className="w-full max-w-[520px]">
        <p className="text-center text-[10px] font-semibold uppercase tracking-[0.2em] text-[#A3A3A3]">Behaviour Passport</p>

        <div className="mt-8">
          <h1 className="text-[11px] font-semibold uppercase tracking-[0.16em] text-brand-prussian-blue">Sharing decision</h1>

          <div className="mt-2 h-px bg-brand-pastel-blue" />

          <div className="mt-4 flex flex-col gap-4">
            <p className="text-[17px] leading-[1.5] text-[#1A1A1A]">
              {clinicName} would like to share {describeScope(scopeItems)} for {childName} with {schoolName}.
            </p>
            <p className="text-[14px] leading-[1.6] text-[#5A5A5A]">
              This includes what {clinicName} has already written, not only what they write from now on. If a new version
              is signed later, {schoolName} will see that too, for as long as this stays confirmed.
            </p>
            <p className="text-[14px] leading-[1.6] text-[#5A5A5A]">
              <ConsentEmphasis>{schoolName} will be able to read this the moment you confirm.</ConsentEmphasis>
            </p>
            <p className="text-[14px] leading-[1.6] text-[#5A5A5A]">
              You can withdraw this at any time, from this same place — it takes effect immediately, and {schoolName} loses
              access the moment you do.
            </p>
          </div>
        </div>

        <div className="mt-8">
          <div className="h-px bg-brand-pastel-blue" />
          <div className="mt-4 flex flex-col gap-4">
            <ConsentTick id="grant-confirm-read" checked={hasRead} onChange={setHasRead}>
              I understand what is being shared, with whom, and that I can withdraw this at any time.
            </ConsentTick>
          </div>
        </div>

        {error && (
          <p role="alert" className="mt-4 text-[13px] font-medium text-red-600">
            {error}
          </p>
        )}

        {!isDeclining ? (
          <div className="mt-6 flex flex-col items-center gap-3">
            <button
              type="button"
              onClick={handleConfirm}
              disabled={!hasRead || isSubmitting}
              className={`inline-flex items-center justify-center rounded-full px-8 py-3 text-[15px] font-medium transition-colors disabled:cursor-not-allowed ${
                !hasRead || isSubmitting
                  ? "border border-[#D4D4D4] bg-white text-[#A3A3A3]"
                  : "border border-brand-prussian-blue bg-brand-prussian-blue text-white"
              }`}
            >
              {isSubmitting ? "Saving…" : "Confirm sharing"}
            </button>
            <button
              type="button"
              onClick={() => setIsDeclining(true)}
              disabled={isSubmitting}
              className="text-[13px] font-medium text-[#5A5A5A] underline-offset-2 hover:underline disabled:cursor-not-allowed"
            >
              Decline
            </button>
          </div>
        ) : (
          <div className="mt-6 flex flex-col gap-3">
            <label className="text-[13px] font-medium text-[#1A1A1A]" htmlFor="grant-decline-reason">
              Reason (optional)
            </label>
            <textarea
              id="grant-decline-reason"
              value={declineReason}
              onChange={(e) => setDeclineReason(e.target.value)}
              rows={3}
              className="rounded-md border border-[#D4D4D4] px-3 py-2 text-[14px] text-[#1A1A1A] focus:border-brand-prussian-blue focus:outline-none"
            />
            <div className="flex justify-center gap-3">
              <button
                type="button"
                onClick={handleDecline}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-full border border-brand-prussian-blue bg-brand-prussian-blue px-8 py-3 text-[15px] font-medium text-white transition-colors disabled:cursor-not-allowed"
              >
                {isSubmitting ? "Saving…" : "Confirm decline"}
              </button>
              <button
                type="button"
                onClick={() => setIsDeclining(false)}
                disabled={isSubmitting}
                className="inline-flex items-center justify-center rounded-full border border-[#D4D4D4] bg-white px-8 py-3 text-[15px] font-medium text-[#5A5A5A] transition-colors disabled:cursor-not-allowed"
              >
                Back
              </button>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
