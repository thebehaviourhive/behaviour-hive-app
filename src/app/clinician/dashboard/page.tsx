"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMessagesAwaitingActionCount } from "@/hooks/useMessagesAwaitingActionCount";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { ClinicianActivityCard } from "@/components/clinician/ClinicianActivityCard";
import { ClinicianQuickActions } from "@/components/clinician/ClinicianQuickActions";
import { CalmEscalationNoticeList } from "@/components/clinician/CalmEscalationNoticeList";
import { ClinicalFileIcon, LockIcon } from "@/components/ui/icons";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

interface ClinicianProfile {
  specialty: string;
  verificationStatus: "pending" | "verified" | "rejected";
  hasSubmitted: boolean;
}

type ReviewState = "not_submitted" | "pending_review" | "rejected" | "verified";

function getReviewState(profile: ClinicianProfile): ReviewState {
  if (profile.verificationStatus === "verified") return "verified";
  if (profile.verificationStatus === "rejected") return "rejected";
  return profile.hasSubmitted ? "pending_review" : "not_submitted";
}

interface Stats {
  activeCases: number;
  weeklyLogs: number;
  reviewsDue: number;
  activeFbas: number;
  openMessages: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

// new Date("YYYY-MM-DD") parses as UTC midnight, not local midnight --
// during BST that's 1am local, shifting the due threshold by up to an
// hour. Parsing the components directly constructs a local-midnight Date
// instead, matching what a clinician actually means by "that calendar day".
function parseLocalDateOnly(dateOnly: string): Date {
  const [year, month, day] = dateOnly.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function isReviewDue(lastReviewDate: string, cadenceDays: number): boolean {
  const due = parseLocalDateOnly(lastReviewDate);
  due.setDate(due.getDate() + cadenceDays);
  return new Date() > due;
}

async function fetchClinicianProfile(
  userId: string
): Promise<{ profile: ClinicianProfile | null; error: boolean }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("clinicians")
    .select("specialty, verification_status, full_name")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("Failed to load clinician profile:", error);
    return { profile: null, error: true };
  }

  if (!data) return { profile: null, error: false };

  return {
    profile: {
      specialty: data.specialty,
      verificationStatus: data.verification_status,
      hasSubmitted: data.full_name !== null,
    },
    error: false,
  };
}

