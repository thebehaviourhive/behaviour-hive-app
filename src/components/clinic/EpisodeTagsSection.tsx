"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";

// PRD 10 Stage 3, "one shared component, not three implementations" --
// current tags plus the right action for whoever's looking, mounted
// unchanged in ChildDetail (director, principal-track), ClinicalFileDetail
// (director-as-practitioner or a plain practitioner, clinician-track),
// and the admin's own new client record view. Self-contained: takes only
// a passportId, resolves its own current episode, caller role, tags,
// and most recent request -- every host screen already has passportId in
// scope, and this deliberately does NOT trust a host screen's own
// already-resolved institutionId/episode, so it behaves identically
// wherever it's mounted.
//
// Renders nothing at all for a passport with no episodes_of_care row --
// a school-engaged client, or a passport a non-staff caller (e.g. an
// independent, parent-engaged clinician) has no institution relationship
// to. episodes_of_care's own SELECT policy (institution_staff_has_
// current_standing) already makes this the correct, structural result of
// the query itself, not a separate check this component has to add.
//
// THE ACTION BRANCHES ON WHO'S LOOKING, PER SECTION 4'S OWN DECISION
// ("a director changing a tag themselves raises no request"):
//  - principal (director): ALWAYS direct edit, via set_episode_tags() --
//    regardless of which of their own screens they're standing on, since
//    this is about their own institution_staff.role, not the host screen.
//  - clinic_admin, while the episode is still genuinely untagged (the
//    one-shot window, 0214): also direct edit, via set_episode_tags() --
//    matching the add-client flow's own onboarding-time path exactly.
//  - everyone else who can reach this at all (a practitioner, a
//    clinic_admin once the window has closed) -- raise_tag_change_
//    request(), never a direct write.
// A discharged (ended_at is not null) episode is read-only, no action at
// all -- raise_tag_change_request() itself refuses an ended episode, so
// this mirrors that refusal in the UI rather than offering an action
// that would only fail.
//
// THE INLINE STATUS, per Daniel's own "both options" decision: the most
// recent request for this episode (any status) is read directly here --
// tag_change_requests' own SELECT policy is already institution-wide
// (0218), and this component already knows the child's own name from
// wherever it's mounted, so there's no need to resolve it through a
// second path the way the cross-passport "My Requests" tile does.

interface EpisodeRow {
  id: string;
  institutionId: string;
  endedAt: string | null;
}

interface TagOption {
  id: string;
  dimension: string;
  value: string;
}

interface RequestRow {
  id: string;
  status: "pending" | "approved" | "declined";
  proposedTags: { dimension: string; value: string }[];
  reason: string;
  declineReason: string | null;
  decidedAt: string | null;
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });
}

