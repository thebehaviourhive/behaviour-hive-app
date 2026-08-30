"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 4, Step 3. The picker shows ALL active staff, not
// pre-filtered to class_teacher/sna -- matching GrantTemporaryAccessSheet's
// own principal-mode precedent exactly ("not restricted to any one role
// ... excludes the principal themselves the same way the RPC would
// refuse a self-grant anyway"). grant_passport_access() itself is the
// real, only gate; this sheet doesn't pre-empt it by hiding options,
// which would just move the same refusal one screen earlier without
// explaining it any better.
//
// Three of grant_passport_access()'s refusals are genuinely reachable
// through this sheet and get honest, actionable copy instead of raw RPC
// text: the target's own standing changed underneath the picker (race,
// not expected but possible), the target isn't a class teacher or SNA
// (reachable because the picker is deliberately unfiltered, above), and
// no institution link exists for this child. THE FOURTH -- Step 2's own
// cross-institution reactivation refusal (CHECK EE-5b) -- is real and
// adversarially proven, but not reachable from THIS sheet today: every
// child offered here comes from get_institution_child_roster(), an
// INNER JOIN to passport_institution_links, so a passportId with no
// link at all can't reach this picker in the first place. Named
// honestly rather than claimed as observed: kept as defense-in-depth
// for whenever grant_passport_access() is called from anywhere else.

interface EligibleStaff {
  userId: string;
  fullName: string;
}

interface GrantPassportAccessSheetProps {
  isOpen: boolean;
  passportId: string;
  institutionId: string;
  childName: string;
  eligibleStaff: EligibleStaff[];
  onClose: () => void;
  onGranted: () => void;
}

function friendlyGrantError(message: string): string {
  if (/different institution/i.test(message)) {
    return "This person's access to this child belongs to another school and can't be reactivated from here. If they should have access at your school too, that needs sorting out with the other school first.";
  }
  if (/not an active member/i.test(message)) {
    return "This person's standing at your school has changed since this list loaded. Refresh and try again.";
  }
  if (/class teacher or SNA/i.test(message)) {
    return "Passport access can only be granted to a class teacher or SNA — not a principal or admin.";
  }
  if (/no link to your institution/i.test(message)) {
    return "This child has no connection to your school yet. Ask their parent to add your school in the app first — then you'll be able to grant access.";
  }
  if (/already has active/i.test(message)) {
    return "They already have active access to this child.";
  }
  return message;
}

export function GrantPassportAccessSheet({
  isOpen,
  passportId,
  institutionId,
  childName,
  eligibleStaff,
  onClose,
  onGranted,
}: GrantPassportAccessSheetProps) {
  const [userId, setUserId] = useState("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setUserId("");
    setReason("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleSubmit() {
    if (!userId) {
      setSubmitError("Choose a staff member.");
      return;
    }
    if (!reason.trim()) {
      setSubmitError("A reason is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("grant_passport_access", {
      p_passport_id: passportId,
      p_user_id: userId,
      p_institution_id: institutionId,
      p_reason: reason.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(friendlyGrantError(error.message));
      return;
    }
    reset();
    onGranted();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Grant Access to {childName}</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        They&apos;ll be able to see {childName}&apos;s passport, log ABC incidents, and message about them, the same
        as any other teacher or SNA with access.
      </p>

      <div className="mt-4">
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">Staff Member</label>
        {eligibleStaff.length === 0 ? (
          <p className="rounded-xl border border-dashed border-black/10 bg-brand-off-white/40 p-3 text-sm text-brand-neutral-black/60">
            No active staff at this school.
          </p>
        ) : (
          <select
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
          >
            <option value="">Select…</option>
            {eligibleStaff.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.fullName}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="mt-4">
        <Textarea
          label="Reason"
          id="grant-passport-access-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Now teaches this child's class"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSubmit} disabled={isSubmitting || eligibleStaff.length === 0} className="mt-4">
        {isSubmitting ? "Granting…" : "Grant Access"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
