"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";
import { ClinicianActivityCard } from "@/components/clinician/ClinicianActivityCard";
import { ClinicianQuickActions } from "@/components/clinician/ClinicianQuickActions";
import { ClinicalFileIcon, LockIcon } from "@/components/ui/icons";

interface ClinicianProfile {
  specialty: string;
  verificationStatus: "pending" | "verified";
}

interface Stats {
  activeCases: number;
  weeklyLogs: number;
  reviewsDue: number;
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function isReviewDue(lastReviewDate: string, cadenceDays: number): boolean {
  const due = new Date(lastReviewDate);
  due.setDate(due.getDate() + cadenceDays);
  return new Date() > due;
}

export default function ClinicianDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("clinician");

  const [firstName, setFirstName] = useState("there");
  const [profile, setProfile] = useState<ClinicianProfile | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [stats, setStats] = useState<Stats>({ activeCases: 0, weeklyLogs: 0, reviewsDue: 0 });
  const [isLoadingStats, setIsLoadingStats] = useState(true);

  useEffect(() => {
    if (!user) return;

    const fullName = user.user_metadata?.full_name as string | undefined;
    if (fullName) {
      setFirstName(fullName.split(" ")[0]);
    }

    let isMounted = true;

    async function loadProfile() {
      const supabase = createClient();
      const { data } = await supabase
        .from("clinicians")
        .select("specialty, verification_status")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (!data) {
        router.replace("/clinician/specialty");
        return;
      }

      setProfile({
        specialty: data.specialty,
        verificationStatus: data.verification_status,
      });
      setIsLoadingProfile(false);
    }

    loadProfile();
    return () => {
      isMounted = false;
    };
  }, [user, router]);

  useEffect(() => {
    if (!user || !profile || profile.specialty !== "behavioural_psychologist") return;
    let isMounted = true;

    async function loadStats() {
      const supabase = createClient();
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      const [
        { count: activeCases },
        { count: weeklyLogs },
        { data: cadenceRow },
        { data: caseRows },
      ] = await Promise.all([
        supabase
          .from("clinician_access")
          .select("id", { count: "exact", head: true })
          .eq("clinician_id", user!.id)
          .eq("is_active", true),
        supabase
          .from("abc_logs")
          .select("id", { count: "exact", head: true })
          .eq("logged_by", user!.id)
          .eq("logged_by_role", "clinician")
          .gte("created_at", sevenDaysAgo.toISOString()),
        supabase
          .from("clinicians")
          .select("review_cadence_days")
          .eq("user_id", user!.id)
          .maybeSingle(),
        supabase
          .from("clinician_access")
          .select("last_review_date")
          .eq("clinician_id", user!.id)
          .eq("is_active", true),
      ]);

      if (!isMounted) return;

      const cadenceDays = cadenceRow?.review_cadence_days ?? 30;
      const reviewsDue = (caseRows ?? []).filter((row) =>
        isReviewDue(row.last_review_date, cadenceDays)
      ).length;

      setStats({
        activeCases: activeCases ?? 0,
        weeklyLogs: weeklyLogs ?? 0,
        reviewsDue,
      });
      setIsLoadingStats(false);
    }

    loadStats();
    return () => {
      isMounted = false;
    };
  }, [user, profile]);

  if (!isReady || isLoadingProfile || !profile) {
    return null;
  }

  if (profile.specialty !== "behavioural_psychologist") {
    return (
      <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory pb-24">
        <main className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <span className="mb-1 flex h-20 w-20 items-center justify-center rounded-full bg-brand-golden-brown/10 text-brand-golden-brown">
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
        <ClinicianBottomNav active="dashboard" />
      </div>
    );
  }

  const isPending = profile.verificationStatus === "pending";

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory pb-24">
      <div className="relative flex-1">
        <div className={isPending ? "pointer-events-none select-none" : ""}>
          <h1 className="mt-6 px-4 font-heading text-2xl font-bold text-brand-prussian-blue">
            {getGreeting()}, {firstName}
          </h1>

          <div className="scrollbar-hide flex gap-4 overflow-x-auto px-4 py-2">
            <StatCard label="Active Cases" value={isLoadingStats ? "…" : stats.activeCases} />
            <StatCard label="Weekly Logs" value={isLoadingStats ? "…" : stats.weeklyLogs} />
            <StatCard label="Reviews Due" value={isLoadingStats ? "…" : stats.reviewsDue} />
          </div>

          <div className="px-4">
            <ClinicianActivityCard />
          </div>

          <ClinicianQuickActions />
        </div>

        {isPending && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-white/30 px-6 backdrop-blur-md">
            <div className="w-full max-w-xs rounded-3xl bg-white p-6 text-center shadow-lg">
              <span className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-brand-golden-brown/10 text-brand-golden-brown">
                <LockIcon className="h-6 w-6" />
              </span>
              <p className="mb-4 text-base font-semibold text-brand-neutral-black">
                Verify your credentials to unlock your clinical dashboard.
              </p>
              <Link
                href="/clinician/verify"
                className="block w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white"
              >
                Submit Credentials
              </Link>
            </div>
          </div>
        )}
      </div>

      <ClinicianBottomNav active="dashboard" />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="min-w-[140px] flex-shrink-0 rounded-xl border-t-4 border-brand-golden-brown bg-white p-4 shadow-sm">
      <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{value}</p>
      <p className="mt-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/60">
        {label}
      </p>
    </div>
  );
}
