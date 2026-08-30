"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { IncidentCard, STATUS_LABEL, formatIncidentDate, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";

// Phase 6, Part G. A list, not a dashboard -- the real principal
// dashboard is a separate, later build (PRD 2 Stage 7). Straight
// through get_institution_incidents(), which already supports
// date-range and planning_status/ncse_complete filtering.
//
// PRD 2, Stage 1: row rendering is now IncidentCard, shared with
// /principal/dashboard -- see that component's own header comment.
// resolve_lapsed_incident_ownership() moved to its own effect, firing
// once on institution resolution rather than on every filter change
// (confirmed idempotent by reading its live SQL; calling it repeatedly
// was harmless, just wasteful).

const PLANNING_STATUS_OPTIONS = [
  { value: "", label: "Any" },
  { value: "in_bsp", label: "In BSP" },
  { value: "not_planned", label: "Not planned" },
];

const NCSE_OPTIONS = [
  { value: "", label: "Any" },
  { value: "true", label: "Complete" },
  { value: "false", label: "Not complete" },
];

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export default function PrincipalIncidentsListPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [planningStatus, setPlanningStatus] = useState("");
  const [ncseComplete, setNcseComplete] = useState("");
  const [rows, setRows] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadInstitution() {
      const supabase = createClient();
      // approved_at is not null alongside deactivated_at is null -- see
      // useTeacherPassports.ts's matching comment.
      const { data } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();
      if (!isMounted) return;
      setInstitutionId(data?.institution_id ?? null);
    }
    loadInstitution();
    return () => {
      isMounted = false;
    };
  }, [user]);

  // PRD 1, Stage 3 / PRD 2, Stage 1: same lazy-materialization call as
  // /principal/dashboard -- this is a second, separate principal-facing
  // incident list, so it needs its own call, not assumed covered by the
  // dashboard's own. Best-effort, never blocks the load. Its own effect
  // now, firing once when institutionId resolves -- not re-run on every
  // filter change the way it used to be (confirmed idempotent, but
  // there's no reason to re-trigger it on a date-range tweak).
  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function resolveLapsed() {
      const supabase = createClient();
      try {
        await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionId });
      } catch {
        // best-effort; see comment above
      }
    }
    if (isMounted) resolveLapsed();
    return () => {
      isMounted = false;
    };
  }, [institutionId]);

  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_institution_incidents", {
        p_institution_id: institutionId,
        p_start: start || null,
        p_end: end || null,
        p_planning_status: planningStatus || null,
        p_ncse_complete: ncseComplete === "" ? null : ncseComplete === "true",
      });
      if (!isMounted) return;
      if (error) {
        setLoadError("Couldn't load incidents.");
        setIsLoading(false);
        return;
      }
      setRows((data ?? []) as InstitutionIncidentRow[]);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [institutionId, start, end, planningStatus, ncseComplete]);

  function exportCsv() {
    const header = [
      "Occurred", "Location", "Category", "Status", "Owning teacher", "Children",
      "Debrief required", "Teacher signed", "Countersigned", "Restrictive practice", "Planning status", "NCSE complete",
    ];
    const lines = rows.map((r) =>
      [
        formatIncidentDate(r.occurred_at),
        r.location,
        r.category ?? "not recorded",
        STATUS_LABEL[r.status] ?? r.status,
        r.owning_teacher_name ?? "—",
        (r.child_indices ?? []).join("/"),
        r.debrief_required ? "Yes" : "No",
        r.teacher_signed_at ? formatIncidentDate(r.teacher_signed_at) : "not yet",
        r.countersigned_at ? formatIncidentDate(r.countersigned_at) : "not yet",
        r.has_restrictive_practice ? "Yes" : "No",
        (r.planning_status ?? []).join("/") || "—",
        (r.ncse_report_complete ?? []).map((c) => (c ? "Complete" : "Not complete")).join("/") || "—",
      ]
        .map((v) => csvEscape(String(v)))
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `incidents-${start || "all"}-to-${end || "all"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Incidents</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="mb-4 flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black/60">From</label>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black/60">To</label>
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              />
            </div>
          </div>
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black/60">Planning status</label>
              <select
                value={planningStatus}
                onChange={(e) => setPlanningStatus(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              >
                {PLANNING_STATUS_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex-1">
              <label className="mb-1.5 block text-xs font-semibold text-brand-neutral-black/60">NCSE report</label>
              <select
                value={ncseComplete}
                onChange={(e) => setNcseComplete(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
              >
                {NCSE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-full bg-brand-prussian-blue px-4 py-2.5 text-sm font-semibold text-white shadow-sm disabled:opacity-40"
          >
            Export CSV ({rows.length})
          </button>
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            No incidents match these filters.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((r) => (
              <IncidentCard key={r.incident_id} incident={r} />
            ))}
          </div>
        )}
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
