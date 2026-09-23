"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

// PRD 10 Stage 6, item 6.1/6.3 -- the director's own view of cross-
// organisation grants for one client. Self-contained (passportId only),
// mirroring EpisodeTagsSection's own shape: resolves its own caller,
// renders nothing for anyone but a director (clinic_admin already has
// its own read-only equivalent on the clinic-admin dashboard, and
// nothing else should see a "propose" or "revoke" action here).
//
// SCOPE IS TYPE-LEVEL, NOT DOCUMENT-LEVEL -- scope_items is
// ('fba_report' | 'bsp'), never a specific report's own id, matching
// has_cross_org_grant_access()'s own gate exactly (0245/0273). A grant
// shares "their FBA"/"their BSP" as a standing category, not one
// snapshot -- consistent with this schema's own one-active-BSP and
// effectively-one-completed-FBA-at-a-time shape.
//
// THE REFUSAL IS SERVER-SIDE (0274) -- this screen only ever OFFERS
// schools get_passport_linked_schools_for_director() returns, but that
// is convenience, not the guarantee. propose_cross_organisation_grant()
// itself refuses an unlinked school regardless of what this component
// sends it.

interface SchoolOption {
  institutionId: string;
  institutionName: string;
}

interface GrantRow {
  id: string;
  receivingInstitutionId: string;
  receivingInstitutionName: string | null;
  scopeItems: string[];
  status: string;
  declineReason: string | null;
  revokeReason: string | null;
}

const SCOPE_LABELS: Record<string, string> = { fba_report: "FBA", bsp: "BSP" };

