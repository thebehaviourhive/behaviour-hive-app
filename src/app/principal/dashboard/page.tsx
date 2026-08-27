"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";

// Minimal principal surface, per the brief: "a sign-off queue and
// access to incidents" -- nothing more. The full principal daily
// dashboard and to-do lists are a separate, later build; this page is
// deliberately not that. Read-only for now -- the actual countersign
// action is Phase 4's, not built here.
//
// Tone: clinical, matching the rest of this module (plain, precise,
// unemotional -- no encouragement/warmth copy, unlike the rest of the
// app's onboarding-adjacent screens).

interface InstitutionIncident {
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
}

// Four states (0089), not the original five -- awaiting_attestation and
// awaiting_debrief collapsed into one derived awaiting_signoff, since
// the two aren't actually sequential (a teacher can finish either in
// either order, and both can be outstanding at once) -- see that
// migration's own reasoning. A single label here can't say WHAT'S
// outstanding without inventing a false priority between them; that
// detail lives in incident_signoff_issues()/get_incident_signoff_summary()
// instead, for whoever's actually signing it off.
const STATUS_LABEL: Record<string, string> = {
  draft: "Draft",
  awaiting_signoff: "Awaiting sign-off",
  awaiting_principal: "Awaiting principal sign-off",
  finalised: "Finalised",
};

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
}

export default function PrincipalDashboardPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<InstitutionIncident[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(name)")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        setError("Could not find your institution.");
        setIsLoading(false);
        return;
      }

      const institutionRecord = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
      setInstitutionName(name ?? null);

      const { data: rows, error: rpcError } = await supabase.rpc("get_institution_incidents", {
        p_institution_id: staffRow.institution_id,
      });

      if (!isMounted) return;

      if (rpcError) {
        setError("Could not load incidents.");
        setIsLoading(false);
        return;
      }

      setIncidents((rows ?? []) as InstitutionIncident[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user]);

  if (!isReady) {
    return null;
  }

  const awaitingSignoff = incidents.filter((i) => i.teacher_signed_at && !i.countersigned_at);
  const rest = incidents.filter((i) => !(i.teacher_signed_at && !i.countersigned_at));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            Incident Log
          </h1>
          {institutionName && (
            <p className="mt-0.5 text-sm text-brand-neutral-black/60">{institutionName}</p>
          )}
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Link
            href="/principal/staff"
            className="flex h-10 items-center rounded-full border-2 border-brand-prussian-blue px-3 text-xs font-semibold text-brand-prussian-blue"
          >
            Staff
          </Link>
          <Link
            href="/principal/incidents"
            className="flex h-10 items-center rounded-full border-2 border-brand-prussian-blue px-3 text-xs font-semibold text-brand-prussian-blue"
          >
            Filter / Export
          </Link>
          <Link
            href="/teacher/incidents/new"
            aria-label="Record incident"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown text-white shadow-sm"
          >
            <AlertTriangleIcon className="h-5 w-5" />
          </Link>
        </div>
      </header>

      <main className="flex-1 px-4">
        <AttestationPromptCard className="mb-4" />
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : (
          <>
            <section className="mb-6">
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                Awaiting sign-off
              </h2>
              {awaitingSignoff.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No incidents awaiting your sign-off.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {awaitingSignoff.map((incident) => (
                    <IncidentRow key={incident.incident_id} incident={incident} needsSignoff />
                  ))}
                </div>
              )}
            </section>

            <section>
              <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                All incidents
              </h2>
              {rest.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
                  No other incidents recorded.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {rest.map((incident) => (
                    <IncidentRow key={incident.incident_id} incident={incident} needsSignoff={false} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function IncidentRow({ incident, needsSignoff }: { incident: InstitutionIncident; needsSignoff: boolean }) {
  const planningStatuses = incident.planning_status ?? [];
  const ncseIncomplete = (incident.ncse_report_complete ?? []).some((c) => c === false);

  return (
    <div
      className={`rounded-2xl border bg-white p-4 shadow-sm ${
        needsSignoff ? "border-brand-golden-brown" : "border-black/5"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-sm font-semibold text-brand-neutral-black">
            {formatDateTime(incident.occurred_at)}
          </p>
          <p className="text-xs text-brand-neutral-black/50">
            Recorded {formatDateTime(incident.recorded_at)}
          </p>
        </div>
        <span className="flex-shrink-0 rounded-full bg-brand-pastel-blue/20 px-2.5 py-1 text-xs font-semibold text-brand-prussian-blue">
          {STATUS_LABEL[incident.status] ?? incident.status}
        </span>
      </div>

      <p className="mt-2 text-sm text-brand-neutral-black/80">
        {incident.location} · {(incident.child_indices ?? []).length} child
        {(incident.child_indices ?? []).length === 1 ? "" : "ren"} named
        {incident.owning_teacher_name ? ` · ${incident.owning_teacher_name}` : ""}
      </p>

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

      {incident.debrief_required && (
        <p className="mt-1 text-xs text-brand-neutral-black/50">Debrief required</p>
      )}
    </div>
  );
}
