"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";

// The centre_manager dashboard build, 25 Sept 2026 -- onboard_clinic_
// client()'s own respite branch (0297) admits a centre_manager
// directly (confirmed by reading the function's live body: "Only a
// clinical director, admin, (where enabled) a practitioner, or a
// centre manager can onboard a new client" is the function's own
// exception text). RedeemLinkCodeSheet.tsx's own header claimed "a
// centre never creates a passport" -- true of what that component
// does, never true of what the RPC permits; this is the missing other
// half. Same shape as principal/passports/enrol's own "new" mode
// (a name, one submit), scoped to a respite centre's own institution.
export function OnboardRespiteClientSheet({
  isOpen,
  onClose,
  institutionId,
}: {
  isOpen: boolean;
  onClose: () => void;
  institutionId: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function reset() {
    setName("");
    setIsSubmitting(false);
    setError(null);
  }

  async function handleSubmit() {
    if (!name.trim()) return;
    setIsSubmitting(true);
    setError(null);
    const supabase = createClient();
    const { data: passportId, error: rpcError } = await supabase.rpc("onboard_clinic_client", {
      p_institution_id: institutionId,
      p_client_name: name.trim(),
    });
    setIsSubmitting(false);

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    reset();
    onClose();
    router.push(`/centre/passport/${passportId}`);
  }

  return (
    <BottomSheet
      isOpen={isOpen}
      onClose={() => {
        reset();
        onClose();
      }}
    >
      <div className="p-4">
        <h2 className="mb-2 font-heading text-xl font-semibold text-brand-neutral-black">Start a new record</h2>
        <p className="mb-4 text-sm text-brand-neutral-black/70">
          Nothing exists for this client here yet -- this starts a real record for them at your centre.
        </p>

        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="onboard-client-name">
          Name
        </label>
        <input
          id="onboard-client-name"
          type="text"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Full name"
          className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {error}
          </p>
        )}

        <Button type="button" onClick={handleSubmit} disabled={!name.trim() || isSubmitting} className="mt-6 lg:w-auto">
          {isSubmitting ? "Starting…" : "Start Record"}
        </Button>
      </div>
    </BottomSheet>
  );
}
