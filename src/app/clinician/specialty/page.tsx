"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { hasConsented } from "@/lib/hasConsented";
import {
  CLINICIAN_SPECIALTIES,
  CLINICIAN_SPECIALTY_LABEL,
  type ClinicianSpecialty as Specialty,
} from "@/lib/clinicianSpecialties";
import { CLINICAL_DOMAINS, CLINICAL_DOMAIN_LABEL, type ClinicalDomain } from "@/lib/clinicalDomains";

export default function ClinicianSpecialtyPage() {
  const router = useRouter();
  // allowBeforeConsent: true -- picking a specialty is this role's own
  // "joining" moment under the onboarding restructure (Sept 2026),
  // gated BEFORE consent now, the same way institution-code entry is
  // for staff. Confirmed safe for a RETURN visit too (PRD 7 Stage 3):
  // for an already-consented user this option is a pure no-op --
  // useRequireRole's own hasConsented() check is simply skipped, which
  // has no effect once consent is already recorded. See the option's
  // own doc comment for the full reasoning.
  const { isReady, user } = useRequireRole("clinician", { allowBeforeConsent: true });

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const [isReturnVisit, setIsReturnVisit] = useState(false);
  const [verificationRoute, setVerificationRoute] = useState<"behaviour_hive" | "organisation" | null>(null);
  const [specialty, setSpecialty] = useState<Specialty | null>(null);
  const [domainTags, setDomainTags] = useState<ClinicalDomain[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [showComingSoon, setShowComingSoon] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const [{ data: clinician }, consented] = await Promise.all([
        supabase
          .from("clinicians")
          .select("specialty, domain_tags, verification_route")
          .eq("user_id", user!.id)
          .maybeSingle(),
        hasConsented(supabase, user!.id),
      ]);

      if (!isMounted) return;

      // A return visit is anyone who's already past consent -- the one
      // context this page could never reach during onboarding itself,
      // since onboarding always visits this page BEFORE /consent. Used
      // only to decide where Save sends you afterward, and whether the
      // independent path's "Coming Soon" detour still applies (it never
      // did for an organisation-verified practitioner -- see below --
      // but a return visit is the only real way one reaches this page
      // at all, so it's the case that actually exercises that branch).
      setIsReturnVisit(consented);
      if (clinician) {
        setSpecialty(clinician.specialty as Specialty);
        setDomainTags((clinician.domain_tags ?? []) as ClinicalDomain[]);
        setVerificationRoute(clinician.verification_route);
      }
      setIsLoadingProfile(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  function toggleDomain(domain: ClinicalDomain) {
    setDomainTags((current) =>
      current.includes(domain) ? current.filter((d) => d !== domain) : [...current, domain]
    );
  }

  async function handleSave() {
    if (!specialty || !user) return;
    setError(null);
    setIsSaving(true);

    const supabase = createClient();

    // select_clinician_specialty() upserts the clinicians row first --
    // the domain_tags write below needs that row to already exist, so
    // this has to run first, not in parallel with it.
    const { error: specialtyError } = await supabase.rpc("select_clinician_specialty", {
      p_specialty: specialty,
    });

    if (specialtyError) {
      setIsSaving(false);
      setError(specialtyError.message);
      return;
    }

    const { error: domainError } = await supabase
      .from("clinicians")
      .update({ domain_tags: domainTags })
      .eq("user_id", user.id);

    setIsSaving(false);

    if (domainError) {
      setError(domainError.message);
      return;
    }

    if (isReturnVisit) {
      setShowSaved(true);
      return;
    }

    // Onboarding path, unchanged from before this stage: an
    // organisation-verified clinic practitioner was never gated on
    // specialty to begin with (their director's own approval is their
    // verification, per 0222/ClinicianAccessGate's own route-aware
    // fix) -- so the "Coming Soon" detour, which exists only for the
    // independent, behaviour_hive-reviewed path's real specialty
    // restriction, never applied to them either. This was a latent
    // inconsistency with the dashboard's own gate (which already
    // checked verificationRoute) that this stage's own recon surfaced
    // and fixes here as a direct byproduct, not a separate change.
    if (specialty === "behavioural_psychologist" || verificationRoute === "organisation") {
      router.push("/consent");
      return;
    }

    setShowComingSoon(true);
  }

  if (!isReady || isLoadingProfile) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            {isReturnVisit ? "Your specialty & domains" : "Select your clinical specialty"}
          </h1>
          {isReturnVisit && (
            <p className="text-sm text-brand-neutral-black/60">
              Update what you do and which clinical domains you work in. Nobody needs to verify this — it&apos;s a
              fact you&apos;re simply stating about yourself.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          {CLINICIAN_SPECIALTIES.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setSpecialty(option)}
              className={`rounded-2xl border p-4 text-left text-base font-semibold shadow-sm transition-colors active:bg-black/[0.02] ${
                specialty === option
                  ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                  : "border-black/5 bg-white text-brand-neutral-black"
              }`}
            >
              {CLINICIAN_SPECIALTY_LABEL[option]}
            </button>
          ))}
        </div>

        <div className="mt-6">
          <p className="mb-1 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
            Clinical Domains
          </p>
          <p className="mb-3 text-xs text-brand-neutral-black/50">
            Select every domain your work touches. This helps colleagues on a shared case find what&apos;s theirs to
            read — it never restricts your own access to your own caseload.
          </p>
          <div className="flex flex-wrap gap-2">
            {CLINICAL_DOMAINS.map((domain) => {
              const isSelected = domainTags.includes(domain);
              return (
                <button
                  key={domain}
                  type="button"
                  onClick={() => toggleDomain(domain)}
                  aria-pressed={isSelected}
                  className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                    isSelected
                      ? "border-brand-golden-brown bg-brand-golden-brown text-white"
                      : "border-black/10 bg-white text-brand-neutral-black"
                  }`}
                >
                  {CLINICAL_DOMAIN_LABEL[domain]}
                </button>
              );
            })}
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={!specialty || isSaving}
          className="mt-6 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? "Saving…" : "Save"}
        </button>

        {error && (
          <p role="alert" className="mt-4 text-sm font-medium text-red-600">
            {error}
          </p>
        )}
      </div>

      <BottomSheet isOpen={showComingSoon} onClose={() => router.push("/consent")}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
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
          <h2 className="font-heading text-xl font-bold text-brand-neutral-black">Coming Soon</h2>
          <p className="text-sm text-brand-neutral-black/70">
            Verification for this clinical role is currently in development. We are working closely with regulatory
            bodies to ensure a secure integration. We will notify you when this track opens.
          </p>
          <button
            type="button"
            onClick={() => router.push("/consent")}
            className="mt-2 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors"
          >
            Return
          </button>
        </div>
      </BottomSheet>

      <BottomSheet isOpen={showSaved} onClose={() => router.push("/more")}>
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex h-16 w-16 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-brand-prussian-blue">
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
              <path d="M5 13l4 4L19 7" />
            </svg>
          </span>
          <h2 className="font-heading text-xl font-bold text-brand-neutral-black">Saved</h2>
          <p className="text-sm text-brand-neutral-black/70">
            Your specialty and clinical domains have been updated.
          </p>
          <button
            type="button"
            onClick={() => router.push("/more")}
            className="mt-2 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors"
          >
            Done
          </button>
        </div>
      </BottomSheet>
    </main>
  );
}
