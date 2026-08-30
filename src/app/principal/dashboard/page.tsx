"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { AlertTriangleIcon } from "@/components/ui/icons";
import { AttestationPromptCard } from "@/components/incident-log/AttestationPromptCard";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";
import { IncidentCard, type InstitutionIncidentRow } from "@/components/principal/IncidentCard";

// Minimal principal surface, per the brief: "a sign-off queue and
// access to incidents" -- nothing more. The full principal daily
// dashboard and to-do lists are a separate, later build (PRD 2 Stage
// 7); this page is deliberately not that yet. Read-only for now -- the
// actual countersign action happens on the incident detail page.
//
// Tone: clinical, matching the rest of this module (plain, precise,
// unemotional -- no encouragement/warmth copy, unlike the rest of the
// app's onboarding-adjacent screens).
//
// PRD 2, Stage 1: the row rendering (IncidentCard) is now shared with
// /principal/incidents -- see that component's own header comment for
// what was unioned, what was fixed as a bug, and what was deliberately
// NOT carried over (the old "Debrief required" pill, provably false on
// any signed-off incident -- suppressed pending Stage 7's RPC widening).

export default function PrincipalDashboardPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionName, setInstitutionName] = useState<string | null>(null);
  const [incidents, setIncidents] = useState<InstitutionIncidentRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      // approved_at is not null alongside deactivated_at is null -- a
      // pending or rejected principal is structurally unreachable today
      // (CLAUDE.md, Deferred work) but this lookup, and the redirect
      // below, should already be correct for the day handover makes it
      // reachable rather than need a second pass then.
      const { data: staffRow, error: staffError } = await supabase
        .from("institution_staff")
        .select("institution_id, institutions(name)")
        .eq("user_id", user!.id)
        .eq("role", "principal")
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle();

      if (!isMounted) return;

      if (staffError || !staffRow) {
        // Before assuming "no institution at all" (join-institution's
        // job), check for the narrower, genuinely-possible case Stage
        // 1c introduces: this session's own auth claim still says
        // 'principal' (that's the only reason useRequireRole let them
        // reach this page at all) but hand_over_principal() already
        // moved them to a different active role elsewhere in the same
        // transaction. auth.users.app_metadata and institution_staff.role
        // are two separate writes -- getUser() should reflect the fresh
        // claim immediately (this app already depends on that working,
        // via role-select's own POST /api/set-role -> router.push flow),
        // but "should" isn't "always will" for a value this session
        // cached at mount. A silent bounce to the join form would be
        // actively wrong here -- they're not joining anything, they
        // already have a school -- so this is named honestly instead:
        // ask them to sign in again rather than pretend nothing changed.
        const { data: anyActiveRow } = await supabase
          .from("institution_staff")
          .select("id")
          .eq("user_id", user!.id)
          .is("deactivated_at", null)
          .not("approved_at", "is", null)
          .maybeSingle();

        if (!isMounted) return;

        if (anyActiveRow) {
          setError("ROLE_MISMATCH");
          setIsLoading(false);
          return;
        }

        // Genuinely no active row anywhere -- matches teacher/dashboard's
        // own pattern: join-institution's own four-way status resolution
        // is where this belongs, not a dead-end error on this page.
        router.replace("/teacher/join-institution");
        return;
      }

      const institutionRecord = staffRow.institutions as unknown as { name: string } | { name: string }[] | null;
      const name = Array.isArray(institutionRecord) ? institutionRecord[0]?.name : institutionRecord?.name;
      setInstitutionName(name ?? null);

      // PRD 1, Stage 3: lazy materialization, best-effort. resolve_
      // lapsed_incident_ownership() is a real write (0105/0107) --
      // called here, on the principal's own queue load, so an
      // incident sitting owned by a departed supply teacher for a week
      // doesn't wait on someone remembering to trigger it separately.
      // Its own failure is never allowed to block the page from
      // loading incidents at all -- errors here are swallowed
      // deliberately, not surfaced as a page-level error for a
      // correctness nicety, not the main job of this load.
      try {
        await supabase.rpc("resolve_lapsed_incident_ownership", { p_institution_id: staffRow.institution_id });
      } catch {
        // best-effort; see comment above
      }

      const { data: rows, error: rpcError } = await supabase.rpc("get_institution_incidents", {
        p_institution_id: staffRow.institution_id,
      });

      if (!isMounted) return;

      if (rpcError) {
        setError("Could not load incidents.");
        setIsLoading(false);
        return;
      }

      setIncidents((rows ?? []) as InstitutionIncidentRow[]);
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, router]);

  if (!isReady) {
    return null;
  }

  const awaitingSignoff = incidents.filter((i) => i.teacher_signed_at && !i.countersigned_at);
  const rest = incidents.filter((i) => !(i.teacher_signed_at && !i.countersigned_at));

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-start justify-between gap-3 px-4 pt-6 pb-4">
        <div>
          <h1 className="font-heading text-2xl font-bold text-brand-prussian-blue">
            Incident Log
          </h1>
          {institutionName && (
            <p className="mt-0.5 text-sm text-brand-neutral-black/60">{institutionName}</p>
          )}
        </div>
        {/* Classes/Staff/Incidents links removed -- PrincipalBottomNav
            now owns navigation between top-level screens. Record-incident
            stays: a quick action, not inter-screen navigation. */}
        <Link
          href="/teacher/incidents/new"
          aria-label="Record incident"
          className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-golden-brown text-white shadow-sm"
        >
          <AlertTriangleIcon className="h-5 w-5" />
        </Link>
      </header>

      <main className="flex-1 px-4">
        <AttestationPromptCard className="mb-4" />
        {isLoading ? (
          <div className="flex flex-col gap-2">
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
            <div className="h-16 animate-pulse rounded-2xl bg-white" />
          </div>
        ) : error === "ROLE_MISMATCH" ? (
          <div className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            <p>Your role at this school has changed. Please sign in again to see your current view.</p>
            <Link
              href="/login"
              className="mt-3 inline-block rounded-2xl bg-brand-prussian-blue px-5 py-2.5 text-sm font-semibold text-white"
            >
              Sign in again
            </Link>
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
                    <IncidentCard key={incident.incident_id} incident={incident} needsSignoff />
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
                    <IncidentCard key={incident.incident_id} incident={incident} />
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>

      <PrincipalBottomNav />
    </div>
  );
}
