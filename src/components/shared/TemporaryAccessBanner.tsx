"use client";

import { formatCutoffTime, getTemporaryAccessWindowStatus } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 3. The proactive half of the mid-session design: a
// persistent, low-key indicator wherever a temporary-access holder
// currently has standing, so the cut-off is never a surprise sprung
// mid-form. Two states, same component, not two components -- an
// ordinary day reads as information; the last 30 minutes before
// cut-off reads as a prompt (Golden Brown, this app's own established
// "attention, not alarm" colour -- never red, matching the zero-
// urgency rule the rest of this app already holds to). The reactive
// half (a specific, honest message when a write actually fails after
// cut-off) lives at each write path itself, not here -- see
// friendlyAccessLapsedMessage() in temporaryAccessTime.ts's sibling
// usage across the ABC logger and incident detail page.

interface TemporaryAccessBannerProps {
  className: string;
  cutoffTime: string;
}

export function TemporaryAccessBanner({ className, cutoffTime }: TemporaryAccessBannerProps) {
  const status = getTemporaryAccessWindowStatus(cutoffTime);
  if (!status.isActive) return null;

  const formattedCutoff = formatCutoffTime(cutoffTime);

  return (
    <div
      className={`mb-4 rounded-2xl border px-4 py-3 text-sm ${
        status.isLate
          ? "border-brand-golden-brown/40 bg-brand-golden-brown/10 text-brand-golden-brown"
          : "border-black/10 bg-white/60 text-brand-neutral-black/70"
      }`}
    >
      <p className="font-semibold">
        Covering {className} today until {formattedCutoff}
      </p>
      {status.isLate && (
        <p className="mt-0.5 text-xs">
          Your access ends soon -- anything unfinished cannot be completed afterwards.
        </p>
      )}
    </div>
  );
}
