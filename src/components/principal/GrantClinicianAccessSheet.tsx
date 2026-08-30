"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 7, Step 2. The institution-side counterpart to
// ShareBottomSheet's own clinician-code section -- same single-step
// lookup-then-connect UX (no separate preview step), wired to
// grant_clinician_access() (0123) instead of connect_clinician(), so
// the row this creates is stamped engaged_by='institution' with this
// principal's own institution_id, not 'parent'.
//
// friendlyGrantError() below covers the double-engagement refusal
// grant_clinician_access() raises in both directions -- a parent's own
// engagement can't be taken over here, and neither can another
// school's -- so a principal sees the actual reason, not a raw RPC
// message.

interface GrantClinicianAccessSheetProps {
  isOpen: boolean;
  passportId: string;
  institutionId: string;
  childName: string;
  onClose: () => void;
  onGranted: (clinicianName: string) => void;
}

function friendlyGrantError(message: string): string {
  if (/engaged by this child's parent/i.test(message)) {
    return "This clinician is already connected by this child's parent or guardian. A school can't take over a parent's own clinical engagement — connect a different clinician, or ask the family to make the introduction.";
  }
  if (/engaged by a different school/i.test(message)) {
    return "This clinician was connected by a different school for this child and can't be reactivated here.";
  }
  if (/already has active access/i.test(message)) {
    return "This clinician already has active access to this child.";
  }
  if (/no link to your institution/i.test(message)) {
    return "This child has no connection to your school yet.";
  }
  if (/couldn't find a clinician/i.test(message)) {
    return "We couldn't find a clinician with that code. Please check with them and try again.";
  }
  return message;
}

export function GrantClinicianAccessSheet({
  isOpen,
  passportId,
  institutionId,
  childName,
  onClose,
  onGranted,
}: GrantClinicianAccessSheetProps) {
  const [codeInput, setCodeInput] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setCodeInput("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!codeInput.trim()) return;
    setIsSubmitting(true);
    setSubmitError(null);

    const supabase = createClient();

    // Looked up first purely for the confirmation copy's own name --
    // grant_clinician_access() re-resolves the code itself server-side
    // rather than trusting this lookup's result, same posture as
    // ShareBottomSheet's own clinician section.
    const { data: clinicianRows, error: lookupError } = await supabase.rpc(
      "lookup_clinician_by_code",
      { code: codeInput.trim() }
    );
    if (lookupError) {
      setIsSubmitting(false);
      setSubmitError(friendlyGrantError(lookupError.message));
      return;
    }
    const clinician = clinicianRows?.[0] ?? null;
    if (!clinician) {
      setIsSubmitting(false);
      setSubmitError(
        "We couldn't find a clinician with that code. Please check with them and try again."
      );
      return;
    }

    const { error } = await supabase.rpc("grant_clinician_access", {
      p_institution_id: institutionId,
      p_passport_id: passportId,
      p_clinician_code: codeInput.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(friendlyGrantError(error.message));
      return;
    }
    reset();
    onGranted(clinician.full_name ?? "The clinician");
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Connect a Clinician to {childName}
      </h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Enter the clinician&apos;s own code to connect them on your school&apos;s
        behalf. They&apos;ll be able to see {childName}&apos;s passport as part of
        your school&apos;s clinical team.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="grant-clinician-code">
          Clinician code
        </label>
        <input
          id="grant-clinician-code"
          type="text"
          value={codeInput}
          onChange={(e) => setCodeInput(e.target.value)}
          placeholder="e.g. CL-4821"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSubmit} disabled={isSubmitting || !codeInput.trim()} className="mt-4">
        {isSubmitting ? "Connecting…" : "Connect Clinician"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
