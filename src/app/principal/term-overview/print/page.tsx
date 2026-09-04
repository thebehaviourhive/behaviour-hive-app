"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BrandMark } from "@/components/ui/BrandMark";
import { computeTrend, formatTermRange } from "@/lib/termOverviewFormatting";

// PRD 4, Stage 6 -- same window.print() pattern as the incidents export
// (principal/incidents/print/page.tsx): no server-side PDF step, no new
// RPC, own route reading the date range as query params so it's a real,
// directly reachable URL rather than a client-side-only export
// function.
//
// This is the one document in the whole app whose stated purpose is
// going in front of a board or an inspector, so both counting rules
// agreed for Stage 6 are written out in words here, not just encoded in
// the RPC -- a raw "12 restraints, 4 not planned" is uninterpretable to
// someone who doesn't already know what "not planned" counts as.

interface ByChildRow {
  passport_id: string;
  child_name: string;
  incident_count: number;
  restraint_count: number;
  unplanned_restraint_count: number;
}

interface ByClassRow {
  class_id: string | null;
  class_name: string;
  incident_count: number;
  restraint_count: number;
  unplanned_restraint_count: number;
}

interface PeriodTotals {
  total_incidents: number;
  total_restraints: number;
  planned_restraints: number;
  unplanned_restraints: number;
}

interface TermOverviewResult {
  period: { start: string; end: string };
  prior_period: { start: string; end: string };
  current: PeriodTotals;
  prior: PeriodTotals;
  by_child: ByChildRow[];
  by_class: ByClassRow[];
}

