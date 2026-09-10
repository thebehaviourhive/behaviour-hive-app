"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { BottomSheet } from "@/components/ui/BottomSheet";

// Phase 4, piece 3. The disagreement path: append-only, attributed,
// never edits the teacher's own narrative -- incident_amendments has no
// UPDATE or DELETE policy at all (confirmed this session), so once
// added an amendment can't be edited or removed by anyone either.
//
// PRINCIPAL-ONLY since migration 0180: incident_amendments' own INSERT
// policy now has exactly one branch, can_countersign_incident(). The
// owning-teacher and verified-clinician branches that used to pass were
// deliberately dropped, not narrowed -- see 0180's own comment. This
// component is still generic (any caller whose standing passes the
// live policy can use it) but in practice that's now only a principal
// or countersign-grant holder; wired up from CountersignCard (the
// pre-countersign flow, unchanged) and, as of this same change, its own
// persistent post-countersign action too.

interface AddAmendmentSheetProps {
  incidentId: string;
  authorId: string;
  isOpen: boolean;
  onClose: () => void;
  onAdded: () => void;
  // THE INCIDENT PDF CARRIES REAL CHILD NAMES, item 1b (CLAUDE.md):
  // an amendment has no per-child scoping at all -- incident_amendments.
  // incident_id only -- so on a multi-child incident, BOTH children's
  // parent exports show the SAME amendment text. If this free text
  // happens to name the other child, that name reaches a family it was
  // never meant to. Not fixable by a WHERE clause (this is free text, not
  // structured data) -- this reminder is the mitigation: named at the
  // moment of writing, when the author can actually act on it.
  isMultiChild?: boolean;
}

export function AddAmendmentSheet({ incidentId, authorId, isOpen, onClose, onAdded, isMultiChild }: AddAmendmentSheetProps) {
  const [reason, setReason] = useState("");
  const [content, setContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setReason("");
    setContent("");
    setError(null);
  }

  async function handleSubmit() {
    if (!reason.trim() || !content.trim()) {
      setError("Both a reason and the amendment itself are required.");
      return;
    }
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("incident_amendments")
      .insert({ incident_id: incidentId, author_id: authorId, reason: reason.trim(), content: content.trim() });
    setIsSubmitting(false);
    if (insertError) {
      setError(insertError.message);
      return;
    }
    reset();
    onAdded();
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        if (isSubmitting) return;
        reset();
        onClose();
      }}
    >
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Add an amendment</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        This is added to the record, attributed to you and dated -- it does not change anything the teacher wrote.
        Once added, an amendment can&apos;t be edited or removed by anyone, including you.
      </p>

      {isMultiChild && (
        <p role="alert" className="mt-3 rounded-xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-3 text-sm text-brand-neutral-black">
          This incident involves more than one child. Each family sees this amendment on their own child&apos;s
          record -- do not name the other child here.
        </p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        <Textarea
          label="Reason for this amendment"
          id="amendment-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Disagree with the account of what happened"
        />
        <Textarea
          label="Amendment"
          id="amendment-content"
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="In your own words"
        />
      </div>

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleSubmit} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Adding…" : "Add amendment"}
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
