"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// The full incident a parent is entitled to see -- the destination
// IncidentNoticeCard's own cards, and this same track's persistent
// incidents list, now link to instead of being dead ends.
//
// USE WHAT THEY ALREADY HAVE, DO NOT WIDEN IT: straight through
// get_parent_incidents(p_passport_id) -- the exact RPC both those
// surfaces already call, no new RPC, no new column, no change to its
// own gate (owns_passport() + teacher_signed_at is not null, unchanged).
// That RPC already returns far more than either surface has ever
// rendered -- distress_level, remained_on_site/detail, recovery_methods,
// injuries, restrictive_practice, the parent_notified_at/called_at
// facts -- all authorised for this audience already, just never shown.
// This page renders what was already being sent, not anything new.
//
// No per-incident RPC param exists (get_parent_incidents takes only
// p_passport_id, returning every incident for that child) -- filtered
// client-side to the one incident_id in the URL, same posture as
// fetching the full list elsewhere on this track.

const DISTRESS_LABEL: Record<string, string> = {
  yes_definitely: "Yes, definitely",
  slightly: "Slightly distressed",
  not_distressed: "Not distressed",
  hard_to_tell: "Hard to tell",
};

const PLANNING_STATUS_LABEL: Record<string, string> = {
  in_bsp: "Part of their behaviour support plan",
  not_planned: "Not part of a planned approach",
};

interface InjuryRow {
  injury_types: string[] | null;
  injury_notes: string | null;
  first_aider_called: boolean | null;
  first_aider_name: string | null;
  doctor_ambulance_called: boolean | null;
  treatments: string[] | null;
  treatment_other: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
}

interface RestrictivePracticeRow {
  planning_status: string | null;
}

interface ParentIncidentDetail {
  incident_id: string;
  // Migration 0152 -- needed to call acknowledge_incident().
  incident_children_id: string;
  occurred_at: string;
  recorded_at: string;
  location: string;
  status: string;
  parent_summary: string | null;
  distress_level: string | null;
  remained_on_site: boolean | null;
  remained_detail: string | null;
  recovery_methods: string[] | null;
  parent_call_required: boolean | null;
  parent_called_at: string | null;
  parent_notified_at: string | null;
  parent_acknowledged_at: string | null;
  teacher_signed_at: string | null;
  countersigned_at: string | null;
  injuries: InjuryRow[];
  restrictive_practice: RestrictivePracticeRow[];
}

function formatDateTime(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return (
    d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) +
    " · " +
    d.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" })
  );
}

