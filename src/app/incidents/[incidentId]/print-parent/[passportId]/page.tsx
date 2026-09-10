"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BrandMark } from "@/components/ui/BrandMark";
import { BodyMapPrintCard, type PrintableMark } from "@/components/incident-log/body-map/BodyMapPrintCard";
import type { BodyView, Side } from "@/components/incident-log/body-map/bodyMapRegions";

// The PARENT version of the incident export, per child -- one route,
// two entry points (a parent reaching their own child's record, or
// staff generating a copy for a family), one authorization each, both
// through the SAME extended get_parent_incidents() (migration 0183):
// owns_passport() for a parent, can_view_incident() for staff. Never a
// second definition of what a parent may see -- this renders exactly
// what that RPC returns, nothing derived or redacted again here.
//
// Deliberately a DIFFERENT route from the school export
// (teacher/incidents/[incidentId]/print), not a mode flag on it -- the
// two documents have almost entirely disjoint field sets and different
// authorities; keeping them structurally separate is what stops a field
// leaking from one into the other by accident.

const PLANNING_STATUS_LABEL: Record<string, string> = {
  in_bsp: "Part of their behaviour support plan",
  not_planned: "Not part of a planned approach",
};

interface ParentBodyMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  region_value: string;
  side: Side;
  injury_type_name: string;
  skin_broken: boolean | null;
}

interface ParentInjury {
  injury_types: string[] | null;
  injury_notes: string | null;
  first_aider_called: boolean | null;
  first_aider_name: string | null;
  doctor_ambulance_called: boolean | null;
  treatments: string[] | null;
  treatment_other: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  body_marks: ParentBodyMark[];
}

interface ParentRestrictivePractice {
  planning_status: string;
  ncse_report_complete: boolean | null;
}

interface ParentAmendment {
  reason: string;
  content: string;
  created_at: string;
}

interface ParentIncidentExport {
  incident_id: string;
  occurred_at: string;
  recorded_at: string;
  location: string;
  status: string;
  parent_summary: string | null;
  distress_level: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  recovery_methods: string[] | null;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  restraint_used: boolean;
  injuries: ParentInjury[];
  restrictive_practice: ParentRestrictivePractice[];
  amendments: ParentAmendment[];
}

const DISTRESS_LABEL: Record<string, string> = {
  yes_definitely: "Yes, definitely",
  slightly: "Slightly distressed",
  not_distressed: "Not distressed",
  hard_to_tell: "Hard to tell",
};

