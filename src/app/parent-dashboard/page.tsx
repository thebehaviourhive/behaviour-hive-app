"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";

interface PassportSummary {
  childName: string;
  age: number;
  diagnosis: string;
  completionPercent: number;
}

export default function ParentDashboardPage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [firstName, setFirstName] = useState("there");

  // No passport creation flow exists yet, so there is nowhere to fetch a
  // real passport from — this always reflects the "not started" state
  // until that flow and its data source are built.
  const [passport] = useState<PassportSummary | null>(null);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const role = user.user_metadata?.role;
      if (role !== "parent") {
        router.replace(getPostAuthRedirect(role));
        return;
      }

      const fullName = user.user_metadata?.full_name as string | undefined;
      if (fullName) {
        setFirstName(fullName.split(" ")[0]);
      }

      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          Good morning, {firstName}
        </h1>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-4">
        {passport ? (
          <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-safe-ivory/60 text-lg"
              >
                ☀️
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-brand-neutral-black">
                  How was {passport.childName}&apos;s morning?
                </p>
                <p className="text-xs text-black/50">15 seconds</p>
              </div>
              <button
                type="button"
                className="rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
              >
                Do now
              </button>
            </div>
          </div>
        ) : (
          <Link
            href="/passport/section-a"
            className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm transition-colors hover:bg-black/[0.02]"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-safe-ivory/60 text-lg"
            >
              ☀️
            </span>
            <div className="flex-1">
              <p className="text-sm font-semibold text-brand-neutral-black">
                Complete your child&apos;s passport first
              </p>
              <p className="text-xs text-black/50">
                We&apos;ll use it to power the morning check-in
              </p>
            </div>
            <span aria-hidden className="text-black/30">
              ›
            </span>
          </Link>
        )}

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
            {passport ? "Your child's passport" : "Get started"}
          </h2>

          {passport ? (
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center gap-3">
                <span
                  aria-hidden
                  className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-lg"
                >
                  📄
                </span>
                <div>
                  <p className="text-sm font-semibold text-brand-neutral-black">
                    {passport.childName}, age {passport.age}
                  </p>
                  <p className="text-xs text-black/50">{passport.diagnosis}</p>
                </div>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-black/10">
                <div
                  className="h-full rounded-full bg-brand-prussian-blue"
                  style={{ width: `${passport.completionPercent}%` }}
                />
              </div>
              <p className="mt-1 text-right text-xs font-medium text-brand-prussian-blue">
                {passport.completionPercent}% complete
              </p>
            </div>
          ) : (
            <Link
              href="/passport/section-a"
              className="flex items-center gap-3 rounded-2xl border border-dashed border-black/15 bg-white p-4 transition-colors hover:bg-black/[0.02]"
            >
              <span
                aria-hidden
                className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-lg"
              >
                📄
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-brand-neutral-black">
                  Build your child&apos;s passport
                </p>
                <p className="text-xs text-black/50">
                  Takes about 10 minutes, save and return anytime
                </p>
              </div>
              <span aria-hidden className="text-black/30">
                ›
              </span>
            </Link>
          )}
        </section>

        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
            Recommended for you
          </h2>
          <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-brand-neutral-black">
              Understanding sensory processing
            </p>
            <p className="text-xs text-black/50">Course · 45 min</p>
          </div>
        </section>
      </main>

      <BottomNav active="home" />
    </div>
  );
}