export function EpisodeTagsSection({ passportId }: { passportId: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [episode, setEpisode] = useState<EpisodeRow | null>(null);
  const [callerRole, setCallerRole] = useState<string | null>(null);
  const [currentTags, setCurrentTags] = useState<TagOption[]>([]);
  const [mostRecentRequest, setMostRecentRequest] = useState<RequestRow | null>(null);

  const [isSheetOpen, setIsSheetOpen] = useState(false);
  const [catalog, setCatalog] = useState<TagOption[]>([]);
  const [isLoadingCatalog, setIsLoadingCatalog] = useState(false);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());
  const [reasonText, setReasonText] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setIsLoading(true);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setIsLoading(false);
      return;
    }

    const { data: episodeRow } = await supabase
      .from("episodes_of_care")
      .select("id, institution_id, ended_at")
      .eq("passport_id", passportId)
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!episodeRow) {
      setEpisode(null);
      setIsLoading(false);
      return;
    }

    const resolvedEpisode: EpisodeRow = {
      id: episodeRow.id,
      institutionId: episodeRow.institution_id,
      endedAt: episodeRow.ended_at,
    };
    setEpisode(resolvedEpisode);

    const [staffResult, tagsResult, requestResult] = await Promise.all([
      supabase
        .from("institution_staff")
        .select("role")
        .eq("institution_id", resolvedEpisode.institutionId)
        .eq("user_id", user.id)
        .is("deactivated_at", null)
        .not("approved_at", "is", null)
        .maybeSingle(),
      supabase
        .from("episode_tags")
        .select("institution_tag_id, institution_tags(id, dimension, value)")
        .eq("episode_id", resolvedEpisode.id),
      supabase
        .from("tag_change_requests")
        .select("id, status, proposed_tags, reason, decline_reason, decided_at")
        .eq("episode_id", resolvedEpisode.id)
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    setCallerRole(staffResult.data?.role ?? null);

    const tagRows = (tagsResult.data ?? []) as Array<{
      institution_tags: TagOption | TagOption[] | null;
    }>;
    setCurrentTags(
      tagRows
        .map((row) => (Array.isArray(row.institution_tags) ? row.institution_tags[0] : row.institution_tags))
        .filter((t): t is TagOption => Boolean(t))
    );

    if (requestResult.data) {
      setMostRecentRequest({
        id: requestResult.data.id,
        status: requestResult.data.status,
        proposedTags: requestResult.data.proposed_tags,
        reason: requestResult.data.reason,
        declineReason: requestResult.data.decline_reason,
        decidedAt: requestResult.data.decided_at,
      });
    } else {
      setMostRecentRequest(null);
    }

    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function openSheet() {
    setError(null);
    setReasonText("");
    setSelectedTagIds(new Set(currentTags.map((t) => t.id)));
    setIsSheetOpen(true);
    if (episode && catalog.length === 0) {
      setIsLoadingCatalog(true);
      const supabase = createClient();
      const { data } = await supabase
        .from("institution_tags")
        .select("id, dimension, value")
        .eq("institution_id", episode.institutionId)
        .eq("is_active", true)
        .order("dimension")
        .order("value");
      setCatalog((data ?? []) as TagOption[]);
      setIsLoadingCatalog(false);
    }
  }

  function toggleTag(tagId: string) {
    setSelectedTagIds((current) => {
      const next = new Set(current);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const isDirect = callerRole === "principal" || (callerRole === "clinic_admin" && currentTags.length === 0);

  async function handleDirectSave() {
    if (!episode) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const tags = Array.from(selectedTagIds)
      .map((id) => catalog.find((t) => t.id === id))
      .filter((t): t is TagOption => Boolean(t))
      .map((t) => ({ dimension: t.dimension, value: t.value }));
    const { error: rpcError } = await supabase.rpc("set_episode_tags", { p_episode_id: episode.id, p_tags: tags });
    setIsSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setIsSheetOpen(false);
    await load();
  }

  async function handleRaiseRequest() {
    if (!episode || !reasonText.trim()) return;
    setIsSaving(true);
    setError(null);
    const supabase = createClient();
    const tags = Array.from(selectedTagIds)
      .map((id) => catalog.find((t) => t.id === id))
      .filter((t): t is TagOption => Boolean(t))
      .map((t) => ({ dimension: t.dimension, value: t.value }));
    const { error: rpcError } = await supabase.rpc("raise_tag_change_request", {
      p_episode_id: episode.id,
      p_proposed_tags: tags,
      p_reason: reasonText.trim(),
    });
    setIsSaving(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setIsSheetOpen(false);
    await load();
  }

  if (isLoading || !episode) {
    return null;
  }

  const isActive = episode.endedAt === null;
  const hasPendingRequest = mostRecentRequest?.status === "pending";
  const tagsByDimension = Array.from(
    catalog.reduce((map, tag) => {
      if (!map.has(tag.dimension)) map.set(tag.dimension, []);
      map.get(tag.dimension)!.push(tag);
      return map;
    }, new Map<string, TagOption[]>())
  );

  return (
    <section className="mb-6">
      <h2 className="mb-2 font-heading text-sm font-bold uppercase tracking-wide text-brand-neutral-black/60">Tags</h2>

      {currentTags.length === 0 ? (
        <p className="text-sm text-brand-neutral-black/50">No tags on this episode.</p>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {currentTags.map((tag) => (
            <span
              key={tag.id}
              className="rounded-full bg-brand-pastel-blue/20 px-3 py-1 text-xs font-semibold text-brand-prussian-blue"
            >
              {tag.dimension}: {tag.value}
            </span>
          ))}
        </div>
      )}

      {!isActive ? (
        <p className="mt-2 text-xs text-brand-neutral-black/50">This episode has ended — tags are historical.</p>
      ) : callerRole === null ? null : (
        <>
          {/* A director's own direct-edit action is ALWAYS available,
              unconditional on any other request's own state -- "a
              director changing a tag themselves raises no request"
              (section 4) is not qualified by whether someone else's
              request happens to be pending. Only a REQUEST-mode caller
              (practitioner, lead, or an admin once the one-shot window
              has closed) is held to the pending card below, since
              raising a second, conflicting proposal while one is
              already awaiting review would just create confusion the
              director would have to sort out anyway. */}
          {isDirect ? (
            <>
              <button
                type="button"
                onClick={openSheet}
                className="mt-2 text-xs font-semibold text-brand-prussian-blue"
              >
                Edit Tags
              </button>
              {hasPendingRequest && (
                <p className="mt-2 text-xs text-brand-golden-brown">
                  A change request from {mostRecentRequest!.reason ? `"${mostRecentRequest!.reason}"` : "a colleague"} is
                  pending review.
                </p>
              )}
            </>
          ) : hasPendingRequest ? (
            <div className="mt-3 rounded-2xl border border-dashed border-brand-golden-brown/40 bg-brand-safe-ivory/30 p-3">
              <p className="text-xs font-semibold text-brand-golden-brown">Pending director review</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5">
                {mostRecentRequest!.proposedTags.map((t, i) => (
                  <span key={i} className="rounded-full bg-white px-2.5 py-0.5 text-xs text-brand-neutral-black/70">
                    {t.dimension}: {t.value}
                  </span>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-brand-neutral-black/60">{mostRecentRequest!.reason}</p>
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={openSheet}
                className="mt-2 text-xs font-semibold text-brand-prussian-blue"
              >
                Request a Change
              </button>

              {mostRecentRequest && mostRecentRequest.status !== "pending" && (
                <p className="mt-2 text-xs text-brand-neutral-black/50">
                  Last request {mostRecentRequest.status}
                  {mostRecentRequest.status === "declined" && mostRecentRequest.declineReason
                    ? ` — ${mostRecentRequest.declineReason}`
                    : ""}
                  {mostRecentRequest.decidedAt ? ` · ${formatDate(mostRecentRequest.decidedAt)}` : ""}
                </p>
              )}
            </>
          )}
        </>
      )}

      <BottomSheet isOpen={isSheetOpen} onClose={() => !isSaving && setIsSheetOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          {isDirect ? "Edit Tags" : "Request a Tag Change"}
        </h2>
        {!isDirect && (
          <p className="mt-2 text-sm text-brand-neutral-black/70">
            A clinical director reviews this before it takes effect.
          </p>
        )}

        {isLoadingCatalog ? (
          <div className="mt-4 h-[60px] animate-pulse rounded-xl bg-black/5" />
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {tagsByDimension.map(([dimension, options]) => (
              <div key={dimension}>
                <p className="mb-1.5 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
                  {dimension}
                </p>
                <div className="flex flex-wrap gap-2">
                  {options.map((tag) => {
                    const isSelected = selectedTagIds.has(tag.id);
                    return (
                      <button
                        key={tag.id}
                        type="button"
                        onClick={() => toggleTag(tag.id)}
                        aria-pressed={isSelected}
                        className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors ${
                          isSelected
                            ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                            : "border-black/10 bg-white text-brand-neutral-black"
                        }`}
                      >
                        {tag.value}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {!isDirect && (
          <div className="mt-4">
            <Textarea
              label="Reason"
              id="tag-change-reason"
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Why is this change needed?"
            />
          </div>
        )}

        {error && (
          <p role="alert" className="mt-3 text-sm font-medium text-brand-golden-brown">
            {error}
          </p>
        )}

        <Button
          type="button"
          onClick={isDirect ? handleDirectSave : handleRaiseRequest}
          disabled={isSaving || (!isDirect && !reasonText.trim())}
          className="mt-4"
        >
          {isSaving ? "Saving…" : isDirect ? "Save" : "Submit Request"}
        </Button>
      </BottomSheet>
    </section>
  );
}
