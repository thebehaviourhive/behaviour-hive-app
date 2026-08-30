import Link from "next/link";

// PRD 2, Stage 1. The merge: /principal/dashboard and /principal/incidents
// each rendered their own copy of this row, independently, since the day
// each was built. Union of both, not either as-is -- Daniel's own
// instruction after reviewing the diff, plus two explicit bug fixes he
// named rather than variations to preserve:
//
// 1. NCSE-outstanding pill: /principal/incidents fetched
//    ncse_report_complete and never rendered it -- a dropped field, not a
//    design choice. Restored here (present in both contexts now).
// 2. Clickability: the dashboard's own rows were plain, unlinked divs --
//    a principal seeing an incident that needs them with no way to open
//    it. Every row is a real link now, both contexts.
//
// NOT unioned, deliberately removed rather than propagated: the
// dashboard's old "Debrief required" line. get_institution_incidents()
// (migration 0107, read live) only ever returns debrief_required, a
// static flag set once at creation and NEVER updated on completion --
// there is no debrief_completed_at (or equivalent) on this RPC's return
// shape at all, even though incident_debriefs.completed_at is exactly
// that signal (0077's own sign-off gate proves it: "completed" means
// that column is set, not just a row existing). Concretely: any incident
// where debrief_required is true AND teacher_signed_at is set is
// GUARANTEED to have a completed debrief (0077's trigger enforces this
// before sign-off can happen at all) -- so the old pill was provably
// showing false information on every signed-off incident it appeared on,
// not just potentially stale. Suppressed here until the RPC is widened
// with a real completion signal (Stage 7's own new SQL) -- showing
// nothing is honest; showing a sometimes-false "required" pill on an
// already-completed debrief is not. Do not re-add this pill from either
// page's old code without the RPC change alongside it.

export interface InstitutionIncidentRow {
  incident_id: string;
  occurred_at: string;
  recorded_at: string;
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

export const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_signoff: "Awaiting sign-off",
  awaiting_principal: "Awaiting principal sign-off",
  finalised: "Finalised",
};

export function formatIncidentDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function formatIncidentDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    formatIncidentDate(value) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

export function IncidentCard({
  incident,
  needsSignoff = false,
}: {
  incident: InstitutionIncidentRow;
  needsSignoff?: boolean;
}) {
  const planningStatuses = incident.planning_status ?? [];
  const ncseIncomplete = (incident.ncse_report_complete ?? []).some((c) => c === false);
  const childCount = (incident.child_indices ?? []).length;

  return (
    <div
      className={`rounded-2xl border bg-white shadow-sm ${
        needsSignoff ? "border-brand-golden-brown" : "border-black/5"
      }`}
    >
      <Link href={`/teacher/incidents/${incident.incident_id}`} className="block p-4">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-brand-neutral-black">
              {formatIncidentDateTime(incident.occurred_at)}
            </p>
            <p className="text-xs text-brand-neutral-black/50">
              Recorded {formatIncidentDateTime(incident.recorded_at)}
            </p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
            {STATUS_LABEL[incident.status] ?? incident.status}
          </span>
        </div>

        <p className="mt-2 text-sm text-brand-neutral-black/80">
          {incident.location} · {childCount} child{childCount === 1 ? "" : "ren"} named
          {incident.owning_teacher_name ? ` · ${incident.owning_teacher_name}` : ""}
        </p>

        {/* PRD 1, Stage 3: "visibly inherited, with who created it and
            when it transferred -- not silently theirs". The fuller,
            three-clause version (dashboard's own) wins the union --
            /principal/incidents' old version dropped the "originally
            recorded by" clause. */}
        {incident.is_inherited && (
          <p className="mt-1.5 rounded-xl bg-brand-golden-brown/10 px-2.5 py-1.5 text-xs text-brand-golden-brown">
            Inherited from {incident.inherited_from_name ?? "a departed supply teacher"}
            {incident.inherited_transferred_at
              ? ` · transferred ${formatIncidentDateTime(incident.inherited_transferred_at)}`
              : ""}
            {incident.created_by_name ? ` · originally recorded by ${incident.created_by_name}` : ""}
          </p>
        )}

        {incident.has_restrictive_practice && (
          <div className="mt-2 flex flex-wrap gap-1.5 text-xs">
            {planningStatuses.map((status, idx) => (
              <span
                key={idx}
                className="rounded-full bg-brand-golden-brown/10 px-2 py-0.5 font-semibold text-brand-golden-brown"
              >
                {status === "in_bsp" ? "In BSP" : "Not planned"}
              </span>
            ))}
            {ncseIncomplete && (
              <span className="rounded-full bg-brand-golden-brown/10 px-2 py-0.5 font-semibold text-brand-golden-brown">
                NCSE report outstanding
              </span>
            )}
          </div>
        )}
      </Link>

      {/* Direct route to the document, not just the form -- a principal
          working from this list wants the PDF. Signed records only, same
          gate the export page and the detail page's own export link both
          use. Was /principal/incidents-only; unioned in, since a
          principal reading the dashboard's own queue wants this exactly
          as much. */}
      {incident.teacher_signed_at && (
        <Link
          href={`/teacher/incidents/${incident.incident_id}/print`}
          className="block border-t border-black/5 px-4 py-2.5 text-center text-xs font-semibold text-brand-prussian-blue"
        >
          Export PDF
        </Link>
      )}
    </div>
  );
}
