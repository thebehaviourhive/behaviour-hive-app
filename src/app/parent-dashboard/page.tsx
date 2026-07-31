"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";

type PassportStatus = "not_started" | "in_progress" | "complete";
type SettledState = "settled" | "unsettled" | "dysregulated";

interface TeacherUpdateData {
  teacherName: string;
  settledState: SettledState;
  energyLevel: number;
  flags: string[];
  headsUp: string | null;
}

// TODO: replace with a real query against teacher_updates once teachers can
// actually submit an end-of-day update — for now this lets us see the full
// State 4 UI end to end.
const DUMMY_TEACHER_UPDATE: TeacherUpdateData = {
  teacherName: "Ms. O'Brien",
  settledState: "unsettled",
  energyLevel: 3,
  flags: ["Peer Friction", "Fatigued"],
  headsUp:
    "Had a tough moment at lunch after a disagreement with a friend, but settled well after some quiet time with a book.",
};
const HAS_TEACHER_UPDATE_TODAY = true;

const SETTLED_PILL: Record<SettledState, { label: string; className: string }> = {
  settled: { label: "Settled and Regulated", className: "bg-green-500 text-white" },
  unsettled: { label: "Unsettled / Anxious", className: "bg-amber-500 text-white" },
  dysregulated: { label: "Highly Dysregulated", className: "bg-red-500 text-white" },
};

const ENERGY_LABELS: Record<number, string> = {
  5: "Full of energy today",
  4: "Good energy levels",
  3: "Moderate energy",
  2: "Low energy — expect some fatigue at home",
  1: "Very low energy today",
};

function getDismissKey(userId: string) {
  return `passportCardDismissed:${userId}`;
}

