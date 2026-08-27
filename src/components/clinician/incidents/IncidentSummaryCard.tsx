"use client";

import type { IncidentSummary } from "@/hooks/useIncidents";

// Read-only by construction, same posture as AbcIncidentCard -- a
// clinician's view of the School Incident Log never edits it. Shows the
// clinical content get_clinician_incidents() carries (narrative
// included); status/sign-off shown as plain fact, not an action --
// there's nothing for a clinician to do here.

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

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

export function IncidentSummaryCard({ incident }: { incident: IncidentSummary }) {
  const hasInjury = incident.injuries.length > 0;
  const hasRestrictivePractice = incident.restrictivePractice.length > 0;

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-brand-neutral-black">{formatDateTime(incident.occurredAt)}</p>
        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
          {STATUS_LABEL[incident.status] ?? incident.status}
        </span>
      </div>
      <p className="mt-0.5 text-xs text-brand-neutral-black/50">{incident.location}</p>

      {incident.narrative && <p className="mt-2 text-sm text-brand-neutral-black">{incident.narrative}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
        {incident.distressLevel && (
          <span className="rounded-full bg-black/5 px-2.5 py-1 font-medium text-brand-neutral-black/70">
            Distress: {DISTRESS_LABEL[incident.distressLevel] ?? incident.distressLevel}
          </span>
        )}
        {hasInjury && (
          <span className="rounded-full bg-brand-golden-brown/10 px-2.5 py-1 font-semibold text-brand-golden-brown">
            Injury recorded
          </span>
        )}
        {hasRestrictivePractice && (
          <span className="rounded-full bg-brand-golden-brown/10 px-2.5 py-1 font-semibold text-brand-golden-brown">
            Restrictive practice used
          </span>
        )}
        {incident.actions.length > 0 && (
          <span className="rounded-full bg-black/5 px-2.5 py-1 font-medium text-brand-neutral-black/70">
            {incident.actions.length} action{incident.actions.length === 1 ? "" : "s"} taken
          </span>
        )}
      </div>
    </div>
  );
}