export default function ParentIncidentDetailPage() {
  const { user, isReady } = useRequireRole("parent");
  const params = useParams<{ incidentId: string }>();
  const incidentId = params.incidentId;
  const { passportId, isLoading: isLoadingPassport, error: passportLoadFailed, refresh: refreshPassport } = useMyPassport(user?.id);

  const [incident, setIncident] = useState<ParentIncidentDetail | null>(null);
  const [isLoadingIncident, setIsLoadingIncident] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isAcknowledging, setIsAcknowledging] = useState(false);
  const [acknowledgeError, setAcknowledgeError] = useState<string | null>(null);
  // Background pass, "the ~17 window.location.reload() sites" -- a
  // reloadKey re-runs this same load effect in place instead of a hard
  // browser reload, matching the incident page's own fix.
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (isLoadingPassport) return;
    if (!passportId) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setIsLoadingIncident(false);
      return;
    }
    let isMounted = true;
    setIsLoadingIncident(true);
    setLoadError(null);

    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_parent_incidents", { p_passport_id: passportId });
      if (!isMounted) return;

      if (error) {
        setLoadError("Couldn't load this incident.");
        setIsLoadingIncident(false);
        return;
      }

      const match = ((data ?? []) as ParentIncidentDetail[]).find((row) => row.incident_id === incidentId);
      setIncident(match ?? null);
      setIsLoadingIncident(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [passportId, isLoadingPassport, incidentId, reloadKey]);

  const isLoading = isLoadingPassport || isLoadingIncident;
  const effectiveLoadError = passportLoadFailed ? "Couldn't load this incident." : loadError;

  async function handleAcknowledge() {
    if (!incident) return;
    setIsAcknowledging(true);
    setAcknowledgeError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("acknowledge_incident", {
      p_incident_children_id: incident.incident_children_id,
    });
    setIsAcknowledging(false);
    if (error) {
      setAcknowledgeError(error.message);
      return;
    }
    setIncident((prev) => (prev ? { ...prev, parent_acknowledged_at: new Date().toISOString() } : prev));
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/parent-dashboard/incidents"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Incident</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
            <div className="h-32 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : effectiveLoadError ? (
          <InlineErrorState
            message={effectiveLoadError}
            onRetry={() => {
              refreshPassport();
              setReloadKey((k) => k + 1);
            }}
          />
        ) : !incident ? (
          // A wrong/stale id, or -- structurally, not a bug -- the
          // stage-1 "recorded" notice's own incident, not yet visible
          // here because it hasn't reached teacher sign-off (this RPC's
          // own gate). Same honest copy either way; nothing to
          // distinguish them from without exposing more than sign-off
          // permits.
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">
              We couldn&apos;t find this incident. If it was recorded very recently, the school may still be
              completing the record.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                {formatDateTime(incident.occurred_at)} · {incident.location}
              </p>
              <p className="mt-1.5 text-sm text-brand-neutral-black">
                {incident.parent_summary || "The school has completed this record."}
              </p>
            </div>

            {(incident.distress_level || incident.remained_on_site !== null || (incident.recovery_methods?.length ?? 0) > 0) && (
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  How they were afterwards
                </h2>
                {incident.distress_level && (
                  <p className="text-sm text-brand-neutral-black">
                    {DISTRESS_LABEL[incident.distress_level] ?? incident.distress_level}
                  </p>
                )}
                {incident.remained_on_site !== null && (
                  <p className="mt-1 text-sm text-brand-neutral-black/70">
                    {incident.remained_on_site ? "They stayed at school for the rest of the day." : "They did not stay at school for the rest of the day."}
                    {incident.remained_detail ? ` ${incident.remained_detail}` : ""}
                  </p>
                )}
                {incident.recovery_methods && incident.recovery_methods.length > 0 && (
                  <p className="mt-2 text-sm text-brand-neutral-black">
                    <span className="font-semibold">What helped: </span>
                    {incident.recovery_methods.join(", ")}
                  </p>
                )}
              </div>
            )}

            {incident.injuries.length > 0 && (
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  Injury
                </h2>
                {incident.injuries.map((inj, idx) => (
                  <div key={idx} className={idx > 0 ? "mt-3 border-t border-black/5 pt-3" : ""}>
                    {inj.injury_types && inj.injury_types.length > 0 && (
                      <p className="text-sm text-brand-neutral-black">{inj.injury_types.join(", ")}</p>
                    )}
                    {inj.injury_notes && <p className="mt-1 text-sm text-brand-neutral-black/70">{inj.injury_notes}</p>}
                    <p className="mt-1.5 text-sm text-brand-neutral-black/70">
                      {inj.first_aider_called
                        ? `First aid was given${inj.first_aider_name ? ` by ${inj.first_aider_name}` : ""}.`
                        : "First aid was not needed."}
                      {inj.doctor_ambulance_called ? " A doctor or ambulance was called." : ""}
                    </p>
                    {inj.treatments && inj.treatments.length > 0 && (
                      <p className="mt-1 text-sm text-brand-neutral-black/70">{inj.treatments.join(", ")}</p>
                    )}
                    {inj.treatment_other && <p className="mt-1 text-sm text-brand-neutral-black/70">{inj.treatment_other}</p>}
                  </div>
                ))}
              </div>
            )}

            {incident.restrictive_practice.length > 0 && (
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  Physical support used
                </h2>
                {incident.restrictive_practice.map((rp, idx) => (
                  <p key={idx} className="text-sm text-brand-neutral-black">
                    {rp.planning_status ? PLANNING_STATUS_LABEL[rp.planning_status] ?? rp.planning_status : "Recorded"}
                  </p>
                ))}
              </div>
            )}

            {(incident.parent_notified_at || incident.parent_called_at) && (
              <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  How you were contacted
                </h2>
                {incident.parent_notified_at && (
                  <p className="text-sm text-brand-neutral-black/70">
                    Notice sent {formatDateTime(incident.parent_notified_at)}.
                  </p>
                )}
                {incident.parent_called_at && (
                  <p className="mt-1 text-sm text-brand-neutral-black/70">
                    You were called {formatDateTime(incident.parent_called_at)}.
                  </p>
                )}
              </div>
            )}

            {/* Acknowledge -- a parent's own record of having seen this,
                distinct from "we sent a notice" / "we telephoned you"
                above. Only reachable once this page can render the
                incident at all, which already means teacher_signed_at
                is set -- acknowledge_incident()'s own gate, so there's
                no separate check needed here for "the full account,
                not just the stamp". */}
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              {incident.parent_acknowledged_at ? (
                <p className="text-sm text-brand-neutral-black/70">
                  You acknowledged this {formatDateTime(incident.parent_acknowledged_at)}.
                </p>
              ) : (
                <>
                  <p className="mb-3 text-sm text-brand-neutral-black/70">
                    Let the school know you&apos;ve seen this record.
                  </p>
                  {acknowledgeError && (
                    <p role="alert" className="mb-2 text-sm font-medium text-brand-golden-brown">
                      {acknowledgeError}
                    </p>
                  )}
                  <button
                    type="button"
                    onClick={handleAcknowledge}
                    disabled={isAcknowledging}
                    className="w-full rounded-xl bg-brand-prussian-blue py-2.5 text-center text-sm font-semibold text-white disabled:opacity-50"
                  >
                    {isAcknowledging ? "Acknowledging…" : "I've seen this"}
                  </button>
                </>
              )}
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
