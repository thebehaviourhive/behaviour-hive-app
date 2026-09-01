"use client";

import { useState } from "react";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { createClient } from "@/lib/supabase/client";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";
import type { GrantRow } from "./TemporaryAccessList";

// PRD 4, Stage 4 -- the Directory split view's right pane for the
// Temporary Access segment. Content matches what each self-contained
// card already showed on the old standalone page (start time via the
// grant's own status, cut-off, assigned class, reason) plus Revoke,
// reusing ReasonConfirmSheet unchanged.
export function TemporaryAccessDetail({
  grant,
  cutoffTime,
  onRevoked,
}: {
  grant: GrantRow;
  cutoffTime: string;
  onRevoked: () => void;
}) {
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);

  const statusLabel = grant.isCurrentlyActive
    ? "Live now"
    : grant.revokedAt
      ? "Revoked"
      : grant.grantedForDate > new Date().toISOString().slice(0, 10)
        ? "Upcoming"
        : "Ended at cut-off";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-h2 font-semibold text-brand-prussian-blue">{grant.grantedToName}</p>
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50">{grant.className}</p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-prussian-blue">
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-black/5 pt-4 font-sans text-body">
        <p className="text-brand-neutral-black/50">
          Granted by <span className="text-brand-neutral-black">{grant.grantedByName}</span>
        </p>
        <p className="text-brand-neutral-black/50">
          {grant.isCurrentlyActive ? "Until" : "Cut-off"} <span className="text-brand-neutral-black">{formatTimeOfDay(cutoffTime)}</span>
        </p>
        <p className="text-brand-neutral-black/70">&ldquo;{grant.reason}&rdquo;</p>
        {grant.revokedAt && (
          <p className="text-brand-neutral-black/50">
            Revoked{grant.revokedByName ? ` by ${grant.revokedByName}` : ""}
            {grant.revocationReason ? ` · "${grant.revocationReason}"` : ""}
          </p>
        )}
      </div>

      {!grant.revokedAt && (grant.isCurrentlyActive || grant.grantedForDate >= new Date().toISOString().slice(0, 10)) && (
        <button
          type="button"
          onClick={() => setIsRevokeOpen(true)}
          className="mt-4 block w-full rounded-xl border border-brand-golden-brown py-2.5 text-center font-sans text-body font-semibold text-brand-golden-brown"
        >
          Revoke
        </button>
      )}

      <ReasonConfirmSheet
        isOpen={isRevokeOpen}
        title={`Revoke ${grant.grantedToName}'s cover for ${grant.className}?`}
        description="Their access ends immediately. It cannot be reinstated until the next morning -- this is a revocation, not a delete, and stays visible here."
        confirmLabel="Revoke Cover"
        submittingLabel="Revoking…"
        onClose={() => setIsRevokeOpen(false)}
        onConfirm={async (reason) => {
          const supabase = createClient();
          const { error } = await supabase.rpc("revoke_temporary_access", {
            p_temporary_access_id: grant.grantId,
            p_reason: reason,
          });
          return { error: error?.message ?? null };
        }}
        onConfirmed={() => {
          setIsRevokeOpen(false);
          onRevoked();
        }}
      />
    </div>
  );
}
