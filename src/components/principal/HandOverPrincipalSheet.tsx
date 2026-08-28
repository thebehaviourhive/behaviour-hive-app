"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Stage 1c, Step 3. Same confirmation shape as the FBA finalize-and-lock
// pattern (ReviewSection.tsx) -- pick, confirm, no undo. The successor
// is drawn from the roster the parent page already loaded (active,
// non-principal, not self) rather than a fresh query here -- there is
// no separate "who can I hand over to" lookup, hand_over_principal()'s
// own guards are the real authority; this list is just a convenience
// picker over people who would plausibly pass them.

interface EligibleSuccessor {
  userId: string;
  fullName: string;
}

interface HandOverPrincipalSheetProps {
  isOpen: boolean;
  onClose: () => void;
  eligibleSuccessors: EligibleSuccessor[];
  onHandedOver: (outcome: Outcome, stayingRole: "class_teacher" | "sna" | null) => void;
}

type Outcome = "leaving" | "staying";

export function HandOverPrincipalSheet({ isOpen, onClose, eligibleSuccessors, onHandedOver }: HandOverPrincipalSheetProps) {
  const [mode, setMode] = useState<"form" | "confirm">("form");
  const [successorId, setSuccessorId] = useState("");
  const [outcome, setOutcome] = useState<Outcome>("leaving");
  const [stayingRole, setStayingRole] = useState<"class_teacher" | "sna">("class_teacher");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setMode("form");
    setSuccessorId("");
    setOutcome("leaving");
    setStayingRole("class_teacher");
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  const successorName = eligibleSuccessors.find((s) => s.userId === successorId)?.fullName ?? "";
  const canProceedToConfirm = Boolean(successorId) && reason.trim().length > 0;

  async function handleConfirm() {
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("hand_over_principal", {
      p_successor_user_id: successorId,
      p_outcome: outcome,
      p_staying_role: outcome === "staying" ? stayingRole : null,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    const finishedOutcome = outcome;
    const finishedStayingRole = outcome === "staying" ? stayingRole : null;
    reset();
    onHandedOver(finishedOutcome, finishedStayingRole);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      {mode === "form" ? (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Hand Over Principal Role</h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            Choose an existing member of staff to become principal. They must already be active at this school.
          </p>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Successor</label>
            {eligibleSuccessors.length === 0 ? (
              <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
                No other active staff at this school yet -- someone must join and be approved before you can hand over.
              </p>
            ) : (
              <select
                value={successorId}
                onChange={(e) => setSuccessorId(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
              >
                <option value="">Select a staff member…</option>
                {eligibleSuccessors.map((s) => (
                  <option key={s.userId} value={s.userId}>
                    {s.fullName}
                  </option>
                ))}
              </select>
            )}
          </div>

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">What happens to you</label>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setOutcome("leaving")}
                className={`rounded-xl border p-3 text-left text-sm ${
                  outcome === "leaving" ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/10"
                }`}
              >
                <span className="font-semibold text-brand-neutral-black">Leaving the school</span>
                <span className="mt-0.5 block text-brand-neutral-black/60">
                  Your membership ends. You lose access to this school entirely.
                </span>
              </button>
              <button
                type="button"
                onClick={() => setOutcome("staying")}
                className={`rounded-xl border p-3 text-left text-sm ${
                  outcome === "staying" ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/10"
                }`}
              >
                <span className="font-semibold text-brand-neutral-black">Staying in another role</span>
                <span className="mt-0.5 block text-brand-neutral-black/60">
                  You keep the children you work with. No access is removed.
                </span>
              </button>
            </div>
          </div>

          {outcome === "staying" && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Your new role</label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setStayingRole("class_teacher")}
                  className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold ${
                    stayingRole === "class_teacher" ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue" : "border-black/10 text-brand-neutral-black/60"
                  }`}
                >
                  Class Teacher
                </button>
                <button
                  type="button"
                  onClick={() => setStayingRole("sna")}
                  className={`flex-1 rounded-xl border py-2.5 text-sm font-semibold ${
                    stayingRole === "sna" ? "border-brand-prussian-blue bg-brand-pastel-blue/10 text-brand-prussian-blue" : "border-black/10 text-brand-neutral-black/60"
                  }`}
                >
                  SNA
                </button>
              </div>
            </div>
          )}

          <div className="mt-4">
            <Textarea
              label="Reason"
              id="handover-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Retiring at the end of term"
            />
          </div>

          <Button type="button" onClick={() => setMode("confirm")} disabled={!canProceedToConfirm} className="mt-4">
            Continue
          </Button>
          <Button type="button" variant="secondary" onClick={close} className="mt-2 !border-black/10 !text-black/60">
            Cancel
          </Button>
        </>
      ) : (
        <>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Hand Over to {successorName}?</h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            You will no longer be the principal of this school. This cannot be undone from your account -- only the
            new principal can hand the role back.
          </p>

          {submitError && (
            <p role="alert" className="mt-3 text-sm font-medium text-red-600">
              {submitError}
            </p>
          )}

          <Button type="button" onClick={handleConfirm} disabled={isSubmitting} className="mt-4">
            {isSubmitting ? "Handing over…" : "Hand Over Principal Role"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              if (isSubmitting) return;
              setMode("form");
            }}
            disabled={isSubmitting}
            className="mt-2 !border-black/10 !text-black/60"
          >
            Back
          </Button>
        </>
      )}
    </BottomSheet>
  );
}
