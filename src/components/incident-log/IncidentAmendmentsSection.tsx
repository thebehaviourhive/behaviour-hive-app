"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Amendment access lockdown, item 3 (CLAUDE.md). Before this, amendments
// existed nowhere on screen for ANY role -- get_incident_export() has
// carried them since 0096 and the PDF has rendered them (attributed,
// dated) since the same migration, both confirmed working before this
// was built. But the only on-screen surface that ever touched an
// amendment was CountersignCard's own pre-countersign confirm text
// ("Amendments can still be added afterwards"), which self-hides for
// everyone except a countersigning principal and never rendered PAST
// amendments as a standing list either way. An owning teacher, an SNA
// named on the incident, or a clinician with legitimate view access
// could have a correction sitting against their own record and no way
// to see it without opening the PDF.
//
// Gated only by get_incident_amendments()'s own can_view_incident()
// check (migration 0180) -- the same authority that already let this
// page load the incident at all, so this never needs its own permission
// state. Self-hides (renders nothing) while empty, same idiom as the
// other self-hiding cards on this page -- an "Amendments" heading over
// an empty list would read as a missing section, not a clean one.
interface IncidentAmendment {
  id: string;
  reason: string;
  content: string;
  author_name: string | null;
  created_at: string;
  // THE AMENDMENT LEAK, FIXED (CLAUDE.md, migration 0186). Whether this
  // amendment's own author chose to share it with the family --
  // get_parent_incidents() only ever returns the ones marked true. Shown
  // here so a teacher/principal can see, without opening the parent
  // export, which amendments a parent will actually see.
  is_parent_visible: boolean;
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

export function IncidentAmendmentsSection({
  incidentId,
  refreshSignal,
}: {
  incidentId: string;
  // Bumped by the parent whenever an amendment is added elsewhere on
  // this page (CountersignCard's own persistent "Add an amendment"
  // button) -- a plain mount-only fetch would repeat this component's
  // own stale-snapshot risk (CLAUDE.md: SignOffCard, CountersignCard's
  // summary) the moment a second amendment is added in the same visit.
  refreshSignal?: number;
}) {
  const [amendments, setAmendments] = useState<IncidentAmendment[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const { data, error } = await supabase.rpc("get_incident_amendments", { p_incident_id: incidentId });
      if (!isMounted) return;
      if (error) {
        // Fails closed and quiet, not a red error banner -- a viewer who
        // can't see amendments for a genuine permission reason is
        // already covered by can_view_incident() gating the page load
        // itself; anything reaching here is a transient load issue, not
        // worth alarming over on a section that's routinely empty.
        console.error("Failed to load incident amendments:", error);
        setIsLoading(false);
        return;
      }
      setAmendments((data ?? []) as IncidentAmendment[]);
      setIsLoading(false);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [incidentId, refreshSignal]);

  if (isLoading || amendments.length === 0) return null;

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <h2 className="font-heading text-lg font-bold text-brand-prussian-blue">Amendments</h2>
      <p className="text-sm text-brand-neutral-black/70">
        Added after sign-off, attributed and dated. These sit alongside the record -- they don&apos;t change anything
        written above.
      </p>
      <div className="flex flex-col gap-3">
        {amendments.map((am) => (
          <div key={am.id} className="rounded-xl border border-black/10 bg-black/[0.015] p-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-brand-neutral-black/50">
                {am.author_name ?? "—"} · {formatDateTime(am.created_at)}
              </p>
              {am.is_parent_visible && (
                <span className="flex-shrink-0 rounded-full bg-brand-prussian-blue/10 px-2 py-0.5 text-[11px] font-medium text-brand-prussian-blue">
                  Shared with family
                </span>
              )}
            </div>
            <p className="mt-1 text-sm font-semibold text-brand-neutral-black">{am.reason}</p>
            <p className="mt-1 text-sm text-brand-neutral-black">{am.content}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