export default function TermOverviewPrintPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const searchParams = useSearchParams();
  const start = searchParams.get("start") ?? "";
  const end = searchParams.get("end") ?? "";

  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [result, setResult] = useState<TermOverviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- a
  // reloadKey re-runs this same load effect in place instead of a hard
  // browser reload, matching the incident page's own fix.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!user || !start || !end) return;
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

      const { data, error } = await supabase.rpc("get_institution_term_overview", {
        p_institution_id: staffRow.institution_id,
        p_start: start,
        p_end: end,
      });
      if (!isMounted) return;
      if (error) {
        setLoadError("Couldn't load the term summary.");
        setIsLoading(false);
        return;
      }
      setResult(data as TermOverviewResult);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [user, start, end, reloadKey]);

  if (!isReady) {
    return null;
  }

  if (!start || !end) {
    return (
      <div className="p-6">
        <InlineErrorState message="No date range given." onRetry={() => router.push("/principal/term-overview")} />
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError || !result) {
    return (
      <div className="p-6">
        <InlineErrorState message={loadError ?? "Couldn't load the term summary."} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  const incidentsTrend = computeTrend(result.current.total_incidents, result.prior.total_incidents);
  const restraintsTrend = computeTrend(result.current.total_restraints, result.prior.total_restraints);

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
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export term overview</p>
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
            <p className="text-xs text-brand-neutral-black/60">Term Overview</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl bg-brand-prussian-blue px-5 py-4 text-center print:rounded-none print-avoid-break">
          <p className="font-heading text-lg font-bold tracking-wide text-white">
            {institutionName ?? "Behaviour Hive School"}
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">Private and Confidential</p>
        </div>

        <div className="mb-8 rounded-2xl border border-black/10 p-4 text-sm print:rounded-none print-avoid-break">
          <p className="text-brand-neutral-black/50">Period covered</p>
          <p className="font-semibold text-brand-neutral-black">{formatTermRange(result.period.start, result.period.end)}</p>
          <p className="mt-2 text-brand-neutral-black/50">Compared against</p>
          <p className="font-semibold text-brand-neutral-black">
            {formatTermRange(result.prior_period.start, result.prior_period.end)} (the same number of days immediately
            before)
          </p>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-3 print-avoid-break">
          <div className="rounded-2xl border border-black/10 p-4 print:rounded-none">
            <p className="text-xs text-brand-neutral-black/50">Total incidents</p>
            <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{result.current.total_incidents}</p>
            <p className="text-xs font-semibold text-brand-neutral-black/70">{incidentsTrend.label}</p>
          </div>
          <div className="rounded-2xl border border-black/10 p-4 print:rounded-none">
            <p className="text-xs text-brand-neutral-black/50">Restraints</p>
            <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{result.current.total_restraints}</p>
            <p className="text-xs font-semibold text-brand-neutral-black/70">{restraintsTrend.label}</p>
          </div>
          <div className="rounded-2xl border border-black/10 p-4 print:rounded-none">
            <p className="text-xs text-brand-neutral-black/50">In a behaviour support plan</p>
            <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{result.current.planned_restraints}</p>
          </div>
          <div className="rounded-2xl border border-black/10 p-4 print:rounded-none">
            <p className="text-xs text-brand-neutral-black/50">Not planned</p>
            <p className="font-heading text-2xl font-bold text-brand-prussian-blue">{result.current.unplanned_restraints}</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl border border-dashed border-black/15 p-4 text-xs text-brand-neutral-black/60 print-avoid-break">
          <p className="mb-1 font-bold uppercase tracking-wide text-brand-neutral-black/50">How these figures are counted</p>
          <p>
            &ldquo;Restraints&rdquo; is a count of incidents that included at least one physical restraint -- it is a
            breakdown of the total incidents above, using the same records, not a separate count.
            &ldquo;In a behaviour support plan&rdquo; and &ldquo;Not planned&rdquo; are, in turn, a breakdown of that
            restraint count: an incident is counted as &ldquo;Not planned&rdquo; if any restraint within it was
            recorded as outside the child&apos;s behaviour support plan. Draft incidents (not yet finalised) are
            excluded from every figure on this page.
          </p>
        </div>

        <section className="mb-8 print-avoid-break">
          <p className="mb-2 font-heading text-sm font-bold text-brand-prussian-blue">By child</p>
          {result.by_child.length === 0 ? (
            <p className="text-sm text-brand-neutral-black/60">No incidents in this period.</p>
          ) : (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b-2 border-brand-pastel-blue">
                  <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Child
                  </th>
                  <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Incidents
                  </th>
                  <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Restraints
                  </th>
                  <th className="py-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                    Not planned
                  </th>
                </tr>
              </thead>
              <tbody>
                {result.by_child.map((row) => (
                  <tr key={row.passport_id} className="border-b border-black/5 print-avoid-break">
                    <td className="py-2 pr-3 text-brand-neutral-black">{row.child_name}</td>
                    <td className="py-2 pr-3 text-brand-neutral-black">{row.incident_count}</td>
                    <td className="py-2 pr-3 text-brand-neutral-black">{row.restraint_count}</td>
                    <td className="py-2 text-brand-neutral-black">{row.unplanned_restraint_count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>

        <section className="mb-8 print-avoid-break">
          <p className="mb-1 font-heading text-sm font-bold text-brand-prussian-blue">By class</p>
          <p className="mb-2 text-xs text-brand-neutral-black/50">
            Grouped by class, not by teacher -- the room and everyone in it, not any one staff member&apos;s own record.
            Each class shows the class the child was actually in on the day of each incident, not their class today.
          </p>
          {result.by_class.length === 0 ? (
            <p className="text-sm text-brand-neutral-black/60">No incidents in this period.</p>
          ) : (
            <>
              <table className="w-full border-collapse text-left text-sm">
                <thead>
                  <tr className="border-b-2 border-brand-pastel-blue">
                    <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Class
                    </th>
                    <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Incidents
                    </th>
                    <th className="py-2 pr-3 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Restraints
                    </th>
                    <th className="py-2 font-accent text-xs font-bold uppercase tracking-wide text-brand-neutral-black/50">
                      Not planned
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {result.by_class.map((row) => (
                    <tr key={row.class_id ?? "unassigned"} className="border-b border-black/5 print-avoid-break">
                      <td className="py-2 pr-3 text-brand-neutral-black">{row.class_name}</td>
                      <td className="py-2 pr-3 text-brand-neutral-black">{row.incident_count}</td>
                      <td className="py-2 pr-3 text-brand-neutral-black">{row.restraint_count}</td>
                      <td className="py-2 text-brand-neutral-black">{row.unplanned_restraint_count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-brand-neutral-black/50">
                An incident involving children from more than one class is counted once for each class it touched, so
                these figures can add up to more than the total incidents above.
              </p>
            </>
          )}
        </section>

        <p className="no-print mt-8 text-xs text-brand-neutral-black/50">
          <Link href="/principal/term-overview" className="text-brand-prussian-blue">
            ‹ Back to Term Overview
          </Link>
        </p>
      </div>
    </div>
  );
}
