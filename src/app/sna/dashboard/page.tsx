"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

// Phase 2 (onboarding) placeholder -- this is where an SNA lands
// immediately after joining their institution. Phase 3 replaces this
// whole component with the real SNA home: child cards, morning chip,
// [+ Add Child], and the 2-item (Passports/More) nav. Kept genuinely
// functional in the meantime (not a dead end or an error state) --
// getStaffDashboardDestination in join-institution/page.tsx already
// resumes an already-joined SNA straight back here.
export default function SnaDashboardPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("sna");
  const [isSigningOut, setIsSigningOut] = useState(false);

  async function handleSignOut() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/login");
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            You&apos;re all set
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 text-center shadow-sm">
          <p className="text-sm leading-relaxed text-black/60">
            Your SNA dashboard is being finished up. You&apos;ll be able to
            see the children you support, log incidents, and view their
            strategies here very soon.
          </p>

          <Button type="button" onClick={handleSignOut} disabled={isSigningOut} className="mt-6">
            {isSigningOut ? "Signing out…" : "Sign out"}
          </Button>
        </div>
      </div>
    </main>
  );
}
