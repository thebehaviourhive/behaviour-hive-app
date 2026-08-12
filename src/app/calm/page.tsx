"use client";

import Link from "next/link";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useParentCalmAccess } from "@/hooks/useParentCalmAccess";
import { CalmFlow } from "@/components/parent/calm/CalmFlow";
import { getChildFirstName } from "@/lib/childDisplayName";

// Full-screen flow, deliberately no <BottomNav> -- same "wizard/
// questionnaire flows that hide the nav" convention this app already
// follows (ABCLogger, the passport section wizard), not a special case
// invented for Calm.
export default function CalmPage() {
  const { user, isReady } = useRequireRole("parent");
  const { passportId, cards, childName, isLoading } = useParentCalmAccess();

  if (!isReady || isLoading || !user) return null;

  // Direct navigation (or cards unpublished after the nav's own prefetch,
  // or genuinely no passport yet) with nothing live -- never render an
  // empty flow, send back to where the locked state's own upsell already
  // lives. Grouping !passportId into this same branch (rather than a
  // separate null-render guard above) is what keeps a passport-less
  // parent landing here from seeing a blank screen forever.
  if (cards.length === 0 || !passportId) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-6 text-center">
        <p className="text-base text-brand-neutral-black/70">The Calm button isn&apos;t unlocked yet.</p>
        <Link href="/parent-dashboard" className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2">
          Back to dashboard
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-dvh flex-col bg-brand-off-white/40 p-4">
      {/* flex-1 + min-h-0: gives CalmFlow's screens a real, resolved
          height to fill (h-dvh alone on the ancestor isn't enough --
          this single flex child still shrink-wraps to its own content
          unless it's told to grow, which is what left the door screen
          top-aligned instead of vertically centered). min-h-0 stops a
          tall card's content from pushing this taller than the
          viewport instead of scrolling within it. */}
      <div className="min-h-0 flex-1">
        <CalmFlow passportId={passportId} userId={user.id} cards={cards} childName={getChildFirstName(childName)} />
      </div>
    </div>
  );
}
