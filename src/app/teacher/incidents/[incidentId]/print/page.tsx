"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { InlineErrorState } from "@/components/ui/InlineErrorState";
import { BrandMark } from "@/components/ui/BrandMark";
import { BodyMapPrintCard, type PrintableMark } from "@/components/incident-log/body-map/BodyMapPrintCard";
import type { BodyView, Side } from "@/components/incident-log/body-map/bodyMapRegions";

// Phase 6, Part F. Same pattern as the FBA's own print page: route-
// independent on role (get_incident_export()'s own can_view_incident()
// gate is what actually decides who sees what -- this page just renders
// whatever comes back), window.print() output, no server-side PDF step.
// Layout is ours; content is theirs -- every fallback line below
// ("not recorded", "No CPI recorded during incident") reflects a real,
// distinct fact this RPC returned, never invented here.

const CATEGORY_LABEL: Record<string, string> = {
  behaviour_leading_to_injury: "Behaviour leading to injury",
  imminent_risk_of_injury: "Imminent risk of injury",
  one_party_incident: "One-party incident",
};

const DISTRESS_LABEL: Record<string, string> = {
  yes_definitely: "Yes, definitely",
  slightly: "Slightly distressed",
  not_distressed: "Not distressed",
  hard_to_tell: "Hard to tell",
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_signoff: "Awaiting sign-off",
  awaiting_principal: "Awaiting principal sign-off",
  finalised: "Finalised",
};

const PLANNING_STATUS_LABEL: Record<string, string> = {
  in_bsp: "In BSP",
  not_planned: "Not planned",
};

const HOLD_TYPE_LABEL: Record<string, string> = {
  childrens: "Children's",
  young_person: "Young person's",
};

const HOLD_POSITION_LABEL: Record<string, string> = {
  seated: "Seated",
  standing: "Standing",
};

const HOLD_LEVEL_LABEL: Record<string, string> = {
  low: "Low",
  med: "Medium",
  high: "High",
};

interface ExportChild {
  child_index: string;
  passport_id: string;
  child_name: string | null;
  distress_level: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  recovery_methods: string[] | null;
}

interface ExportStaffAttestation {
  incident_staff_id: string;
  name: string;
  involvement: string | null;
  has_account: boolean;
  status: string;
  status_label: string;
  addendum: string | null;
  attested_at: string | null;
  withdrawal_reason: string | null;
  withdrawn_at: string | null;
}

interface ExportAction {
  value: string;
  is_restraint: boolean;
  other_detail: string | null;
}

interface ExportRestrictivePractice {
  id: string;
  passport_id: string;
  planning_status: string;
  reason_codes: string[] | null;
  disengagement_codes: string[] | null;
  hold_type: string | null;
  hold_position: string | null;
  hold_level: string | null;
  result_codes: string[] | null;
  total_procedures: number | null;
  staff_initials: string | null;
  ncse_report_complete: boolean | null;
}

interface ExportBodyMark {
  id: string;
  view: BodyView;
  x: number;
  y: number;
  region_value: string;
  side: Side;
  injury_type_name: string;
  skin_broken: boolean | null;
  other_detail: string | null;
}

interface ExportInjury {
  id: string;
  injured_party_type: string;
  passport_id: string | null;
  party_name: string;
  injury_types: string[] | null;
  injury_notes: string | null;
  first_aider_called: boolean | null;
  first_aider_name: string | null;
  doctor_ambulance_called: boolean | null;
  treatments: string[] | null;
  treatment_other: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  body_marks: ExportBodyMark[];
}

interface ExportDebrief {
  debrief_date: string;
  staff_present: string[] | null;
  notes: string | null;
  actions_for_management: string | null;
  completed_by_name: string | null;
  completed_at: string | null;
}

interface ExportAmendment {
  id: string;
  reason: string;
  content: string;
  author_name: string | null;
  created_at: string;
}

interface IncidentExport {
  incident_id: string;
  occurred_at: string;
  recorded_at: string;
  location: string;
  status: string;
  category: string | null;
  party: string[] | null;
  party_other: string | null;
  item_involved: string | null;
  narrative: string | null;
  parent_summary: string | null;
  staff_count_needed: string | null;
  staff_distressed: string | null;
  risk_reduction_future: string | null;
  other_information: string | null;
  anyone_injured: boolean | null;
  debrief_required: boolean;
  teacher_signed_at: string | null;
  teacher_signed_by_name: string | null;
  countersigned_at: string | null;
  countersigned_by_name: string | null;
  countersigned_role_at_time: string | null;
  countersigned_via: string | null;
  children: ExportChild[];
  staff_attestations: ExportStaffAttestation[];
  actions: ExportAction[];
  has_cpi_action: boolean;
  restrictive_practices: ExportRestrictivePractice[];
  injuries: ExportInjury[];
  debrief: ExportDebrief | null;
  amendments: ExportAmendment[];
}

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

