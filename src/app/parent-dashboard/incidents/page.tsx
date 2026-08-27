"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// Phase 5: the parent's own persistent incident list (the dashboard's
// IncidentNoticeCard is for new/recent notices; this is the durable
// place to revisit any past one). Straight through get_parent_incidents()
// -- their own child's slice only, never the staff narrative, never
// another child's identity or fields, never a record before teacher
// sign-off (that RPC's own gate, adversarially proven in CHECK T).

interface ParentIncidentRow {
  incident_id: string;
  occurred_at: string;
  location: string;
  parent_summary: string | null;
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

export default function ParentIncidentsPage() {
  const { user, isReady } = useRequireRole("parent");
  const [rows, setRows] = useState<ParentIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: passport, error: passportError } = await supabase
        .from("passports")
        .select("id")
        .eq("user_id", user!.id)
        .maybeSingle();

      if (!isMounted) return;

      if (passportError || !passport) {
        setLoadError("Couldn't load your incidents.");
        setIsLoading(false);
        return;
      }

      const { data, error } = await supabase.rpc("get_parent_incidents", { p_passport_id: passport.id });

      if (!isMounted) return;

      if (error) {
        setLoadError("Couldn't load your incidents.");
        setIsLoading(false);
        return;
      }

      setRows((data ?? []) as ParentIncidentRow[]);
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

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-safe-ivory">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/parent-dashboard"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Incidents</h1>
      </header>

      <main className="flex-1 px-4 pb-10">
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
            <div className="h-20 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : loadError ? (
          <InlineErrorState message={loadError} onRetry={() => window.location.reload()} />
        ) : rows.length === 0 ? (
          <div className="rounded-2xl border-2 border-dashed border-brand-pastel-blue bg-white/60 p-6 text-center">
            <p className="text-sm text-brand-neutral-black/70">Nothing recorded yet.</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {rows.map((row) => (
              <div key={row.incident_id} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                <p className="text-xs font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                  {formatDateTime(row.occurred_at)} · {row.location}
                </p>
                <p className="mt-1.5 text-sm text-brand-neutral-black">
                  {row.parent_summary || "The school has completed this record."}
                </p>
              </div>
            ))}
          </div>
        )}
      </main>
    </div>
  );
}
