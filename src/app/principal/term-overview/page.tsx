"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { TermOverviewMetricTile } from "@/components/principal/TermOverviewMetricTile";
import { computeTrend } from "@/lib/termOverviewFormatting";

// PRD 4, Stage 6 -- the observation surface, one level down from the
// work queue. Deliberately NOT in primary navigation (PrincipalSidebar/
// PrincipalBottomNav are untouched) -- reached only via "View Term
// Overview" on the Dashboard, per the brief: putting it in the nav
// would contradict "one level down from the queue by design".
//
// Date range defaults to NOTHING -- no pre-filled start/end. Agreed
// explicitly: a pre-filled default silently answers a question nobody
// asked, and this gets printed. get_institution_term_overview() itself
// refuses null dates, so this isn't just a client-side nicety -- the
// empty state is the only state until the principal actually picks a
// range.
//
// Grouping is by child and by class provision, never by staff -- see
// the RPC's own migration comment (0147) for why, and CLASS_VIEW_
// EXPLAINER below for how that's stated in the UI itself, not just
// assumed obvious from the absence of a staff column.

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

const CLASS_VIEW_EXPLAINER =
  "Grouped by class, not by teacher -- this shows where support needs are concentrated in the school's environment and provision. A class here is the room and every adult and child in it, not any one staff member's own record.";