function formatDateTime(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

function yesNoOrNotRecorded(value: boolean | null): string {
  if (value === null) return "not recorded";
  return value ? "Yes" : "No";
}

export default function ParentIncidentPrintPage() {
  const params = useParams<{ incidentId: string; passportId: string }>();
  const router = useRouter();
  const incidentId = params.incidentId;
  const passportId = params.passportId;

  const [authChecked, setAuthChecked] = useState(false);
  const [childName, setChildName] = useState<string | null>(null);
  const [data, setData] = useState<ParentIncidentExport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [isStandalone, setIsStandalone] = useState(false);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      setAuthChecked(true);
    });
    return () => {
      isMounted = false;
    };
  }, [router]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsStandalone(window.matchMedia("(display-mode: standalone)").matches);
  }, []);

  useEffect(() => {
    if (!authChecked) return;
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    setLoadError(null);
    async function load() {
      const supabase = createClient();
      const [{ data: rows, error }, { data: passport }] = await Promise.all([
        supabase.rpc("get_parent_incidents", { p_passport_id: passportId, p_incident_id: incidentId }),
        // Best-effort child name for the document header -- the RPC
        // itself deliberately doesn't return it (the on-screen parent
        // view never needed to print it), so this is a small, separate
        // read, not a widening of what get_parent_incidents() returns.
        // Same RLS this route's own authority already satisfies
        // (has_child_access() covers the staff branch; a parent's own
        // owns_passport() covers theirs).
        supabase.from("passports").select("child_name").eq("id", passportId).maybeSingle(),
      ]);
      if (!isMounted) return;
      if (error) {
        setLoadError(error.message);
        setIsLoading(false);
        return;
      }
      const row = ((rows ?? []) as ParentIncidentExport[])[0] ?? null;
      if (!row) {
        setLoadError("Couldn't find this incident, or you don't have permission to view it.");
        setIsLoading(false);
        return;
      }
      setChildName(passport?.child_name ?? null);
      setData(row);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [authChecked, incidentId, passportId, reloadKey]);

  if (!authChecked || isLoading) {
    return (
      <div className="flex min-h-full flex-1 flex-col gap-4 bg-brand-off-white/40 p-6">
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-white" />
      </div>
    );
  }

  if (loadError || !data) {
    return (
      <div className="p-6">
        <InlineErrorState message={loadError ?? "Couldn't load this incident."} onRetry={() => setReloadKey((k) => k + 1)} />
      </div>
    );
  }

  const noRestraint = !data.restraint_used;

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
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export for parent</p>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-bold text-white shadow-sm"
        >
          Print / Save as PDF
        </button>
      </div>
      {isStandalone && (
        <p className="no-print px-4 pt-3 text-xs text-brand-neutral-black/60">
          On iPhone, tap Print, then use the Share icon on the preview to save this as a PDF to Files.
        </p>
      )}

      <div className="mx-auto max-w-2xl px-4 py-6 print:max-w-none print:px-0 print:py-0">
        <div className="mb-8 flex items-center gap-3 border-b-4 border-brand-prussian-blue pb-4 print-avoid-break">
          <BrandMark size={40} />
          <div>
            <p className="font-heading text-base font-bold text-brand-prussian-blue">The Behaviour Hive</p>
            <p className="text-xs text-brand-neutral-black/60">Incident Report</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl bg-brand-prussian-blue px-5 py-4 text-center print:rounded-none print-avoid-break">
          <p className="font-heading text-lg font-bold tracking-wide text-white">
            {childName ?? "Your Child"} — Incident Report
          </p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">Private and Confidential</p>
        </div>

        <div className="mb-8 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-black/10 p-4 text-sm print:rounded-none print-avoid-break">
          <p className="text-brand-neutral-black/50">Occurred</p>
          <p className="font-semibold text-brand-neutral-black">{formatDateTime(data.occurred_at)}</p>
          <p className="text-brand-neutral-black/50">Location</p>
          <p className="font-semibold text-brand-neutral-black">{data.location}</p>
        </div>

        <div className="flex flex-col gap-8 print:gap-6">
          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">What happened</h2>
            <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{data.parent_summary || "not recorded"}</p>
          </section>

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">
              {childName ?? "Your child"}
            </h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <p className="text-brand-neutral-black/50">Distress</p>
              <p className="text-brand-neutral-black">
                {data.distress_level ? DISTRESS_LABEL[data.distress_level] ?? data.distress_level : "not recorded"}
              </p>
              <p className="text-brand-neutral-black/50">Remained on site</p>
              <p className="text-brand-neutral-black">{yesNoOrNotRecorded(data.remained_on_site)}</p>
            </div>
            {data.remained_detail && <p className="mt-1.5 text-sm text-brand-neutral-black/70">{data.remained_detail}</p>}
            {data.recovery_methods && data.recovery_methods.length > 0 && (
              <p className="mt-1.5 text-sm text-brand-neutral-black">
                <span className="font-semibold">Recovery: </span>
                {data.recovery_methods.join(", ")}
              </p>
            )}
          </section>

          {/* Physical intervention -- deliberately says WHETHER, never
              the mechanics (hold type/position/level) or who performed
              it. A parent whose child was physically restrained must be
              told so in words; everything beyond that fact stays out. */}
          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Physical intervention</h2>
            {noRestraint ? (
              <p className="text-sm text-brand-neutral-black/70">No physical intervention was used.</p>
            ) : (
              <div className="flex flex-col gap-3">
                <p className="text-sm font-semibold text-brand-neutral-black">Physical intervention was used.</p>
                {data.restrictive_practice.map((rp, i) => (
                  <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                    <p className="text-brand-neutral-black">{PLANNING_STATUS_LABEL[rp.planning_status] ?? rp.planning_status}</p>
                    <p className="mt-1 text-brand-neutral-black/80">
                      NCSE report: {rp.ncse_report_complete === null ? "not recorded" : rp.ncse_report_complete ? "Complete" : "Not complete"}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.injuries.length > 0 && (
            <section>
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue print-avoid-break">Injuries</h2>
              <div className="flex flex-col gap-6">
                {data.injuries.map((inj, i) => {
                  const marks: PrintableMark[] = inj.body_marks.map((m) => ({
                    id: m.id,
                    view: m.view,
                    x: m.x,
                    y: m.y,
                    regionValue: m.region_value,
                    side: m.side,
                    injuryTypeName: m.injury_type_name,
                    skinBroken: m.skin_broken,
                  }));
                  return (
                    <div key={i} className="print-avoid-break">
                      <div className="rounded-xl border border-black/10 p-3 text-sm">
                        <p className="mt-1 text-brand-neutral-black/80">
                          {inj.injury_types && inj.injury_types.length > 0 ? inj.injury_types.join(", ") : "not recorded"}
                        </p>
                        {inj.injury_notes && <p className="mt-1 text-brand-neutral-black/70">{inj.injury_notes}</p>}
                        <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-brand-neutral-black/80">
                          <p>First aider called: {yesNoOrNotRecorded(inj.first_aider_called)}</p>
                          {inj.first_aider_name && <p>First aider: {inj.first_aider_name}</p>}
                          <p>Doctor/ambulance called: {yesNoOrNotRecorded(inj.doctor_ambulance_called)}</p>
                          <p>Remained on site: {yesNoOrNotRecorded(inj.remained_on_site)}</p>
                        </div>
                        {inj.treatments && inj.treatments.length > 0 && (
                          <p className="mt-1.5">
                            Treatment: {inj.treatments.join(", ")}
                            {inj.treatment_other ? ` — ${inj.treatment_other}` : ""}
                          </p>
                        )}
                        {inj.remained_detail && <p className="mt-1">{inj.remained_detail}</p>}
                      </div>
                      {marks.length > 0 && (
                        <div className="mt-3 flex justify-center">
                          <BodyMapPrintCard partyName={childName ?? "Your child"} marks={marks} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.amendments.length > 0 && (
            <section className="print-avoid-break">
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Amendments</h2>
              <div className="flex flex-col gap-3">
                {data.amendments.map((am, i) => (
                  <div key={i} className="rounded-xl border border-black/10 p-3 text-sm">
                    <p className="text-xs text-brand-neutral-black/50">{formatDateTime(am.created_at)}</p>
                    <p className="mt-1 font-semibold text-brand-neutral-black">{am.reason}</p>
                    <p className="mt-1 text-brand-neutral-black">{am.content}</p>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>

        <div className="mt-12 border-t border-black/10 pt-6 print-avoid-break">
          <p className="text-sm text-brand-neutral-black">
            {data.countersigned_at ? "This record is closed." : "This record is signed off, and awaiting countersign."}
          </p>
        </div>
      </div>
    </div>
  );
}
