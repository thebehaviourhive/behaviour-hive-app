"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionMembership } from "@/hooks/useInstitutionMembership";
import { createClient } from "@/lib/supabase/client";
import { RespiteChildRecord } from "@/components/respite/RespiteChildRecord";
import { EndPlacementSheet } from "@/components/respite/EndPlacementSheet";
import { ReopenPlacementSheet } from "@/components/respite/ReopenPlacementSheet";
import { CentrePageContent } from "@/components/respite/CentrePageContent";
import { CentreBottomNav } from "@/components/respite/CentreBottomNav";

// PRD 11 Stage 5, item 4 -- the first-five-minutes screen, centre_
// manager's own route. Placement-scoped read throughout, unaffected by
// activation state -- see migration 0302 and the shared RespiteChildRecord
// component for the full shape.
//
// The centre_manager dashboard build, 25 Sept 2026 -- adds the one
// thing this screen never had: ending or reopening the placement
// itself. Deliberately NOT added inside RespiteChildRecord (shared
// verbatim with /care/passport, where a care_staff caller has no
// authority to end or reopen anything) -- a small, dedicated query
// here instead, kept off the shared component and its shared hook.
interface EpisodeStatus {
  episodeId: string;
  endedAt: string | null;
}

export default function CentreManagerPassportPage() {
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("centre_manager");
  const membership = useInstitutionMembership(user?.id, "centre_manager");
  const institutionId = membership.institutionId;

  const [episode, setEpisode] = useState<EpisodeStatus | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [isEndOpen, setIsEndOpen] = useState(false);
  const [isReopenOpen, setIsReopenOpen] = useState(false);
  // Forces RespiteChildRecord to remount (and re-run its own internal
  // fetch from scratch) after End/Reopen -- its own episodeId is
  // resolved inside useRespiteChildRecord, which this page has no
  // handle on otherwise. A reopen in particular produces a genuinely
  // NEW episode id; without this, StaysSection would keep pointing at
  // the just-ended one until an unrelated navigation happened to
  // remount the tree.
  const [recordKey, setRecordKey] = useState(0);

  // Baseline audit, 26 Sept 2026 -- this used to ALSO run its own direct
  // `.from("passports").select("child_name")`, which this schema's own
  // standing rule already names as unsafe: a roster-scoped child name
  // must resolve through a dedicated RPC, never a direct passports read
  // (RLS-silent, not RLS-erroring). Confirmed live: this query genuinely
  // returned no row for a real centre_manager session, so childName
  // silently stayed null forever -- invisible before this pass because
  // nothing rendered it prominently (only EndPlacementSheet/
  // ReopenPlacementSheet's "this child" fallback), and surfaced the
  // moment the new back-chevron header put it at the top of the screen.
  // Fixed by dropping the query outright and sourcing childName from
  // RespiteChildRecord's own onChildNameChange -- the same correctly
  // RPC-resolved name already used elsewhere -- instead of re-deriving
  // it a second, broken way.
  const loadEpisode = useCallback(async () => {
    if (!institutionId || !passportId) return;
    const supabase = createClient();
    const { data: episodeRow } = await supabase
      .from("episodes_of_care")
      .select("id, ended_at")
      .eq("passport_id", passportId)
      .eq("institution_id", institutionId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (episodeRow) {
      setEpisode({ episodeId: episodeRow.id, endedAt: episodeRow.ended_at });
    }
  }, [institutionId, passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadEpisode();
  }, [loadEpisode]);

  if (!isReady || membership.status !== "approved" || !user || !institutionId) {
    return null;
  }

  const isActive = episode && !episode.endedAt;
  const isEnded = episode && episode.endedAt;

  return (
    <>
    <main className="min-h-full bg-brand-off-white/40 px-4 py-4 pb-24 lg:pb-4">
      {/* Baseline audit, 26 Sept 2026 -- this was the single densest
          screen in the product with zero back-chevron matches anywhere
          in the respite track. Same component and aria-label as
          principal/passports/[passportId]/page.tsx's own header, back
          to the list this route is always reached from. */}
      <header className="flex items-center gap-3 pb-4">
        <Link
          href="/centre/children"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="flex-1 font-heading text-xl font-bold text-brand-prussian-blue">{childName ?? "Child"}</h1>
      </header>

      {episode && (
        <CentrePageContent className="mb-4">
          <div className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-3 shadow-sm">
            <p className="text-sm text-black/60">{isActive ? "Placement active" : "Placement ended"}</p>
            {isActive && (
              <button
                type="button"
                onClick={() => setIsEndOpen(true)}
                className="shrink-0 rounded-full bg-black/5 px-3 py-1.5 text-xs font-semibold text-brand-neutral-black"
              >
                End placement
              </button>
            )}
            {isEnded && (
              <button
                type="button"
                onClick={() => setIsReopenOpen(true)}
                className="shrink-0 rounded-full bg-brand-golden-brown px-3 py-1.5 text-xs font-semibold text-white"
              >
                Reopen placement
              </button>
            )}
          </div>
        </CentrePageContent>
      )}

      <RespiteChildRecord
        key={recordKey}
        passportId={passportId}
        institutionId={institutionId}
        currentUserId={user.id}
        viewerRole="centre_manager"
        onChildNameChange={setChildName}
      />

      {episode && (
        <EndPlacementSheet
          isOpen={isEndOpen}
          episodeId={episode.episodeId}
          institutionId={institutionId}
          childName={childName ?? "this child"}
          onClose={() => setIsEndOpen(false)}
          onEnded={() => {
            setIsEndOpen(false);
            setRecordKey((k) => k + 1);
            loadEpisode();
          }}
        />
      )}

      <ReopenPlacementSheet
        isOpen={isReopenOpen}
        institutionId={institutionId}
        passportId={passportId}
        childName={childName ?? "this child"}
        onClose={() => setIsReopenOpen(false)}
        onReopened={() => {
          setIsReopenOpen(false);
          setRecordKey((k) => k + 1);
          loadEpisode();
        }}
      />
    </main>
    <CentreBottomNav />
    </>
  );
}
