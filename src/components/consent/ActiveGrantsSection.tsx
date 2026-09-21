"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { getChildDisplayName } from "@/lib/childDisplayName";

// PRD 10 Stage 6, item 6.3 -- "the parent revokes from wherever they
// confirmed the grant." This IS that place, real and wired -- only
// GrantConfirmationPromptCard's own confirm/decline flow is held back
// for design review; revocation was never part of that hold.
//
// Renders nothing at all when the parent has nothing currently shared
// -- same "genuinely absent, not an empty state" posture every other
// self-contained prompt/section in this app already uses.
//
// SCOPED TO ONE CHILD, found and fixed 21 Sept 2026 while making
// ClinicalSupportSection's own visibility rules precise per child. This
// component used to query every one of the calling parent's active
// grants across ALL their children, unfiltered -- fine for a single-
// child parent (the only kind this app supported until multi-child
// entry), but wrong the moment a second child exists: mounted under
// child B's own ClinicalSupportSection, it would have shown child A's
// grant too. `cross_organisation_grants` can only ever exist once a
// child has a real clinic connection (its own direction trigger
// requires the granting institution to be type='clinic') -- which is
// exactly why this component needed no separate "does this child have
// a clinic connection" check to satisfy that rule; it only needed to
// stop looking at every child's grants at once.
interface ActiveGrantRow {
  id: string;
  childName: string;
  clinicName: string;
  schoolName: string;
  scopeItems: string[];
}

const SCOPE_LABELS: Record<string, string> = { fba_report: "FBA", bsp: "BSP" };

export function ActiveGrantsSection({ passportId }: { passportId: string | null }) {
  const [active, setActive] = useState<ActiveGrantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<ActiveGrantRow | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!passportId) {
      setActive([]);
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    const supabase = createClient();

    const { data: grantRows, error: grantsError } = await supabase
      .from("cross_organisation_grants")
      .select("id, passport_id, granting_institution_id, receiving_institution_id, scope_items")
      .eq("status", "active")
      .eq("passport_id", passportId);

    if (grantsError || !grantRows || grantRows.length === 0) {
      setActive([]);
      setIsLoading(false);
      return;
    }

    const passportIds = [...new Set(grantRows.map((g) => g.passport_id))];
    const institutionIds = [...new Set(grantRows.flatMap((g) => [g.granting_institution_id, g.receiving_institution_id]))];

    const [passportsResult, institutionsResult] = await Promise.all([
      supabase.from("passports").select("id, child_name").in("id", passportIds),
      supabase.from("institutions").select("id, name").in("id", institutionIds),
    ]);

    const childNameById = new Map((passportsResult.data ?? []).map((p) => [p.id, p.child_name]));
    const institutionNameById = new Map((institutionsResult.data ?? []).map((i) => [i.id, i.name]));

    setActive(
      grantRows.map((g) => ({
        id: g.id,
        childName: childNameById.get(g.passport_id) ?? "your child",
        clinicName: institutionNameById.get(g.granting_institution_id) ?? "the clinic",
        schoolName: institutionNameById.get(g.receiving_institution_id) ?? "the school",
        scopeItems: g.scope_items,
      }))
    );
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleRevoke() {
    if (!revokeTarget) return;
    setIsRevoking(true);
    setError(null);
    const supabase = createClient();
    // p_reason omitted entirely -- optional for a guardian withdrawing
    // their own consent (0274), never required the way it is for a
    // director.
    const { error: rpcError } = await supabase.rpc("revoke_cross_organisation_grant", { p_grant_id: revokeTarget.id });
    setIsRevoking(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setRevokeTarget(null);
    await load();
  }

  if (isLoading || active.length === 0) {
    return null;
  }

  return (
    <section className="mt-6 flex flex-col gap-2">
      <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">Currently Sharing</h2>
      {active.map((grant) => (
        <div key={grant.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <p className="text-sm font-semibold text-brand-neutral-black">
            {grant.clinicName} is sharing {grant.scopeItems.map((s) => SCOPE_LABELS[s] ?? s).join(", ")} for{" "}
            {getChildDisplayName(grant.childName)} with {grant.schoolName}
          </p>
          <button
            type="button"
            onClick={() => {
              setRevokeTarget(grant);
              setError(null);
            }}
            className="mt-2 text-xs font-semibold text-brand-golden-brown"
          >
            Stop sharing
          </button>
        </div>
      ))}

      {revokeTarget && (
        <BottomSheet isOpen={!!revokeTarget} onClose={() => !isRevoking && setRevokeTarget(null)}>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            Stop sharing with {revokeTarget.schoolName}?
          </h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            {revokeTarget.schoolName} loses access immediately. This is your own decision to make -- no reason is required.
          </p>
          {error && (
            <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
              {error}
            </p>
          )}
          <Button type="button" onClick={handleRevoke} disabled={isRevoking} className="mt-5">
            {isRevoking ? "Stopping…" : "Stop sharing"}
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => setRevokeTarget(null)}
            disabled={isRevoking}
            className="mt-2 !border-black/10 !text-black/60"
          >
            Cancel
          </Button>
        </BottomSheet>
      )}
    </section>
  );
}