export default function TermOverviewPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [institutionName, setInstitutionName] = useState<string | null>(null);

  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [result, setResult] = useState<TermOverviewResult | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedClassId, setExpandedClassId] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function loadInstitution() {
      const supabase = createClient();
      const { data } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(name)")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();
      if (!isMounted) return;
      setInstitutionId(data?.institution_id ?? null);
      const institutionRecord = data?.institutions as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
      setInstitutionName(name ?? null);
    }
    loadInstitution();
    return () => {
      isMounted = false;
    };
  }, [user]);

  useEffect(() => {
    let isMounted = true;
    async function run() {
      if (!institutionId || !start || !end) {
        setResult(null);
        return;
      }
      if (end < start) {
        setError("End date cannot be before the start date.");
        setResult(null);
        return;
      }
      setIsLoading(true);
      setError(null);
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_institution_term_overview", {
        p_institution_id: institutionId,
        p_start: start,
        p_end: end,
      });
      if (!isMounted) return;
      if (rpcError) {
        setError("Couldn't load the term summary.");
        setIsLoading(false);
        return;
      }
      setResult(data as TermOverviewResult);
      setIsLoading(false);
    }
    run();
    return () => {
      isMounted = false;
    };
  }, [institutionId, start, end]);

  if (!isReady) {
    return null;
  }

  const hasRange = Boolean(start && end) && end >= start;
  const printHref = `/principal/term-overview/print?${new URLSearchParams({ start, end }).toString()}`;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-4">
        <div>
          <button
            type="button"
            onClick={() => router.push("/principal/dashboard")}
            className="mb-1 font-sans text-eyebrow font-semibold text-brand-prussian-blue"
          >
            ‹ Dashboard
          </button>
          <h1 className="font-heading text-h1 font-bold text-brand-prussian-blue">Term Overview</h1>
          {institutionName && <p className="mt-0.5 font-sans text-body text-brand-neutral-black/60">{institutionName}</p>}
        </div>
        {hasRange && result && (
          <Link
            href={printHref}
            className="flex-shrink-0 rounded-full bg-brand-prussian-blue px-4 py-2.5 font-sans text-eyebrow font-bold uppercase tracking-wide text-white shadow-sm"
          >
            Export PDF
          </Link>
        )}
      </header>

      <main className="flex-1 px-4">
        <div className="mb-6 flex gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
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

        {!hasRange ? (
          error ? (
            <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-6 text-center font-sans text-body text-brand-neutral-black/60">
              {error}
            </p>
          ) : (
            <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-8 text-center">
              <p className="font-sans text-body text-brand-neutral-black/60">Choose a date range to see this term&apos;s summary.</p>
            </div>
          )
        ) : isLoading ? (
          <div className="flex flex-col gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex animate-pulse items-center gap-4 rounded-2xl border border-black/5 bg-white p-4">
                <div className="h-5 w-[120px] flex-shrink-0 rounded bg-black/10" />
                <div className="h-4 flex-1 rounded bg-black/5" />
              </div>
            ))}
          </div>
        ) : error ? (
          <InlineErrorState message={error} onRetry={() => setStart((s) => s)} />
        ) : (
          result && (
            <>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                <TermOverviewMetricTile
                  label="Total incidents"
                  value={result.current.total_incidents}
                  trend={computeTrend(result.current.total_incidents, result.prior.total_incidents)}
                />
                <TermOverviewMetricTile
                  label="Restraints"
                  value={result.current.total_restraints}
                  trend={computeTrend(result.current.total_restraints, result.prior.total_restraints)}
                />
                <TermOverviewMetricTile
                  label="In a behaviour support plan"
                  value={result.current.planned_restraints}
                  caption="Of the restraints above"
                />
                <TermOverviewMetricTile
                  label="Not planned"
                  value={result.current.unplanned_restraints}
                  caption="Any restraint with at least one hold outside the plan"
                />
              </div>

              <section className="mt-8">
                <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  By child
                </h2>
                {result.by_child.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                    No incidents in this range.
                  </p>
                ) : (
                  <>
                    <div className="hidden overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm lg:block">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b-2 border-brand-pastel-blue">
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Child
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Incidents
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Restraints
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Not planned
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.by_child.map((row) => (
                            <tr key={row.passport_id} className="border-b border-black/5 last:border-0">
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.child_name}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.incident_count}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.restraint_count}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">
                                {row.unplanned_restraint_count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>

                    <div className="flex flex-col gap-2 lg:hidden">
                      {result.by_child.map((row) => (
                        <div key={row.passport_id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                          <p className="font-sans text-body font-semibold text-brand-neutral-black">{row.child_name}</p>
                          <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/60">
                            {row.incident_count} incident{row.incident_count === 1 ? "" : "s"} · {row.restraint_count}{" "}
                            restraint{row.restraint_count === 1 ? "" : "s"}
                            {row.unplanned_restraint_count > 0 ? ` · ${row.unplanned_restraint_count} not planned` : ""}
                          </p>
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </section>

              <section className="mt-8">
                <h2 className="mb-1 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                  By class
                </h2>
                <p className="mb-2 font-sans text-eyebrow text-brand-neutral-black/50">{CLASS_VIEW_EXPLAINER}</p>
                {result.by_class.length === 0 ? (
                  <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
                    No incidents in this range.
                  </p>
                ) : (
                  <>
                    <div className="hidden overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm lg:block">
                      <table className="w-full border-collapse text-left">
                        <thead>
                          <tr className="border-b-2 border-brand-pastel-blue">
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Class
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Incidents
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Restraints
                            </th>
                            <th className="px-4 py-2.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                              Not planned
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {result.by_class.map((row) => (
                            <tr key={row.class_id ?? "unassigned"} className="border-b border-black/5 last:border-0">
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.class_name}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.incident_count}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">{row.restraint_count}</td>
                              <td className="px-4 py-2.5 font-sans text-body text-brand-neutral-black">
                                {row.unplanned_restraint_count}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      <p className="border-t border-black/5 px-4 py-2.5 font-sans text-eyebrow text-brand-neutral-black/40">
                        A single incident involving children from more than one class is counted once for each class it
                        touched, so these figures can add up to more than the total incidents above.
                      </p>
                    </div>

                    {/* Mobile: accordion, per the brief -- a table's four
                        columns don't fit at 375px the way IncidentCard's
                        own stacked layout handles the incidents list.
                        Collapsed shows the headline number; expanding
                        reveals the same restraint/not-planned breakdown
                        the desktop table shows plainly. */}
                    <div className="flex flex-col gap-2 lg:hidden">
                      {result.by_class.map((row) => {
                        const key = row.class_id ?? "unassigned";
                        const isExpanded = expandedClassId === key;
                        return (
                          <div key={key} className="overflow-hidden rounded-2xl border border-black/5 bg-white shadow-sm">
                            <button
                              type="button"
                              onClick={() => setExpandedClassId((v) => (v === key ? null : key))}
                              aria-expanded={isExpanded}
                              className="flex w-full items-center justify-between p-4 text-left"
                            >
                              <span className="font-sans text-body font-semibold text-brand-neutral-black">
                                {row.class_name}
                              </span>
                              <span className="flex items-center gap-2 font-sans text-eyebrow text-brand-neutral-black/60">
                                {row.incident_count} incident{row.incident_count === 1 ? "" : "s"}
                                <span className={`transition-transform ${isExpanded ? "rotate-180" : ""}`}>⌄</span>
                              </span>
                            </button>
                            {isExpanded && (
                              <div className="border-t border-black/5 px-4 py-3 font-sans text-body text-brand-neutral-black/70">
                                <p>
                                  {row.restraint_count} restraint{row.restraint_count === 1 ? "" : "s"}, of which{" "}
                                  {row.unplanned_restraint_count} not planned
                                </p>
                              </div>
                            )}
                          </div>
                        );
                      })}
                      <p className="px-1 font-sans text-eyebrow text-brand-neutral-black/40">
                        A single incident involving children from more than one class is counted once for each class it
                        touched, so these figures can add up to more than the total incidents above.
                      </p>
                    </div>
                  </>
                )}
              </section>
            </>
          )
        )}
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
