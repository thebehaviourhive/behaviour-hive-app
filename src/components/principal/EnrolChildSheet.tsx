"use client";

import { useState } from "react";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";

// PRD 1, Stage 6, Step 2 -- the "+ Enrol" entry point create_school_
// passport() (0113, extended atomically in 0121 to also open the
// enrolment row) has had since it shipped but no client ever called.
// Deliberately the ONLY enrol path this sheet offers: a child who
// doesn't exist in this system yet. Enrolling an already-existing
// passport (a genuine transfer-in) is a different operation, out of
// scope here -- Step 0's own recon named it and parked it alongside the
// rest of transfer.

interface EnrolChildSheetProps {
  isOpen: boolean;
  institutionId: string;
  onClose: () => void;
  onEnrolled: () => void;
}

export function EnrolChildSheet({ isOpen, institutionId, onClose, onEnrolled }: EnrolChildSheetProps) {
  const [childName, setChildName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setChildName("");
    setError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleEnrol() {
    if (!childName.trim()) return;
    setIsSubmitting(true);
    setError(null);

    const supabase = createClient();
    const { error: enrolError } = await supabase.rpc("create_school_passport", {
      p_institution_id: institutionId,
      p_child_name: childName.trim(),
    });

    setIsSubmitting(false);

    if (enrolError) {
      setError(enrolError.message);
      return;
    }

    reset();
    onEnrolled();
    onClose();
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Enrol a child</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Creates a new passport for this child, started by your school. Their
        parent or guardian claims it later using a code you generate from
        their passport page.
      </p>

      <label className="mt-5 block text-sm font-semibold text-brand-neutral-black" htmlFor="enrol-child-name">
        Child&apos;s name
      </label>
      <input
        id="enrol-child-name"
        type="text"
        value={childName}
        onChange={(e) => setChildName(e.target.value)}
        placeholder="e.g. Sam Murphy"
        className="mt-1.5 w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
      />

      {error && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      <Button type="button" onClick={handleEnrol} disabled={!childName.trim() || isSubmitting} className="mt-5">
        {isSubmitting ? "Enrolling…" : "Enrol child"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
