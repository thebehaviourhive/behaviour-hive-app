"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Staff Lifecycle Stage 1, Step 3. The leaving checklist is not a
// blocker -- the principal sees what this person leaves behind, then
// proceeds regardless if they choose to. "Classes or children they are
// assigned to" is real data here, not empty-until-Stage-2: the cascade
// (0097) already closes passport_access grants on deactivation, so the
// principal is entitled to see exactly which children that affects
// before confirming, not discover it after.

interface StaffMember {
  id: string;
  user_id: string;
  full_name: string;
  role: string;
}

interface Preview {
  unsigned_incidents: { incident_id: string; occurred_at: string; status: string }[];
  outstanding_attestations: { incident_id: string; occurred_at: string }[];
  active_children: { passport_id: string; child_name: string }[];
}

interface DeactivateStaffSheetProps {
  member: StaffMember;
  isOpen: boolean;
  onClose: () => void;
  onDeactivated: () => void;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export function DeactivateStaffSheet({ member, isOpen, onClose, onDeactivated }: DeactivateStaffSheetProps) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [isLoadingPreview, setIsLoadingPreview] = useState(true);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  // member.id (institution_staff's own row id) comes straight from
  // get_institution_staff_roster() (0099) -- institution_staff has no
  // SELECT policy broad enough for a principal to look up a colleague's
  // row directly (auth.uid() = user_id only), so re-querying the table
  // here would silently return zero rows under RLS, not an error. Found
  // live, in the browser, the first time this shipped without the id.
  const loadPreview = useCallback(async () => {
    setIsLoadingPreview(true);
    setPreviewError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_staff_deactivation_preview", {
      p_institution_staff_id: member.id,
    });
    if (error) {
      setPreviewError(error.message);
      setIsLoadingPreview(false);
      return;
    }
    setPreview(data as Preview);
    setIsLoadingPreview(false);
  }, [member.id]);

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadPreview();
  }, [isOpen, loadPreview]);

  function reset() {
    setReason("");
    setSubmitError(null);
  }

  async function handleDeactivate() {
    if (!reason.trim()) {
      setSubmitError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("deactivate_institution_staff", {
      p_institution_staff_id: member.id,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onDeactivated();
  }

  const unsignedCount = preview?.unsigned_incidents.length ?? 0;
  const attestationCount = preview?.outstanding_attestations.length ?? 0;
  const childrenCount = preview?.active_children.length ?? 0;
  const leavesNothingBehind = !isLoadingPreview && !previewError && unsignedCount === 0 && attestationCount === 0 && childrenCount === 0;

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (isSubmitting) return;
        reset();
        onClose();
      }}
    >
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Deactivate {member.full_name}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        They will lose access to this school immediately. Everything they have written stays on the record, in their name.
      </p>

      <div className="mt-4">
        {isLoadingPreview ? (
          <div className="h-20 animate-pulse rounded-xl bg-brand-off-white/60" />
        ) : previewError ? (
          <p className="text-sm text-red-600">{previewError}</p>
        ) : leavesNothingBehind ? (
          <p className="rounded-xl border border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
            Nothing outstanding for this person.
          </p>
        ) : (
          <div className="flex flex-col gap-2 rounded-xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-golden-brown">Before you deactivate</p>
            {unsignedCount > 0 && (
              <p className="text-sm text-brand-neutral-black">
                {unsignedCount} incident{unsignedCount === 1 ? "" : "s"} they own {unsignedCount === 1 ? "is" : "are"} not signed off
                {preview?.unsigned_incidents[0] && ` (earliest ${formatDate(preview.unsigned_incidents[0].occurred_at)})`}.
              </p>
            )}
            {attestationCount > 0 && (
              <p className="text-sm text-brand-neutral-black">
                {attestationCount} attestation{attestationCount === 1 ? "" : "s"} outstanding against them.
              </p>
            )}
            {childrenCount > 0 && (
              <p className="text-sm text-brand-neutral-black">
                They currently have access to {childrenCount} child{childrenCount === 1 ? "" : "ren"}
                {": " + preview?.active_children.map((c) => c.child_name).join(", ")} -- this ends immediately on deactivation.
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-4">
        <Textarea
          label="Reason"
          id="deactivation-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Left the school"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {submitError}
        </p>
      )}

      <Button
        type="button"
        onClick={handleDeactivate}
        disabled={isSubmitting || isLoadingPreview}
        className="mt-4 !bg-brand-golden-brown"
      >
        {isSubmitting ? "Deactivating…" : "Deactivate"}
      </Button>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          if (isSubmitting) return;
          reset();
          onClose();
        }}
        disabled={isSubmitting}
        className="mt-2 !border-black/10 !text-black/60"
      >
        Cancel
      </Button>
    </BottomSheet>
  );
}
