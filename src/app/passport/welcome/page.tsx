"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";

// Stage 2, 15 Sept 2026: self-creation retired. This used to be a real
// choice screen -- "Next" into the self-created wizard (/passport/
// section-a with no existing passport), or "Enter your code"
// (/passport/claim) as a parallel entry point. Every orphan-passport
// bug this build has hit traced back to that first path being live
// (the 134-row cleanup, the CHECK NN/OO fixture leak, a real create-
// instead-of-claim mistake during this very QA pass) -- retiring it
// removes the bug class, not just a screen.
//
// This route is kept, not deleted -- eight other files still link here
// as "the entry point when there's no passport yet" (parent-dashboard,
// passport/progress, ClinicalSupportSection, CalmUnlockSheet,
// getPassportResumeHref's own former default, etc.), and repointing
// all eight carried more risk than this one thin redirect. The only
// thing this page does now is the same "already have one? go straight
// to it" check it always had, then hand off to /passport/claim -- the
// prompt already built and tested (PRD 1, Stage 5, Step 3, Requirement
// 4) -- rather than duplicating that UI here.
export default function PassportWelcomePage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");
  const { passportId: existingPassportId, isLoading: isCheckingExisting } = useMyPassport(user?.id);

  useEffect(() => {
    if (!isReady || isCheckingExisting) return;
    router.replace(existingPassportId ? "/passport/dashboard" : "/passport/claim");
  }, [isReady, isCheckingExisting, existingPassportId, router]);

  return null;
}
