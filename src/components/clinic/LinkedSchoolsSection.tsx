"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Closes the director notification gap recorded during the cross-
// organisation link build (0294): a director's own client record
// showed no trace of a real school link anywhere -- not on Clinical
// Team, not on Data Sharing. This is that trace. Its own place, not
// folded into Clinical Team's own roster -- Clinical Team is about
// PEOPLE; a linked institution is a fact about the client itself, and
// gets its own section, positioned first in the tab so it's visible
// without hunting rather than buried under the roster.
//
// Genuinely absent (no heading, no empty state) when there's nothing
// to show -- most clinic clients have no school link at all, and an
// always-visible "No linked schools" row for every one of them would
// be exactly the clutter this schema's own Session Notes/Overseeing
// Leads precedent already avoids for a fact that's usually not true.
//
// Reuses get_passport_linked_schools_for_director() (0295) directly --
// the SAME function GrantManagementSection already calls for its own
// "Share with a School" picker, so this section and that one can never
// silently disagree about which schools are linked.

interface LinkedSchool {
  institutionId: string;
  institutionName: string;
  linkedAt: string;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

export function LinkedSchoolsSection({ passportId }: { passportId: string }) {
  const [schools, setSchools] = useState<LinkedSchool[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const { data } = await supabase.rpc("get_passport_linked_schools_for_director", { p_passport_id: passportId });
    const rows = (data ?? []) as { institution_id: string; institution_name: string; linked_at: string }[];
    setSchools(rows.map((r) => ({ institutionId: r.institution_id, institutionName: r.institution_name, linkedAt: r.linked_at })));
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (isLoading || schools.length === 0) return null;

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
        Linked Schools ({schools.length})
      </h2>
      <div className="flex flex-col gap-2">
        {schools.map((s) => (
          <div key={s.institutionId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <p className="text-sm font-semibold text-brand-neutral-black">{s.institutionName}</p>
            <p className="mt-0.5 text-xs text-brand-neutral-black/50">Linked {formatDate(s.linkedAt)}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
