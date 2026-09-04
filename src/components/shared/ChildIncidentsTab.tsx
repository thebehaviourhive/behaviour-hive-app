"use client";

import { useIncidents } from "@/hooks/useIncidents";
import { IncidentSummaryCard } from "@/components/incident-log/IncidentSummaryCard";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// Passport Incidents tabs (migration 0166) -- the teacher/SNA track's
// own real incident log, shared between both since has_child_access()
// is itself already shared (has_class_teacher_access() OR
// has_sna_access()). Mirrors ClinicalFileIncidentsTab exactly --
// audience="staff" is the only difference passed down to useIncidents,
// which is what actually selects get_child_incidents_for_staff() over
// get_clinician_incidents(). No new access: has_child_access() already
// lets either role open any of these incidents directly today; this
// only gives a child's own passport page something to call for the
// list shape.
export function ChildIncidentsTab({ passportId }: { passportId: string }) {
  const { incidents, isLoading, loadError, refresh } = useIncidents(passportId, "staff");

  if (isLoading) {
    return (
      <div className="flex flex-col gap-2">
        <div className="h-24 animate-pulse rounded-2xl bg-brand-off-white" />
        <div className="h-24 animate-pulse rounded-2xl bg-brand-off-white" />
      </div>
    );
  }

  if (loadError) {
    return <InlineErrorState message={loadError} onRetry={() => refresh()} />;
  }

  if (incidents.length === 0) {
    return (
      <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
        <p className="text-sm text-brand-neutral-black/70">No incident log records for this child yet.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {incidents.map((incident) => (
        <IncidentSummaryCard key={incident.incidentId} incident={incident} />
      ))}
    </div>
  );
}