function formatDate(value: string | null): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

// Explicitly distinct from "No" -- a Yes/No question that was never
// answered is a different fact than one answered No, per this module's
// own three-way-field discipline (migration 0081).
function yesNoOrNotRecorded(value: boolean | null): string {
  if (value === null) return "not recorded";
  return value ? "Yes" : "No";
}

function viaLabel(via: string | null): string {
  if (via === "grant") return "via a countersign grant";
  return "";
}

export default function IncidentPrintPage() {
  const params = useParams();
  const router = useRouter();
  const incidentId = params.incidentId as string;

  const [authChecked, setAuthChecked] = useState(false);
  const [data, setData] = useState<IncidentExport | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
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
    async function load() {
      const supabase = createClient();
      const { data: result, error } = await supabase.rpc("get_incident_export", { p_incident_id: incidentId });
      if (!isMounted) return;
      if (error) {
        setLoadError(error.message);
        setIsLoading(false);
        return;
      }
      setData(result as IncidentExport);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [authChecked, incidentId]);

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
        <InlineErrorState message={loadError ?? "Couldn't load this incident."} onRetry={() => window.location.reload()} />
      </div>
    );
  }

  const noCpiRecorded = !data.has_cpi_action && data.restrictive_practices.length === 0;

  return (
    <div className="min-h-full bg-brand-off-white/40 pb-16 print:bg-white print:pb-0">
      <div className="no-print sticky top-0 z-20 flex items-center gap-3 border-b border-black/5 bg-brand-off-white/95 px-4 py-4 backdrop-blur-sm">
        <Link
          href={`/teacher/incidents/${incidentId}`}
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <p className="flex-1 font-heading text-lg font-bold text-brand-prussian-blue">Export incident report</p>
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
            <p className="text-xs text-brand-neutral-black/60">School Incident Report</p>
          </div>
        </div>

        <div className="mb-8 rounded-2xl bg-brand-prussian-blue px-5 py-4 text-center print:rounded-none print-avoid-break">
          <p className="font-heading text-lg font-bold tracking-wide text-white">SCHOOL INCIDENT REPORT</p>
          <p className="mt-1 text-xs font-bold uppercase tracking-widest text-white/80">Private and Confidential</p>
        </div>

        {/* Both timestamps, never collapsed. */}
        <div className="mb-8 grid grid-cols-2 gap-x-4 gap-y-2 rounded-2xl border border-black/10 p-4 text-sm print:rounded-none print-avoid-break">
          <p className="text-brand-neutral-black/50">Occurred</p>
          <p className="font-semibold text-brand-neutral-black">{formatDateTime(data.occurred_at)}</p>
          <p className="text-brand-neutral-black/50">Recorded</p>
          <p className="font-semibold text-brand-neutral-black">{formatDateTime(data.recorded_at)}</p>
          <p className="text-brand-neutral-black/50">Location</p>
          <p className="font-semibold text-brand-neutral-black">{data.location}</p>
          <p className="text-brand-neutral-black/50">Category</p>
          <p className="font-semibold text-brand-neutral-black">
            {data.category ? CATEGORY_LABEL[data.category] ?? data.category : "not recorded"}
          </p>
          <p className="text-brand-neutral-black/50">Status</p>
          <p className="font-semibold text-brand-neutral-black">{STATUS_LABEL[data.status] ?? data.status}</p>
        </div>

        <div className="flex flex-col gap-8 print:gap-6">
          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Party involved</h2>
            <p className="text-sm text-brand-neutral-black">
              {data.party && data.party.length > 0
                ? data.party.map((p) => (p === "other" ? data.party_other || "Other" : p)).join(", ")
                : "not recorded"}
            </p>
            {data.item_involved && <p className="mt-1 text-sm text-brand-neutral-black/70">Item involved: {data.item_involved}</p>}
          </section>

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">What happened</h2>
            <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{data.narrative || "not recorded"}</p>
          </section>

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Parent summary</h2>
            <p className="whitespace-pre-wrap text-sm text-brand-neutral-black">{data.parent_summary || "not recorded"}</p>
          </section>

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Staff response</h2>
            <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
              <p className="text-brand-neutral-black/50">Staff needed</p>
              <p className="text-brand-neutral-black">{data.staff_count_needed || "not recorded"}</p>
              <p className="text-brand-neutral-black/50">Staff found it distressing</p>
              <p className="text-brand-neutral-black">
                {data.staff_distressed
                  ? data.staff_distressed === "yes"
                    ? "Yes"
                    : data.staff_distressed === "slightly"
                      ? "Slightly distressing"
                      : "No"
                  : "not recorded"}
              </p>
              <p className="text-brand-neutral-black/50">Anyone injured</p>
              <p className="text-brand-neutral-black">{yesNoOrNotRecorded(data.anyone_injured)}</p>
            </div>
            {data.risk_reduction_future && (
              <p className="mt-3 text-sm text-brand-neutral-black">
                <span className="font-semibold">Reducing risk in future: </span>
                {data.risk_reduction_future}
              </p>
            )}
            {data.other_information && (
              <p className="mt-2 text-sm text-brand-neutral-black">
                <span className="font-semibold">Other information: </span>
                {data.other_information}
              </p>
            )}
            {data.actions.length > 0 && (
              <div className="mt-3">
                <p className="mb-1 text-sm font-semibold text-brand-neutral-black">Actions taken</p>
                <ul className="list-disc pl-5 text-sm text-brand-neutral-black">
                  {data.actions.map((a, i) => (
                    <li key={i}>
                      {a.value}
                      {a.other_detail ? ` — ${a.other_detail}` : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>

          {data.children.map((child) => (
            <section key={child.child_index} className="print-avoid-break">
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">
                {child.child_name ?? `Child ${child.child_index}`}
              </h2>
              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
                <p className="text-brand-neutral-black/50">Distress</p>
                <p className="text-brand-neutral-black">
                  {child.distress_level ? DISTRESS_LABEL[child.distress_level] ?? child.distress_level : "not recorded"}
                </p>
                <p className="text-brand-neutral-black/50">Remained on site</p>
                <p className="text-brand-neutral-black">{yesNoOrNotRecorded(child.remained_on_site)}</p>
              </div>
              {child.remained_detail && <p className="mt-1.5 text-sm text-brand-neutral-black/70">{child.remained_detail}</p>}
              {child.recovery_methods && child.recovery_methods.length > 0 && (
                <p className="mt-1.5 text-sm text-brand-neutral-black">
                  <span className="font-semibold">Recovery: </span>
                  {child.recovery_methods.join(", ")}
                </p>
              )}
            </section>
          ))}

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Staff attestations</h2>
            {data.staff_attestations.length === 0 ? (
              <p className="text-sm text-brand-neutral-black/60">No staff named on this incident.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.staff_attestations.map((s) => (
                  <div key={s.incident_staff_id} className="rounded-xl border border-black/10 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-semibold text-brand-neutral-black">
                        {s.name}
                        {s.involvement && <span className="font-normal text-brand-neutral-black/50"> · {s.involvement}</span>}
                      </p>
                      <p className="flex-shrink-0 text-xs font-semibold text-brand-neutral-black/60">{s.status_label}</p>
                    </div>
                    {s.attested_at && (
                      <p className="mt-1 text-xs text-brand-neutral-black/70">
                        Attested {formatDateTime(s.attested_at)}
                        {s.addendum && <span className="italic"> — &quot;{s.addendum}&quot;</span>}
                      </p>
                    )}
                    {s.withdrawn_at && (
                      <p className="mt-1 text-xs text-brand-neutral-black/70">
                        Withdrew {formatDateTime(s.withdrawn_at)}
                        {s.withdrawal_reason && <span className="italic"> — &quot;{s.withdrawal_reason}&quot;</span>}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="print-avoid-break">
            <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Restrictive practice</h2>
            {noCpiRecorded ? (
              <p className="text-sm text-brand-neutral-black/70">No CPI recorded during incident.</p>
            ) : (
              <div className="flex flex-col gap-3">
                {data.restrictive_practices.map((rp) => (
                  <div key={rp.id} className="rounded-xl border border-black/10 p-3 text-sm">
                    <p className="font-semibold text-brand-neutral-black">
                      {PLANNING_STATUS_LABEL[rp.planning_status] ?? rp.planning_status}
                    </p>
                    <div className="mt-1.5 grid grid-cols-2 gap-x-4 gap-y-1 text-brand-neutral-black/80">
                      {rp.hold_type && <p>Hold type: {HOLD_TYPE_LABEL[rp.hold_type] ?? rp.hold_type}</p>}
                      {rp.hold_position && <p>Position: {HOLD_POSITION_LABEL[rp.hold_position] ?? rp.hold_position}</p>}
                      {rp.hold_level && <p>Level: {HOLD_LEVEL_LABEL[rp.hold_level] ?? rp.hold_level}</p>}
                      {rp.total_procedures != null && <p>Procedures: {rp.total_procedures}</p>}
                      {rp.staff_initials && <p>Staff: {rp.staff_initials}</p>}
                      <p>NCSE report: {rp.ncse_report_complete === null ? "not recorded" : rp.ncse_report_complete ? "Complete" : "Not complete"}</p>
                    </div>
                    {rp.reason_codes && rp.reason_codes.length > 0 && <p className="mt-1.5">Reasons: {rp.reason_codes.join(", ")}</p>}
                    {rp.disengagement_codes && rp.disengagement_codes.length > 0 && (
                      <p className="mt-1">Disengagement: {rp.disengagement_codes.join(", ")}</p>
                    )}
                    {rp.result_codes && rp.result_codes.length > 0 && <p className="mt-1">Result: {rp.result_codes.join(", ")}</p>}
                  </div>
                ))}
              </div>
            )}
          </section>

          {data.injuries.length > 0 && (
            <section>
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue print-avoid-break">Injuries</h2>
              <div className="flex flex-col gap-6">
                {data.injuries.map((inj) => {
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
                    <div key={inj.id} className="print-avoid-break">
                      <div className="rounded-xl border border-black/10 p-3 text-sm">
                        <p className="font-semibold text-brand-neutral-black">{inj.party_name}</p>
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
                          <BodyMapPrintCard partyName={inj.party_name} marks={marks} />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          )}

          {data.debrief && (
            <section className="print-avoid-break">
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Debrief</h2>
              <p className="text-sm text-brand-neutral-black/50">{formatDate(data.debrief.debrief_date)}</p>
              {data.debrief.staff_present && data.debrief.staff_present.length > 0 && (
                <p className="mt-1 text-sm text-brand-neutral-black">Staff present: {data.debrief.staff_present.join(", ")}</p>
              )}
              {data.debrief.notes && <p className="mt-2 whitespace-pre-wrap text-sm text-brand-neutral-black">{data.debrief.notes}</p>}
              {data.debrief.actions_for_management && (
                <p className="mt-2 text-sm text-brand-neutral-black">
                  <span className="font-semibold">Actions for management: </span>
                  {data.debrief.actions_for_management}
                </p>
              )}
              <p className="mt-2 text-xs text-brand-neutral-black/50">
                Completed by {data.debrief.completed_by_name ?? "—"} · {formatDateTime(data.debrief.completed_at)}
              </p>
            </section>
          )}

          {data.amendments.length > 0 && (
            <section className="print-avoid-break">
              <h2 className="mb-2 font-heading text-base font-bold text-brand-prussian-blue">Amendments</h2>
              <div className="flex flex-col gap-3">
                {data.amendments.map((am) => (
                  <div key={am.id} className="rounded-xl border border-black/10 p-3 text-sm">
                    <p className="text-xs text-brand-neutral-black/50">
                      {am.author_name ?? "—"} · {formatDateTime(am.created_at)}
                    </p>
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
            Signed off by <span className="font-semibold">{data.teacher_signed_by_name ?? "—"}</span> on{" "}
            {formatDateTime(data.teacher_signed_at)}.
          </p>
          <p className="mt-1 text-sm text-brand-neutral-black">
            {data.countersigned_at ? (
              <>
                Countersigned by <span className="font-semibold">{data.countersigned_by_name ?? "—"}</span>
                {data.countersigned_role_at_time && ` (${data.countersigned_role_at_time}`}
                {viaLabel(data.countersigned_via) && `, ${viaLabel(data.countersigned_via)}`}
                {data.countersigned_role_at_time && ")"} on {formatDateTime(data.countersigned_at)}.
              </>
            ) : (
              "Not yet countersigned."
            )}
          </p>
        </div>
      </div>
    </div>
  );
}
