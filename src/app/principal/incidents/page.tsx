"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// Phase 6, Part G. A list, not a dashboard -- the real principal
// dashboard is a separate, later build. Straight through
// get_institution_incidents(), which already supports date-range and
// planning_status/ncse_complete filtering (built in an earlier phase,
// unused by any client until now) -- no new SQL needed for this piece.

interface InstitutionIncidentRow {
  incident_id: string;
  occurred_at: string;
  location: string;
  category: string | null;
  status: string;
  owning_teacher_name: string | null;
  child_indices: string[] | null;
  debrief_required: boolean;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  has_restrictive_practice: boolean;
  planning_status: string[] | null;
  ncse_report_complete: boolean[] | null;
  created_by_name: string | null;
  is_inherited: boolean;
  inherited_from_name: string | null;
  inherited_transferred_at: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_signoff: "Awaiting sign-off",
  awaiting_principal: "Awaiting principal sign-off",
  finalised: "Finalised",
};

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

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

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

  useEffect(() => {
    if (!institutionId) return;
    let isMounted = true;
    async function load() {
      setIsLoading(true);
      setLoadError(null);
      const supabase = createClient();
      // PRD 1, Stage 3: same lazy-materialization call as /principal/
      // dashboard -- this is a second, separate principal-facing
      // incident list, so it needs the same call, not assumed covered
      // by the dashboard's own. Best-effort, never blocks the load.
      try {
        await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionId });
      } catch {
        // best-effort; see comment above
      }
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
        formatDate(r.occurred_at),
        r.location,
        r.category ?? "not recorded",
        STATUS_LABEL[r.status] ?? r.status,
        r.owning_teacher_name ?? "—",
        (r.child_indices ?? []).join("/"),
        r.debrief_required ? "Yes" : "No",
        r.teacher_signed_at ? formatDate(r.teacher_signed_at) : "not yet",
        r.countersigned_at ? formatDate(r.countersigned_at) : "not yet",
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
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
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
              <div key={r.incident_id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <Link href={`/teacher/incidents/${r.incident_id}`} className="block">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-sm font-semibold text-brand-neutral-black">{formatDate(r.occurred_at)}</p>
                    <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
                      {STATUS_LABEL[r.status] ?? r.status}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-brand-neutral-black/80">
                    {r.location} · {(r.child_indices ?? []).length} child{(r.child_indices ?? []).length === 1 ? "" : "ren"}
                    {r.owning_teacher_name ? ` · ${r.owning_teacher_name}` : ""}
                  </p>
                  {/* Same "visibly inherited" requirement as the
                      dashboard's own queue -- this is a second, separate
                      principal-facing incident list, not assumed to
                      inherit the dashboard's own copy of this badge. */}
                  {r.is_inherited && (
                    <p className="mt-1.5 rounded-xl bg-brand-golden-brown/10 px-2.5 py-1.5 text-xs text-brand-golden-brown">
                      Inherited from {r.inherited_from_name ?? "a departed supply teacher"}
                      {r.inherited_transferred_at ? ` · transferred ${formatDate(r.inherited_transferred_at)}` : ""}
                    </p>
                  )}
                  {r.has_restrictive_practice && (
                    <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
                      {(r.planning_status ?? []).map((s, i) => (
                        <span key={i} className="rounded-full bg-brand-golden-brown/10 px-2 py-0.5 font-semibold text-brand-golden-brown">
                          {s === "in_bsp" ? "In BSP" : "Not planned"}
                        </span>
                      ))}
                    </div>
                  )}
                </Link>
                {/* Direct route to the document, not just the form -- a --
                    principal working from this list wants the PDF.
                    Signed records only, same gate the export page and
                    the detail page's own export link both use. */}
                {r.teacher_signed_at && (
                  <Link
                    href={`/teacher/incidents/${r.incident_id}/print`}
                    className="mt-3 block rounded-xl border border-brand-prussian-blue py-2 text-center text-xs font-semibold text-brand-prussian-blue"
                  >
                    Export PDF
                  </Link>
                )}
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
