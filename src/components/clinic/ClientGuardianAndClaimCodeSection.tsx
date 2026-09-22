"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";

// Decision 5 -- the claim-code RPCs are now clinic_admin-permitted at a
// clinic (migration 0287), so an admin who onboards a client can also
// hand them the code, closing the exact gap named in the recon: "an
// admin can onboard a client but cannot generate the code to hand the
// parent." Self-contained, matching EpisodeTagsSection's own pattern --
// resolves its own institution, takes only passportId. A deliberately
// SEPARATE, smaller implementation from ChildDetail.tsx's own inline
// version rather than a shared refactor of it -- that file's own
// guardian/claim-code state is threaded through one large load()
// Promise.all built for a director's much bigger page; duplicating this
// one section's own logic here is a smaller, lower-risk change than
// extracting it out from underneath a 1900-line component.

interface GuardianRow {
  userId: string;
  fullName: string | null;
  claimedAt: string;
}

interface ClaimCodeStatus {
  id: string;
  code: string;
  expiresAt: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

function daysRemaining(iso: string): number {
  const diffMs = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(diffMs / 86_400_000));
}

export function ClientGuardianAndClaimCodeSection({ passportId, childName }: { passportId: string; childName: string }) {
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [guardians, setGuardians] = useState<GuardianRow[]>([]);
  const [claimCode, setClaimCode] = useState<ClaimCodeStatus | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isGeneratingCode, setIsGeneratingCode] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [claimCodeRevokeTarget, setClaimCodeRevokeTarget] = useState<ClaimCodeStatus | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return;

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "clinic_admin")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setLoadError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const [guardiansResult, claimCodeResult] = await Promise.all([
      supabase.rpc("get_passport_guardians_for_child", { p_institution_id: staffRow.institution_id, p_passport_id: passportId }),
      supabase.rpc("get_passport_claim_code_status", { p_institution_id: staffRow.institution_id, p_passport_id: passportId }),
    ]);

    setGuardians(
      ((guardiansResult.data ?? []) as { user_id: string; full_name: string | null; claimed_at: string }[]).map((g) => ({
        userId: g.user_id,
        fullName: g.full_name,
        claimedAt: g.claimed_at,
      }))
    );
    const codeRow = ((claimCodeResult.data ?? []) as { id: string; code: string; expires_at: string }[])[0];
    setClaimCode(codeRow ? { id: codeRow.id, code: codeRow.code, expiresAt: codeRow.expires_at } : null);

    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleGenerateCode() {
    if (!institutionId) return;
    setIsGeneratingCode(true);
    setGenerateError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("generate_passport_claim_code", {
      p_institution_id: institutionId,
      p_passport_id: passportId,
    });
    setIsGeneratingCode(false);
    if (error) {
      setGenerateError(error.message);
      return;
    }
    load();
  }

  if (isLoading) {
    return <div className="h-[100px] animate-pulse rounded-2xl bg-white" />;
  }
  if (loadError) {
    return <p className="text-sm text-brand-neutral-black/60">{loadError}</p>;
  }

  return (
    <section className="mt-6">
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
        Parent / Guardian
      </h2>

      {guardians.length === 0 && !claimCode && (
        <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center">
          <p className="text-sm text-brand-neutral-black/60">Parent claim code required.</p>
          <p className="mt-1 text-sm text-brand-neutral-black/60">No parent or guardian has claimed {childName}&apos;s record yet.</p>
          <button
            type="button"
            onClick={handleGenerateCode}
            disabled={isGeneratingCode}
            className="mt-3 rounded-full bg-brand-prussian-blue px-5 py-2.5 text-sm font-bold text-white disabled:opacity-50"
          >
            {isGeneratingCode ? "Generating…" : "Generate Claim Code"}
          </button>
          {generateError && (
            <p role="alert" className="mt-2 text-xs font-medium text-brand-golden-brown">
              {generateError}
            </p>
          )}
        </div>
      )}

      {guardians.length > 0 && (
        <div className="flex flex-col gap-2">
          {guardians.map((g) => (
            <div key={g.userId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm font-semibold text-brand-neutral-black">{g.fullName ?? "A parent"}</p>
                <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                  CLAIMED {formatDate(g.claimedAt).toUpperCase()}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {claimCode && (
        <div className={`rounded-2xl border border-black/5 bg-white p-4 shadow-sm ${guardians.length > 0 ? "mt-2" : ""}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">Outstanding claim code</p>
            <span className="flex-shrink-0 rounded-full bg-brand-golden-brown/15 px-2.5 py-1 text-xs font-semibold text-brand-golden-brown">
              EXPIRES IN {daysRemaining(claimCode.expiresAt)} DAY{daysRemaining(claimCode.expiresAt) === 1 ? "" : "S"}
            </span>
          </div>
          <p className="mt-1 font-heading text-2xl font-bold tracking-widest text-brand-prussian-blue">{claimCode.code}</p>
          <p className="mt-1 text-xs text-brand-neutral-black/50">Give this code to {childName}&apos;s parent or guardian to link their account.</p>
          <button
            type="button"
            onClick={() => setClaimCodeRevokeTarget(claimCode)}
            className="mt-3 block w-full lg:w-auto rounded-xl border border-brand-golden-brown px-4 py-2 text-center text-xs font-semibold text-brand-golden-brown"
          >
            Revoke
          </button>
        </div>
      )}

      {guardians.length > 0 && !claimCode && (
        <button
          type="button"
          onClick={handleGenerateCode}
          disabled={isGeneratingCode}
          className="mt-2 block w-full lg:w-auto rounded-xl border border-brand-prussian-blue px-4 py-2 text-center text-xs font-semibold text-brand-prussian-blue disabled:opacity-50"
        >
          {isGeneratingCode ? "Generating…" : "+ Generate a code for another guardian"}
        </button>
      )}

      {guardians.length > 0 && generateError && (
        <p role="alert" className="mt-2 text-xs font-medium text-brand-golden-brown">
          {generateError}
        </p>
      )}

      {claimCodeRevokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(claimCodeRevokeTarget)}
          title={`Revoke this claim code for ${childName}?`}
          description="This code stops working immediately. Nothing about this child's record or any already-claimed guardian is affected -- you can generate a fresh code at any time."
          confirmLabel="Revoke Code"
          submittingLabel="Revoking…"
          onClose={() => setClaimCodeRevokeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_passport_claim_code", {
              p_claim_code_id: claimCodeRevokeTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setClaimCodeRevokeTarget(null);
            load();
          }}
        />
      )}
    </section>
  );
}
