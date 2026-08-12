"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { BottomNav } from "@/components/ui/BottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { ProgressSurface } from "@/components/progress/ProgressSurface";

// Parent entry point (A1): reached from the dashboard's quick-actions
// tile and the More page. Read-only page shell around the shared
// ProgressSurface engine -- this file's only job is resolving the
// signed-in parent's own passportId/child_name (via owns_passport's
// same auth.uid() = user_id rule every other parent-track page uses)
// and handing it to the surface; all chart/range/threshold logic lives
// in ProgressSurface + src/lib/progress, shared with the teacher and
// clinician tracks.
export default function ParentProgressPage() {
  const { user, isReady: isRoleReady } = useRequireRole("parent");
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase
        .from("passports")
        .select("id, child_name")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;
      if (error) {
        console.error("Failed to load passport for Progress:", error);
        setLoadError("Couldn't load your child's Progress page.");
        setIsLoading(false);
        return;
      }
      setPassportId(data?.id ?? null);
      setChildName(data?.child_name ?? null);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

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
          <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
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
