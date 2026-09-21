"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { Checkbox } from "@/components/ui/Checkbox";

// PRD 10 Stage 4, section 5.5 -- the lead scope editor. Daniel's own
// instruction: "AND across dimensions is genuinely counter-intuitive
// -- a director selecting Tusla and Carlow means Tusla clients IN
// Carlow, not every Tusla client plus every Carlow client. A screen
// that hides that produces leads overseeing the wrong children... it
// should show the director, as they build the scope, the actual
// clients it currently covers. That live result is the clearest
// possible explanation." This page is exactly that: checkboxes grouped
// by dimension (OR within one, visible AND dividers between dimensions
// that have a selection), a plain-English sentence built from the
// current selection, and a live client list computed CLIENT-SIDE
// against every active episode's own tags -- zero network round-trips
// per checkbox toggle.
//
// BUILT, THEN STOPPED BEFORE WIRING THE SAVE, per Daniel's own
// explicit instruction ("send screenshots to Daniel, he approves
// before the save is wired and deployed"). The Save button below is
// disabled and says so -- everything else on this screen is real and
// live against real data (institution_tags, episode_tags,
// clinical_lead_scope's own current state), only the write path is
// held back.
//
// THE MATCH LOGIC IS A DELIBERATE, LINE-FOR-LINE PORT of
// _lead_episode_in_scope() (0226's own live SQL) -- see
// isEpisodeInScope() below. This is the single most important claim
// on this page (Daniel: "a preview that is silently wrong is worse
// than none, because a director would trust it") and is proven to
// match the real RPC (get_institution_episode_roster_for_lead) with a
// dedicated script before this ships, not assumed from reading the SQL
// once.

interface TagOption {
  id: string;
  dimension: string;
  value: string;
}

interface EpisodeRow {
  episodeId: string;
  childName: string;
  tagIds: Set<string>;
}

// A line-for-line port of _lead_episode_in_scope() (migration 0226):
// lead_dims = every DISTINCT dimension the selection touches at all;
// matched_dims = the subset of those dimensions where this episode
// carries one of the SPECIFIC selected tag ids. In scope iff there's
// at least one selected dimension AND every one of them matched --
// AND across dimensions, OR within one (any single matching value in
// a dimension satisfies that dimension).
export function isEpisodeInScope(selectedTagIds: Set<string>, episodeTagIds: Set<string>, tagDimensionById: Map<string, string>): boolean {
  const leadDims = new Set<string>();
  for (const tagId of selectedTagIds) {
    const dim = tagDimensionById.get(tagId);
    if (dim) leadDims.add(dim);
  }
  if (leadDims.size === 0) return false;

  const matchedDims = new Set<string>();
  for (const tagId of selectedTagIds) {
    if (episodeTagIds.has(tagId)) {
      const dim = tagDimensionById.get(tagId);
      if (dim) matchedDims.add(dim);
    }
  }
  return matchedDims.size === leadDims.size;
}

