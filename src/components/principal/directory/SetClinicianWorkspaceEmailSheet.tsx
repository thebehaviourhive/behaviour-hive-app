"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 9, Stage 1 -- mirrors SetStartTimeSheet's own shape. Clinic-only
// (gated at the call site in ClinicianCoverageDetail, institutionType
// === "clinic") and director-set, never self-declared -- see
// set_clinician_workspace_email()'s own migration comment (0255) for
// why: a wrong-but-real address silently misdirects the Domain-Wide
// Delegation service account to a different real person's calendar,
// with nothing failing to signal it. Only a director's own knowledge
// of their own roster closes that gap.

interface SetClinicianWorkspaceEmailSheetProps {
  isOpen: boolean;
  institutionId: string;
  clinicianUserId: string;
  clinicianName: string;
  currentWorkspaceEmail: string | null;
  onClose: () => void;
  onSaved: (newWorkspaceEmail: string) => void;
}

export function SetClinicianWorkspaceEmailSheet({
  isOpen,
  institutionId,
  clinicianUserId,
  clinicianName,
  currentWorkspaceEmail,
  onClose,
  onSaved,
}: SetClinicianWorkspaceEmailSheetProps) {
  const [value, setValue] = useState(currentWorkspaceEmail ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function close() {
    if (isSubmitting) return;
    setSubmitError(null);
    onClose();
  }

  async function handleSave() {
    const trimmed = value.trim();
    if (!trimmed) {
      setSubmitError("A Workspace email is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_clinician_workspace_email", {
      p_institution_id: institutionId,
      p_clinician_user_id: clinicianUserId,
      p_workspace_email: trimmed,
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    onSaved(trimmed.toLowerCase());
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Workspace Email</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        The Google Workspace address for {clinicianName}&apos;s own calendar. This is what parents will book
        against -- an address that belongs to the wrong real person will silently check and hold time on THEIR
        calendar instead, with nothing failing to say so. Set this only from what you know is correct.
      </p>

      <div className="mt-4">
        <label htmlFor="workspace-email" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Workspace email
        </label>
        <input
          id="workspace-email"
          type="email"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="name@yourclinic.ie"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSave} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Saving…" : "Save"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
