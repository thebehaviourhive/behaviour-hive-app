"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { ReasonConfirmSheet } from "@/components/shared/ReasonConfirmSheet";
import { formatTimeOfDay, todayLocalDateString } from "@/lib/temporaryAccessTime";

// PRD 4, Stage 4 -- extracted from principal/temporary-access/page.tsx.
// Below lg: the same three sections (Active Now, Upcoming, Recent Past)
// with each card's own full detail and inline Revoke, unchanged. At
// lg+: compact rows, selectable -- the same detail and Revoke move into
// TemporaryAccessDetail, the split view's right pane.

export interface GrantRow {
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

export function TemporaryAccessList({
  institutionId,
  selectedGrantId,
  onSelect,
  onCutoffResolved,
  refreshToken,
}: {
  institutionId: string | null;
  selectedGrantId: string | null;
  onSelect: (grant: GrantRow) => void;
  onCutoffResolved: (cutoffTime: string) => void;
  refreshToken: number;
}) {
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [grants, setGrants] = useState<GrantRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showPast, setShowPast] = useState(true);
  const [revokeTarget, setRevokeTarget] = useState<GrantRow | null>(null);

  const load = useCallback(
    async (instId: string) => {
      setIsLoading(true);
      setError(null);
      const supabase = createClient();

      const { data: instRow } = await supabase
        .from("institutions")
        .select("temporary_access_cutoff_time")
        .eq("id", instId)
        .maybeSingle();
      if (instRow?.temporary_access_cutoff_time) {
        setCutoffTime(instRow.temporary_access_cutoff_time);
        onCutoffResolved(instRow.temporary_access_cutoff_time);
      }

      const { data: rows, error: rowsError } = await supabase.rpc("get_institution_temporary_access", {
        p_institution_id: instId,
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
    },
    [onCutoffResolved]
  );

  useEffect(() => {
    if (!institutionId) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [institutionId]);

  useEffect(() => {
    if (!institutionId || refreshToken === 0) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  const today = todayLocalDateString();
  const active = grants.filter((g) => g.isCurrentlyActive);
  const upcoming = grants.filter((g) => !g.isCurrentlyActive && !g.revokedAt && g.grantedForDate > today);
  const past = grants.filter((g) => !g.isCurrentlyActive && (Boolean(g.revokedAt) || g.grantedForDate <= today));

  function row(g: GrantRow, statusBadge: React.ReactNode, muted: boolean) {
    const isSelected = g.grantId === selectedGrantId;
    return (
      <button
        key={g.grantId}
        type="button"
        onClick={() => onSelect(g)}
        className={`w-full rounded-2xl border p-4 text-left ${
          isSelected
            ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
            : muted
              ? "border-black/5 bg-white/60"
              : "border-black/5 bg-white shadow-sm"
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
              {g.grantedToName}
            </p>
            <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50 lg:text-eyebrow">{g.className}</p>
          </div>
          {statusBadge}
        </div>

        {/* Full detail + inline Revoke -- below lg only, exactly as
            this page always rendered before this stage. At lg+ the
            same content lives in TemporaryAccessDetail instead. */}
        <div className="lg:hidden">
          <p className="mt-2 font-sans text-body text-brand-neutral-black/50">
            Granted by {g.grantedByName}
            {g.revokedAt || g.grantedForDate <= today
              ? g.revokedAt
                ? " · revoked"
                : ` · ${g.grantedForDate === today ? "ended at cut-off today" : formatDate(g.grantedForDate)}`
              : ` · starts ${formatDate(g.grantedForDate)}`}
          </p>
          <p className="mt-1 font-sans text-body text-brand-neutral-black/70">&ldquo;{g.reason}&rdquo;</p>
          {!g.revokedAt && (g.isCurrentlyActive || g.grantedForDate >= today) && (
            <span
              role="button"
              tabIndex={0}
              onClick={(e) => {
                e.stopPropagation();
                setRevokeTarget(g);
              }}
              className="mt-3 block w-full rounded-xl border border-brand-golden-brown py-2 text-center font-sans text-body font-semibold text-brand-golden-brown"
            >
              Revoke
            </span>
          )}
        </div>
      </button>
    );
  }

  return (
    <>
      <div className="mb-6 rounded-2xl border border-brand-golden-brown/30 bg-brand-golden-brown/10 p-4">
        <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">How temporary cover works</p>
        <ul className="flex flex-col gap-2 font-sans text-body text-brand-neutral-black/80">
          <li>• SNA-level access only, regardless of the role being covered — a supply teacher never gets more.</li>
          <li>• Starts daily, ends at {formatTimeOfDay(cutoffTime)}. It cannot be reinstated until the next morning.</li>
          <li>• Anything unfinished at the cut-off cannot be completed afterwards.</li>
        </ul>
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : (
        <>
          <section className="mb-6">
            <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
              Active Now ({active.length})
            </h2>
            {active.length === 0 ? (
              <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                No one has active cover right now.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {active.map((g) =>
                  row(
                    g,
                    <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-prussian-blue">
                      Live now
                    </span>,
                    false
                  )
                )}
              </div>
            )}
          </section>

          {upcoming.length > 0 && (
            <section className="mb-6">
              <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                Upcoming ({upcoming.length})
              </h2>
              <div className="flex flex-col gap-2">
                {upcoming.map((g) =>
                  row(
                    g,
                    <span className="flex-shrink-0 rounded-full bg-black/5 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-neutral-black/60">
                      {formatDate(g.grantedForDate)}
                    </span>,
                    false
                  )
                )}
              </div>
            </section>
          )}

          <section>
            <button
              type="button"
              onClick={() => setShowPast((v) => !v)}
              className="mb-2 flex w-full items-center justify-between"
            >
              <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                Recent Past ({past.length})
              </h2>
              <span className="font-sans text-body font-semibold text-brand-neutral-black/40">{showPast ? "−" : "+"}</span>
            </button>
            {showPast &&
              (past.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                  No recent cover in the last 30 days.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {past.map((g) =>
                    row(
                      g,
                      <span className="flex-shrink-0 rounded-full bg-black/5 px-2.5 py-1 font-accent text-eyebrow font-bold text-brand-neutral-black/60">
                        {g.revokedAt ? "Revoked" : "Ended"}
                      </span>,
                      true
                    )
                  )}
                </div>
              ))}
          </section>
        </>
      )}

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
            if (institutionId) load(institutionId);
          }}
        />
      )}
    </>
  );
}