export default function LeadScopePage() {
  const { isReady } = useRequireRole("principal");
  const params = useParams();
  const staffId = params.staffId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [leadName, setLeadName] = useState<string | null>(null);
  const [tagsByDimension, setTagsByDimension] = useState<Map<string, TagOption[]>>(new Map());
  const [tagDimensionById, setTagDimensionById] = useState<Map<string, string>>(new Map());
  const [episodes, setEpisodes] = useState<EpisodeRow[]>([]);
  const [selectedTagIds, setSelectedTagIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!isReady || !staffId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      setIsLoading(true);
      setError(null);

      const { data: leadRow, error: leadError } = await supabase
        .from("institution_staff")
        .select("institution_id, full_name, role")
        .eq("id", staffId)
        .eq("role", "clinical_lead")
        .maybeSingle();

      if (!isMounted) return;
      if (leadError || !leadRow) {
        setError("Could not find this clinical lead.");
        setIsLoading(false);
        return;
      }
      setLeadName(leadRow.full_name);

      const [tagsResult, scopeResult, episodesResult] = await Promise.all([
        supabase
          .from("institution_tags")
          .select("id, dimension, value")
          .eq("institution_id", leadRow.institution_id)
          .eq("is_active", true)
          .order("dimension")
          .order("value"),
        supabase.from("clinical_lead_scope").select("institution_tag_id").eq("institution_staff_id", staffId),
        supabase.rpc("get_institution_episode_roster", { p_institution_id: leadRow.institution_id, p_include_ended: false }),
      ]);

      if (!isMounted) return;

      const tagRows = (tagsResult.data ?? []) as TagOption[];
      const byDim = new Map<string, TagOption[]>();
      const dimById = new Map<string, string>();
      for (const t of tagRows) {
        dimById.set(t.id, t.dimension);
        const list = byDim.get(t.dimension) ?? [];
        list.push(t);
        byDim.set(t.dimension, list);
      }
      setTagsByDimension(byDim);
      setTagDimensionById(dimById);

      const scopeRows = (scopeResult.data ?? []) as { institution_tag_id: string }[];
      setSelectedTagIds(new Set(scopeRows.map((r) => r.institution_tag_id)));

      const episodeRows = (episodesResult.data ?? []) as { episode_id: string; child_name: string }[];
      const episodeIds = episodeRows.map((r) => r.episode_id);
      const tagsByEpisode = new Map<string, Set<string>>();
      if (episodeIds.length > 0) {
        const { data: episodeTagRows } = await supabase
          .from("episode_tags")
          .select("episode_id, institution_tag_id")
          .in("episode_id", episodeIds);
        for (const row of (episodeTagRows ?? []) as { episode_id: string; institution_tag_id: string }[]) {
          const set = tagsByEpisode.get(row.episode_id) ?? new Set<string>();
          set.add(row.institution_tag_id);
          tagsByEpisode.set(row.episode_id, set);
        }
      }
      if (!isMounted) return;
      setEpisodes(
        episodeRows.map((r) => ({
          episodeId: r.episode_id,
          childName: r.child_name,
          tagIds: tagsByEpisode.get(r.episode_id) ?? new Set<string>(),
        }))
      );

      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [isReady, staffId]);

  function toggleTag(tagId: string) {
    setSelectedTagIds((prev) => {
      const next = new Set(prev);
      if (next.has(tagId)) next.delete(tagId);
      else next.add(tagId);
      return next;
    });
  }

  const dimensionsWithSelection = useMemo(() => {
    const result: { dimension: string; values: string[] }[] = [];
    for (const [dimension, tags] of tagsByDimension) {
      const selected = tags.filter((t) => selectedTagIds.has(t.id)).map((t) => t.value);
      if (selected.length > 0) result.push({ dimension, values: selected });
    }
    return result;
  }, [tagsByDimension, selectedTagIds]);

  const scopeSentence = useMemo(() => {
    if (dimensionsWithSelection.length === 0) {
      return "No scope selected yet -- this lead won't oversee any clients until at least one tag is chosen.";
    }
    return dimensionsWithSelection.map((d) => `${d.dimension}: ${d.values.join(" OR ")}`).join(" AND ");
  }, [dimensionsWithSelection]);

  const inScopeEpisodes = useMemo(
    () => episodes.filter((e) => isEpisodeInScope(selectedTagIds, e.tagIds, tagDimensionById)),
    [episodes, selectedTagIds, tagDimensionById]
  );

  if (!isReady || isLoading) {
    return null;
  }

  if (error) {
    return (
      <div className="flex min-h-full flex-1 items-center justify-center px-6 text-center">
        <p className="text-sm text-brand-neutral-black/60">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/directory?segment=staff"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <div className="flex-1">
          <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Manage Scope</h1>
          <p className="text-sm text-brand-neutral-black/60">{leadName}</p>
        </div>
      </header>

      <main className="flex-1 px-4 lg:max-w-[66.6667%]">
        {tagsByDimension.size === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            This clinic has no tags set up yet -- nothing to scope a lead to. Add tags first, from the Clinic page.
          </p>
        ) : (
          <div className="flex flex-col gap-1">
            {[...tagsByDimension.entries()].map(([dimension, tags], index) => {
              const hasSelectionInThisDim = tags.some((t) => selectedTagIds.has(t.id));
              const isFirstPopulatedAfterAnother =
                index > 0 &&
                hasSelectionInThisDim &&
                [...tagsByDimension.entries()].slice(0, index).some(([, prevTags]) => prevTags.some((t) => selectedTagIds.has(t.id)));

              return (
                <div key={dimension}>
                  {isFirstPopulatedAfterAnother && (
                    <div className="my-3 flex items-center gap-3">
                      <div className="h-px flex-1 bg-brand-prussian-blue/20" />
                      <span className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                        AND
                      </span>
                      <div className="h-px flex-1 bg-brand-prussian-blue/20" />
                    </div>
                  )}
                  <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
                    <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                      {dimension}
                    </p>
                    <div className="flex flex-col gap-2">
                      {tags.map((tag) => (
                        <Checkbox
                          key={tag.id}
                          id={`tag-${tag.id}`}
                          checked={selectedTagIds.has(tag.id)}
                          onChange={() => toggleTag(tag.id)}
                          label={tag.value}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <section className="mt-6 rounded-2xl border border-brand-prussian-blue/20 bg-brand-pastel-blue/20 p-4">
          <p className="mb-1 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
            This lead will oversee
          </p>
          <p className="text-sm text-brand-neutral-black">{scopeSentence}</p>
        </section>

        <section className="mt-6">
          <p className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
            Currently covers {inScopeEpisodes.length} {inScopeEpisodes.length === 1 ? "client" : "clients"}
          </p>
          {inScopeEpisodes.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
              {dimensionsWithSelection.length === 0
                ? "Select at least one tag above to see which clients this covers."
                : "No current client matches this selection."}
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {inScopeEpisodes.map((e) => (
                <div key={e.episodeId} className="rounded-xl border border-black/5 bg-white px-3 py-2 text-sm text-brand-neutral-black">
                  {e.childName}
                </div>
              ))}
            </div>
          )}
        </section>

        <button
          type="button"
          disabled
          title="Not wired yet -- design review first"
          className="mt-8 block w-full cursor-not-allowed rounded-2xl bg-brand-prussian-blue/30 py-3 text-center font-sans text-body font-semibold text-white"
        >
          Save (not yet enabled)
        </button>
      </main>
    </div>
  );
}
