"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { createClient } from "@/lib/supabase/client";

// PRD 10 Stage 5 -- the lead_can_reassign_within_scope toggle's own
// missing capability, built (reassign_clinician_caseload(), 0272), now
// given a real screen. Picks from get_institution_roster_clinicians_
// for_caseload() -- the same roster the director's own caseload-
// assignment picker already uses (ClinicianCoverageDetail.tsx),
// widened in 0272 to admit a lead's own read of it. A reason is
// required, matching every other consequential clinic-side action
// (discharge, revoke) already does.

interface RosterOption {
  userId: string;
  fullName: string;
  specialty: string;
  coveredChildCount: number;
}

interface ReassignCaseloadSheetProps {
  isOpen: boolean;
  clinicianAccessId: string;
  institutionId: string;
  childName: string;
  currentClinicianName: string;
  onClose: () => void;
  onReassigned: () => void;
}

export function ReassignCaseloadSheet({
  isOpen,
  clinicianAccessId,
  institutionId,
  childName,
  currentClinicianName,
  onClose,
  onReassigned,
}: ReassignCaseloadSheetProps) {
  const [roster, setRoster] = useState<RosterOption[]>([]);
  const [selectedUserId, setSelectedUserId] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    const supabase = createClient();
    supabase
      .rpc("get_institution_roster_clinicians_for_caseload", { p_institution_id: institutionId })
      .then(({ data, error: rosterError }) => {
        if (!isMounted) return;
        if (rosterError) {
          setError("Could not load this clinic's own practitioners.");
          return;
        }
        setRoster(
          ((data ?? []) as { user_id: string; full_name: string; specialty: string; covered_child_count: number }[]).map((r) => ({
            userId: r.user_id,
            fullName: r.full_name ?? "This practitioner",
            specialty: r.specialty,
            coveredChildCount: r.covered_child_count,
          }))
        );
      });
    return () => {
      isMounted = false;
    };
  }, [isOpen, institutionId]);

  function reset() {
    setSelectedUserId("");
    setReason("");
    setError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleConfirm() {
    if (!selectedUserId || coalesceEmpty(reason) === "") return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("reassign_clinician_caseload", {
      p_clinician_access_id: clinicianAccessId,
      p_new_clinician_user_id: selectedUserId,
      p_reason: reason,
    });

    setIsSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    reset();
    onReassigned();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Reassign {childName}?</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Moves this client from {currentClinicianName}&apos;s own caseload to a different practitioner at your clinic.
        {currentClinicianName}&apos;s own access ends the moment this is confirmed.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="reassign-new-clinician">
          New practitioner
        </label>
        <select
          id="reassign-new-clinician"
          value={selectedUserId}
          onChange={(e) => setSelectedUserId(e.target.value)}
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
        >
          <option value="">Select a practitioner…</option>
          {roster.map((r) => (
            <option key={r.userId} value={r.userId}>
              {r.fullName} ({r.coveredChildCount} on caseload)
            </option>
          ))}
        </select>
      </div>

      <div className="mt-4">
        <Textarea
          id="reassign-reason"
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Why is this client being reassigned?"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {error}
        </p>
      )}

      <Button
        type="button"
        onClick={handleConfirm}
        disabled={!selectedUserId || coalesceEmpty(reason) === "" || isSubmitting}
        className="mt-5"
      >
        {isSubmitting ? "Reassigning…" : "Reassign"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}

function coalesceEmpty(value: string): string {
  return value.trim();
}
