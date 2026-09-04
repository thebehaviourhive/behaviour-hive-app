"use client";

import { useIncidents } from "@/hooks/useIncidents";
import { IncidentSummaryCard } from "@/components/clinician/incidents/IncidentSummaryCard";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// The Clinical File's own Incident Log tab -- the OTHER tab on this
// page, previously also labelled "Incidents", was the ABC log timeline
// and has since been relabelled "ABC Logs" to remove the collision
// (its key stays "incidents", unchanged -- see that tab list's own
// comment).
export function ClinicalFileIncidentsTab({ passportId }: { passportId: string }) {
  const { incidents, isLoading, loadError, refresh } = useIncidents(passportId);

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
