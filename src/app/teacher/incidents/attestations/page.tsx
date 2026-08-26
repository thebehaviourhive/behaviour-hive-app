"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";

// Phase 4, piece 2. Every incident a named staff member's own real
// account is attached to -- linked from the dashboard prompt card
// (AttestationPromptCard), which is the actual entry point; this page
// is the "review everything" landing spot once they've tapped it.
// Accessible to class_teacher/sna/principal, matching the incident
// detail page's own role list -- anyone can be named staff on someone
// else's incident regardless of their own role.
//
// Deliberately not restricted to outstanding items: closed and
// withdrawn incidents are shown too, per the brief -- a staff member's
// name is on a legal record and they should be able to look up what
// they attested to (or withdrew, or never got to) even after it's
// closed, not lose the ability to find it the moment it locks.

interface AttestationRow {
  incident_id: string;
  incident_staff_id: string;
  occurred_at: string;
  location: string;
  status: string;
  status_label: string;
  stale_categories: string[] | null;
  is_closed: boolean;
}

const CATEGORY_LABEL: Record<string, string> = {
  narrative: "the narrative",
  children: "a child's distress or whether they remained on site",
  actions: "the actions taken",
  restrictive_practices: "a restrictive practice record",
  injuries: "an injury record",
  body_marks: "a body-map marker",
  attestation_reset: "attestations were withdrawn and re-requested from scratch",
};

function whatChangedLine(categories: string[] | null): string | null {
  if (!categories || categories.length === 0) return null;
  if (categories.includes("attestation_reset") && categories.length === 1) {
    return "Attestations were withdrawn and re-requested from scratch since you last attested.";
  }
  const labels = categories.filter((c) => c !== "attestation_reset").map((c) => CATEGORY_LABEL[c] ?? c);
  if (categories.includes("attestation_reset")) {
    labels.unshift("attestations were reset");
  }
  return `Changed since you attested: ${labels.join(", ")}.`;
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

const STATUS_PILL_CLASS: Record<string, string> = {
  not_attested: "bg-black/5 text-brand-neutral-black/60",
  stale: "bg-brand-golden-brown/15 text-brand-golden-brown",
  withdrawn: "bg-black/5 text-brand-neutral-black/60",
  current: "bg-brand-pastel-blue/20 text-brand-prussian-blue",
};

export default function IncidentAttestationsPage() {
  const { user, isReady } = useRequireRole(["class_teacher", "sna", "principal"]);
  const [rows, setRows] = useState<AttestationRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const { data, error: rpcError } = await supabase.rpc("get_my_incident_attestations");
      if (!isMounted) return;
      if (rpcError) {
        setError("Could not load your incident attestations.");
        setIsLoading(false);
        return;
      }
      setRows((data ?? []) as AttestationRow[]);
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

  const outstanding = rows.filter((r) => !r.is_closed && (r.status === "not_attested" || r.status === "stale"));
  const rest = rows.filter((r) => !outstanding.includes(r));

  function Row({ row }: { row: AttestationRow }) {
    const whatChanged = whatChangedLine(row.stale_categories);
    return (
      <Link
        href={`/teacher/incidents/${row.incident_id}`}
        className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
      >
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold text-brand-neutral-black">{formatDateTime(row.occurred_at)}</p>
            <p className="text-xs text-brand-neutral-black/50">{row.location}</p>
          </div>
          <span className={`flex-shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_PILL_CLASS[row.status] ?? "bg-black/5 text-brand-neutral-black/60"}`}>
            {row.status_label}
          </span>
        </div>
        {whatChanged && <p className="mt-2 text-xs text-brand-neutral-black/70">{whatChanged}</p>}
        {row.is_closed && <p className="mt-2 text-xs text-brand-neutral-black/50">This incident is closed. Your record is preserved, read-only.</p>}
      </Link>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-10">
      <header className="px-4 pt-6 pb-4">
        <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">Your incident attestations</h1>
        <p className="mt-0.5 text-sm text-brand-neutral-black/60">
          Every incident you&apos;re named on, and where your own account stands.
        </p>
      </header>

      <main className="flex-1 px-4">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error ? (
          <p className="text-sm text-brand-neutral-black/60">{error}</p>
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            You&apos;re not named on any incident records.
          </p>
        ) : (
          <>
            {outstanding.length > 0 && (
              <section className="mb-6">
                <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Needs your attestation
                </h2>
                <div className="flex flex-col gap-2">
                  {outstanding.map((row) => (
                    <Row key={row.incident_staff_id} row={row} />
                  ))}
                </div>
              </section>
            )}

            {rest.length > 0 && (
              <section>
                <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  {outstanding.length > 0 ? "Everything else" : "Your incident attestations"}
                </h2>
                <div className="flex flex-col gap-2">
                  {rest.map((row) => (
                    <Row key={row.incident_staff_id} row={row} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