export default function ParentDashboardPage() {
  const { user, isReady } = useRequireRole("parent");
  const [firstName, setFirstName] = useState("there");
  const [childName, setChildName] = useState("your child");
  const [passportStatus, setPassportStatus] = useState<PassportStatus>("not_started");
  const [resumeHref, setResumeHref] = useState("/passport/welcome");
  const [isLoadingPassport, setIsLoadingPassport] = useState(true);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [isPassportCardDismissed, setIsPassportCardDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    setIsPassportCardDismissed(
      window.localStorage.getItem(getDismissKey(user.id)) === "true"
    );
  }, [user]);

  useEffect(() => {
    if (!user) return;

    const fullName = user.user_metadata?.full_name as string | undefined;
    if (fullName) {
      setFirstName(fullName.split(" ")[0]);
    }

    let isMounted = true;

    async function loadDashboardData() {
      const supabase = createClient();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [
        { data: passportRow },
        { data: sectionB },
        { data: sectionC },
        { data: sectionD },
        { data: todaysCheckin },
      ] = await Promise.all([
        supabase
          .from("passports")
          .select("child_name, passport_status, section_a_complete")
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
        supabase
          .from("morning_checkins")
          .select("id")
          .eq("user_id", user!.id)
          .gte("checked_in_at", startOfToday.toISOString())
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      const status =
        (passportRow?.passport_status as PassportStatus | undefined) ?? "not_started";

      setChildName(passportRow?.child_name || "your child");
      setPassportStatus(status);
      setHasCheckedInToday(Boolean(todaysCheckin));
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

    loadDashboardData();
    return () => {
      isMounted = false;
    };
  }, [user]);

  function dismissPassportCard() {
    if (!user) return;
    window.localStorage.setItem(getDismissKey(user.id), "true");
    setIsPassportCardDismissed(true);
  }

  if (!isReady || isLoadingPassport) {
    return null;
  }

  const isBefore1pm = new Date().getHours() < 13;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          Good morning, {firstName}
        </h1>
      </header>

      <main className="flex flex-col gap-4 px-4 pt-4">
        <CheckInCard
          childName={childName}
          isBefore1pm={isBefore1pm}
          hasCheckedInToday={hasCheckedInToday}
          hasTeacherUpdateToday={HAS_TEACHER_UPDATE_TODAY}
          teacherUpdate={DUMMY_TEACHER_UPDATE}
        />

        {passportStatus === "complete" ? (
          !isPassportCardDismissed && (
            <section>
              <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
                Your child&apos;s passport
              </h2>
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <div className="mb-3 flex items-center gap-3">
                  <span
                    aria-hidden
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-lg"
                  >
                    ✅
                  </span>
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-brand-neutral-black">
                      Passport Completed!
                    </p>
                    <p className="text-xs text-black/50">
                      You can view or edit it anytime from the Passport tab
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={dismissPassportCard}
                  className="w-full rounded-full border border-black/15 py-2 text-xs font-semibold text-black/50"
                >
                  Dismiss
                </button>
              </div>
            </section>
          )
        ) : (
          <section>
            <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">
              Get started
            </h2>
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
                  {passportStatus === "not_started"
                    ? "Build your child's passport"
                    : "Resume passport creation"}
                </p>
                <p className="text-xs text-black/50">
                  Takes about 10 minutes, save and return anytime
                </p>
              </div>
              <span aria-hidden className="text-black/30">
                ›
              </span>
            </Link>
          </section>
        )}

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

function CheckInCard({
  childName,
  isBefore1pm,
  hasCheckedInToday,
  hasTeacherUpdateToday,
  teacherUpdate,
}: {
  childName: string;
  isBefore1pm: boolean;
  hasCheckedInToday: boolean;
  hasTeacherUpdateToday: boolean;
  teacherUpdate: TeacherUpdateData;
}) {
  if (isBefore1pm && !hasCheckedInToday) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/20 p-4 shadow-sm">
        <span
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown/15 text-lg"
        >
          ☀️
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-brand-neutral-black">
            How was {childName}&apos;s morning?
          </p>
          <p className="text-xs text-black/50">
            Takes 15 seconds — let the teacher know before the day begins
          </p>
        </div>
        <Link
          href="/morning-checkin"
          className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
        >
          Check in now
        </Link>
      </div>
    );
  }

  if (isBefore1pm && hasCheckedInToday) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-green-100 bg-green-50 p-4 shadow-sm">
        <span
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-green-100 text-lg"
        >
          ✅
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-brand-neutral-black">
            Morning check-in sent
          </p>
          <p className="text-xs text-black/50">Your teacher has been updated for today</p>
        </div>
      </div>
    );
  }

  if (!hasTeacherUpdateToday) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-black/5 bg-black/[0.03] p-4 shadow-sm">
        <span
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-black/5 text-lg"
        >
          🕐
        </span>
        <div className="flex-1">
          <p className="text-sm font-semibold text-brand-neutral-black">
            Waiting for today&apos;s update from school
          </p>
          <p className="text-xs text-black/50">
            Your teacher&apos;s end-of-day update will appear here
          </p>
        </div>
      </div>
    );
  }

  const pill = SETTLED_PILL[teacherUpdate.settledState];

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="mb-3 text-sm font-semibold text-brand-neutral-black">
        Afternoon Update from {teacherUpdate.teacherName}
      </p>

      <span
        className={`mb-4 block w-full rounded-full px-4 py-2 text-center text-xs font-bold uppercase tracking-wide ${pill.className}`}
      >
        {pill.label}
      </span>

      <div className="mb-4">
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">
          Energy Level
        </p>
        <EnergyBars level={teacherUpdate.energyLevel} />
        <p className="mt-1.5 text-xs text-black/60">
          <span className="font-semibold text-brand-neutral-black">
            Energy {teacherUpdate.energyLevel}/5
          </span>{" "}
          — {ENERGY_LABELS[teacherUpdate.energyLevel]}
        </p>
      </div>

      <div className={teacherUpdate.headsUp ? "mb-4" : ""}>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-black/40">
          Flags Noticed
        </p>
        <FlagChips flags={teacherUpdate.flags} />
      </div>

      {teacherUpdate.headsUp && <HeadsUpNote text={teacherUpdate.headsUp} />}
    </div>
  );
}

function EnergyBars({ level }: { level: number }) {
  return (
    <div className="flex items-end gap-1">
      {[1, 2, 3, 4, 5].map((bar) => (
        <span
          key={bar}
          aria-hidden
          className={`w-2.5 rounded-sm ${
            bar <= level ? "bg-brand-prussian-blue" : "bg-black/10"
          }`}
          style={{ height: `${8 + bar * 4}px` }}
        />
      ))}
    </div>
  );
}

function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) {
    return (
      <span className="inline-block rounded-full bg-black/5 px-3 py-1 text-xs font-semibold text-black/50">
        No Flags Today
      </span>
    );
  }

  return (
    <div className="grid grid-cols-2 gap-2">
      {flags.map((flag) => (
        <span
          key={flag}
          className="rounded-full border border-black/10 bg-white px-3 py-1 text-center text-xs font-semibold text-brand-neutral-black"
        >
          {flag}
        </span>
      ))}
    </div>
  );
}

function HeadsUpNote({ text }: { text: string }) {
  return (
    <div className="rounded-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-3">
      <p className="text-xs italic text-black/70">&ldquo;{text}&rdquo;</p>
    </div>
  );
}
