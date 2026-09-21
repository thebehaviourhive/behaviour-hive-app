"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { MyTagChangeRequestsSection } from "@/components/clinic/MyTagChangeRequestsSection";

// PRD 10 Stage 3, item 1 -- the admin's own real dashboard, replacing
// the honest holding page. Four things, per section 5.3: the entire
// client list (its own page, /clinic-admin/clients, linked from here),
// onboarding (already wired, Stage 2 -- "+ Add Client" links straight
// into the real, already-widened /principal/passports/enrol), raising
// change requests (lives on each client's own record, via
// EpisodeTagsSection -- nothing to add here), and "records and
// data-sharing requests" -- decided to mean a READ-ONLY view of the
// clinic's own cross-organisation grants (who, status, why), never a
// capability to propose one (the director proposes, section 6.1, not
// open).
//
// cross_organisation_grants' own SELECT policy (0245) is already
// "staff at either institution... no role filter" -- an admin has RLS-
// level read access to every grant already, unmodified. child_name and
// the receiving institution's own name are resolved from the SAME
// roster call this page already needs (get_institution_episode_roster,
// admin-legitimate) and a plain, open institutions read (`using
// (true)`) -- never an embedded join through cross_organisation_grants
// -> passports, which would hit the identical guardian-only-RLS trap
// get_my_tag_change_requests() was built to avoid.
//
// "My Requests" is MyTagChangeRequestsSection, shared with the
// practitioner's own dashboard rather than built twice -- see that
// component's own header for why a director never gets this tile.

interface GrantRow {
  id: string;
  passportId: string;
  receivingInstitutionId: string;
  scopeItems: string[];
  status: string;
  declineReason: string | null;
}

export default function ClinicAdminDashboardPage() {
  const { user, isReady } = useRequireRole("clinic_admin");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [nameByPassport, setNameByPassport] = useState<Map<string, string>>(new Map());
  const [nameByInstitution, setNameByInstitution] = useState<Map<string, string>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", user.id)
      .eq("role", "clinic_admin")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    const inst = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
    setInstitutionName(Array.isArray(inst) ? (inst[0]?.name ?? null) : (inst?.name ?? null));

    const [rosterResult, grantsResult] = await Promise.all([
      supabase.rpc("get_institution_episode_roster", { p_institution_id: staffRow.institution_id, p_include_ended: true }),
      supabase
        .from("cross_organisation_grants")
        .select("id, passport_id, receiving_institution_id, scope_items, status, decline_reason")
        .eq("granting_institution_id", staffRow.institution_id)
        .order("proposed_at", { ascending: false }),
    ]);

    const roster = (rosterResult.data ?? []) as Array<{ passport_id: string; child_name: string }>;
    const passportMap = new Map<string, string>();
    for (const row of roster) passportMap.set(row.passport_id, row.child_name);
    setNameByPassport(passportMap);

    if (!grantsResult.error) {
      const grantRows = (grantsResult.data ?? []) as Array<{
        id: string;
        passport_id: string;
        receiving_institution_id: string;
        scope_items: string[];
        status: string;
        decline_reason: string | null;
      }>;
      setGrants(
        grantRows.map((g) => ({
          id: g.id,
          passportId: g.passport_id,
          receivingInstitutionId: g.receiving_institution_id,
          scopeItems: g.scope_items,
          status: g.status,
          declineReason: g.decline_reason,
        }))
      );

      const receivingIds = [...new Set(grantRows.map((g) => g.receiving_institution_id))];
      if (receivingIds.length > 0) {
        const { data: institutionRows } = await supabase.from("institutions").select("id, name").in("id", receivingIds);
        const instMap = new Map<string, string>();
        for (const row of institutionRows ?? []) instMap.set(row.id, row.name);
        setNameByInstitution(instMap);
      }
    }

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Dashboard</h1>
        {institutionName && <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>}
      </header>

      <main className="flex-1">
        <div className="px-4 lg:max-w-[66.6667%]">
          {isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : error ? (
            <p className="text-sm text-brand-neutral-black/60">{error}</p>
          ) : (
            <Link
              href="/clinic-admin/clients"
              className="flex items-center justify-between rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="font-sans text-body font-semibold text-brand-neutral-black">Clients</p>
              <span className="text-xl text-brand-prussian-blue">›</span>
            </Link>
          )}
        </div>

        {!isLoading && !error && (
          <MyTagChangeRequestsSection recordHref={(passportId) => `/clinic-admin/client/${passportId}`} />
        )}

        {!isLoading && !error && (
          <section className="mt-8 px-4 lg:max-w-[66.6667%]">
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
              Data Sharing
            </h2>
            {grants.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                Nothing shared with another organisation yet.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {grants.map((g) => (
                  <div key={g.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <p className="font-sans text-body font-semibold text-brand-neutral-black">
                      {nameByPassport.get(g.passportId) ?? "A client"}
                    </p>
                    <p className="mt-0.5 text-xs text-brand-neutral-black/60">
                      {g.scopeItems.join(", ")} shared with {nameByInstitution.get(g.receivingInstitutionId) ?? "another organisation"}
                    </p>
                    <p className="mt-1 text-xs font-semibold text-brand-prussian-blue">
                      {g.status === "proposed"
                        ? "Awaiting the parent's confirmation"
                        : g.status === "active"
                          ? "Active"
                          : g.status === "declined"
                            ? `Declined${g.declineReason ? ` — ${g.declineReason}` : ""}`
                            : `Revoked${g.declineReason ? ` — ${g.declineReason}` : ""}`}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}
      </main>
    </div>
  );
}
