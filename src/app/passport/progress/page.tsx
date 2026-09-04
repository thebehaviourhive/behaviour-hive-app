"use client";

import Link from "next/link";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { BottomNav } from "@/components/ui/BottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ProgressSurface } from "@/components/progress/ProgressSurface";

// Parent entry point (A1): reached from the dashboard's quick-actions
// tile and the More page. Read-only page shell around the shared
// ProgressSurface engine -- this file's only job is resolving the
// signed-in parent's own passportId/child_name (via get_my_passports(),
// which sees a claimed passport correctly -- see useMyPassport) and
// handing it to the surface; all chart/range/threshold logic lives
// in ProgressSurface + src/lib/progress, shared with the teacher and
// clinician tracks.
export default function ParentProgressPage() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const { passportId, childName, isLoading, error, refresh } = useMyPassport(user?.id);
  const loadError = error ? "Couldn't load your child's Progress page." : null;

  if (!isRoleReady || isLoading) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-2">
        <Link
          href="/parent-dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
      </header>

      <main className="flex-1 px-4 py-2">
        {loadError ? (
          <InlineErrorState message={loadError} onRetry={() => refresh()} />
        ) : !passportId ? (
          <div className="flex flex-col items-center gap-3 py-12 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              Build {childName ?? "your child"}&apos;s passport first to start tracking progress.
            </p>
            <Link
              href="/passport/welcome"
              className="text-sm font-semibold text-brand-prussian-blue underline underline-offset-2"
            >
              Get started
            </Link>
          </div>
        ) : (
          <ProgressSurface passportId={passportId} childFullName={childName} role="parent" />
        )}
      </main>

      <BottomNav passportHref="/passport/dashboard" />
    </div>
  );
}
