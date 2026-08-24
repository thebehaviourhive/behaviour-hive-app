"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { Button } from "@/components/ui/Button";

// Landing page after the 15-second stamp (Phase 3). Stage two -- the
// full record (category, narrative, actions, restrictive practice,
// injuries, debrief) -- is a separate build, not this one. This page is
// deliberately just a confirmation of what was captured, not a
// placeholder pretending stage two exists yet.
//
// Tone: clinical, matching the rest of this module.

interface IncidentSummary {
  occurredAt: string;
  locationValue: string;
  childNames: string[];
  staffNames: string[];
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

export default function IncidentStampConfirmationPage() {
  const router = useRouter();
  const params = useParams<{ incidentId: string }>();
  const { user, isReady } = useRequireRole(["class_teacher", "sna", "principal"]);

  const [summary, setSummary] = useState<IncidentSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user || !params.incidentId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();

      const { data: incident, error: incidentError } = await supabase
        .from("incidents")
        .select("institution_id, occurred_at, incident_locations(value)")
        .eq("id", params.incidentId)
        .maybeSingle();

      if (!isMounted) return;

      if (incidentError || !incident) {
        setError("Could not find this incident.");
        setIsLoading(false);
        return;
      }

      const [{ data: childRows }, { data: staffRows }, { data: staffRoster }, { data: childRoster }] = await Promise.all([
        supabase
          .from("incident_children")
          .select("child_index, passport_id")
          .eq("incident_id", params.incidentId)
          .order("child_index"),
        supabase
          .from("incident_staff")
          .select("user_id, free_text_name")
          .eq("incident_id", params.incidentId),
        // Named rows only carry user_id -- their display name has to
        // come from the roster RPC (auth.users isn't directly readable),
        // same reason useInstitutionRoster exists at all.
        supabase.rpc("get_institution_staff_roster", { p_institution_id: incident.institution_id }),
        // Same reasoning for children: an embedded passports(child_name)
        // join is silently filtered by passports' OWN RLS (scoped to
        // passport_access/clinician_access/ownership) even though the
        // incident_children row itself is visible -- exactly the gap
        // get_institution_child_roster() exists to close (decision 5).
        // Caught live: this rendered "Unnamed child" for a roster child
        // the stamping teacher had no ordinary passport_access to.
        supabase.rpc("get_institution_child_roster", { p_institution_id: incident.institution_id }),
      ]);

      if (!isMounted) return;

      const locationRecord = incident.incident_locations as unknown as { value: string } | { value: string }[] | null;
      const locationValue = Array.isArray(locationRecord) ? locationRecord[0]?.value : locationRecord?.value;

      const nameByUserId = new Map<string, string | null>(
        (staffRoster ?? []).map((row: { user_id: string; full_name: string | null }) => [row.user_id, row.full_name])
      );
      const nameByPassportId = new Map<string, string | null>(
        (childRoster ?? []).map((row: { passport_id: string; child_name: string | null }) => [row.passport_id, row.child_name])
      );

      setSummary({
        occurredAt: incident.occurred_at,
        locationValue: locationValue ?? "Unknown location",
        childNames: (childRows ?? []).map((row) => nameByPassportId.get(row.passport_id) || "Unnamed child"),
        staffNames: (staffRows ?? []).map(
          (row) => row.free_text_name || nameByUserId.get(row.user_id ?? "") || "Named staff member"
        ),
      });
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, params.incidentId]);

  if (!isReady) {
    return null;
  }

  const staffRole = user?.app_metadata?.role as string | undefined;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Stamp Recorded</h1>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="h-32 animate-pulse rounded-2xl bg-white" />
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : summary ? (
          <>
            <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
              <p className="text-sm font-semibold text-brand-neutral-black">{formatDateTime(summary.occurredAt)}</p>
              <p className="mt-0.5 text-sm text-brand-neutral-black/70">{summary.locationValue}</p>

              <div className="mt-3 border-t border-black/5 pt-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">Child</p>
                <p className="mt-1 text-sm text-brand-neutral-black">{summary.childNames.join(", ")}</p>
              </div>

              {summary.staffNames.length > 0 && (
                <div className="mt-3 border-t border-black/5 pt-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50">
                    Staff present
                  </p>
                  <p className="mt-1 text-sm text-brand-neutral-black">{summary.staffNames.join(", ")}</p>
                </div>
              )}
            </div>

            <p className="mt-4 text-sm leading-relaxed text-brand-neutral-black/60">
              The full record -- category, narrative, actions taken, and any restrictive practice or
              injury detail -- is not yet available in this build. This stamp is saved and will not
              be lost.
            </p>

            <Button type="button" onClick={() => router.push(getPostAuthRedirect(staffRole))} className="mt-6">
              Done
            </Button>
          </>
        ) : null}
      </main>
    </div>
  );
}
