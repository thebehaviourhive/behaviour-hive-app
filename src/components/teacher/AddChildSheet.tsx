"use client";

import { useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { getChildFirstName } from "@/lib/childDisplayName";
import { logActivity } from "@/lib/logActivity";

export function AddChildSheet({
  isOpen,
  onClose,
  teacherId,
  teacherName,
  institutionId,
  institutionCode,
  onAdded,
}: {
  isOpen: boolean;
  onClose: () => void;
  teacherId: string;
  teacherName: string;
  institutionId: string;
  institutionCode: string | null;
  onAdded: () => void;
}) {
  const [passportCode, setPassportCode] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  function handleClose() {
    setPassportCode("");
    setError(null);
    setSuccess(null);
    onClose();
  }

  async function handleConfirm() {
    if (!passportCode.trim()) return;

    setError(null);
    setSuccess(null);
    setIsSaving(true);

    const supabase = createClient();

    const { data: passportRows, error: lookupError } = await supabase.rpc(
      "lookup_passport_by_code",
      { code: passportCode.trim() }
    );

    if (lookupError) {
      setIsSaving(false);
      setError(lookupError.message);
      return;
    }

    const passport = passportRows?.[0] ?? null;

    if (!passport) {
      setIsSaving(false);
      setError(
        "We couldn't find a child with that code. Please check with the parent and try again."
      );
      return;
    }

    if (!passport.passport_code_active) {
      setIsSaving(false);
      setError("This code has been deactivated by the parent. Please ask them to share a new code.");
      return;
    }

    const { data: link } = await supabase
      .from("passport_institution_links")
      .select("id")
      .eq("passport_id", passport.id)
      .eq("institution_id", institutionId)
      .eq("approved_by_parent", true)
      .maybeSingle();

    if (!link) {
      setIsSaving(false);
      setError(
        `This passport has not been approved for your school. Please ask the parent to approve your school first using your institution code ${institutionCode ?? ""}.`
      );
      return;
    }

    const { data: existingAccess } = await supabase
      .from("passport_access")
      .select("id, is_active")
      .eq("passport_id", passport.id)
      .eq("teacher_id", teacherId)
      .maybeSingle();

    if (existingAccess?.is_active) {
      setIsSaving(false);
      setError("You already have access to this child's passport.");
      return;
    }

    const { data: reactivatedRows, error: saveError } = existingAccess
      ? await supabase
          .from("passport_access")
          .update({ is_active: true, linked_at: new Date().toISOString() })
          .eq("id", existingAccess.id)
          .select("id")
      : await supabase.from("passport_access").insert({
          passport_id: passport.id,
          teacher_id: teacherId,
          institution_id: institutionId,
          is_active: true,
        });

    setIsSaving(false);

    if (saveError) {
      setError(saveError.message);
      return;
    }

    // An UPDATE can be RLS-filtered down to zero matching rows and still
    // report success (no error) -- .select() here is what lets us tell
    // the two apart, since a genuinely applied update always returns the
    // row it touched.
    if (existingAccess && (!reactivatedRows || reactivatedRows.length === 0)) {
      setError(
        "We couldn't restore access to this child's passport. Please ask the parent to re-approve your school, then try again."
      );
      return;
    }

    logActivity({
      passportId: passport.id,
      actorId: teacherId,
      eventType: "team_linked",
      eventDescription: `${teacherName} linked to passport`,
    });

    setPassportCode("");
    setSuccess(`${getChildFirstName(passport.child_name)} has been added to your dashboard.`);
    onAdded();
    setTimeout(handleClose, 1200);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={handleClose}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Add a Child
      </h2>
      <p className="mt-1 text-sm text-black/60">
        Enter the child&apos;s passport code shared by the parent to access
        their classroom profile.
      </p>

      <label className="mt-5 block text-sm font-semibold text-brand-neutral-black">
        Enter the child&apos;s passport code
      </label>
      <input
        type="text"
        value={passportCode}
        onChange={(e) => setPassportCode(e.target.value)}
        placeholder="e.g. SAM-4821"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base uppercase tracking-widest text-brand-neutral-black placeholder:normal-case placeholder:tracking-normal placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}
      {success && (
        <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-sm font-medium text-green-800">
          {success}
        </p>
      )}

      <button
        type="button"
        onClick={handleConfirm}
        disabled={!passportCode.trim() || isSaving}
        className="mt-5 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
      >
        {isSaving ? "Checking…" : "Add child to dashboard"}
      </button>
    </BottomSheet>
  );
}
