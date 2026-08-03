"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { BottomNav } from "@/components/ui/BottomNav";
import { TeacherBottomNav } from "@/components/teacher/TeacherBottomNav";
import { ClinicianBottomNav } from "@/components/clinician/ClinicianBottomNav";

const CADENCE_OPTIONS = [14, 30, 60, 90] as const;

export default function MorePage() {
  const router = useRouter();
  const [isReady, setIsReady] = useState(false);
  const [role, setRole] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [isSigningOut, setIsSigningOut] = useState(false);
  const [clinicianCode, setClinicianCode] = useState<string | null>(null);
  const [reviewCadenceDays, setReviewCadenceDays] = useState<number | null>(null);
  const [isSavingCadence, setIsSavingCadence] = useState(false);

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

      const userRole = (user.app_metadata?.role as string | undefined) ?? null;
      setRole(userRole);
      setUserId(user.id);

      if (userRole === "clinician") {
        const { data: clinician } = await supabase
          .from("clinicians")
          .select("clinician_code, review_cadence_days")
          .eq("user_id", user.id)
          .maybeSingle();

        if (isMounted && clinician) {
          setClinicianCode(clinician.clinician_code);
          setReviewCadenceDays(clinician.review_cadence_days);
        }
      }

      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router]);

  async function handleCadenceChange(days: number) {
    if (!userId) return;
    setIsSavingCadence(true);
    const supabase = createClient();
    const { error } = await supabase
      .from("clinicians")
      .update({ review_cadence_days: days })
      .eq("user_id", userId);

    setIsSavingCadence(false);
    if (!error) {
      setReviewCadenceDays(days);
    }
  }

  async function handleLogout() {
    setIsSigningOut(true);
    const supabase = createClient();
    await supabase.auth.signOut();
    window.localStorage.clear();
    window.sessionStorage.clear();
    router.replace("/login");
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-8 pb-2">
        <h1 className="font-heading text-2xl font-semibold text-brand-prussian-blue">
          More
        </h1>
      </header>

      <main className="flex flex-1 flex-col gap-3 px-4 pt-3">
        {role === "clinician" && (
          <section className="rounded-2xl border-t-4 border-brand-golden-brown bg-white p-4 shadow-sm">
            <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              My Clinician Code
            </p>
            {clinicianCode ? (
              <p className="font-heading text-2xl font-bold tracking-widest text-brand-prussian-blue">
                {clinicianCode}
              </p>
            ) : (
              <p className="text-sm text-brand-neutral-black/60">
                Your code will appear here once your credentials are verified.
              </p>
            )}

            <div className="my-4 h-px bg-black/10" />

            <p className="mb-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Case Review Cadence
            </p>
            <div className="flex gap-2">
              {CADENCE_OPTIONS.map((days) => (
                <button
                  key={days}
                  type="button"
                  onClick={() => handleCadenceChange(days)}
                  disabled={isSavingCadence}
                  className={`flex-1 rounded-xl border py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${
                    reviewCadenceDays === days
                      ? "border-brand-golden-brown bg-brand-golden-brown text-white"
                      : "border-black/10 bg-white text-brand-neutral-black"
                  }`}
                >
                  {days}d
                </button>
              ))}
            </div>
          </section>
        )}

        <section>
          <button
            type="button"
            onClick={() => setIsConfirmOpen(true)}
            className="flex w-full items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99]"
          >
            <span
              aria-hidden
              className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-red-50 text-lg"
            >
              🚪
            </span>
            <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
              Log out
            </span>
            <span aria-hidden className="text-black/30">
              ›
            </span>
          </button>
        </section>

        <p className="mt-auto pt-6 text-center text-xs text-black/40">
          The Behaviour Hive — v1.0
        </p>
      </main>

      <BottomSheet isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Are you sure you want to log out?
        </h2>

        <div className="mt-5 flex gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => setIsConfirmOpen(false)}
            className="flex-1"
          >
            Cancel
          </Button>
          <button
            type="button"
            onClick={handleLogout}
            disabled={isSigningOut}
            className="flex-1 rounded-2xl bg-red-600 px-5 py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSigningOut ? "Logging out…" : "Log out"}
          </button>
        </div>
      </BottomSheet>

      {role === "class_teacher" ? (
        <TeacherBottomNav active="more" />
      ) : role === "clinician" ? (
        <ClinicianBottomNav active="more" />
      ) : (
        <BottomNav active="more" />
      )}
    </div>
  );
}
