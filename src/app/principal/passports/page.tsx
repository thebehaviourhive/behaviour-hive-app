"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { EnrolChildSheet } from "@/components/principal/EnrolChildSheet";

// PRD 1, Stage 4, Step 3. Mirrors /principal/classes' own list idiom
// exactly (header with a back chevron + title, rounded-2xl white cards)
// -- no new visual pattern introduced.
//
// Source is get_institution_child_roster() -- the SAME RPC every other
// principal roster screen already uses, confirmed unchanged and
// deliberately not approval-gated (Stage 4 Step 1's own decision 4,
// re-confirmed rather than assumed before this page was built on top of
// it). This is the point of decision 2: EVERY child at the school shows
// here, including ones with zero passport_access grants at all -- the
// gap is the information, not just the grants. An empty detail page
// (visited by tapping through) is a legitimate, informative state, not
// an error.
//
// Stage 6, Step 2: the same RPC now also returns enrolment_ended_at
// (0122) -- null for an actively-enrolled child OR one linked before
// Stage 6 existed (never given an enrolment row at all; treated the
// same deliberately, so no pre-Stage-6 child silently vanishes from the
// active list), non-null for a child whose most recent enrolment at
// this school has ended. Split into Active + a collapsed Past Pupils
// section, matching this app's own established convention (Past Cover,
// Removed teachers, Previously in this class) -- not a new pattern.

interface ChildRosterRow {
  passport_id: string;
  child_name: string;
  enrolment_ended_at: string | null;
}

function formatDate(value: string): string {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default function PrincipalPassportsPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [children, setChildren] = useState<ChildRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPast, setShowPast] = useState(false);
  const [isEnrolOpen, setIsEnrolOpen] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);

    const supabase = createClient();
    const { data: staffRow, error: staffError } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (staffError || !staffRow) {
      setError("Could not find your institution.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_child_roster", {
      p_institution_id: staffRow.institution_id,
    });

    if (rosterError) {
      setError("Could not load the school roster.");
      setIsLoading(false);
      return;
    }

    setChildren(((rosterRows ?? []) as ChildRosterRow[]).slice().sort((a, b) => a.child_name.localeCompare(b.child_name)));
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  const active = children.filter((c) => !c.enrolment_ended_at);
  const past = children.filter((c) => c.enrolment_ended_at);
  const filteredActive = query.trim()
    ? active.filter((c) => c.child_name.toLowerCase().includes(query.trim().toLowerCase()))
    : active;
  const filteredPast = query.trim()
    ? past.filter((c) => c.child_name.toLowerCase().includes(query.trim().toLowerCase()))
    : past;

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="flex-1 font-heading text-xl font-bold text-brand-prussian-blue">Passports</h1>
        {institutionId && (
          <button
            type="button"
            onClick={() => setIsEnrolOpen(true)}
            className="rounded-full bg-brand-prussian-blue px-4 py-2 text-sm font-semibold text-white"
          >
            + Enrol
          </button>
        )}
      </header>

      {children.length > 0 && (
        <div className="px-4 pb-4">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-brand-off-white bg-white px-4 py-2 font-sans text-sm text-brand-neutral-black placeholder:text-brand-neutral-black/40 focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
      )}

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : children.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            No children linked to this school yet.
          </p>
        ) : filteredActive.length === 0 && filteredPast.length === 0 ? (
          <p className="px-1 pt-2 text-center text-sm text-brand-neutral-black/60">No children match &quot;{query}&quot;.</p>
        ) : (
          <>
            {filteredActive.length > 0 && (
              <div className="flex flex-col gap-2">
                {filteredActive.map((c) => (
                  <Link
                    key={c.passport_id}
                    href={`/principal/passports/${c.passport_id}`}
                    className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                  >
                    <p className="text-sm font-semibold text-brand-neutral-black">{c.child_name}</p>
                  </Link>
                ))}
              </div>
            )}

            {filteredActive.length === 0 && filteredPast.length > 0 && (
              <p className="px-1 pt-2 text-center text-sm text-brand-neutral-black/60">
                No currently enrolled children match &quot;{query}&quot;.
              </p>
            )}

            {filteredPast.length > 0 && (
              <div className="mt-4">
                <button
                  type="button"
                  onClick={() => setShowPast((v) => !v)}
                  className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/50"
                >
                  <span>Past pupils ({filteredPast.length})</span>
                  <span>{showPast ? "−" : "+"}</span>
                </button>
                {showPast && (
                  <div className="mt-2 flex flex-col gap-2">
                    {filteredPast.map((c) => (
                      <Link
                        key={c.passport_id}
                        href={`/principal/passports/${c.passport_id}`}
                        className="block rounded-2xl border border-black/5 bg-white/60 p-4"
                      >
                        <p className="text-sm font-semibold text-brand-neutral-black">{c.child_name}</p>
                        <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                          Enrolment ended {formatDate(c.enrolment_ended_at!)}
                        </p>
                      </Link>
                    ))}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>

      {institutionId && (
        <EnrolChildSheet
          isOpen={isEnrolOpen}
          institutionId={institutionId}
          onClose={() => setIsEnrolOpen(false)}
          onEnrolled={load}
        />
      )}
    </div>
  );
}
