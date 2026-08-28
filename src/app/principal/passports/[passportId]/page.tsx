"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { GrantPassportAccessSheet } from "@/components/principal/GrantPassportAccessSheet";

// PRD 1, Stage 4, Step 3. Principal's passport-access detail: current
// access with revoke, a collapsed past-access history, and a grant
// sheet -- mirroring /principal/classes/[classId]'s own active/past
// split and sheet-wiring pattern exactly.
//
// Daniel's own instruction 1: HISTORY IS VISIBLE, NOT HIDDEN. Past
// access shows who granted it, who revoked it, when, and why -- the
// whole reason 0111 added granted_by/revoked_by/revoked_at/
// revocation_reason to passport_access in the first place. Collapsed
// by default (matching every other history section in this app -- Past
// Cover, Removed teachers, Previously in this class), never omitted.
//
// Daniel's own instruction 2: an empty state here (no grants at all,
// for a child the roster shows) is legitimate and informative -- it IS
// the gap a principal needs to see, not an error state to explain away.

interface AccessRow {
  id: string;
  userId: string;
  fullName: string;
  actorRole: string;
  isActive: boolean;
  linkedAt: string;
  grantedByName: string | null;
  revokedAt: string | null;
  revokedByName: string | null;
  revocationReason: string | null;
}

interface StaffRosterRow {
  user_id: string;
  full_name: string;
  is_active: boolean;
}

const ROLE_LABEL: Record<string, string> = {
  class_teacher: "Class Teacher",
  sna: "SNA",
};

export default function PrincipalPassportDetailPage() {
  const params = useParams();
  const passportId = params.passportId as string;
  const { user, isReady } = useRequireRole("principal");

  const [childName, setChildName] = useState<string | null>(null);
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [access, setAccess] = useState<{ active: AccessRow[]; past: AccessRow[] }>({ active: [], past: [] });
  const [eligibleStaff, setEligibleStaff] = useState<{ userId: string; fullName: string }[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notOnRoster, setNotOnRoster] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const [isGrantOpen, setIsGrantOpen] = useState(false);
  const [revokeTarget, setRevokeTarget] = useState<AccessRow | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    setNotOnRoster(false);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your institution.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    // Same roster RPC the list page uses -- if this child genuinely
    // isn't on it (a stale link, or a passportId that was never really
    // this institution's), that's shown plainly rather than silently
    // resolving to "Unknown".
    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_child_roster", {
      p_institution_id: staffRow.institution_id,
    });
    if (rosterError) {
      setError("Could not load this child.");
      setIsLoading(false);
      return;
    }
    const rosterMatch = (rosterRows ?? []).find((r: { passport_id: string; child_name: string }) => r.passport_id === passportId);
    if (!rosterMatch) {
      setNotOnRoster(true);
      setIsLoading(false);
      return;
    }
    setChildName(rosterMatch.child_name);

    const [accessResult, staffRosterResult] = await Promise.all([
      supabase.rpc("get_passport_access_for_child", { p_passport_id: passportId, p_institution_id: staffRow.institution_id }),
      supabase.rpc("get_institution_staff_roster", { p_institution_id: staffRow.institution_id, p_include_inactive: false, p_include_pending: false }),
    ]);

    if (accessResult.error) {
      setError("Could not load this child's access history.");
      setIsLoading(false);
      return;
    }

    const activeRows: AccessRow[] = [];
    const pastRows: AccessRow[] = [];
    for (const r of accessResult.data ?? []) {
      const row: AccessRow = {
        id: r.id,
        userId: r.user_id,
        fullName: r.full_name,
        actorRole: r.actor_role,
        isActive: r.is_active,
        linkedAt: r.linked_at,
        grantedByName: r.granted_by_name,
        revokedAt: r.revoked_at,
        revokedByName: r.revoked_by_name,
        revocationReason: r.revocation_reason,
      };
      (r.is_active ? activeRows : pastRows).push(row);
    }
    setAccess({ active: activeRows, past: pastRows });

    const activeUserIds = new Set(activeRows.map((r) => r.userId));
    setEligibleStaff(
      ((staffRosterResult.data ?? []) as StaffRosterRow[])
        .filter((s) => s.is_active && !activeUserIds.has(s.user_id))
        .map((s) => ({ userId: s.user_id, fullName: s.full_name }))
    );

    setIsLoading(false);
  }, [passportId, user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/passports"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{childName ?? "Passport"}</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : notOnRoster ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            This child isn&apos;t on your school&apos;s roster.
          </p>
        ) : (
          <>
            <section>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Current Access ({access.active.length})
                </h2>
                <button type="button" onClick={() => setIsGrantOpen(true)} className="text-xs font-semibold text-brand-prussian-blue">
                  + Grant Access
                </button>
              </div>

              {access.active.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No one currently has passport access to {childName}.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {access.active.map((a) => (
                    <div key={a.id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-brand-neutral-black">{a.fullName}</p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[a.actorRole] ?? a.actorRole}</p>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                          Active
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-brand-neutral-black/50">
                        Granted {formatDate(a.linkedAt)}
                        {a.grantedByName ? ` by ${a.grantedByName}` : ""}
                      </p>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(a)}
                        className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}

              {access.past.length > 0 && (
                <div className="mt-3">
                  <button
                    type="button"
                    onClick={() => setShowHistory((v) => !v)}
                    className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                  >
                    <span>Past access ({access.past.length})</span>
                    <span>{showHistory ? "−" : "+"}</span>
                  </button>
                  {showHistory && (
                    <div className="mt-2 flex flex-col gap-2">
                      {access.past.map((a) => (
                        <div key={a.id} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                          <p className="text-sm font-semibold text-brand-neutral-black">{a.fullName}</p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{ROLE_LABEL[a.actorRole] ?? a.actorRole}</p>
                          <p className="mt-2 text-xs text-brand-neutral-black/50">
                            Granted {formatDate(a.linkedAt)}
                            {a.grantedByName ? ` by ${a.grantedByName}` : ""}
                          </p>
                          {a.revokedAt && (
                            <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                              Revoked {formatDate(a.revokedAt)}
                              {a.revokedByName ? ` by ${a.revokedByName}` : ""}
                            </p>
                          )}
                          {a.revocationReason && (
                            <p className="mt-2 text-sm text-brand-neutral-black/70">&ldquo;{a.revocationReason}&rdquo;</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      {institutionId && childName && (
        <GrantPassportAccessSheet
          isOpen={isGrantOpen}
          passportId={passportId}
          institutionId={institutionId}
          childName={childName}
          eligibleStaff={eligibleStaff}
          onClose={() => setIsGrantOpen(false)}
          onGranted={() => {
            setIsGrantOpen(false);
            load();
          }}
        />
      )}

      {revokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(revokeTarget)}
          title={`Revoke ${revokeTarget.fullName}'s access to ${childName ?? "this child"}?`}
          description="Their access ends immediately. This is a revocation, not a delete -- it stays in this child's access history, visible to you at any time."
          confirmLabel="Revoke Access"
          submittingLabel="Revoking…"
          onClose={() => setRevokeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_passport_access", {
              p_passport_access_id: revokeTarget.id,
              p_reason: reason,
            });
            return { error: error?.message ?? null };
          }}
          onConfirmed={() => {
            setRevokeTarget(null);
            load();
          }}
        />
      )}
    </div>
  );
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
