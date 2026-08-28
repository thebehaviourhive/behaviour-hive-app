"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";

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

interface ChildRosterRow {
  passport_id: string;
  child_name: string;
}

export default function PrincipalPassportsPage() {
  const { user, isReady } = useRequireRole("principal");
  const [children, setChildren] = useState<ChildRosterRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        setError("Could not find your institution.");
        setIsLoading(false);
        return;
      }

      const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_child_roster", {
        p_institution_id: staffRow.institution_id,
      });

      if (!isMounted) return;

      if (rosterError) {
        setError("Could not load the school roster.");
        setIsLoading(false);
        return;
      }

      setChildren(((rosterRows ?? []) as ChildRosterRow[]).slice().sort((a, b) => a.child_name.localeCompare(b.child_name)));
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

  const filtered = query.trim()
    ? children.filter((c) => c.child_name.toLowerCase().includes(query.trim().toLowerCase()))
    : children;

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
        ) : filtered.length === 0 ? (
          <p className="px-1 pt-2 text-center text-sm text-brand-neutral-black/60">No children match &quot;{query}&quot;.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {filtered.map((c) => (
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
      </main>
    </div>
  );
}