export default function ClinicianDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("clinician");
  const messagesAwaitingCount = useMessagesAwaitingActionCount(user?.id ?? null);

  const [profile, setProfile] = useState<ClinicianProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [profileLoadError, setProfileLoadError] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState(false);
  const [checkStatusMessage, setCheckStatusMessage] = useState<string | null>(null);
  const [stats, setStats] = useState<Stats>({
    activeCases: 0,
    weeklyLogs: 0,
    reviewsDue: 0,
    activeFbas: 0,
    openMessages: 0,
  });
  const [isLoadingStats, setIsLoadingStats] = useState(true);
  const [statsError, setStatsError] = useState<string | null>(null);

  const fullName = user?.user_metadata?.full_name as string | undefined;
  const firstName = fullName ? fullName.split(" ")[0] : "there";

  const loadProfile = useCallback(async () => {
    if (!user) return;
    setIsLoadingProfile(true);
    setProfileLoadError(null);

    const { profile: loaded, error } = await fetchClinicianProfile(user.id);

    if (error) {
      setProfileLoadError("Couldn't load your profile.");
      setIsLoadingProfile(false);
      return;
    }

    if (!loaded) {
      router.replace("/clinician/specialty");
      return;
    }

    setProfile(loaded);
    setIsLoadingProfile(false);
  }, [user, router]);

  // Fetches on mount and whenever `loadProfile`'s identity changes -- a
  // genuine effect for syncing with the external data source, not a
  // synchronous state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadProfile();
  }, [loadProfile]);

  async function handleCheckStatus() {
    if (!user) return;
    setIsCheckingStatus(true);
    setCheckStatusMessage(null);
    const { profile: loaded, error } = await fetchClinicianProfile(user.id);
    setIsCheckingStatus(false);
    if (error) {
      setCheckStatusMessage("Couldn't check your status. Please try again.");
      return;
    }
    if (!loaded) return;

    setProfile(loaded);
    if (getReviewState(loaded) === "pending_review") {
      setCheckStatusMessage("Pending approval. Please check back soon.");
    }
  }

  const loadStats = useCallback(async () => {
    if (!user || !profile || profile.specialty !== "behavioural_psychologist") return;
    setIsLoadingStats(true);
    setStatsError(null);

    const supabase = createClient();
    const sevenDaysAgo = new Date();
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

    const [
      { count: activeCases, error: activeCasesError },
      { count: weeklyLogs, error: weeklyLogsError },
      { data: cadenceRow, error: cadenceError },
      { data: caseRows, error: caseRowsError },
      { count: activeFbas, error: activeFbasError },
      { count: openMessages, error: openMessagesError },
    ] = await Promise.all([
      supabase
        .from("clinician_access")
        .select("id", { count: "exact", head: true })
        .eq("clinician_id", user.id)
        .eq("is_active", true),
      supabase
        .from("abc_logs")
        .select("id", { count: "exact", head: true })
        .eq("logged_by", user.id)
        .eq("logged_by_role", "clinician")
        .gte("created_at", sevenDaysAgo.toISOString()),
      supabase
        .from("clinicians")
        .select("review_cadence_days")
        .eq("user_id", user.id)
        .maybeSingle(),
      supabase
        .from("clinician_access")
        .select("last_review_date")
        .eq("clinician_id", user.id)
        .eq("is_active", true),
      supabase
        .from("fba_reports")
        .select("id", { count: "exact", head: true })
        .eq("clinician_id", user.id)
        .in("status", ["draft", "in_progress"]),
      // Same "open" definition as every other Messages surface: this
      // clinician is a recipient, hasn't acknowledged, and it isn't
      // closed. Trivially cheap (one indexed count query) -- no tap-
      // through destination exists yet (messages live per-case in the
      // Clinical File, not a caseload-wide triage page), so this is
      // informational only, same as Active Cases/Weekly Logs.
      supabase
        .from("message_recipients")
        .select("id, messages!inner(status)", { count: "exact", head: true })
        .eq("recipient_id", user.id)
        .is("acknowledged_at", null)
        .neq("messages.status", "closed"),
    ]);

    const firstError =
      activeCasesError ?? weeklyLogsError ?? cadenceError ?? caseRowsError ?? activeFbasError ?? openMessagesError;
    if (firstError) {
      console.error("Failed to load clinician stats:", firstError);
      setStatsError("Couldn't load your stats.");
      setIsLoadingStats(false);
      return;
    }

    const cadenceDays = cadenceRow?.review_cadence_days ?? 30;
    const reviewsDue = (caseRows ?? []).filter((row) =>
      isReviewDue(row.last_review_date, cadenceDays)
    ).length;

    setStats({
      activeCases: activeCases ?? 0,
      weeklyLogs: weeklyLogs ?? 0,
      reviewsDue,
      activeFbas: activeFbas ?? 0,
      openMessages: openMessages ?? 0,
    });
    setIsLoadingStats(false);
  }, [user, profile]);

  // Fetches on mount and whenever `loadStats`'s identity changes -- a
  // genuine effect for syncing with the external data source, not a
  // synchronous state derivation.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadStats();
  }, [loadStats]);

  if (!isReady || isLoadingProfile) {
    return null;
  }

  if (profileLoadError) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 pb-24 text-center">
        <InlineErrorState message={profileLoadError} onRetry={loadProfile} />
      </div>
    );
  }

  if (!profile) {
    return null;
  }

  if (profile.specialty !== "behavioural_psychologist") {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
            <ClinicalFileIcon className="h-10 w-10" />
          </span>
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            Coming Soon
          </h1>
          <p className="max-w-[280px] text-sm text-brand-neutral-black/70">
            Verification for this clinical role is currently in development.
            We are working closely with regulatory bodies to ensure a secure
            integration. We will notify you when this track opens.
          </p>
        </main>
        <ClinicianBottomNav />
      </div>
    );
  }

  const reviewState = getReviewState(profile);
  const isLocked = reviewState !== "verified";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      {/* Outside the isLocked pointer-events-none wrapper below,
          deliberately -- an unverified clinician has no active linked
          cases (verification gates clinician_access reads throughout
          this app), so this is never actually populated for them, but
          the red notice must never be capable of being visually
          suppressed by that lock state regardless. */}
      <CalmEscalationNoticeList />
      <div className="relative flex-1">
        <div className={isLocked ? "pointer-events-none select-none" : ""}>
          <h1 className="mt-6 px-4 font-heading text-2xl font-semibold text-brand-neutral-black">
            {getGreeting()}, {firstName}
          </h1>

          {statsError ? (
            <div className="px-4 py-2">
              <InlineErrorState message={statsError} onRetry={loadStats} />
            </div>
          ) : (
            <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 py-2">
              <StatCard label="Active Cases" value={isLoadingStats ? "…" : stats.activeCases} />
              <StatCard label="Weekly Logs" value={isLoadingStats ? "…" : stats.weeklyLogs} />
              <StatCard
                label="Reviews Due"
                value={isLoadingStats ? "…" : stats.reviewsDue}
                isWarning={!isLoadingStats && stats.reviewsDue > 0}
              />
              <StatCard
                label="Active FBAs"
                value={isLoadingStats ? "…" : stats.activeFbas}
                href="/clinician/fba"
              />
              <StatCard
                label="Open Messages"
                value={isLoadingStats ? "…" : stats.openMessages}
                href="/clinician/messages"
              />
            </div>
          )}

          <div className="px-4">
            <ClinicianActivityCard />
          </div>

          <ClinicianQuickActions messagesAwaitingCount={messagesAwaitingCount} />
        </div>

        {reviewState === "not_submitted" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-6 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-4 text-base font-semibold text-brand-neutral-black">
                Verify your credentials to unlock your clinical dashboard.
              </p>
              <Link
                href="/clinician/verify"
                className="block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
              >
                Submit Credentials
              </Link>
            </div>
          </div>
        )}

        {reviewState === "pending_review" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-6 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-4 text-base font-semibold text-brand-neutral-black">
                Thanks — your credentials are being reviewed. You&apos;ll be
                notified when your account is verified.
              </p>
              <button
                type="button"
                onClick={handleCheckStatus}
                disabled={isCheckingStatus}
                className="block w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
              >
                {isCheckingStatus ? "Checking…" : "Check status"}
              </button>
              {checkStatusMessage && (
                <p className="mt-3 text-sm font-medium text-brand-neutral-black/60">
                  {checkStatusMessage}
                </p>
              )}
            </div>
          </div>
        )}

        {reviewState === "rejected" && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-6 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-2 text-base font-semibold text-brand-neutral-black">
                We weren&apos;t able to verify your credentials.
              </p>
              <p className="text-sm text-brand-neutral-black/70">
                Please contact info@thebehaviourhive.com for help with your
                application.
              </p>
            </div>
          </div>
        )}
      </div>

      <ClinicianBottomNav />
    </div>
  );
}

function StatCard({
  label,
  value,
  isWarning,
  href,
}: {
  label: string;
  value: number | string;
  isWarning?: boolean;
  href?: string;
}) {
  const className = `min-w-[140px] flex-shrink-0 rounded-2xl p-4 shadow-sm ${
    isWarning
      ? "border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30"
      : "border border-black/5 bg-white"
  }`;

  const content = (
    <>
      <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{value}</p>
      <p className="mt-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/60">
        {label}
      </p>
    </>
  );

  if (href) {
    return (
      <Link href={href} className={className}>
        {content}
      </Link>
    );
  }

  return <div className={className}>{content}</div>;
}
