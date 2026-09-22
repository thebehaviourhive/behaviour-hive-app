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
  // Standing rule, 22 Sept 2026 -- everything on the parent dashboard is
  // dismissible, but a grant confirmation is a CONSENT DECISION, not a
  // notification: there is no third "just hide it" state that wouldn't
  // leave the director waiting exactly as before. Dismiss here IS
  // decline_cross_organisation_grant() -- the existing RPC, already
  // director-visible via status='declined' on GrantManagementSection.
  const [declineTarget, setDeclineTarget] = useState<PendingGrantRow | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [isDeclining, setIsDeclining] = useState(false);
  const [declineError, setDeclineError] = useState<string | null>(null);

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

  async function handleDecline() {
    if (!declineTarget) return;
    setIsDeclining(true);
    setDeclineError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("decline_cross_organisation_grant", {
      p_grant_id: declineTarget.id,
      p_reason: declineReason.trim() === "" ? null : declineReason.trim(),
    });
    setIsDeclining(false);
    if (error) {
      setDeclineError(error.message);
      return;
    }
    setDeclineTarget(null);
    setDeclineReason("");
    load();
  }

  if (isLoading || pending.length === 0) {
    return null;
  }

  return (
    <>
      <div className={`flex flex-col gap-3 ${className}`}>
        {pending.map((grant) => (
          <div
            key={grant.id}
            className="rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 shadow-md"
          >
            <button
              type="button"
              onClick={() => setActiveGrant(grant)}
              className="flex w-full items-center gap-3 text-left transition-transform active:scale-[0.99]"
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

            {declineTarget?.id === grant.id ? (
              <div className="mt-3 rounded-xl bg-white/60 p-3">
                <p className="text-xs text-brand-neutral-black/80">
                  This declines the request -- {grant.schoolName} will not see {getChildDisplayName(grant.childName)}
                  &apos;s records from {grant.clinicName}. A reason is optional.
                </p>
                <input
                  type="text"
                  value={declineReason}
                  onChange={(e) => setDeclineReason(e.target.value)}
                  placeholder="Reason (optional)"
                  className="mt-2 w-full rounded-lg border border-black/10 bg-white px-3 py-1.5 text-xs text-brand-neutral-black"
                />
                {declineError && <p className="mt-1 text-xs font-medium text-brand-golden-brown">{declineError}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleDecline}
                    disabled={isDeclining}
                    className="rounded-full bg-brand-golden-brown px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {isDeclining ? "Declining…" : "Yes, not now"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeclineTarget(null)}
                    disabled={isDeclining}
                    className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-semibold text-black/60"
                  >
                    Go back
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setDeclineError(null);
                  setDeclineReason("");
                  setDeclineTarget(grant);
                }}
                className="mt-2 text-xs font-semibold text-brand-neutral-black/50"
              >
                Not now
              </button>
            )}
          </div>
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
