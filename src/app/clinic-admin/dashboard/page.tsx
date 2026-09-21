"use client";

import { BrandMark } from "@/components/ui/BrandMark";
import { useRequireRole } from "@/hooks/useRequireRole";

// A real, honest landing page, not a redirect loop. Same reasoning as
// clinical-lead/dashboard/page.tsx's own header -- see that file.
// getPostAuthRedirect() had no case for 'clinic_admin' either, and this
// role has no client surface of its own anywhere in the app yet.
export default function ClinicAdminDashboardPage() {
  const { isReady } = useRequireRole("clinic_admin");

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
            Your account is set up as Admin for this clinic. This dashboard isn&apos;t built yet -- we&apos;ll
            be in touch when it is.
          </p>
        </div>
      </div>
    </main>
  );
}
