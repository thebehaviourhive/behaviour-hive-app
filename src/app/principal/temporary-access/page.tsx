"use client";

import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { formatCutoffTime, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 2, Stage 6. Institution-wide view of temporary cover, replacing
// "open every class in turn" -- get_institution_temporary_access()
// (0131) is the one query this whole page is built on; no class-by-
// class composition, no second roster call for names (every name and
// the class label are resolved inline on the row itself).
//
// Lives under Directory (its own card, alongside Staff/Classes/
// Passports), not School and not Dashboard: this is the same shape of
// thing as those three -- a live roster of who currently has standing
// over what, revocable from the view itself -- not a setting (School's
// charter) and not an overview metric (Dashboard's). The cut-off-time
// CONTROL lives on School instead; this page is the live view only.
//
// THREE FACTS, MADE PLAIN, NOT DISCOVERED AT THE WORST MOMENT (Daniel's
// own instruction): SNA-level access regardless of the role being
// covered; starts 7:30am, ends at the school's own cut-off, cannot be
// reinstated until the next morning; anything unfinished cannot be
// completed afterwards, and an incident a supply teacher started
// transfers to the principal at the cut-off. One persistent card, not
// buried in a tooltip or a sheet nobody opens.
//
// THE DISTINCTION Daniel named as unmissable: "live right now" and
// "ended at the cut-off" are different facts a single list of grants
// with dates would make look the same. Three sections, not one list --
// Active Now (is_currently_active, computed server-side against the
// SAME window has_active_temporary_grant() itself checks -- this page
// never re-derives the school's own cut-off logic), Upcoming
// (unrevoked, scheduled for a future date -- GrantTemporaryAccessSheet
// does allow picking ahead, so this is a real, if rare, state, not a
// hypothetical one), and Recent Past (everything else within the
// window -- revoked, or naturally ended at a previous cut-off). Each
// past row says explicitly which of those two it was, and revoked
// rows keep their own reason visible, same "history is visible, not
// hidden" discipline every other history section in this app already
// follows.

interface GrantRow {
  grantId: string;
  classId: string;
  className: string;
  grantedTo: string;
  grantedToName: string;
  grantedByName: string;
  grantedByRole: string;
  grantedForDate: string;
  reason: string;
  revokedAt: string | null;
  revokedByName: string | null;
  revocationReason: string | null;
  isCurrentlyActive: boolean;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrincipalTemporaryAccessPage() {
  const { user, isReady } = useRequireRole("principal");
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id, institutions(temporary_access_cutoff_time)")
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
    const institutionRecord = staffRow.institutions as unknown as
      | { temporary_access_cutoff_time: string | null }
      | { temporary_access_cutoff_time: string | null }[]
      | null;
    const record = Array.isArray(institutionRecord) ? institutionRecord[0] : institutionRecord;
    if (record?.temporary_access_cutoff_time) {
      setCutoffTime(record.temporary_access_cutoff_time);
    }

    const { data: rows, error: rowsError } = await supabase.rpc("get_institution_temporary_access", {
      p_institution_id: staffRow.institution_id,
    });
    if (rowsError) {
      setError("Could not load temporary access.");
      setIsLoading(false);
      return;
    }

    setGrants(
      (
        (rows ?? []) as {
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
        }[]
      ).map((r) => ({
        grantId: r.grant_id,
        classId: r.class_id,
        className: r.class_name,
        grantedTo: r.granted_to,
        grantedToName: r.granted_to_name,
        grantedByName: r.granted_by_name,
        grantedByRole: r.granted_by_role,
        grantedForDate: r.granted_for_date,
        reason: r.reason,
        revokedAt: r.revoked_at,
        revokedByName: r.revoked_by_name,
        revocationReason: r.revocation_reason,
        isCurrentlyActive: r.is_currently_active,
      }))
    );
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  const today = todayLocalDateString();
  const active = grants.filter((g) => g.isCurrentlyActive);
  const upcoming = grants.filter((g) => !g.isCurrentlyActive && !g.revokedAt && g.grantedForDate > today);
  const past = grants.filter((g) => !g.isCurrentlyActive && (Boolean(g.revokedAt) || g.grantedForDate <= today));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Temporary Access</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="mb-6 rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-brand-golden-brown">How temporary cover works</p>
          <ul className="flex flex-col gap-2 text-sm text-brand-neutral-black/80">
            <li>• SNA-level access only, regardless of the role being covered -- a supply teacher never gets more.</li>
            <li>
              • Starts 7:30am, ends daily at {formatCutoffTime(cutoffTime)}. It cannot be reinstated until the next
              morning.
            </li>
            <li>
              • Anything unfinished at the cut-off cannot be completed afterwards. If a supply teacher started an
              incident, it transfers to you at the cut-off.
            </li>
          </ul>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Active Now ({active.length})
              </h2>
              {active.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No one has active cover right now.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {active.map((g) => (
                    <div key={g.grantId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-brand-neutral-black">{g.grantedToName}</p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{g.className}</p>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                          Live now
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-brand-neutral-black/50">
                        Granted by {g.grantedByName} · until {formatCutoffTime(cutoffTime)} today
                      </p>
                      <p className="mt-1 text-sm text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(g)}
                        className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {upcoming.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Upcoming ({upcoming.length})
                </h2>
                <div className="flex flex-col gap-2">
                  {upcoming.map((g) => (
                    <div key={g.grantId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-semibold text-brand-neutral-black">{g.grantedToName}</p>
                          <p className="mt-0.5 text-xs text-brand-neutral-black/50">{g.className}</p>
                        </div>
                        <span className="flex-shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/60">
                          Starts {formatDate(g.grantedForDate)}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-brand-neutral-black/50">Granted by {g.grantedByName}</p>
                      <p className="mt-1 text-sm text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
                      <button
                        type="button"
                        onClick={() => setRevokeTarget(g)}
                        className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center text-xs font-semibold text-brand-golden-brown"
                      >
                        Revoke
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            <section>
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="mb-2 flex w-full items-center justify-between"
              >
                <h2 className="font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Recent Past ({past.length})
                </h2>
                <span className="text-sm font-semibold text-brand-neutral-black/40">{showPast ? "−" : "+"}</span>
              </button>
              {showPast && (
                past.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                    No recent cover in the last 30 days.
                  </p>
                ) : (
                  <div className="flex flex-col gap-2">
                    {past.map((g) => (
                      <div key={g.grantId} className="rounded-2xl border border-black/5 bg-white/60 p-4">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="text-sm font-semibold text-brand-neutral-black">{g.grantedToName}</p>
                            <p className="mt-0.5 text-xs text-brand-neutral-black/50">{g.className}</p>
                          </div>
                          <span className="flex-shrink-0 rounded-full bg-black/5 px-2.5 py-1 text-xs font-semibold text-brand-neutral-black/60">
                            {g.revokedAt ? "Revoked" : "Ended at cut-off"}
                          </span>
                        </div>
                        <p className="mt-2 text-xs text-brand-neutral-black/50">
                          {formatDate(g.grantedForDate)} · granted by {g.grantedByName}
                        </p>
                        <p className="mt-1 text-sm text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
                        {g.revokedAt && (
                          <p className="mt-2 text-xs text-brand-neutral-black/50">
                            Revoked {formatDate(g.revokedAt)}
                            {g.revokedByName ? ` by ${g.revokedByName}` : ""}
                            {g.revocationReason ? ` · "${g.revocationReason}"` : ""}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )
              )}
            </section>
          </>
        )}
      </main>

      {revokeTarget && (
        <ReasonConfirmSheet
          isOpen={Boolean(revokeTarget)}
          title={`Revoke ${revokeTarget.grantedToName}'s cover for ${revokeTarget.className}?`}
          description="Their access ends immediately. It cannot be reinstated until the next morning -- this is a revocation, not a delete, and stays visible here."
          confirmLabel="Revoke Cover"
          submittingLabel="Revoking…"
          onClose={() => setRevokeTarget(null)}
          onConfirm={async (reason) => {
            const supabase = createClient();
            const { error } = await supabase.rpc("revoke_temporary_access", {
              p_temporary_access_id: revokeTarget.grantId,
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

      <PrincipalBottomNav />
    </div>
  );
}
