"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { createClient } from "@/lib/supabase/client";
import { PendingApprovalState } from "@/components/clinic/PendingApprovalState";
import { MembershipMissingState } from "@/components/clinic/MembershipMissingState";
import { RedeemLinkCodeSheet } from "@/components/respite/RedeemLinkCodeSheet";
import { OnboardRespiteClientSheet } from "@/components/respite/OnboardRespiteClientSheet";
import { AddClientChoiceSheet } from "@/components/respite/AddClientChoiceSheet";
import { EndPlacementSheet } from "@/components/respite/EndPlacementSheet";
import { ReopenPlacementSheet } from "@/components/respite/ReopenPlacementSheet";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";
import { InlineErrorState } from "@/components/ui/InlineErrorState";

// The centre_manager dashboard build, 25 Sept 2026 -- the full
// placement directory, mirroring what principal/directory's own
// Children segment and clinic-admin/clients give the other two
// authority tiers. get_institution_episode_roster() has been institution-
// type-agnostic since 0211/0263/0290 (confirmed by reading its live
// body -- no institutions.type check exists anywhere in it), so this
// page needed no new RPC, only a client that actually calls it for a
// respite institution -- nothing did, until this.
interface EpisodeRow {
  episode_id: string;
  passport_id: string;
  child_name: string | null;
  started_at: string;
  ended_at: string | null;
  end_reason: string | null;
}

export default function CentreChildrenPage() {
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;

  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [showEnded, setShowEnded] = useState(false);

  const [isAddChoiceOpen, setIsAddChoiceOpen] = useState(false);
  const [isRedeemOpen, setIsRedeemOpen] = useState(false);
  const [isOnboardOpen, setIsOnboardOpen] = useState(false);
  const [endTarget, setEndTarget] = useState<EpisodeRow | null>(null);
  const [reopenTarget, setReopenTarget] = useState<EpisodeRow | null>(null);

  const load = useCallback(async () => {
    if (!institutionId) return;
    setLoadError(null);
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_institution_episode_roster", {
      p_institution_id: institutionId,
      p_include_ended: true,
    });
    if (error) {
      setLoadError(error.message);
      setIsLoading(false);
      return;
    }
    setEpisodes((data ?? []) as EpisodeRow[]);
    setIsLoading(false);
  }, [institutionId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    load();
  }, [load]);

  if (!isReady || membership.status === "checking") {
    return null;
  }
  if (membership.status === "pending") {
    return <PendingApprovalState waitingFor="centre manager" />;
  }
  if (membership.status === "missing") {
    return <MembershipMissingState noun="centre" />;
  }

  const visible = showEnded ? episodes : episodes.filter((e) => !e.ended_at);

  return (
    <>
      <main className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 px-4 py-6 pb-24 lg:pb-6">
        <div className="mx-auto w-full max-w-2xl">
          <div className="mb-4 flex items-center justify-between">
            <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">Children</h1>
            <button
              type="button"
              onClick={() => setIsAddChoiceOpen(true)}
              className="rounded-full bg-brand-golden-brown px-4 py-2 text-sm font-semibold text-white shadow-sm"
            >
              + Add a client
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowEnded((v) => !v)}
            className="mb-4 text-xs font-semibold text-brand-prussian-blue"
          >
            {showEnded ? "Hide ended placements" : "Show ended placements"}
          </button>

          {loadError ? (
            <InlineErrorState message={loadError} onRetry={() => load()} />
          ) : isLoading ? null : visible.length === 0 ? (
            <div className="rounded-2xl border border-black/5 bg-white p-6 text-center shadow-sm">
              <p className="text-sm text-black/60">
                {showEnded
                  ? "No placements recorded yet."
                  : "No children on placement yet. Redeem a link code, or start a new record, to get started."}
              </p>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              {visible.map((episode) => (
                <div
                  key={episode.episode_id}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                >
                  <Link href={`/centre/passport/${episode.passport_id}`} className="min-w-0 flex-1">
                    <p className="truncate font-semibold text-brand-neutral-black">
                      {episode.child_name ?? "This child"}
                    </p>
                    <p className="text-xs text-black/50">
                      {episode.ended_at
                        ? `Placement ended ${new Date(episode.ended_at).toLocaleDateString()}${episode.end_reason ? ` -- ${episode.end_reason}` : ""}`
                        : `Placement started ${new Date(episode.started_at).toLocaleDateString()}`}
                    </p>
                  </Link>
                  {episode.ended_at ? (
                    <button
                      type="button"
                      onClick={() => setReopenTarget(episode)}
                      className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-brand-neutral-black"
                    >
                      Reopen
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setEndTarget(episode)}
                      className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-brand-neutral-black"
                    >
                      End placement
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </main>

      <CentreBottomNav />

      {isAddChoiceOpen && (
        <AddClientChoiceSheet
          onClose={() => setIsAddChoiceOpen(false)}
          onPickRedeem={() => {
            setIsAddChoiceOpen(false);
            setIsRedeemOpen(true);
          }}
          onPickOnboard={() => {
            setIsAddChoiceOpen(false);
            setIsOnboardOpen(true);
          }}
        />
      )}

      {institutionId && (
        <RedeemLinkCodeSheet
          isOpen={isRedeemOpen}
          onClose={() => setIsRedeemOpen(false)}
          institutionId={institutionId}
          institutionName={membership.institutionName}
        />
      )}

      {institutionId && (
        <OnboardRespiteClientSheet
          isOpen={isOnboardOpen}
          onClose={() => setIsOnboardOpen(false)}
          institutionId={institutionId}
        />
      )}

      {endTarget && (
        <EndPlacementSheet
          isOpen={Boolean(endTarget)}
          episodeId={endTarget.episode_id}
          institutionId={institutionId ?? ""}
          childName={endTarget.child_name ?? "this child"}
          onClose={() => setEndTarget(null)}
          onEnded={() => {
            setEndTarget(null);
            load();
          }}
        />
      )}

      {reopenTarget && institutionId && (
        <ReopenPlacementSheet
          isOpen={Boolean(reopenTarget)}
          institutionId={institutionId}
          passportId={reopenTarget.passport_id}
          childName={reopenTarget.child_name ?? "this child"}
          onClose={() => setReopenTarget(null)}
          onReopened={() => {
            setReopenTarget(null);
            load();
          }}
        />
      )}
    </>
  );
}
