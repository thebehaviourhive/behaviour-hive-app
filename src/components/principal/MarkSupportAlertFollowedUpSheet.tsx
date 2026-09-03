"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Support Button, item 7. Single-outcome confirm-with-a-required-note --
// deliberately NOT built as a generic reusable primitive. Checked all
// eight existing WorkQueueRow buckets on this dashboard first: only one
// (join requests, ReviewStaffJoinSheet) collects anything note-like, and
// that one is a genuinely different shape -- two live outcomes
// (approve/reject), not a single confirm. This is the first, and so far
// only, plain "confirm with a required note" case on this page; if a
// second one turns up, THAT'S the point to extract a shared primitive,
// not before.

interface OutstandingSupportAlert {
  id: string;
  raised_by_name: string | null;
  room_names: string[];
  raised_at: string;
}

interface MarkSupportAlertFollowedUpSheetProps {
  alert: OutstandingSupportAlert;
  isOpen: boolean;
  onClose: () => void;
  onResolved: () => void;
}

export function MarkSupportAlertFollowedUpSheet({
  alert,
  isOpen,
  onClose,
  onResolved,
}: MarkSupportAlertFollowedUpSheetProps) {
  const [note, setNote] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setNote("");
    setSubmitError(null);
  }

  async function handleSubmit() {
    if (!note.trim()) {
      setSubmitError("A note is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("mark_support_alert_followed_up", {
      p_support_alert_id: alert.id,
      p_note: note.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onResolved();
  }

  const room = alert.room_names.length > 0 ? alert.room_names.join(", ") : "no room named";
  const time = new Date(alert.raised_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (isSubmitting) return;
        reset();
        onClose();
      }}
    >
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
        Support Requested by {alert.raised_by_name ?? "a staff member"}
      </h2>
      <p className="mt-1 text-sm text-brand-neutral-black/60">
        Raised at {time} - {room}.
      </p>

      <p className="mt-4 text-sm leading-relaxed text-brand-neutral-black/70">
        Say what you did in response -- who you spoke to, what was checked, or why no further action was needed.
      </p>

      <div className="mt-4">
        <Textarea
          label="Follow-up note"
          id="support-alert-followup-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="e.g. Spoke to Ms Fitzgerald after school, situation resolved -- no further action needed."
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Saving…" : "Mark Followed Up"}
      </Button>
    </BottomSheet>
  );
}
