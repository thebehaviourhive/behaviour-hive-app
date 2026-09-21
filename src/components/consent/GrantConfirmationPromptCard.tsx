"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { GrantConfirmationScreen } from "./GrantConfirmationScreen";

// PRD 10 Stage 6, item 6.2 -- the parent's own entry point, following
// AssessmentRequestPromptCard's exact shape: self-contained, fetches
// its own data, renders nothing while loading or empty, owns the
// open/closed state of the full-screen flow it launches.
//
// cross_organisation_grants' own SELECT policy ("Staff at either
// institution, or the passport's guardian", 0245) already scopes a
// raw client select to exactly this parent's own children's grants --
// no dedicated RPC needed for the read, matching how the clinic-admin
// dashboard already reads the same table directly.
//
// Wired, per Daniel's approval of GrantConfirmationScreen's design
// (section 7) -- onConfirm/onDecline call confirm_cross_organisation_
// grant()/decline_cross_organisation_grant() directly.

interface PendingGrantRow {
  id: string;
  childName: string;
  clinicName: string;
  schoolName: string;
  scopeItems: string[];
}

export function GrantConfirmationPromptCard({ className = "" }: { className?: string }) {
  const [pending, setPending] = useState<PendingGrantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeGrant, setActiveGrant] = useState<PendingGrantRow | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();

    const { data: grantRows, error } = await supabase
      .from("cross_organisation_grants")
      .select("id, passport_id, granting_institution_id, receiving_institution_id, scope_items")
      .eq("status", "proposed");

    if (error || !grantRows || grantRows.length === 0) {
      setPending([]);
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

    setPending(
      grantRows.map((g) => ({
        id: g.id,
        childName: childNameById.get(g.passport_id) ?? "your child",
        clinicName: institutionNameById.get(g.granting_institution_id) ?? "the clinic",
        schoolName: institutionNameById.get(g.receiving_institution_id) ?? "the school",
        scopeItems: g.scope_items,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || pending.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`flex flex-col gap-3 ${className}`}>
        {pending.map((grant) => (
          <button
            key={grant.id}
            type="button"
            onClick={() => setActiveGrant(grant)}
            className="flex w-full items-center gap-3 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 text-left shadow-md transition-transform active:scale-[0.99]"
          >
            <span aria-hidden className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown/20 text-lg">
              🔗
            </span>
            <span className="flex-1 text-sm font-semibold text-brand-neutral-black">
              {grant.clinicName} would like to share {getChildDisplayName(grant.childName)}&apos;s records with {grant.schoolName}
            </span>
            <span aria-hidden className="flex-shrink-0 rounded-full bg-brand-golden-brown px-4 py-2 text-xs font-semibold text-white">
              Review
            </span>
          </button>
        ))}
      </div>

      {activeGrant && (
        <div className="fixed inset-0 z-[100] flex flex-col bg-white">
          <GrantConfirmationScreen
            clinicName={activeGrant.clinicName}
            schoolName={activeGrant.schoolName}
            childName={activeGrant.childName}
            scopeItems={activeGrant.scopeItems}
            onConfirm={async () => {
              const supabase = createClient();
              const { error } = await supabase.rpc("confirm_cross_organisation_grant", {
                p_grant_id: activeGrant.id,
              });
              return { error: error?.message ?? null };
            }}
            onDecline={async (reason: string) => {
              const supabase = createClient();
              const { error } = await supabase.rpc("decline_cross_organisation_grant", {
                p_grant_id: activeGrant.id,
                p_reason: reason.trim() === "" ? null : reason.trim(),
              });
              return { error: error?.message ?? null };
            }}
            onConfirmed={() => {
              setActiveGrant(null);
              load();
            }}
            onDeclined={() => {
              setActiveGrant(null);
              load();
            }}
          />
          <button
            type="button"
            onClick={() => setActiveGrant(null)}
            className="absolute right-4 top-4 text-2xl leading-none text-brand-neutral-black/40"
            aria-label="Close"
          >
            ×
          </button>
        </div>
      )}
    </>
  );
}
