"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { BottomSheet } from "@/components/ui/BottomSheet";

// PRD 1, Stage 2, Step 3. Principal-only, matching every other
// institution-shaping action -- create_class() itself enforces this,
// this sheet is just the picker over it.

interface CreateClassSheetProps {
  isOpen: boolean;
  institutionId: string;
  onClose: () => void;
  onCreated: (classId: string) => void;
}

export function CreateClassSheet({ isOpen, institutionId, onClose, onCreated }: CreateClassSheetProps) {
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  function reset() {
    setName("");
    setSubmitError(null);
  }

  function close() {
    if (isSubmitting) return;
    reset();
    onClose();
  }

  async function handleCreate() {
    if (!name.trim()) {
      setSubmitError("A class name is required.");
      return;
    }
    setIsSubmitting(true);
    setSubmitError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("create_class", {
      p_institution_id: institutionId,
      p_name: name.trim(),
    });
    setIsSubmitting(false);
    if (error) {
      setSubmitError(error.message);
      return;
    }
    reset();
    onCreated(data as string);
  }

  return (
    <BottomSheet isOpen={isOpen} onClose={close}>
      <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Create Class</h2>
      <p className="mt-2 text-sm text-brand-neutral-black/70">
        Classes persist for as long as the school uses them -- ending them later is done one teacher, or one child, at a
        time, never all at once.
      </p>

      <div className="mt-4">
        <TextField
          label="Class name"
          id="class-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. Room 4"
        />
      </div>

      {submitError && (
        <p role="alert" className="mt-3 text-sm font-medium text-red-600">
          {submitError}
        </p>
      )}

      <Button type="button" onClick={handleCreate} disabled={isSubmitting} className="mt-4">
        {isSubmitting ? "Creating…" : "Create Class"}
      </Button>
      <Button type="button" variant="secondary" onClick={close} disabled={isSubmitting} className="mt-2 !border-black/10 !text-black/60">
        Cancel
      </Button>
    </BottomSheet>
  );
}
