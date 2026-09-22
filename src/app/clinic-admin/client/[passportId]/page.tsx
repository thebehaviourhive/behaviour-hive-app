"use client";

import Link from "next/link";
import { use, useCallback, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { EpisodeTagsSection } from "@/components/clinic/EpisodeTagsSection";
import { ClientContactInfoSection } from "@/components/clinic/ClientContactInfoSection";
import { ClientGuardianAndClaimCodeSection } from "@/components/clinic/ClientGuardianAndClaimCodeSection";

// PRD 10 Stage 3, item 3 -- the admin's own new client record, "the
// same guarantee as the list: identity, episodes, tags, requests,
// nothing clinical." This is a genuinely NEW leak surface (the list
// was proven structural; this detail view is built fresh this stage),
// so the same discipline applies deliberately: no clinical table is
// ever queried here, by construction -- what's rendered is exactly
// child_name plus episode dates (from the SAME roster RPC the list
// already uses, get_institution_episode_roster(), filtered client-side
// to this one passport rather than a second RPC written just to fetch
// one row) and EpisodeTagsSection (Stage 3's own shared component,
// which already resolves its own tags/requests and never touches a
// clinical table either). There is no tab strip, no "Clinical" section,
// nothing to accidentally wire a clinical component into later without
// it being an obvious, visible addition to this short file.
//
// Client Info (clinic-only), Daniel's decisions, Sept 2026. Two
// additions, both holding the same guarantee as everything else on this
// page: ClientContactInfoSection (the only client-info component an
// admin ever sees -- ClientClinicalIntakeSection is never imported
// here, at all) and ClientGuardianAndClaimCodeSection, reachable now
// that the claim-code RPCs admit clinic_admin at a clinic (migration
// 0287) -- closing the exact gap the recon named: an admin who onboards
// a client previously had no way to generate the code to hand the
// parent.
//
// ?missingSection=contact (decision 1) shows a plain banner -- the only
// section that can ever be flagged here, since this page never renders
// clinical intake at all.

interface RosterRow {
  episodeId: string;
  passportId: string;
  childName: string;
  startedAt: string;
  endedAt: string | null;
  endReason: string | null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

export default function ClinicAdminClientDetailPage({ params }: { params: Promise<{ passportId: string }> }) {
  const { passportId } = use(params);
  const { user, isReady } = useRequireRole("clinic_admin");
  const searchParams = useSearchParams();
  const missingSection = searchParams.get("missingSection");
  const [row, setRow] = useState<RosterRow | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "clinic_admin")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }

    const { data: rosterRows, error: rosterError } = await supabase.rpc("get_institution_episode_roster", {
      p_institution_id: staffRow.institution_id,
      p_include_ended: true,
    });

    if (rosterError) {
      setError(rosterError.message);
      setIsLoading(false);
      return;
    }

    const match = (rosterRows ?? []).find(
      (r: { passport_id: string }) => r.passport_id === passportId
    ) as
      | { episode_id: string; passport_id: string; child_name: string; started_at: string; ended_at: string | null; end_reason: string | null }
      | undefined;

    if (!match) {
      setError("This client isn't on your clinic's roster.");
      setIsLoading(false);
      return;
    }

    setRow({
      episodeId: match.episode_id,
      passportId: match.passport_id,
      childName: match.child_name,
      startedAt: match.started_at,
      endedAt: match.ended_at,
      endReason: match.end_reason,
    });
    setIsLoading(false);
  }, [user, passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/clinic-admin/clients"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">{row?.childName ?? "Client"}</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          {isLoading ? (
            <div className="h-[100px] animate-pulse rounded-2xl bg-white" />
          ) : error ? (
            <p className="text-sm text-brand-neutral-black/60">{error}</p>
          ) : row ? (
            <>
              {missingSection === "contact" && (
                <p role="alert" className="mb-4 rounded-2xl bg-brand-golden-brown/10 p-3 text-sm font-medium text-brand-golden-brown">
                  Contact info didn&apos;t save when this client was added — fill it in below when you can.
                </p>
              )}

              <section className="mb-6">
                <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">
                  Episode of Care
                </h2>
                <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${
                      row.endedAt ? "bg-black/5 text-brand-neutral-black/60" : "bg-brand-pastel-blue/20 text-brand-prussian-blue"
                    }`}
                  >
                    {row.endedAt ? "Discharged" : "Active"}
                  </span>
                  <p className="mt-1.5 text-xs text-brand-neutral-black/50">
                    {row.endedAt
                      ? `${row.endReason ?? "Discharged"} · ${formatDate(row.endedAt)}`
                      : `Started ${formatDate(row.startedAt)}`}
                  </p>
                </div>
              </section>

              <ClientContactInfoSection passportId={row.passportId} />
              <ClientGuardianAndClaimCodeSection passportId={row.passportId} childName={row.childName} />
              <div className="mt-6">
                <EpisodeTagsSection passportId={row.passportId} />
              </div>
            </>
          ) : null}
        </div>
      </main>
    </div>
  );
}
