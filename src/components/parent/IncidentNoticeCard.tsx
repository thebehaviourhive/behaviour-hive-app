"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Phase 4, piece 4. The parent-facing side of the two-stage incident
// notification. IN-APP ONLY (no push/email/SMS) -- this card being
// visible here is the entire delivery mechanism.
//
// parent_incident_notices carries no body of its own (see its own
// migration comment) -- content is sourced live: stage 1's fixed copy
// uses the notice's own created_at (the moment the trigger fired, which
// is the same moment as the stamp -- not incidents.occurred_at, which a
// backdated stamp could set earlier than "now"), stage 2's content comes
// from get_parent_incidents() -- the same RPC this session's own audit
// fixed to gate on teacher_signed_at, so there is no path for this card
// to render a stage-2 notice before the record is genuinely signed off.
//
// Grouped by incident_id, one card per incident, showing only the more
// advanced of the two stages when both exist -- a stage-1 notice never
// lingers next to its own stage-2 successor.
//
// CLICKABLE (was a dead end): links to /parent-dashboard/incidents/
// [incidentId], which renders the full record via the exact same
// get_parent_incidents() call this card already makes -- no widened
// access, just a destination that finally exists. A stage-1 notice
// links there too; the detail page's own empty state explains why
// nothing shows yet (not signed off) rather than erroring.
//
// MORE PROMINENT: Golden Brown, not the plain white every other
// dashboard card uses -- an incident notice is a different weight of
// thing than routine activity, and needs to read as one at a glance,
// not just via its text.

interface NoticeRow {
  id: string;
  notice_type: "incident_recorded" | "incident_summary_ready";
  incident_id: string;
  created_at: string;
}

interface ParentIncidentRow {
  incident_id: string;
  occurred_at: string;
  location: string;
  parent_summary: string | null;
}

interface IncidentEntry {
  incidentId: string;
  stage: "incident_recorded" | "incident_summary_ready";
  recordedAt: string;
  fullDetail: ParentIncidentRow | null;
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

function formatTimeOnly(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

async function fetchEntries(passportId: string): Promise<IncidentEntry[]> {
  const supabase = createClient();
  const [{ data: noticeRows }, { data: fullRows }] = await Promise.all([
    supabase
      .from("parent_incident_notices")
      .select("id, notice_type, incident_id, created_at")
      .eq("passport_id", passportId)
      .order("created_at", { ascending: false }),
    supabase.rpc("get_parent_incidents", { p_passport_id: passportId }),
  ]);

  const fullByIncidentId = new Map<string, ParentIncidentRow>(
    ((fullRows ?? []) as ParentIncidentRow[]).map((row) => [row.incident_id, row])
  );

  // Group by incident, keep only the more advanced stage per incident --
  // 'incident_summary_ready' supersedes 'incident_recorded', never shown
  // alongside it.
  const byIncidentId = new Map<string, IncidentEntry>();
  for (const row of (noticeRows ?? []) as NoticeRow[]) {
    const existing = byIncidentId.get(row.incident_id);
    if (existing && existing.stage === "incident_summary_ready") continue;
    byIncidentId.set(row.incident_id, {
      incidentId: row.incident_id,
      stage: row.notice_type,
      recordedAt: row.created_at,
      fullDetail: fullByIncidentId.get(row.incident_id) ?? null,
    });
  }

  return Array.from(byIncidentId.values()).sort(
    (a, b) => new Date(b.recordedAt).getTime() - new Date(a.recordedAt).getTime()
  );
}

export function IncidentNoticeCard({ passportId }: { passportId: string | null }) {
  const [isLoading, setIsLoading] = useState(true);
  const [entries, setEntries] = useState<IncidentEntry[]>([]);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      if (!passportId) {
        if (isMounted) setIsLoading(false);
        return;
      }
      const result = await fetchEntries(passportId);
      if (!isMounted) return;
      setEntries(result);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [passportId]);

  if (isLoading || entries.length === 0) {
    return null;
  }

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-black/40">Incident notices</h2>
        <Link href="/parent-dashboard/incidents" className="text-xs font-semibold text-brand-prussian-blue">
          View all
        </Link>
      </div>
      <div className="flex flex-col gap-2">
        {entries.map((entry) => (
          <Link
            key={entry.incidentId}
            href={`/parent-dashboard/incidents/${entry.incidentId}`}
            className="block rounded-2xl border border-brand-golden-brown bg-brand-golden-brown/10 p-4 shadow-sm"
          >
            {entry.stage === "incident_recorded" ? (
              <p className="text-sm font-medium text-brand-neutral-black">
                An incident involving your child was recorded at {formatTimeOnly(entry.recordedAt)} today. Their
                teacher will share the details once the record is complete.
              </p>
            ) : (
              <>
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-golden-brown">
                  {entry.fullDetail ? formatDateTime(entry.fullDetail.occurred_at) : formatDateTime(entry.recordedAt)}
                  {entry.fullDetail?.location ? ` · ${entry.fullDetail.location}` : ""}
                </p>
                <p className="mt-1.5 text-sm font-medium text-brand-neutral-black">
                  {entry.fullDetail?.parent_summary || "The school has completed this record."}
                </p>
              </>
            )}
          </Link>
        ))}
      </div>
    </section>
  );
}
