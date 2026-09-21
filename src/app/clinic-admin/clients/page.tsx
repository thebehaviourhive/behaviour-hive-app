"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";

// PRD 10 Stage 3, item 1/2 -- the admin's entire client list, no
// clinical data. get_institution_episode_roster() (0263, Tier 1,
// UNMODIFIED here) is the RPC: a static language sql function with a
// six-column RETURNS TABLE (episode_id, passport_id, child_name,
// started_at, ended_at, end_reason) and a body that never references
// any clinical table (fba_reports, session_notes, assessments, bsp,
// passport_clinical_content) at all. Nothing this function could ever
// return, under any path, is clinical -- a future change to widen it
// would have to be a visible, reviewable RETURNS TABLE edit, not a
// silent leak. Its own caller check admits any approved,
// non-deactivated institution_staff member, no role filter -- clinic_
// admin already has RPC-level access to this, unmodified, today.
//
// Tags come from a SECOND query (episode_tags joined to institution_tags,
// filtered to this roster's own episode ids), the same two-query merge
// Stage 2's own catalog page already uses for usage counts -- not
// N+1, one extra query regardless of roster size. Both tables' own
// SELECT policies are institution-staff-wide, no role filter either.

interface RosterRow {
  episodeId: string;
  passportId: string;
  childName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

interface TagOption {
  dimension: string;
  value: string;
}

export default function ClinicAdminClientsPage() {
  const { user, isReady } = useRequireRole("clinic_admin");
  const [roster, setRoster] = useState<RosterRow[]>([]);
  const [tagsByEpisode, setTagsByEpisode] = useState<Map<string, TagOption[]>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
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

    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_episode_roster", {
      p_institution_id: staffRow.institution_id,
      p_include_ended: true,
    });

    if (rosterError) {
      setError(rosterError.message);
      setIsLoading(false);
      return;
    }

    const rows: RosterRow[] = (rosterRows ?? []).map(
      (r: { episode_id: string; passport_id: string; child_name: string; started_at: string; ended_at: string | null; end_reason: string | null }) => ({
        episodeId: r.episode_id,
        passportId: r.passport_id,
        childName: r.child_name,
        startedAt: r.started_at,
        endedAt: r.ended_at,
        endReason: r.end_reason,
      })
    );
    setRoster(rows);

    const episodeIds = rows.map((r) => r.episodeId);
    const map = new Map<string, TagOption[]>();
    if (episodeIds.length > 0) {
      const { data: tagRows } = await supabase
        .from("episode_tags")
        .select("episode_id, institution_tags(dimension, value)")
        .in("episode_id", episodeIds);
      for (const row of (tagRows ?? []) as Array<{ episode_id: string; institution_tags: TagOption | TagOption[] | null }>) {
        const tag = Array.isArray(row.institution_tags) ? row.institution_tags[0] : row.institution_tags;
        if (!tag) continue;
        if (!map.has(row.episode_id)) map.set(row.episode_id, []);
        map.get(row.episode_id)!.push(tag);
      }
    }
    setTagsByEpisode(map);

    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  const active = roster.filter((r) => !r.endedAt);
  const discharged = roster.filter((r) => r.endedAt);

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/clinic-admin/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Clients</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          <Link
            href="/principal/passports/enrol"
            className="mb-4 block w-full lg:w-auto rounded-2xl border border-dashed border-brand-prussian-blue/40 px-4 py-3 text-center text-sm font-semibold text-brand-prussian-blue"
          >
            + Add Client
          </Link>

          {isLoading ? (
            <div className="flex flex-col gap-2">
              <div className="h-[70px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[70px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : error ? (
            <p className="text-sm text-brand-neutral-black/60">{error}</p>
          ) : roster.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
              No clients yet.
            </p>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {active.map((row) => (
                  <ClientRow key={row.passportId} row={row} tags={tagsByEpisode.get(row.episodeId) ?? []} />
                ))}
              </div>

              {discharged.length > 0 && (
                <div className="mt-6">
                  <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/40">
                    Discharged ({discharged.length})
                  </p>
                  <div className="flex flex-col gap-2">
                    {discharged.map((row) => (
                      <ClientRow key={row.passportId} row={row} tags={tagsByEpisode.get(row.episodeId) ?? []} muted />
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

function ClientRow({ row, tags, muted = false }: { row: RosterRow; tags: TagOption[]; muted?: boolean }) {
  return (
    <Link
      href={`/clinic-admin/client/${row.passportId}`}
      className={`flex items-center justify-between gap-3 rounded-2xl border border-black/5 p-4 shadow-sm ${
        muted ? "bg-white/60" : "bg-white"
      }`}
    >
      <div className="min-w-0">
        <p className={`truncate font-sans text-body font-semibold ${muted ? "text-brand-neutral-black/60" : "text-brand-neutral-black"}`}>
          {row.childName}
        </p>
        {tags.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {tags.map((t, i) => (
              <span key={i} className="rounded-full bg-brand-pastel-blue/20 px-2 py-0.5 text-xs text-brand-prussian-blue">
                {t.value}
              </span>
            ))}
          </div>
        )}
      </div>
      <span className="flex-shrink-0 text-xl text-brand-prussian-blue">›</span>
    </Link>
  );
}
