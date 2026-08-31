"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { BottomNav } from "@/components/ui/BottomNav";
import { ChatBubbleIcon } from "@/components/ui/icons";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { getPassportResumeHref } from "@/lib/getPassportResumeHref";
import { RecentUpdatesCard } from "@/components/parent/RecentUpdatesCard";
import { IncidentNoticeCard } from "@/components/parent/IncidentNoticeCard";
import { HomeProfilePromptCard } from "@/components/passport/HomeProfilePromptCard";
import { ClinicalSupportSection } from "@/components/parent/ClinicalSupportSection";
import { QuickActionButtons } from "@/components/parent/QuickActionButtons";
import { YourTeamCard } from "@/components/parent/YourTeamCard";
import { CalmLogReminderCard } from "@/components/parent/calm/CalmLogReminderCard";

type PassportStatus = "not_started" | "in_progress" | "complete";
type SettledState = "settled" | "unsettled" | "dysregulated";

interface TeacherUpdateData {
  teacherName: string;
  settledState: SettledState;
  energyLevel: number;
  flags: string[];
  headsUp: string | null;
}

const SETTLED_BADGE: Record<SettledState, { label: string; dotClassName: string; badgeClassName: string }> = {
  settled: {
    label: "Settled and Regulated",
    dotClassName: "bg-green-500",
    badgeClassName: "bg-green-50 text-green-800",
  },
  unsettled: {
    label: "Unsettled and Anxious",
    dotClassName: "bg-amber-500",
    badgeClassName: "bg-amber-50 text-amber-800",
  },
  dysregulated: {
    label: "Highly Dysregulated",
    dotClassName: "bg-red-500",
    badgeClassName: "bg-red-50 text-red-800",
  },
};

function getDismissKey(userId: string) {
  return `passportCardDismissed:${userId}`;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Welcome back";
}