export function GrantManagementSection({ passportId }: { passportId: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [linkedSchools, setLinkedSchools] = useState<SchoolOption[]>([]);
  const [fbaAvailable, setFbaAvailable] = useState(false);
  const [bspAvailable, setBspAvailable] = useState(false);
  const [grants, setGrants] = useState<GrantRow[]>([]);

  const [isProposeOpen, setIsProposeOpen] = useState(false);
  const [selectedSchoolId, setSelectedSchoolId] = useState("");
  const [scopeFba, setScopeFba] = useState(false);
  const [scopeBsp, setScopeBsp] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);
  const [isProposing, setIsProposing] = useState(false);

  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);
  const [revokeReasonText, setRevokeReasonText] = useState("");
  const [revokeError, setRevokeError] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState(false);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

    // A grant's granting_institution_id is always the CALLER's own
    // clinic -- resolved from institution_staff directly, not from the
    // passport's own episode (unlike EpisodeTagsSection, a grant isn't
    // derived from which episode this passport happens to have; it's
    // proposed BY a director of a clinic this child is linked to).
    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id, role")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setCallerRole(null);
      setIsLoading(false);
      return;
    }
    setCallerRole(staffRow.role);

    const [schoolsResult, fbaResult, bspResult, grantsResult] = await Promise.all([
      supabase.rpc("get_passport_linked_schools_for_director", { p_passport_id: passportId }),
      supabase.rpc("get_fba_reports_for_director", { p_passport_id: passportId }),
      supabase.rpc("get_bsp_for_director", { p_passport_id: passportId }),
      supabase
        .from("cross_organisation_grants")
        .select("id, receiving_institution_id, scope_items, status, decline_reason, revoke_reason")
        .eq("passport_id", passportId)
        .eq("granting_institution_id", staffRow.institution_id)
        .order("proposed_at", { ascending: false }),
    ]);

    const schoolRows = (schoolsResult.data ?? []) as { institution_id: string; institution_name: string }[];
    setLinkedSchools(schoolRows.map((r) => ({ institutionId: r.institution_id, institutionName: r.institution_name })));
    const schoolNameById = new Map(schoolRows.map((r) => [r.institution_id, r.institution_name]));

    setFbaAvailable(((fbaResult.data ?? []) as { status: string }[]).some((r) => r.status === "completed"));
    setBspAvailable(((bspResult.data ?? []) as { status: string }[]).some((r) => r.status === "active"));

    const grantRows = (grantsResult.data ?? []) as Array<{
      id: string;
      receiving_institution_id: string;
      scope_items: string[];
      status: string;
      decline_reason: string | null;
      revoke_reason: string | null;
    }>;
    setGrants(
      grantRows.map((g) => ({
        id: g.id,
        receivingInstitutionId: g.receiving_institution_id,
        receivingInstitutionName: schoolNameById.get(g.receiving_institution_id) ?? null,
        scopeItems: g.scope_items,
        status: g.status,
        declineReason: g.decline_reason,
        revokeReason: g.revoke_reason,
      }))
    );

    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  function openPropose() {
    setSelectedSchoolId("");
    setScopeFba(false);
    setScopeBsp(false);
    setProposeError(null);
    setIsProposeOpen(true);
  }

  async function handlePropose() {
    const scopeItems = [scopeFba && "fba_report", scopeBsp && "bsp"].filter(Boolean) as string[];
    if (!selectedSchoolId || scopeItems.length === 0) return;
    setIsProposing(true);
    setProposeError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("propose_cross_organisation_grant", {
      p_passport_id: passportId,
      p_receiving_institution_id: selectedSchoolId,
      p_scope_items: scopeItems,
    });
    setIsProposing(false);
    if (error) {
      setProposeError(error.message);
      return;
    }
    setIsProposeOpen(false);
    await load();
  }

  async function handleRevoke() {
    if (!revokeTarget || !revokeReasonText.trim()) return;
    setIsRevoking(true);
    setRevokeError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("revoke_cross_organisation_grant", {
      p_grant_id: revokeTarget.id,
      p_reason: revokeReasonText,
    });
    setIsRevoking(false);
    if (error) {
      setRevokeError(error.message);
      return;
    }
    setRevokeTarget(null);
    setRevokeReasonText("");
    await load();
  }

  if (isLoading || callerRole !== "principal") return null;

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">Data Sharing</h2>
        {linkedSchools.length > 0 && (fbaAvailable || bspAvailable) && (
          <button type="button" onClick={openPropose} className="text-xs font-semibold text-brand-prussian-blue">
            + Share with a School
          </button>
        )}
      </div>

      {grants.length === 0 ? (
        // A correct empty section still has to say WHY -- "nothing
        // shared" reads as broken, not as a real answer, when a school
        // link exists and there's simply been no decision yet. The
        // same failure shape as a dashboard quietly saying "All clear"
        // when it can't actually see anything to be clear about.
        linkedSchools.length > 0 ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center">
            <p className="text-sm text-brand-neutral-black/60">
              This client is also at {linkedSchools.map((s) => s.institutionName).join(" and ")}. Nothing has been
              shared yet.
            </p>
            {(fbaAvailable || bspAvailable) && (
              <button
                type="button"
                onClick={openPropose}
                className="mt-3 rounded-full bg-brand-prussian-blue px-5 py-2.5 text-sm font-bold text-white"
              >
                Propose Sharing
              </button>
            )}
          </div>
        ) : (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            Nothing shared with another organisation yet.
          </p>
        )
      ) : (
        <div className="flex flex-col gap-2">
          {grants.map((g) => (
            <div key={g.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-brand-neutral-black">
                {g.scopeItems.map((s) => SCOPE_LABELS[s] ?? s).join(", ")} shared with{" "}
                {g.receivingInstitutionName ?? "another organisation"}
              </p>
              <p className="mt-1 text-xs font-semibold text-brand-prussian-blue">
                {g.status === "proposed"
                  ? "Awaiting the parent's confirmation"
                  : g.status === "active"
                    ? "Active"
                    : g.status === "declined"
                      ? `Declined${g.declineReason ? ` — ${g.declineReason}` : ""}`
                      : `Revoked${g.revokeReason ? ` — ${g.revokeReason}` : ""}`}
              </p>
              {g.status === "active" && (
                <button
                  type="button"
                  onClick={() => {
                    setRevokeTarget(g);
                    setRevokeReasonText("");
                    setRevokeError(null);
                  }}
                  className="mt-2 text-xs font-semibold text-brand-golden-brown"
                >
                  Revoke
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <BottomSheet isOpen={isProposeOpen} onClose={() => !isProposing && setIsProposeOpen(false)}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">Share with a School</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          The parent must confirm before anything crosses. Nothing is shared until they do.
        </p>

        <div className="mt-4">
          <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black" htmlFor="grant-school">
            School
          </label>
          <select
            id="grant-school"
            value={selectedSchoolId}
            onChange={(e) => setSelectedSchoolId(e.target.value)}
            className="w-full rounded-xl border border-black/10 bg-white px-4 py-3 text-sm text-brand-neutral-black"
          >
            <option value="">Select a school…</option>
            {linkedSchools.map((s) => (
              <option key={s.institutionId} value={s.institutionId}>
                {s.institutionName}
              </option>
            ))}
          </select>
        </div>

        <div className="mt-4 flex flex-col gap-2">
          {fbaAvailable && (
            <label className="flex items-center gap-2 text-sm text-brand-neutral-black">
              <input type="checkbox" checked={scopeFba} onChange={(e) => setScopeFba(e.target.checked)} />
              Their completed FBA
            </label>
          )}
          {bspAvailable && (
            <label className="flex items-center gap-2 text-sm text-brand-neutral-black">
              <input type="checkbox" checked={scopeBsp} onChange={(e) => setScopeBsp(e.target.checked)} />
              Their signed BSP
            </label>
          )}
        </div>

        {proposeError && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {proposeError}
          </p>
        )}

        <Button type="button" onClick={handlePropose} disabled={!selectedSchoolId || (!scopeFba && !scopeBsp) || isProposing} className="mt-5">
          {isProposing ? "Proposing…" : "Propose"}
        </Button>
        <Button
          type="button"
          variant="secondary"
          onClick={() => setIsProposeOpen(false)}
          disabled={isProposing}
          className="mt-2 !border-black/10 !text-black/60"
        >
          Cancel
        </Button>
      </BottomSheet>

      {revokeTarget && (
        <BottomSheet isOpen={!!revokeTarget} onClose={() => !isRevoking && setRevokeTarget(null)}>
          <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
            Revoke sharing with {revokeTarget.receivingInstitutionName ?? "this school"}?
          </h2>
          <p className="mt-2 text-sm text-brand-neutral-black/70">This ends their access immediately. A reason is required.</p>
          <div className="mt-4">
            <Textarea
              id="grant-revoke-reason"
              label="Reason"
              value={revokeReasonText}
              onChange={(e) => setRevokeReasonText(e.target.value)}
              placeholder="Why is sharing being revoked?"
            />
          </div>
          {revokeError && (
            <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
              {revokeError}
            </p>
          )}
          <Button type="button" onClick={handleRevoke} disabled={!revokeReasonText.trim() || isRevoking} className="mt-5">
            {isRevoking ? "Revoking…" : "Revoke"}
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
