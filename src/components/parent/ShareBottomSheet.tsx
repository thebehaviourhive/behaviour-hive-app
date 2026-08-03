"use client";

import { useEffect, useRef, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { generateUniquePassportCode } from "@/lib/generatePassportCode";
import { logActivity } from "@/lib/logActivity";

export function ShareBottomSheet({
  isOpen,
  onClose,
  passportId,
  childName,
  passportCode,
  onCodeGenerated,
  onApproved,
  onClinicianConnected,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  childName: string;
  passportCode: string | null;
  onCodeGenerated: (code: string) => void;
  onApproved: () => void;
  onClinicianConnected: () => void;
}) {
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasStartedGenerating = useRef(false);

  const [institutionCodeInput, setInstitutionCodeInput] = useState("");
  const [isApproving, setIsApproving] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
  const [approveSuccess, setApproveSuccess] = useState<string | null>(null);

  const [clinicianCodeInput, setClinicianCodeInput] = useState("");
  const [isConnectingClinician, setIsConnectingClinician] = useState(false);
  const [clinicianError, setClinicianError] = useState<string | null>(null);
  const [clinicianSuccess, setClinicianSuccess] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      hasStartedGenerating.current = false;
    }
  }, [isOpen]);

  useEffect(() => {
    // hasStartedGenerating (a ref, not state) guards against double-firing
    // instead of the isGeneratingCode state itself — setting that state
    // inside this effect while also listing it as a dependency would make
    // the effect re-run and cancel its own in-flight request via the
    // cleanup's isMounted flip before the update ever reaches the caller.
    if (!isOpen || passportCode || hasStartedGenerating.current) return;
    hasStartedGenerating.current = true;
    let isMounted = true;

    async function generate() {
      setIsGeneratingCode(true);
      const supabase = createClient();
      try {
        const code = await generateUniquePassportCode(supabase, childName);
        const { error } = await supabase
          .from("passports")
          .update({ passport_code: code })
          .eq("id", passportId);
        if (!isMounted) return;
        if (!error) {
          onCodeGenerated(code);
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (user) {
            logActivity({
              passportId,
              actorId: user.id,
              eventType: "passport_shared",
              eventDescription: "Passport code generated",
            });
          }
        }
      } finally {
        if (isMounted) setIsGeneratingCode(false);
      }
    }

    generate();
    return () => {
      isMounted = false;
    };
  }, [isOpen, passportCode, passportId, childName, onCodeGenerated]);

  function handleCopy() {
    if (!passportCode) return;
    navigator.clipboard.writeText(passportCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function handleClose() {
    setInstitutionCodeInput("");
    setApproveError(null);
    setApproveSuccess(null);
    setClinicianCodeInput("");
    setClinicianError(null);
    setClinicianSuccess(null);
    onClose();
  }

  async function handleApprove() {
    if (!institutionCodeInput.trim()) return;

    setApproveError(null);
    setApproveSuccess(null);
    setIsApproving(true);

    const supabase = createClient();
    const { data: institution, error: lookupError } = await supabase
      .from("institutions")
      .select("id, name")
      .ilike("institution_code", institutionCodeInput.trim())
      .maybeSingle();

    if (lookupError) {
      setIsApproving(false);
      setApproveError(lookupError.message);
      return;
    }

    if (!institution) {
      setIsApproving(false);
      setApproveError(
        "We couldn't find a school with that code. Please check with your school and try again."
      );
      return;
    }

    const { data: existingLink } = await supabase
      .from("passport_institution_links")
      .select("id, approved_by_parent")
      .eq("passport_id", passportId)
      .eq("institution_id", institution.id)
      .maybeSingle();

    if (existingLink?.approved_by_parent) {
      setIsApproving(false);
      setApproveError("You have already approved this school.");
      return;
    }

    const nowIso = new Date().toISOString();
    const { error: saveError } = existingLink
      ? await supabase
          .from("passport_institution_links")
          .update({ approved_by_parent: true, parent_approved_at: nowIso })
          .eq("id", existingLink.id)
      : await supabase.from("passport_institution_links").insert({
          passport_id: passportId,
          institution_id: institution.id,
          approved_by_parent: true,
          parent_approved_at: nowIso,
        });

    setIsApproving(false);

    if (saveError) {
      setApproveError(saveError.message);
      return;
    }

    setInstitutionCodeInput("");
    setApproveSuccess(`${institution.name} has been approved to access ${childName}'s passport.`);
    onApproved();
  }

  async function handleConnectClinician() {
    if (!clinicianCodeInput.trim()) return;

    setClinicianError(null);
    setClinicianSuccess(null);
    setIsConnectingClinician(true);

    const supabase = createClient();
    const { data: clinicianRows, error: lookupError } = await supabase.rpc(
      "lookup_clinician_by_code",
      { code: clinicianCodeInput.trim() }
    );

    if (lookupError) {
      setIsConnectingClinician(false);
      setClinicianError(lookupError.message);
      return;
    }

    const clinician = clinicianRows?.[0] ?? null;

    if (!clinician) {
      setIsConnectingClinician(false);
      setClinicianError(
        "We couldn't find a clinician with that code. Please check with them and try again."
      );
      return;
    }

    const { data: existingAccess } = await supabase
      .from("clinician_access")
      .select("id, is_active")
      .eq("passport_id", passportId)
      .eq("clinician_id", clinician.user_id)
      .maybeSingle();

    if (existingAccess?.is_active) {
      setIsConnectingClinician(false);
      setClinicianError("This clinician is already connected to this passport.");
      return;
    }

    const { error: saveError } = existingAccess
      ? await supabase
          .from("clinician_access")
          .update({ is_active: true, linked_at: new Date().toISOString() })
          .eq("id", existingAccess.id)
      : await supabase.from("clinician_access").insert({
          passport_id: passportId,
          clinician_id: clinician.user_id,
        });

    setIsConnectingClinician(false);

    if (saveError) {
      setClinicianError(saveError.message);
      return;
    }

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) {
      logActivity({
        passportId,
        actorId: user.id,
        eventType: "team_linked",
        eventDescription: `${clinician.full_name ?? "A clinician"} linked to passport`,
      });
    }

    setClinicianCodeInput("");
    setClinicianSuccess(`${clinician.full_name ?? "The clinician"} has been connected to ${childName}'s passport.`);
    onClinicianConnected();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Share {childName}&apos;s Passport
      </h2>

      <p className="mt-4 text-sm font-semibold text-brand-neutral-black">
        Your child&apos;s passport code
      </p>
      <div className="mt-1.5 flex items-center justify-between gap-3 rounded-2xl border border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 px-5 py-4">
        {isGeneratingCode || !passportCode ? (
          <span className="font-heading text-lg text-black/40">Generating…</span>
        ) : (
          <span className="font-heading text-2xl font-bold tracking-widest text-brand-neutral-black">
            {passportCode}
          </span>
        )}
        <button
          type="button"
          onClick={handleCopy}
          disabled={!passportCode}
          className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white disabled:opacity-40"
        >
          {copied ? "Copied!" : "Copy Code"}
        </button>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-black/50">
        Share this code with your child&apos;s class teacher. They will enter
        it in the app to access {childName}&apos;s classroom profile.
      </p>

      <div className="my-5 border-t border-black/5" />

      <p className="text-sm font-semibold text-brand-neutral-black">
        Enter your school&apos;s institution code
      </p>
      <input
        type="text"
        value={institutionCodeInput}
        onChange={(e) => setInstitutionCodeInput(e.target.value)}
        placeholder="e.g. BHPS0000"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {approveError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {approveError}
        </p>
      )}
      {approveSuccess && (
        <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {approveSuccess}
        </p>
      )}

      <button
        type="button"
        onClick={handleApprove}
        disabled={!institutionCodeInput.trim() || isApproving}
        className="mt-4 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isApproving ? "Approving…" : "Approve school access"}
      </button>

      <div className="my-5 border-t border-black/5" />

      <p className="text-sm font-semibold text-brand-neutral-black">
        Enter your clinician&apos;s code
      </p>
      <input
        type="text"
        value={clinicianCodeInput}
        onChange={(e) => setClinicianCodeInput(e.target.value)}
        placeholder="e.g. CL-4821"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-golden-brown focus:outline-none focus:ring-2 focus:ring-brand-golden-brown/30"
      />

      {clinicianError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {clinicianError}
        </p>
      )}
      {clinicianSuccess && (
        <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {clinicianSuccess}
        </p>
      )}

      <button
        type="button"
        onClick={handleConnectClinician}
        disabled={!clinicianCodeInput.trim() || isConnectingClinician}
        className="mt-4 w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isConnectingClinician ? "Connecting…" : "Connect clinician"}
      </button>
    </BottomSheet>
  );
}