function formatTime(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

export default function ParentDashboardPage() {
  const { user, isReady } = useRequireRole("parent");
  const messagesAwaitingCount = useMessagesAwaitingActionCount(user?.id ?? null);
  const parentFullName = user?.user_metadata?.full_name as string | undefined;
  const firstName = parentFullName ? parentFullName.split(" ")[0] : "there";
  const {
    passportId,
    childName: resolvedChildName,
    isLoading: isLoadingPassportId,
  } = useMyPassport(user?.id);
  const childName = resolvedChildName || "your child";
  const [passportStatus, setPassportStatus] = useState<PassportStatus>("not_started");
  const [resumeHref, setResumeHref] = useState("/passport/welcome");
  // A CLAIMED passport (this parent isn't its passports.user_id) has no
  // wizard to resume -- section-a/useSectionB/C/D are all user_id-keyed
  // to whoever originally created it, deliberately out of Stage 5 Step
  // 3's scope. Found live, driving the exact case end-to-end: without
  // this, "Build your child's passport" renders for a passport a claimed
  // guardian structurally cannot build, and its link would otherwise
  // route through the same /passport/welcome->/passport/dashboard hop
  // passport/dashboard/page.tsx's own matching fix now short-circuits.
  const [isSelfCreatedPassport, setIsSelfCreatedPassport] = useState(true);
  const [isLoadingDashboardData, setIsLoadingDashboardData] = useState(true);
  const [hasCheckedInToday, setHasCheckedInToday] = useState(false);
  const [checkedInAt, setCheckedInAt] = useState<string | null>(null);
  const [hasTeacherUpdateToday, setHasTeacherUpdateToday] = useState(false);
  const [teacherUpdate, setTeacherUpdate] = useState<TeacherUpdateData | null>(null);
  const [isPassportCardDismissed, setIsPassportCardDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    // Genuine external-system read (localStorage isn't available during
    // SSR, so this can't be derived during render) -- the one case in
    // this sweep where an effect is the correct tool, not a workaround.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsPassportCardDismissed(
      window.localStorage.getItem(getDismissKey(user.id)) === "true"
    );
  }, [user]);

  useEffect(() => {
    if (!user || isLoadingPassportId) return;

    let isMounted = true;

    async function loadDashboardData() {
      const supabase = createClient();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      if (!passportId) {
        // No passport yet (genuinely not started, not a load failure) --
        // same as before, resumeHref stays at its /passport/welcome
        // default and every passport-scoped section below renders its
        // own "no passport" state via passportId={null}.
        setIsLoadingDashboardData(false);
        return;
      }

      // passportRow: the fields getPassportResumeHref needs beyond what
      // get_my_passports() returns (id + child_name only) -- a follow-up
      // .eq("id", ...) read, safe post-migration 0117 (passports' SELECT
      // policy is owns_passport()-based) for a claimed guardian too, not
      // just a self-created one.
      //
      // sectionB/C/D now read .eq("passport_id", passportId), not
      // .eq("user_id", user.id) -- PRD 3 Stage 1 (migration 0138) made
      // these tables guardian-writable, so the old premise here ("a
      // claimed guardian's passport can never have rows in these
      // tables") no longer holds. It's not only a claimed-guardian
      // concern either: this block only runs .eq("user_id", user.id)
      // under isSelfCreated below, but isSelfCreated just means "I'm the
      // original creator," not "I'm the only guardian" -- a second
      // guardian can be added to a self-created passport too (the claim
      // flow), and last-writer attribution means the row's user_id
      // reflects whoever saved most recently, not who created the
      // passport. The original creator's own resumeHref calculation
      // would silently see a co-guardian's real, complete section as
      // empty. passport_id is the correct key regardless of authorship.
      //
      // morning_checkins deliberately stays .eq("user_id", user.id) --
      // that's a separate, already-documented gap (see CLAUDE.md's
      // "known limitation, not solved" entry on morning check-ins), not
      // in this stage's scope to fix.
      const [
        { data: passportRow },
        { data: sectionB },
        { data: sectionC },
        { data: sectionD },
        { data: todaysCheckin },
      ] = await Promise.all([
        supabase
          .from("passports")
          .select("user_id, passport_status, section_a_complete")
          .eq("id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_b")
          .select("okay_signals, hard_signals, hard_triggers, section_b_complete")
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_c")
          .select("section_c_complete")
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("passport_section_d")
          .select("before_behaviour, during_distress, after_distress, section_d_complete")
          .eq("passport_id", passportId)
          .maybeSingle(),
        supabase
          .from("morning_checkins")
          .select("submitted_at")
          .eq("user_id", user!.id)
          .gte("checked_in_at", startOfToday.toISOString())
          .order("checked_in_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;

      const status =
        (passportRow?.passport_status as PassportStatus | undefined) ?? "not_started";
      const isSelfCreated = passportRow?.user_id === user!.id;

      setPassportStatus(status);
      setIsSelfCreatedPassport(isSelfCreated);
      setHasCheckedInToday(Boolean(todaysCheckin));
      setCheckedInAt(todaysCheckin?.submitted_at ?? null);

      const { data: todaysUpdate } = await supabase
        .from("teacher_updates")
        .select("settled_state, energy_level, flags, heads_up, teacher_id")
        .eq("passport_id", passportId)
        .gte("submitted_at", startOfToday.toISOString())
        .order("submitted_at", { ascending: false })
        .limit(1)
        .maybeSingle();

      if (!isMounted) return;

      if (todaysUpdate) {
        const { data: teacherName, error: teacherNameError } = await supabase.rpc(
          "get_teacher_name",
          { p_teacher_id: todaysUpdate.teacher_id }
        );

        if (teacherNameError) {
          console.error("Failed to load teacher name:", teacherNameError);
        }

        if (!isMounted) return;

        setHasTeacherUpdateToday(true);
        setTeacherUpdate({
          teacherName: teacherName ?? "your child's teacher",
          settledState: (todaysUpdate.settled_state as SettledState) ?? "settled",
          energyLevel: todaysUpdate.energy_level ?? 0,
          flags: todaysUpdate.flags ?? [],
          headsUp: todaysUpdate.heads_up,
        });
      }
      setResumeHref(
        isSelfCreated
          ? getPassportResumeHref({
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
          : "/passport/dashboard"
      );
      setIsLoadingDashboardData(false);
    }

    loadDashboardData();
    return () => {
      isMounted = false;
    };
  }, [user, passportId, isLoadingPassportId]);

  function dismissPassportCard() {
    if (!user) return;
    window.localStorage.setItem(getDismissKey(user.id), "true");
    setIsPassportCardDismissed(true);
  }

  if (!isReady || isLoadingPassportId || isLoadingDashboardData) {
    return null;
  }

  const isBefore1pm = new Date().getHours() < 13;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
          {getGreeting()}, {firstName}
        </h1>
        {/* NAV + HEADER refinements: a persistent link to Messages --
            deliberately no badge, no count, no indicator (the dashboard
            quick-action tile keeps the live count; this is purely a
            shortcut). A circular Prussian Blue backing gives it presence
            without reading as a second primary action -- solid but small
            (44x44, unchanged tap target), so it stays visually quieter
            than the golden daily-update card immediately below it. */}
        <Link
          href="/messages"
          aria-label="Messages"
          className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue text-white shadow-sm transition-colors active:bg-brand-prussian-blue/90"
        >
          <ChatBubbleIcon className="h-5 w-5" />
        </Link>
      </header>

      <main className="flex flex-col gap-3 px-4 pt-3">
        {user && <CalmLogReminderCard userId={user.id} />}

        <CheckInCard
          childName={childName}
          isBefore1pm={isBefore1pm}
          hasCheckedInToday={hasCheckedInToday}
          checkedInAt={checkedInAt}
          hasTeacherUpdateToday={hasTeacherUpdateToday}
          teacherUpdate={teacherUpdate}
        />

        <IncidentNoticeCard passportId={passportId} />

        <HomeProfilePromptCard />

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
        ) : isSelfCreatedPassport ? (
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
        ) : (
          // A claimed, still-incomplete passport: neither "Passport
          // Completed!" (it isn't) nor "Build your child's passport"
          // (this parent structurally can't -- section-a is user_id-keyed
          // to whoever originally created it) fits. No card, matching
          // this section's own existing precedent for "nothing to show
          // here" (a dismissed completed-card also renders null). The
          // real fix -- a genuine "complete your child's passport" flow
          // for a claimed guardian -- is CLAUDE.md's own already-named
          // known limitation, not attempted here.
          null
        )}

        <ClinicalSupportSection passportId={passportId} childName={childName} />

        <RecentUpdatesCard passportId={passportId} />

        <QuickActionButtons childName={childName} messagesAwaitingCount={messagesAwaitingCount} />

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

        <YourTeamCard passportId={passportId} />
      </main>

      <BottomNav passportHref={resumeHref} />
    </div>
  );
}

function CheckInCard({
  childName,
  isBefore1pm,
  hasCheckedInToday,
  checkedInAt,
  hasTeacherUpdateToday,
  teacherUpdate,
}: {
  childName: string;
  isBefore1pm: boolean;
  hasCheckedInToday: boolean;
  checkedInAt: string | null;
  hasTeacherUpdateToday: boolean;
  teacherUpdate: TeacherUpdateData | null;
}) {
  if (isBefore1pm && !hasCheckedInToday) {
    return (
      <Link
        href="/morning-checkin"
        className="flex items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 shadow-md transition-transform active:scale-[0.99]"
      >
        <span
          aria-hidden
          className="flex h-10 w-10 flex-shrink-0 animate-pulse items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg"
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
        <span
          aria-hidden
          className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white"
        >
          Check in now
        </span>
      </Link>
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
          <p className="text-xs text-black/50">
            {checkedInAt
              ? `Sent to your teacher at ${formatTime(checkedInAt)}`
              : "Your teacher has been updated for today"}
          </p>
        </div>
      </div>
    );
  }

  if (!hasTeacherUpdateToday || !teacherUpdate) {
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

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-3.5 shadow-sm">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm font-semibold text-brand-neutral-black">
          Afternoon update from {teacherUpdate.teacherName}
        </p>
        <SettledBadge state={teacherUpdate.settledState} />
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <div className="flex flex-shrink-0 items-center gap-2">
          <span className="text-xs text-black/50">Energy</span>
          <EnergySegments level={teacherUpdate.energyLevel} />
        </div>
        <FlagChips flags={teacherUpdate.flags} />
      </div>

      {teacherUpdate.headsUp && (
        <div className="mt-2.5">
          <HeadsUpNote text={teacherUpdate.headsUp} />
        </div>
      )}
    </div>
  );
}

function SettledBadge({ state }: { state: SettledState }) {
  const badge = SETTLED_BADGE[state];
  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${badge.badgeClassName}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${badge.dotClassName}`} />
      {badge.label}
    </span>
  );
}

function EnergySegments({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4, 5].map((segment) => (
        <span
          key={segment}
          aria-hidden
          className={`h-2 w-4 rounded-full ${
            segment <= level ? "bg-brand-prussian-blue" : "bg-black/10"
          }`}
        />
      ))}
    </div>
  );
}

function FlagChips({ flags }: { flags: string[] }) {
  if (flags.length === 0) {
    return (
      <span className="inline-block rounded-full bg-black/5 px-2.5 py-1 text-xs font-medium text-black/50">
        All good today
      </span>
    );
  }

  const shown = flags.slice(0, 3);
  const remaining = flags.length - shown.length;

  return (
    <div className="flex flex-wrap items-center justify-end gap-1.5">
      {shown.map((flag) => (
        <span
          key={flag}
          className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600"
        >
          {flag}
        </span>
      ))}
      {remaining > 0 && (
        <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">
          +{remaining} more
        </span>
      )}
    </div>
  );
}

function HeadsUpNote({ text }: { text: string }) {
  return (
    <div className="relative rounded-xl bg-brand-prussian-blue/[0.06] py-2.5 pl-9 pr-3">
      <span aria-hidden className="absolute left-2.5 top-2.5 text-sm leading-none">
        💬
      </span>
      <p className="text-xs italic text-brand-neutral-black/80">{text}</p>
    </div>
  );
}
