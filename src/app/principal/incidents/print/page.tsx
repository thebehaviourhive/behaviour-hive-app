"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BrandMark } from "@/components/ui/BrandMark";
import { STATUS_LABEL, formatIncidentDate, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";

// PRD 4, Stage 3 -- replaces the old Export CSV button. Same pattern as
// the existing per-incident PDF export (teacher/incidents/[incidentId]/
// print/page.tsx): window.print(), no server-side PDF step, no new RPC
// -- this reads the exact same get_institution_incidents() the list
// page already calls, with the same filter params passed as a query
// string so this route can be reached directly (a real page, real URL,
// not a client-side-only export function) without re-deriving filter
// state from anywhere else.
//
// A principal exporting a date range is producing a document for a
// board meeting, an inspection, or a child's file -- carries the school
// name, the date range and which filters were applied, and per incident
// the same four fields as the table plus whether restraint was used and
// its planning status, printed as words, never colour. Same honesty
// rules as the single-incident export: "not recorded" (the fact wasn't
// captured) is never conflated with "No" (the fact is known and
// negative) or with "—" (the question doesn't apply here at all).

const PLANNING_STATUS_LABEL: Record<string, string> = {
  in_bsp: "In BSP",
  not_planned: "Not planned",
};

function planningStatusText(row: InstitutionIncidentRow): string {
  if (!row.has_restrictive_practice) return "—";
  const statuses = row.planning_status ?? [];
  if (statuses.length === 0) return "not recorded";
  return statuses.map((s) => PLANNING_STATUS_LABEL[s] ?? s).join(", ");
}

function dateRangeText(start: string, end: string): string {
  if (start && end) return `${formatIncidentDate(start)} – ${formatIncidentDate(end)}`;
  if (start) return `From ${formatIncidentDate(start)}`;
  if (end) return `Up to ${formatIncidentDate(end)}`;
  return "All dates";
}

function filtersAppliedText(restraint: boolean, planning: string, ncse: boolean): string {
  const parts: string[] = [];
  if (restraint) {
    parts.push(planning ? `restraint used (${PLANNING_STATUS_LABEL[planning] ?? planning})` : "restraint used");
  }
  if (ncse) parts.push("NCSE pending");
  return parts.length > 0 ? `Filtered to ${parts.join(", ")}.` : "No filters applied.";
}

export default function PrincipalIncidentsPrintPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const searchParams = useSearchParams();

  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";
  const isRestraintUsed = searchParams.get("restraint") === "1";
  const planningSubFilter = searchParams.get("planning") ?? "";
  const isNcsePending = searchParams.get("ncse") === "1";

  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [rows, setRows] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- a
  // reloadKey re-runs this same load effect in place instead of a hard
  // browser reload, matching the incident page's own fix.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    async function load() {
      const supabase = createClient();
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(name)")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();
      if (!isMounted) return;
      if (staffError || !staffRow) {
        setLoadError("Couldn't find your institution.");
        setIsLoading(false);
        return;
      }
      const institutionRecord = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
      setInstitutionName(name ?? null);

      const { data, error } = await supabase.rpc("get_institution_incidents", {
        p_institution_id: staffRow.institution_id,
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
      const allRows = (data ?? []) as InstitutionIncidentRow[];
      setRows(isRestraintUsed && !planningSubFilter ? allRows.filter((r) => r.has_restrictive_practice) : allRows);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [user, start, end, planningSubFilter, isNcsePending, isRestraintUsed, reloadKey]);

  if (!isReady) {
    return null;
  }

  if (isLoading) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="p-6">
        <InlineErrorState message={loadError} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  return (
    <div className="min-h-full bg-brand-off-white/40 pb-16 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 py-4 backdrop-blur-sm">
        <button
          type="button"
          onClick={() => router.back()}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export incident report</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-bold text-white shadow-sm"
        >
          Print / Save as PDF
        </button>
      </div>

      <div className="mx-auto max-w-3xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-8 flex items-center gap-3 border-b-4 border-brand-prussian-blue pb-4 print-avoid-break">
          <BrandMark size={40} />
          <div>
            <p className="font-heading text-base font-bold text-brand-prussian-blue">The Behaviour Hive</p>
            <p className="text-xs text-brand-neutral-black/60">School Incident Report</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl bg-brand-prussian-blue px-5 py-4 text-center print:rounded-none print-avoid-break">
          <p className="font-heading text-lg font-bold tracking-wide text-white">
            {institutionName ?? "Behaviour Hive School"}
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">Private and Confidential</p>
        </div>

        <div className="mb-8 rounded-2xl border border-black/10 p-4 text-sm print:rounded-none print-avoid-break">
          <p className="text-brand-neutral-black/50">Date range</p>
          <p className="font-semibold text-brand-neutral-black">{dateRangeText(start, end)}</p>
          <p className="mt-2 text-brand-neutral-black/50">Filters applied</p>
          <p className="font-semibold text-brand-neutral-black">
            {filtersAppliedText(isRestraintUsed, planningSubFilter, isNcsePending)}
          </p>
          <p className="mt-2 text-brand-neutral-black/50">Total incidents</p>
          <p className="font-semibold text-brand-neutral-black">{rows.length}</p>
        </div>

        {rows.length === 0 ? (
          <p className="text-sm text-brand-neutral-black/60">No incidents match this date range and these filters.</p>
        ) : (
          <table className="w-full border-collapse text-left text-sm print-avoid-break">
            <thead>
              <tr className="border-b-2 border-brand-pastel-blue">
                <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Date
                </th>
                <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Child
                </th>
                <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Status
                </th>
                <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Location
                </th>
                <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Restraint used
                </th>
                <th className="py-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  Planning status
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.incident_id} className="border-b border-black/5 print-avoid-break">
                  <td className="py-2 pr-3 text-brand-neutral-black">{formatIncidentDate(r.occurred_at)}</td>
                  <td className="py-2 pr-3 text-brand-neutral-black">{(r.child_indices ?? []).join(", ") || "—"}</td>
                  <td className="py-2 pr-3 text-brand-neutral-black">{STATUS_LABEL[r.status] ?? r.status}</td>
                  <td className="py-2 pr-3 text-brand-neutral-black">{r.location}</td>
                  <td className="py-2 pr-3 text-brand-neutral-black">{r.has_restrictive_practice ? "Yes" : "No"}</td>
                  <td className="py-2 text-brand-neutral-black">{planningStatusText(r)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <p className="no-print mt-8 text-xs text-brand-neutral-black/50">
          <Link href="/principal/incidents" className="text-brand-prussian-blue">
            ‹ Back to Incidents
          </Link>
        </p>
      </div>
    </div>
  );
}
