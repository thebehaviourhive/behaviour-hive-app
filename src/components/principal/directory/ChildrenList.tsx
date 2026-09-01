"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 4, Stage 4 -- extracted from principal/passports/page.tsx.
// "Passports" renamed to "Children" here, per Daniel's confirmation --
// a rename, in scope, no surface change. Same Link+preventDefault
// pattern as ClassesList: a real push to /principal/passports/[id]
// below lg (unchanged), intercepted into onSelect at lg+.
export function ChildrenList({
  institutionId,
  selectedPassportId,
  onSelect,
}: {
  institutionId: string | null;
  selectedPassportId: string | null;
  onSelect: (passportId: string) => void;
}) {
  const [children, setChildren] = useState<{ passport_id: string; child_name: string; enrolment_ended_at: string | null }[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [showPast, setShowPast] = useState(false);

  const load = useCallback(async (instId: string) => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_child_roster", {
      p_institution_id: instId,
    });
    if (rosterError) {
      setError("Could not load the school roster.");
      setIsLoading(false);
      return;
    }
    setChildren(
      ((rosterRows ?? []) as { passport_id: string; child_name: string; enrolment_ended_at: string | null }[])
        .slice()
        .sort((a, b) => a.child_name.localeCompare(b.child_name))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!institutionId) return;
    async function run() {
      await load(institutionId!);
    }
    run();
  }, [institutionId, load]);

  const active = children.filter((c) => !c.enrolment_ended_at);
  const past = children.filter((c) => c.enrolment_ended_at);
  const filteredActive = query.trim()
    ? active.filter((c) => c.child_name.toLowerCase().includes(query.trim().toLowerCase()))
    : active;
  const filteredPast = query.trim()
    ? past.filter((c) => c.child_name.toLowerCase().includes(query.trim().toLowerCase()))
    : past;

  function formatDate(value: string): string {
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return value;
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  }

  function rowLink(c: { passport_id: string; child_name: string }, muted: boolean) {
    return (
      <Link
        key={c.passport_id}
        href={`/principal/passports/${c.passport_id}`}
        onClick={(e) => {
          if (window.matchMedia("(min-width: 1024px)").matches) {
            e.preventDefault();
            onSelect(c.passport_id);
          }
        }}
        className={`block rounded-2xl border p-4 shadow-sm ${
          c.passport_id === selectedPassportId
            ? "border-brand-prussian-blue bg-brand-pastel-blue/10"
            : muted
              ? "border-black/5 bg-white/60"
              : "border-black/5 bg-white"
        }`}
      >
        <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
          {c.child_name}
        </p>
      </Link>
    );
  }

  return (
    <>
      <div className="mb-4 flex items-center justify-between gap-2">
        {children.length > 0 && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name"
            className="w-full rounded-xl border border-brand-off-white bg-white px-4 py-2 font-sans text-body text-brand-neutral-black placeholder:text-brand-neutral-black/40 focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        )}
        {institutionId && (
          <Link
            href="/principal/passports/enrol"
            className="flex-shrink-0 rounded-full bg-brand-prussian-blue px-4 py-2 font-sans text-body font-semibold text-white"
          >
            + Enrol
          </Link>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : children.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          No children linked to this school yet.
        </p>
      ) : filteredActive.length === 0 && filteredPast.length === 0 ? (
        <p className="px-1 pt-2 text-center font-sans text-body text-brand-neutral-black/60">No children match &quot;{query}&quot;.</p>
      ) : (
        <>
          {filteredActive.length > 0 && <div className="flex flex-col gap-2">{filteredActive.map((c) => rowLink(c, false))}</div>}

          {filteredActive.length === 0 && filteredPast.length > 0 && (
            <p className="px-1 pt-2 text-center font-sans text-body text-brand-neutral-black/60">
              {query.trim() ? `No currently enrolled children match "${query}".` : "No children currently enrolled."}
            </p>
          )}

          {filteredPast.length > 0 && (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowPast((v) => !v)}
                className="flex w-full items-center justify-between rounded-2xl border border-dashed border-black/10 bg-white/60 px-4 py-3 text-left font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50"
              >
                <span>Past pupils ({filteredPast.length})</span>
                <span>{showPast ? "−" : "+"}</span>
              </button>
              {showPast && (
                <div className="mt-2 flex flex-col gap-2">
                  {filteredPast.map((c) => (
                    <div key={c.passport_id}>
                      {rowLink(c, true)}
                      <p className="mt-0.5 px-1 font-sans text-eyebrow text-brand-neutral-black/50">
                        Enrolment ended {formatDate(c.enrolment_ended_at!)}
                      </p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}
