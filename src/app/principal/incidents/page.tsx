"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { IncidentCard, formatIncidentDate, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";
import {
  deriveIncidentDisplayStatus,
  INCIDENT_DISPLAY_STATUS_LABEL,
  INCIDENT_DISPLAY_STATUS_STYLE,
} from "@/lib/incidentDisplayStatus";

// Phase 6, Part G. A list, not a dashboard -- the real principal
// dashboard is a separate build (PRD 2 Stage 7, now PRD 4 Stage 2's
// work queue). Straight through get_institution_incidents(), which
// already supports date-range and planning_status/ncse_complete
// filtering -- unchanged this stage, no new params.
//
// PRD 4, Stage 3 -- table at lg+ (Date, Child, Status, Location), pill
// filters, PDF export replacing CSV. Below lg, the row list stays
// IncidentCard, unchanged -- PRD 4 doesn't ask for a mobile table, and
// IncidentCard already carries more context than the bare columns would
// at that width.
//
// A later pass (this file's own table-header comment below has the
// full recon) added real child names, sortable Class and Logged By
// columns, and a colour-coded four-state status badge -- overruling
// this stage's own "no Reporter column, no sortable who-logged-this
// axis" reasoning. See CLAUDE.md: identification and sorting are fine,
// a performance-metric framing is not.
//
// Filters: three pills map onto the RPC's EXISTING params, no widening.
// Date Range only toggles the from/to inputs' visibility -- it isn't a
// filter value by itself. Restraint Used is a real filter: with no
// sub-filter chosen there's no "has_restrictive_practice, any planning
// status" RPC param, so that specific case filters client-side over the
// same rows already fetched; choosing In BSP or Unplanned passes
// p_planning_status server-side exactly as the old select did. NCSE
// Pending maps to the existing p_ncse_complete: false -- the old
// "Complete" option is dropped (the PRD asks for one pill, not a
// three-way choice); the data itself (ncse_report_complete) is still
// visible per incident, only the FILTER control simplified.
const PLANNING_SUB_FILTERS = [
  { value: "in_bsp" as const, label: "In BSP" },
  { value: "not_planned" as const, label: "Unplanned" },
];

function PillToggle({
  label,
  isActive,
  onClick,
}: {
  label: string;
  isActive: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={isActive}
      className={`rounded-full border px-4 py-2 font-sans text-body font-semibold transition-colors ${
        isActive
          ? "border-brand-pastel-blue bg-brand-pastel-blue text-brand-prussian-blue"
          : "border-black/10 bg-white text-brand-neutral-black/70"
      }`}
    >
      {label}
    </button>
  );
}

