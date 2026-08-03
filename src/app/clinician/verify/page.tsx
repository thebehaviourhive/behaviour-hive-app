"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TextField } from "@/components/ui/TextField";
import { Checkbox } from "@/components/ui/Checkbox";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";

export default function ClinicianVerifyPage() {
  const router = useRouter();
  const { isReady } = useRequireRole("clinician");

  const [fullName, setFullName] = useState("");
  const [psiNumber, setPsiNumber] = useState("");
  const [coruNumber, setCoruNumber] = useState("");
  const [bacbNumber, setBacbNumber] = useState("");
  const [governmentId, setGovernmentId] = useState("");
  const [gardaVetting, setGardaVetting] = useState(false);
  const [professionalIndemnity, setProfessionalIndemnity] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const isComplete =
    fullName.trim() &&
    psiNumber.trim() &&
    coruNumber.trim() &&
    bacbNumber.trim() &&
    governmentId.trim() &&
    gardaVetting &&
    professionalIndemnity;

  async function handleSubmit() {
    if (!isComplete) return;

    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("submit_clinician_verification", {
      p_full_name: fullName.trim(),
      p_psi_membership_number: psiNumber.trim(),
      p_coru_registration_number: coruNumber.trim(),
      p_bacb_certification_number: bacbNumber.trim(),
      p_government_id_number: governmentId.trim(),
      p_garda_vetting_declared: gardaVetting,
      p_professional_indemnity_declared: professionalIndemnity,
    });

    setIsSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    router.push("/clinician/dashboard");
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory px-4 pt-8 pb-10">
      <div className="mx-auto w-full max-w-sm">
        <h1 className="mb-1 font-heading text-2xl font-bold text-brand-prussian-blue">
          Verify your credentials
        </h1>
        <p className="mb-6 text-sm text-brand-neutral-black/70">
          This information is used once for manual verification and is never
          displayed on your profile.
        </p>

        <div className="flex flex-col gap-5 rounded-3xl border-t-4 border-brand-golden-brown bg-white p-6 shadow-sm">
          <TextField
            label="Full Name"
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
          />
          <TextField
            label="PSI Membership Number"
            type="text"
            value={psiNumber}
            onChange={(e) => setPsiNumber(e.target.value)}
          />
          <TextField
            label="CORU Registration Number"
            type="text"
            value={coruNumber}
            onChange={(e) => setCoruNumber(e.target.value)}
          />
          <TextField
            label="BACB Certification Number"
            type="text"
            value={bacbNumber}
            onChange={(e) => setBacbNumber(e.target.value)}
          />
          <div>
            <TextField
              label="Government ID"
              type="text"
              value={governmentId}
              onChange={(e) => setGovernmentId(e.target.value)}
            />
            <p className="mt-1.5 text-xs leading-relaxed text-brand-neutral-black/50">
              Driver&apos;s Licence or Passport Number. This sensitive
              information is used once for manual verification and is never
              displayed on your profile.
            </p>
          </div>

          <div className="my-1 h-px bg-black/10" />

          <Checkbox
            id="garda-vetting"
            checked={gardaVetting}
            onChange={setGardaVetting}
            required
            label="I confirm I hold valid Garda Vetting clearance to work with minors in the Republic of Ireland/UK."
          />
          <Checkbox
            id="professional-indemnity"
            checked={professionalIndemnity}
            onChange={setProfessionalIndemnity}
            required
            label="I confirm I hold valid personal or company-provided professional indemnity insurance cover."
          />

          {error && (
            <p role="alert" className="text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isComplete || isSubmitting}
            className="w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
          >
            {isSubmitting ? "Submitting…" : "Submit Credentials"}
          </button>
        </div>
      </div>
    </main>
  );
}
