"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import {
  CLINICIAN_SPECIALTIES,
  CLINICIAN_SPECIALTY_LABEL,
  type ClinicianSpecialty as Specialty,
} from "@/lib/clinicianSpecialties";

export default function ClinicianSpecialtyPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("clinician");
  const [pendingSpecialty, setPendingSpecialty] = useState<Specialty | null>(null);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function selectSpecialty(specialty: Specialty) {
    setError(null);
    setPendingSpecialty(specialty);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("select_clinician_specialty", {
      p_specialty: specialty,
    });

    if (rpcError) {
      setPendingSpecialty(null);
      setError(rpcError.message);
      return;
    }

    if (specialty === "behavioural_psychologist") {
      router.push("/clinician/dashboard");
      return;
    }

    setShowComingSoon(true);
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-safe-ivory px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            Select your clinical specialty
          </h1>
        </div>

        <div className="flex flex-col gap-3">
          {CLINICIAN_SPECIALTIES.map((specialty) => (
            <button
              key={specialty}
              type="button"
              onClick={() => selectSpecialty(specialty)}
              disabled={pendingSpecialty !== null}
              className="rounded-2xl border border-brand-off-white/50 bg-white p-4 text-left text-base font-semibold text-brand-neutral-black shadow-sm transition-colors active:bg-brand-safe-ivory/50 disabled:opacity-50"
            >
              {pendingSpecialty === specialty ? "Loading…" : CLINICIAN_SPECIALTY_LABEL[specialty]}
            </button>
          ))}
        </div>

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>

      <BottomSheet isOpen={showComingSoon} onClose={() => router.push("/clinician/dashboard")}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-golden-brown/10 text-brand-golden-brown">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-8 w-8"
              aria-hidden="true"
            >
              <circle cx="12" cy="12" r="9" />
              <path d="M12 8v4.5l3 2" />
            </svg>
          </span>
          <h2 className="font-heading text-xl font-bold text-brand-neutral-black">
            Coming Soon
          </h2>
          <p className="text-sm text-brand-neutral-black/70">
            Verification for this clinical role is currently in development.
            We are working closely with regulatory bodies to ensure a secure
            integration. We will notify you when this track opens.
          </p>
          <button
            type="button"
            onClick={() => router.push("/clinician/dashboard")}
            className="mt-2 w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white transition-colors"
          >
            Return
          </button>
        </div>
      </BottomSheet>
    </main>
  );
}