export default function PrincipalIncidentsListPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [isDateRangeOpen, setIsDateRangeOpen] = useState(false);
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [isRestraintUsed, setIsRestraintUsed] = useState(false);
  const [planningSubFilter, setPlanningSubFilter] = useState<"" | "in_bsp" | "not_planned">("");
  const [isNcsePending, setIsNcsePending] = useState(false);
  const [rows, setRows] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Class and Logged By are sortable -- overruling PRD 4 Stage 3's own
  // "no sortable who-logged-this axis" rule (CLAUDE.md now records why:
  // identification and sorting are fine, a performance-metric framing
  // is not). Client-side over the already-fetched rows, same as every
  // other client-side derivation on this page -- no new RPC param.
  const [sortKey, setSortKey] = useState<"class" | "loggedBy" | null>(null);
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("asc");
  // Background pass, "the ~17 window.location.reload() sites" -- a
  // reloadKey re-runs the load effect below in place instead of a hard
  // browser reload, matching the incident page's own fix.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadInstitution() {
      const supabase = createClient();
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
    async function resolveLapsed() {
      const supabase = createClient();
      try {
        await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionId });
      } catch {
        // best-effort; see /principal/dashboard's own matching comment
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
        p_planning_status: planningSubFilter || null,
        p_ncse_complete: isNcsePending ? false : null,
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
  }, [institutionId, start, end, planningSubFilter, isNcsePending, reloadKey]);

  // Client-side only for the one combination the RPC's own params can't
  // express (restraint used, any planning status) -- see header comment.
  const visibleRows = isRestraintUsed && !planningSubFilter ? rows.filter((r) => r.has_restrictive_practice) : rows;

  // useMemo is a hook -- must run unconditionally, so this stays above
  // the `!isReady` early return below rather than beside printHref.
  const sortedRows = useMemo(() => {
    if (!sortKey) return visibleRows;
    const withKey = (r: InstitutionIncidentRow) =>
      sortKey === "class" ? (r.class_names ?? []).join(", ") : (r.created_by_name ?? "");
    const sorted = [...visibleRows].sort((a, b) => withKey(a).localeCompare(withKey(b)));
    return sortDirection === "asc" ? sorted : sorted.reverse();
  }, [visibleRows, sortKey, sortDirection]);

  if (!isReady) {
    return null;
  }

  // Class and Logged By only -- Daniel's literal ask, not extended to
  // Date/Child/Status/Location. Toggling the same key flips direction;
  // picking a new key starts ascending.
  function toggleSort(key: "class" | "loggedBy") {
    if (sortKey === key) {
      setSortDirection((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDirection("asc");
    }
  }

  const printHref = `/principal/incidents/print?${new URLSearchParams({
    start,
    end,
    restraint: isRestraintUsed ? "1" : "",
    planning: planningSubFilter,
    ncse: isNcsePending ? "1" : "",
  }).toString()}`;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center justify-between gap-3 px-4 pt-6 pb-4">
        <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Incidents</h1>
        <Link
          href={printHref}
          aria-disabled={rows.length === 0}
          className={`rounded-full bg-brand-prussian-blue px-4 py-2.5 font-sans text-eyebrow font-bold uppercase tracking-wide text-white shadow-sm ${
            rows.length === 0 ? "pointer-events-none opacity-40" : ""
          }`}
        >
          Export PDF
        </Link>
      </header>

      <main className="flex-1 px-4">
        <div className="mb-4 flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <PillToggle label="Date Range" isActive={isDateRangeOpen} onClick={() => setIsDateRangeOpen((v) => !v)} />
            <PillToggle
              label="Restraint Used"
              isActive={isRestraintUsed}
              onClick={() => {
                setIsRestraintUsed((v) => !v);
                if (isRestraintUsed) setPlanningSubFilter("");
              }}
            />
            <PillToggle label="NCSE Pending" isActive={isNcsePending} onClick={() => setIsNcsePending((v) => !v)} />
          </div>

          {isDateRangeOpen && (
            <div className="flex gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <div className="flex-1">
                <label className="mb-1.5 block font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  From
                </label>
                <input
                  type="date"
                  value={start}
                  onChange={(e) => setStart(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-sans text-body text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              </div>
              <div className="flex-1">
                <label className="mb-1.5 block font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  To
                </label>
                <input
                  type="date"
                  value={end}
                  onChange={(e) => setEnd(e.target.value)}
                  className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 font-sans text-body text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              </div>
            </div>
          )}

          {/* Sub-filters, not peers -- planning status only means anything
              where restraint occurred, so this row only exists once
              Restraint Used is on. */}
          {isRestraintUsed && (
            <div className="ml-4 flex flex-wrap gap-2 border-l-2 border-brand-pastel-blue pl-4">
              {PLANNING_SUB_FILTERS.map((opt) => (
                <PillToggle
                  key={opt.value}
                  label={opt.label}
                  isActive={planningSubFilter === opt.value}
                  onClick={() => setPlanningSubFilter((v) => (v === opt.value ? "" : opt.value))}
                />
              ))}
            </div>
          )}
        </div>

        {isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
                <div className="h-5 w-[120px] flex-shrink-0 rounded bg-black/10" />
                <div className="h-4 flex-1 rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
        ) : visibleRows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
            No incidents match these filters.
          </p>
        ) : (
          <>
            {/* The table -- lg+ only. Date, Child, Status, Location, Class,
                Logged By.
                Child now shows real names (child_names), not the
                anonymous per-incident letter code -- checked before
                lifting it (migration 0150's own header comment has the
                full recon): child_index is never referenced by any
                narrative or user-facing copy, get_institution_incidents()
                is principal-only (three call sites, all gated on
                can_countersign_incident(), which is itself one of
                can_view_incident()'s own OR-branches -- real names are
                already one click away on every row's detail page today).
                Below lg, IncidentCard now shows the same real names too
                (showRealNames prop) -- same screen at two widths, so a
                principal on an iPad shouldn't see "A" while a laptop
                shows the name. The print export still reads
                child_indices, deliberately -- a document that leaves
                the app is a different artefact from a screen a
                principal scrolls; see CLAUDE.md's "REAL NAMES IN THE
                PRINCIPAL'S PDF EXPORT" entry, open for Catherine, not
                decided here.
                Class and Logged By are new, and sortable -- CLAUDE.md now
                records why this overrules PRD 4 Stage 3's old "no
                sortable who-logged-this axis" rule: a principal seeing
                one name recur is identifying where support is needed,
                not ranking people. Status is a colour-coded four-state
                badge (incidentDisplayStatus.ts) instead of the raw
                incidents.status text -- colour is never the only signal,
                the label is always alongside. */}
            <div className="hidden overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm lg:block">
              <table className="w-full text-left">
                <thead>
                  <tr className="border-b-2 border-brand-pastel-blue">
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Date
                    </th>
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Child
                    </th>
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Status
                    </th>
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Location
                    </th>
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      <button
                        type="button"
                        onClick={() => toggleSort("class")}
                        className="flex items-center gap-1 uppercase tracking-wide"
                      >
                        Class {sortKey === "class" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                    <th className="px-4 py-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      <button
                        type="button"
                        onClick={() => toggleSort("loggedBy")}
                        className="flex items-center gap-1 uppercase tracking-wide"
                      >
                        Logged By {sortKey === "loggedBy" ? (sortDirection === "asc" ? "↑" : "↓") : ""}
                      </button>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sortedRows.map((r) => {
                    const displayStatus = deriveIncidentDisplayStatus(r);
                    return (
                      <tr key={r.incident_id} className="border-b border-black/5 last:border-0">
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 font-sans text-body text-brand-neutral-black hover:bg-brand-off-white/60"
                          >
                            {formatIncidentDate(r.occurred_at)}
                          </Link>
                        </td>
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 font-heading text-h2 font-semibold text-brand-prussian-blue hover:bg-brand-off-white/60"
                          >
                            {(r.child_names ?? []).join(", ") || "—"}
                          </Link>
                        </td>
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 hover:bg-brand-off-white/60"
                          >
                            <span
                              className={`inline-block rounded-full px-2.5 py-1 font-sans text-eyebrow font-semibold ${INCIDENT_DISPLAY_STATUS_STYLE[displayStatus]}`}
                            >
                              {INCIDENT_DISPLAY_STATUS_LABEL[displayStatus]}
                            </span>
                          </Link>
                        </td>
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 font-sans text-body text-brand-neutral-black hover:bg-brand-off-white/60"
                          >
                            {r.location}
                          </Link>
                        </td>
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 font-sans text-body text-brand-neutral-black hover:bg-brand-off-white/60"
                          >
                            {(r.class_names ?? []).join(", ") || "—"}
                          </Link>
                        </td>
                        <td className="p-0">
                          <Link
                            href={`/teacher/incidents/${r.incident_id}`}
                            className="block px-4 py-3 font-sans text-body text-brand-neutral-black hover:bg-brand-off-white/60"
                          >
                            {r.created_by_name ?? "—"}
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="flex flex-col gap-2 lg:hidden">
              {visibleRows.map((r) => (
                <IncidentCard key={r.incident_id} incident={r} showRealNames />
              ))}
            </div>
          </>
        )}
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
