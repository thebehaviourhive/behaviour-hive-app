"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";

interface PassportSummary {
  childName: string;
  age: number;
  diagnosis: string;
  completionPercent: number;
}

type PassportStatus = "not_started" | "in_progress" | "complete";

export default function ParentDashboardPage() {
  const { user, isReady } = useRequireRole("parent");
  const [firstName, setFirstName] = useState("there");
  const [passportStatus, setPassportStatus] =
    useState<PassportStatus>("not_started");
  const [resumeHref, setResumeHref] = useState("/passport/welcome");
  const [isLoadingPassport, setIsLoadingPassport] = useState(true);

  // The full rich summary (name/age/diagnosis/completion %) lives on the
  // dedicated /passport/dashboard view once complete — this stays null
  // here regardless of status, so these cards always show the compact
  // status-driven prompt instead of duplicating that summary.
  const [passport] = useState<PassportSummary | null>(null);

  useEffect(() => {
    if (!user) return;

    const fullName = user.user_metadata?.full_name as string | undefined;
    if (fullName) {
      setFirstName(fullName.split(" ")[0]);
    }

    let isMounted = true;

    async function loadPassportStatus() {
      const supabase = createClient();
      const [{ data: passportRow }, { data: sectionB }, { data: sectionC }, { data: sectionD }] =
        await Promise.all([
          supabase
            .from("passports")
            .select("passport_status, section_a_complete")
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_b")
            .select("okay_signals, hard_signals, hard_triggers, section_b_complete")
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_c")
            .select("section_c_complete")
            .eq("user_id", user!.id)
            .maybeSingle(),
          supabase
            .from("passport_section_d")
            .select("before_behaviour, during_distress, after_distress, section_d_complete")
            .eq("user_id", user!.id)
            .maybeSingle(),
        ]);

      if (!isMounted) return;

      const status =
        (passportRow?.passport_status as PassportStatus | undefined) ?? "not_started";

      setPassportStatus(status);
      setResumeHref(
        getPassportResumeHref({
          passportStatus: status,
          sectionAComplete: Boolean(passportRow?.section_a_complete),
          sectionB: sectionB
            ? {
                okaySignals: sectionB.okay_signals,
                hardSignals: sectionB.hard_signals,
                hardTriggers: sectionB.hard_triggers,
                complete: sectionB.section_b_complete,
              }
            : null,
          sectionCComplete: Boolean(sectionC?.section_c_complete),
          sectionD: sectionD
            ? {
                beforeBehaviour: sectionD.before_behaviour,
                duringDistress: sectionD.during_distress,
                afterDistress: sectionD.after_distress,
                complete: sectionD.section_d_complete,
              }
            : null,
        })
      );
      setIsLoadingPassport(false);
    }

    loadPassportStatus();
    return () => {
      isMounted = false;
    };
  }, [user]);

  if (!isReady || isLoadingPassport) {
    return null;
  }

  const morningCardText =
    passportStatus === "not_started"
      ? "Complete your child's passport first"
      : passportStatus === "complete"
        ? "View your child's passport"
        : "Resume passport creation";
  const passportCardText =
    passportStatus === "not_started"
      ? "Build your child's passport"
      : passportStatus === "complete"
        ? "View your child's passport"
        : "Resume passport creation";

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
            href={resumeHref}
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
                {morningCardText}
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
              href={resumeHref}
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
                  {passportCardText}
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

      <BottomNav active="home" passportHref={resumeHref} />
    </div>
  );
}
