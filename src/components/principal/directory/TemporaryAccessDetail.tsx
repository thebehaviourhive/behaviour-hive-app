"use client";

import { useEffect, useState } from "react";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { createClient } from "@/lib/supabase/client";
import { formatTimeOfDay } from "@/lib/temporaryAccessTime";
import type { GrantRow } from "./TemporaryAccessList";

// PRD 4, Stage 4 -- the Directory split view's right pane for the
// Temporary Access segment. Content matches what each self-contained
// card already showed on the old standalone page (start time via the
// grant's own status, cut-off, assigned class, reason) plus Revoke,
// reusing ReasonConfirmSheet unchanged.
//
// Stale-snapshot fix: this used to render `grant` -- a plain prop, set
// once when the row was selected -- directly. Correctness after Revoke
// depended entirely on the parent's onRevoked calling
// setSelectedGrant(null), which unmounts this component before anyone
// could see it still showing the pre-revoke state. That's the exact
// "coincidental save via unmount" CLAUDE.md names for SignOffCard's own
// original bug: it worked, but only because of an incidental side
// effect, not because this component was actually correct. Fixed the
// same way StaffDetail was: this now owns its own copy of the row
// (`grantRow`, seeded from the prop, re-fetched by grantId on mount and
// after its own revoke succeeds) and the parent no longer clears the
// selection on revoke -- the pane now stays open and genuinely shows
// "Revoked", rather than disappearing back to the empty-state
// placeholder.
export function TemporaryAccessDetail({
  grant,
  institutionId,
  cutoffTime,
  onRevoked,
}: {
  grant: GrantRow;
  institutionId: string;
  cutoffTime: string;
  onRevoked: () => void;
}) {
  const [isRevokeOpen, setIsRevokeOpen] = useState(false);
  const [grantRow, setGrantRow] = useState<GrantRow>(grant);

  async function fetchGrantRow(): Promise<GrantRow | null> {
    const supabase = createClient();
    const { data } = await supabase.rpc("get_institution_temporary_access", { p_institution_id: institutionId });
    const rows = (data ?? []) as {
      grant_id: string;
      class_id: string;
      class_name: string;
      granted_to: string;
      granted_to_name: string;
      granted_by_name: string;
      granted_by_role: string;
      granted_for_date: string;
      reason: string;
      revoked_at: string | null;
      revoked_by_name: string | null;
      revocation_reason: string | null;
      is_currently_active: boolean;
    }[];
    const match = rows.find((r) => r.grant_id === grant.grantId);
    if (!match) return null;
    return {
      grantId: match.grant_id,
      classId: match.class_id,
      className: match.class_name,
      grantedTo: match.granted_to,
      grantedToName: match.granted_to_name,
      grantedByName: match.granted_by_name,
      grantedByRole: match.granted_by_role,
      grantedForDate: match.granted_for_date,
      reason: match.reason,
      revokedAt: match.revoked_at,
      revokedByName: match.revoked_by_name,
      revocationReason: match.revocation_reason,
      isCurrentlyActive: match.is_currently_active,
    };
  }

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setGrantRow(grant);
    async function load() {
      const fresh = await fetchGrantRow();
      if (!isMounted || !fresh) return;
      setGrantRow(fresh);
    }
    load();
    return () => {
      isMounted = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [grant.grantId]);

  const statusLabel = grantRow.isCurrentlyActive
    ? "Live now"
    : grantRow.revokedAt
      ? "Revoked"
      : grantRow.grantedForDate > new Date().toISOString().slice(0, 10)
        ? "Upcoming"
        : "Ended at cut-off";

  return (
    <div className="rounded-2xl bg-white p-6 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-heading text-h2 font-semibold text-brand-prussian-blue">{grantRow.grantedToName}</p>
          <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50">{grantRow.className}</p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-prussian-blue">
          {statusLabel}
        </span>
      </div>

      <div className="mt-4 flex flex-col gap-2 border-t border-black/5 pt-4 font-sans text-body">
        <p className="text-brand-neutral-black/50">
          Granted by <span className="text-brand-neutral-black">{grantRow.grantedByName}</span>
        </p>
        <p className="text-brand-neutral-black/50">
          {grantRow.isCurrentlyActive ? "Until" : "Cut-off"} <span className="text-brand-neutral-black">{formatTimeOfDay(cutoffTime)}</span>
        </p>
        <p className="text-brand-neutral-black/70">&ldquo;{grantRow.reason}&rdquo;</p>
        {grantRow.revokedAt && (
          <p className="text-brand-neutral-black/50">
            Revoked{grantRow.revokedByName ? ` by ${grantRow.revokedByName}` : ""}
            {grantRow.revocationReason ? ` · "${grantRow.revocationReason}"` : ""}
          </p>
        )}
      </div>

      {!grantRow.revokedAt && (grantRow.isCurrentlyActive || grantRow.grantedForDate >= new Date().toISOString().slice(0, 10)) && (
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
        title={`Revoke ${grantRow.grantedToName}'s cover for ${grantRow.className}?`}
        description="Their access ends immediately. It cannot be reinstated until the next morning -- this is a revocation, not a delete, and stays visible here."
        confirmLabel="Revoke Cover"
        submittingLabel="Revoking…"
        onClose={() => setIsRevokeOpen(false)}
        onConfirm={async (reason) => {
          const supabase = createClient();
          const { error } = await supabase.rpc("revoke_temporary_access", {
            p_temporary_access_id: grantRow.grantId,
            p_reason: reason,
          });
          return { error: error?.message ?? null };
        }}
        onConfirmed={async () => {
          setIsRevokeOpen(false);
          onRevoked();
          const fresh = await fetchGrantRow();
          if (fresh) setGrantRow(fresh);
        }}
      />
    </div>
  );
}
