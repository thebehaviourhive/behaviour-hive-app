"use client";

import { BrandMark } from "@/components/ui/BrandMark";
import { useRequireRole } from "@/hooks/useRequireRole";

// A real, honest landing page, not a redirect loop. Built 21 Sept 2026
// alongside the clinic role picker fix -- before this, getPostAuthRedirect()
// had no case for 'clinical_lead' and sent a genuinely joined, consented
// clinical lead straight back to /role-select, indistinguishable from
// someone who had never signed up at all (see CLAUDE.md's own dedicated
// entry on this finding). This page closes that loop; it does not build
// the lead's own real dashboard -- that stays Daniel's own deliberately
// deferred call (CLAUDE.md: "THE clinical_lead ROLE HAS NO CLIENT
// SURFACE ANYWHERE"), same reasoning, just no longer landing on a screen
// that reads as "you haven't joined."
export default function ClinicalLeadDashboardPage() {
  const { isReady } = useRequireRole("clinical_lead");

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm text-center">
        <div className="mb-6 flex flex-col items-center gap-3">
          <BrandMark />
        </div>
        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <h1 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">
            You&apos;re in
          </h1>
          <p className="text-sm leading-relaxed text-black/60">
            Your account is set up as a Clinical Lead. This dashboard isn&apos;t built yet -- we&apos;ll
            be in touch when it is.
          </p>
        </div>
      </div>
    </main>
  );
}
