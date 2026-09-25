"use client";

import { useEffect, useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// The centre_manager dashboard build, 25 Sept 2026 -- end_clinic_
// episode() has carried a real respite branch since 0297 (confirmed by
// reading its live body directly), with zero client callers reachable
// by centre_manager -- the only existing caller, DischargeEpisodeSheet,
// is wired into principal/clinic-only screens and uses clinic-specific
// copy ("at your clinic", "Discharge"). A dedicated sheet with
// placement-appropriate wording, not a widening of that one -- same
// reasoning RedeemLinkCodeSheet already established for this codebase:
// a shared component entangling a third institution type's own
// vocabulary with a different one's is the wrong shape, even when the
// underlying RPC is identical.
//
// discharge_reasons is reused as-is, not forked -- the seeded values
// ("Goals met", "Transferred to another provider", etc.) are Behaviour-
// Hive-controlled vocabulary, global by default (institution_id is
// null), and nothing about them is factually wrong for a respite
// placement ending. A respite-specific reason set is a real product
// decision for whoever owns that vocabulary, not something to invent
// here.

interface DischargeReasonOption {
  id: string;
  value: string;
}

export function EndPlacementSheet({
  isOpen,
  episodeId,
  institutionId,
  childName,
  onClose,
  onEnded,
}: {
  isOpen: boolean;
  episodeId: string;
  institutionId: string;
  childName: string;
  onClose: () => void;
  onEnded: () => void;
}) {
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
    onEnded();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">End {childName}&apos;s placement?</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        This ends their placement at your centre and closes your team&apos;s access to their record between stays.
        This is a record, not a delete -- their history stays intact. A reason is required.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="end-placement-reason">
          Reason
        </label>
        <select
          id="end-placement-reason"
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
        {isSubmitting ? "Ending…" : "End Placement"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
