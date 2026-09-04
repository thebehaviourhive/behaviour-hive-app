"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// Passport Incidents tabs (migration 0166) -- the parent's own passport
// dashboard had the identical mislabelling every non-clinician track
// had: its own "Incident Timeline" section was the ABC log timeline,
// and the real incident log lived only on a separate, disconnected
// route (/parent-dashboard/incidents), never reachable from the
// passport view itself. Self-contained, own fetch -- matching
// IncidentNoticeCard/RecentUpdatesCard's own established pattern of a
// small dashboard-embedded component with its own load effect, rather
// than folding another RPC into that page's already-large load().
//
// get_parent_incidents() (0093) already gates on owns_passport() +
// teacher_signed_at is not null -- signed-off, own child only, exactly
// the same RPC /parent-dashboard/incidents and IncidentNoticeCard
// already use. No new access.
interface ParentIncidentRow {
  incident_id: string;
  occurred_at: string;
  location: string;
  parent_summary: string | null;
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

export function PassportIncidentsSection({ passportId }: { passportId: string }) {
  const [rows, setRows] = useState<ParentIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();
    supabase
      .rpc("get_parent_incidents", { p_passport_id: passportId })
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          setLoadError("Couldn't load incidents.");
          setIsLoading(false);
          return;
        }
        setRows((data ?? []) as ParentIncidentRow[]);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId, reloadKey]);

  return (
    <section className="mt-2 mb-6">
      <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">Incidents</h2>
      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-20 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : loadError ? (
        <InlineErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : rows.length === 0 ? (
        <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
          <p className="text-sm text-brand-neutral-black/70">Nothing recorded yet.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {rows.map((row) => (
            <Link
              key={row.incident_id}
              href={`/parent-dashboard/incidents/${row.incident_id}`}
              className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
            >
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                {formatDateTime(row.occurred_at)} · {row.location}
              </p>
              <p className="mt-1.5 text-sm text-brand-neutral-black">
                {row.parent_summary || "The school has completed this record."}
              </p>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
