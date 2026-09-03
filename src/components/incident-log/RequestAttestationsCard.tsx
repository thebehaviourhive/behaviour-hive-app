"use client";

import { useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/Button";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { friendlyAccessLapsedMessage } from "@/lib/temporaryAccessTime";

// Phase 4, piece 2. The explicit, reversible teacher action that moves
// an incident from draft to awaiting_signoff (0089) -- deliberately NOT
// inferred from stage-two content existing (an SNA would be prompted to
// attest to a half-written narrative, go stale as the teacher keeps
// typing, and again). This is what makes named staff able to see the
// record and prompts them to attest -- it is not sign-off and must not
// look like it: reversible, doesn't lock anything, the teacher can keep
// editing afterwards.
//
// Un-toggling after staff have already attested is a real event, not a
// quiet reset -- it pulls the record back underneath people who've
// already put their name to it (their attestation needs renewing once
// re-requested, same as any other staleness -- 0089's own re-request
// mechanism handles that automatically). Warned here, at the point of
// un-toggling, rather than left to be discovered.

interface RequestAttestationsCardProps {
  incidentId: string;
  requested: boolean;
  onChange: (requested: boolean) => void;
}

export function RequestAttestationsCard({ incidentId, requested, onChange }: RequestAttestationsCardProps) {
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const [attestedCount, setAttestedCount] = useState<number | null>(null);

  async function setAndSave(value: boolean) {
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    // Bug report follow-up -- rows-affected check, single known row by
    // id. This is the gate that moves an incident from draft to
    // awaiting_signoff -- a silent no-op here means staff are never
    // shown the record to attest to at all, with nothing telling the
    // teacher who toggled it that nothing happened.
    const { data, error: updateError } = await supabase
      .from("incidents")
      .update({ attestations_requested: value })
      .eq("id", incidentId)
      .select("id");
    setIsSaving(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    if (!data || data.length === 0) {
      setError(friendlyAccessLapsedMessage("This"));
      return;
    }
    onChange(value);
  }

  async function handleToggle(next: boolean) {
    if (next === requested) return;

    if (!next) {
      // Un-toggling -- find out first whether anyone has already
      // attested, so the warning names a real number, not a guess.
      const supabase = createClient();
      const { data: summary } = await supabase.rpc("get_incident_signoff_summary", { p_incident_id: incidentId });
      const count = (summary?.staff_attestations ?? []).filter((s: { status: string }) => s.status !== "not_attested").length;
      if (count > 0) {
        setAttestedCount(count);
        setIsConfirmOpen(true);
        return;
      }
    }

    await setAndSave(next);
  }

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="text-sm font-semibold text-brand-neutral-black">My account is complete -- request attestations</p>
      <p className="mt-1 text-xs text-brand-neutral-black/60">
        This makes the record visible to named staff and prompts them to attest. It does not lock anything -- you
        can keep editing, and it can be turned off again.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          onClick={() => handleToggle(true)}
          disabled={isSaving}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
            requested
              ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
              : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
          }`}
        >
          Yes
        </button>
        <button
          type="button"
          onClick={() => handleToggle(false)}
          disabled={isSaving}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-40 ${
            !requested
              ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
              : "border-black/10 bg-white text-black/60 hover:bg-black/[0.02]"
          }`}
        >
          No
        </button>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-sm font-medium text-red-600">
          {error}
        </p>
      )}

      <BottomSheet isOpen={isConfirmOpen} onClose={() => setIsConfirmOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Turn off attestation requests?</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          {attestedCount} staff member{attestedCount === 1 ? " has" : "s have"} already attested to this record.
          Turning this off pulls it back to draft -- they won&apos;t be able to see it until you request again, and
          when you do, their attestation will need renewing, the same as if the record itself had changed.
        </p>
        <Button
          type="button"
          onClick={async () => {
            setIsConfirmOpen(false);
            await setAndSave(false);
          }}
          disabled={isSaving}
          className="mt-6 !bg-brand-golden-brown"
        >
          Turn off anyway
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsConfirmOpen(false)}
          disabled={isSaving}
          className="mt-2 !border-black/10 !text-black/60"
        >
          Cancel
        </Button>
      </BottomSheet>
    </div>
  );
}
