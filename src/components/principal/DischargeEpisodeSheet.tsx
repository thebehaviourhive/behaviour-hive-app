"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// Tier 1 item 3 (clinic UI layer), extracted 21 Sept 2026 so ChildDetail's
// own per-child Enrolment tab and Directory's Children list share one
// implementation instead of two -- same shape as EndEnrolmentSheet
// (this file's own direct school-side sibling), just resolving its
// reason list from discharge_reasons (a vocabulary table, not a CHECK
// enumeration -- see 0209's own header) instead of a fixed literal set.

interface DischargeReasonOption {
  id: string;
  value: string;
}

interface DischargeEpisodeSheetProps {
  isOpen: boolean;
  episodeId: string;
  institutionId: string;
  childName: string;
  onClose: () => void;
  onDischarged: () => void;
}

export function DischargeEpisodeSheet({
  isOpen,
  episodeId,
  institutionId,
  childName,
  onClose,
  onDischarged,
}: DischargeEpisodeSheetProps) {
  const [reasons, setReasons] = useState<DischargeReasonOption[]>([]);
  const [selectedReasonId, setSelectedReasonId] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("discharge_reasons")
      .select("id, value")
      .eq("is_active", true)
      .or(`institution_id.is.null,institution_id.eq.${institutionId}`)
      .order("sort_order")
      .then(({ data }) => {
        if (isMounted) setReasons((data ?? []) as DischargeReasonOption[]);
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, institutionId]);

  function reset() {
    setSelectedReasonId("");
    setError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    const reason = reasons.find((r) => r.id === selectedReasonId);
    if (!reason) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("end_clinic_episode", {
      p_episode_id: episodeId,
      p_reason: reason.value,
    });

    setIsSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    reset();
    onDischarged();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Discharge {childName}?</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        This ends the episode of care and closes every practitioner&apos;s own caseload access to this client at
        your clinic. This is a record, not a delete -- their history stays intact. A reason is required.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="discharge-episode-reason">
          Reason
        </label>
        <select
          id="discharge-episode-reason"
          value={selectedReasonId}
          onChange={(e) => setSelectedReasonId(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
        >
          <option value="">Select a reason…</option>
          {reasons.map((r) => (
            <option key={r.id} value={r.id}>
              {r.value}
            </option>
          ))}
        </select>
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleConfirm} disabled={!selectedReasonId || isSubmitting} className="mt-5">
        {isSubmitting ? "Discharging…" : "Discharge"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
