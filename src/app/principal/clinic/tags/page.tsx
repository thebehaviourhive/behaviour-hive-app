"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useInstitutionType } from "@/hooks/useInstitutionType";
import { createClient } from "@/lib/supabase/client";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";

// PRD 10 Stage 2 -- the tag catalog editor. A nested structure (N
// dimensions, each with M values, each independently renamable and
// retirable) is not a single BottomSheet the way clinic hours or the
// cancellation policy are -- its own sub-page, linked from a summary
// row on /principal/clinic, matching this schema's own "same shape,
// not same table" precedent for genuinely different settings.
//
// Same school-principal redirect guard as PrincipalClinicPage -- a
// school has no tags at all (institution_tags is clinic-configured,
// PRD 5's own words: "clinics configure their own"), and this route
// would otherwise happily render an empty, meaningless catalog editor
// for someone whose institution has no such thing.
//
// USAGE COUNTS: plain client queries, not a new RPC. Three queries
// total regardless of catalog size -- institution_tags (all rows),
// episode_tags filtered to those ids, clinical_lead_scope filtered to
// those ids -- both of the latter already have institution-wide SELECT
// policies (0213/0217), so nothing here needs SECURITY DEFINER. Not
// N+1: the count is computed client-side from two flat id-filtered
// selects, not one query per tag.

interface TagRow {
  id: string;
  dimension: string;
  value: string;
  is_active: boolean;
}

interface DimensionGroup {
  dimension: string;
  active: TagRow[];
  retired: TagRow[];
}

export default function ClinicTagsPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const { institutionType, isLoading: isInstitutionTypeLoading } = useInstitutionType(institutionId);

  useEffect(() => {
    if (!isInstitutionTypeLoading && institutionId && institutionType === "school") {
      router.replace("/principal/school");
    }
  }, [isInstitutionTypeLoading, institutionId, institutionType, router]);

  const [tags, setTags] = useState<TagRow[]>([]);
  const [usage, setUsage] = useState<Map<string, { episodes: number; leadScopes: number }>>(new Map());
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionError, setActionError] = useState<string | null>(null);

  const [renameValueTarget, setRenameValueTarget] = useState<TagRow | null>(null);
  const [renameValueText, setRenameValueText] = useState("");
  const [renameDimensionTarget, setRenameDimensionTarget] = useState<string | null>(null);
  const [renameDimensionText, setRenameDimensionText] = useState("");
  const [addValueDimension, setAddValueDimension] = useState<string | null>(null);
  const [addValueText, setAddValueText] = useState("");
  const [isAddDimensionOpen, setIsAddDimensionOpen] = useState(false);
  const [newDimensionName, setNewDimensionName] = useState("");
  const [newDimensionValue, setNewDimensionValue] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    setLoadError(null);
    const supabase = createClient();

    const { data: staffRow } = await supabase
      .from("institution_staff")
      .select("institution_id")
      .eq("user_id", user.id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();

    if (!staffRow) {
      setLoadError("Could not find your clinic.");
      setIsLoading(false);
      return;
    }
    setInstitutionId(staffRow.institution_id);

    const { data: tagRows, error: tagError } = await supabase
      .from("institution_tags")
      .select("id, dimension, value, is_active")
      .eq("institution_id", staffRow.institution_id)
      .order("dimension")
      .order("value");

    if (tagError) {
      setLoadError(tagError.message);
      setIsLoading(false);
      return;
    }

    const allTags = (tagRows ?? []) as TagRow[];
    setTags(allTags);

    const tagIds = allTags.map((t) => t.id);
    const usageMap = new Map<string, { episodes: number; leadScopes: number }>();
    for (const id of tagIds) usageMap.set(id, { episodes: 0, leadScopes: 0 });

    if (tagIds.length > 0) {
      const [episodeCounts, leadScopeCounts] = await Promise.all([
        supabase.from("episode_tags").select("institution_tag_id").in("institution_tag_id", tagIds),
        supabase.from("clinical_lead_scope").select("institution_tag_id").in("institution_tag_id", tagIds),
      ]);
      for (const row of episodeCounts.data ?? []) {
        const entry = usageMap.get(row.institution_tag_id);
        if (entry) entry.episodes += 1;
      }
      for (const row of leadScopeCounts.data ?? []) {
        const entry = usageMap.get(row.institution_tag_id);
        if (entry) entry.leadScopes += 1;
      }
    }
    setUsage(usageMap);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  const groups = useMemo<DimensionGroup[]>(() => {
    const byDimension = new Map<string, DimensionGroup>();
    for (const tag of tags) {
      if (!byDimension.has(tag.dimension)) {
        byDimension.set(tag.dimension, { dimension: tag.dimension, active: [], retired: [] });
      }
      const group = byDimension.get(tag.dimension)!;
      if (tag.is_active) group.active.push(tag);
      else group.retired.push(tag);
    }
    return Array.from(byDimension.values()).sort((a, b) => a.dimension.localeCompare(b.dimension));
  }, [tags]);

  function usageLabel(tagId: string): string {
    const entry = usage.get(tagId);
    if (!entry) return "";
    const parts: string[] = [];
    if (entry.episodes > 0) parts.push(`${entry.episodes} client${entry.episodes === 1 ? "" : "s"}`);
    if (entry.leadScopes > 0) parts.push(`${entry.leadScopes} lead scope${entry.leadScopes === 1 ? "" : "s"}`);
    return parts.length > 0 ? parts.join(" · ") : "Not in use";
  }

  async function handleRenameValue() {
    if (!renameValueTarget) return;
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("rename_institution_tag_value", {
      p_tag_id: renameValueTarget.id,
      p_new_value: renameValueText,
    });
    setIsSaving(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setRenameValueTarget(null);
    await load();
  }

  async function handleRenameDimension() {
    if (!renameDimensionTarget || !institutionId) return;
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("rename_institution_tag_dimension", {
      p_institution_id: institutionId,
      p_old_dimension: renameDimensionTarget,
      p_new_dimension: renameDimensionText,
    });
    setIsSaving(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    setRenameDimensionTarget(null);
    await load();
  }

  async function handleSetActive(tag: TagRow, isActive: boolean) {
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.rpc("set_institution_tag_active", {
      p_tag_id: tag.id,
      p_is_active: isActive,
    });
    setIsSaving(false);
    if (error) {
      setActionError(error.message);
      return;
    }
    await load();
  }

  async function handleAddValue() {
    if (!addValueDimension || !institutionId || !addValueText.trim()) return;
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.from("institution_tags").insert({
      institution_id: institutionId,
      dimension: addValueDimension,
      value: addValueText.trim(),
    });
    setIsSaving(false);
    if (error) {
      setActionError(
        error.message.includes("duplicate key")
          ? "That value already exists under this dimension -- it may be retired. Check below before adding it again."
          : error.message
      );
      return;
    }
    setAddValueDimension(null);
    setAddValueText("");
    await load();
  }

  async function handleAddDimension() {
    if (!institutionId || !newDimensionName.trim() || !newDimensionValue.trim()) return;
    setIsSaving(true);
    setActionError(null);
    const supabase = createClient();
    const { error } = await supabase.from("institution_tags").insert({
      institution_id: institutionId,
      dimension: newDimensionName.trim(),
      value: newDimensionValue.trim(),
    });
    setIsSaving(false);
    if (error) {
      setActionError(
        error.message.includes("duplicate key")
          ? "That dimension and value already exist."
          : error.message
      );
      return;
    }
    setIsAddDimensionOpen(false);
    setNewDimensionName("");
    setNewDimensionValue("");
    await load();
  }

  if (!isReady) {
    return null;
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
        <Link
          href="/principal/clinic"
          aria-label="Back"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </Link>
        <h1 className="font-heading text-xl font-bold text-brand-prussian-blue">Tags</h1>
      </header>

      <main className="flex-1 px-4">
        <div className="lg:max-w-[66.6667%]">
          <p className="text-sm text-brand-neutral-black/70">
            The dimensions and values your clinic tags clients with -- funding, location, service, whatever your
            clinic actually uses. A client can carry more than one value per dimension.
          </p>

          {isLoading ? (
            <div className="mt-4 flex flex-col gap-2">
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
              <div className="h-[80px] animate-pulse rounded-2xl bg-white" />
            </div>
          ) : loadError ? (
            <p className="mt-4 text-sm text-brand-neutral-black/60">{loadError}</p>
          ) : (
            <>
              {actionError && (
                <p role="alert" className="mt-4 rounded-xl bg-brand-golden-brown/10 p-3 text-sm font-medium text-brand-golden-brown">
                  {actionError}
                </p>
              )}

              <button
                type="button"
                onClick={() => setIsAddDimensionOpen(true)}
                className="mt-4 block w-full lg:w-auto rounded-2xl border border-dashed border-brand-prussian-blue/40 px-4 py-3 text-center text-sm font-semibold text-brand-prussian-blue"
              >
                + New Dimension
              </button>

              {groups.length === 0 && (
                <p className="mt-4 text-sm text-brand-neutral-black/50">
                  No tags yet. Add a dimension to get started -- e.g. &ldquo;Funding&rdquo; with Private, Tusla, HSE.
                </p>
              )}

              {groups.map((group) => (
                <section key={group.dimension} className="mt-8">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
                      {group.dimension}
                    </h2>
                    <button
                      type="button"
                      onClick={() => {
                        setRenameDimensionTarget(group.dimension);
                        setRenameDimensionText(group.dimension);
                      }}
                      className="text-xs font-semibold text-brand-prussian-blue"
                    >
                      Rename dimension
                    </button>
                  </div>

                  <div className="mt-2 flex flex-col gap-2">
                    {group.active.map((tag) => (
                      <div
                        key={tag.id}
                        className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
                      >
                        <div>
                          <p className="font-sans text-body font-semibold text-brand-neutral-black">{tag.value}</p>
                          <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/50">{usageLabel(tag.id)}</p>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-3">
                          <button
                            type="button"
                            onClick={() => {
                              setRenameValueTarget(tag);
                              setRenameValueText(tag.value);
                            }}
                            className="text-xs font-semibold text-brand-prussian-blue"
                          >
                            Rename
                          </button>
                          <button
                            type="button"
                            onClick={() => handleSetActive(tag, false)}
                            disabled={isSaving}
                            className="text-xs font-semibold text-brand-neutral-black/50"
                          >
                            Retire
                          </button>
                        </div>
                      </div>
                    ))}

                    <button
                      type="button"
                      onClick={() => setAddValueDimension(group.dimension)}
                      className="rounded-2xl border border-dashed border-black/10 px-4 py-2.5 text-left text-sm font-semibold text-brand-prussian-blue"
                    >
                      + Add value
                    </button>
                  </div>

                  {group.retired.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      <p className="font-accent text-eyebrow font-semibold uppercase tracking-wide text-brand-neutral-black/40">
                        Retired ({group.retired.length})
                      </p>
                      {group.retired.map((tag) => (
                        <div
                          key={tag.id}
                          className="flex items-center justify-between gap-3 rounded-2xl border border-black/5 bg-black/[0.02] p-4"
                        >
                          <div>
                            <p className="font-sans text-body font-medium text-brand-neutral-black/50 line-through">
                              {tag.value}
                            </p>
                            <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/40">{usageLabel(tag.id)}</p>
                          </div>
                          <button
                            type="button"
                            onClick={() => handleSetActive(tag, true)}
                            disabled={isSaving}
                            className="flex-shrink-0 text-xs font-semibold text-brand-prussian-blue"
                          >
                            Restore
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              ))}
            </>
          )}
        </div>
      </main>

      <BottomSheet isOpen={isAddDimensionOpen} onClose={() => !isSaving && setIsAddDimensionOpen(false)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">New Dimension</h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          A dimension needs at least one value to exist -- e.g. &ldquo;Funding&rdquo; with its first value,
          &ldquo;Tusla&rdquo;.
        </p>
        <div className="mt-4 flex flex-col gap-3">
          <TextField label="Dimension name" value={newDimensionName} onChange={(e) => setNewDimensionName(e.target.value)} />
          <TextField label="First value" value={newDimensionValue} onChange={(e) => setNewDimensionValue(e.target.value)} />
        </div>
        <Button
          type="button"
          onClick={handleAddDimension}
          disabled={isSaving || !newDimensionName.trim() || !newDimensionValue.trim()}
          className="mt-4"
        >
          {isSaving ? "Adding…" : "Add"}
        </Button>
      </BottomSheet>

      <BottomSheet isOpen={addValueDimension !== null} onClose={() => !isSaving && setAddValueDimension(null)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Add a value under &ldquo;{addValueDimension}&rdquo;
        </h2>
        <div className="mt-4">
          <TextField label="Value" value={addValueText} onChange={(e) => setAddValueText(e.target.value)} />
        </div>
        <Button type="button" onClick={handleAddValue} disabled={isSaving || !addValueText.trim()} className="mt-4">
          {isSaving ? "Adding…" : "Add"}
        </Button>
      </BottomSheet>

      <BottomSheet isOpen={renameValueTarget !== null} onClose={() => !isSaving && setRenameValueTarget(null)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Rename &ldquo;{renameValueTarget?.value}&rdquo;
        </h2>
        <div className="mt-4">
          <TextField label="New value" value={renameValueText} onChange={(e) => setRenameValueText(e.target.value)} />
        </div>
        <Button type="button" onClick={handleRenameValue} disabled={isSaving || !renameValueText.trim()} className="mt-4">
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </BottomSheet>

      <BottomSheet isOpen={renameDimensionTarget !== null} onClose={() => !isSaving && setRenameDimensionTarget(null)}>
        <h2 className="font-heading text-lg font-semibold text-brand-neutral-black">
          Rename &ldquo;{renameDimensionTarget}&rdquo;
        </h2>
        <p className="mt-2 text-sm text-brand-neutral-black/70">
          Renames every value under this dimension -- every tagged client and every lead&apos;s scope follows
          automatically.
        </p>
        <div className="mt-4">
          <TextField label="New dimension name" value={renameDimensionText} onChange={(e) => setRenameDimensionText(e.target.value)} />
        </div>
        <Button
          type="button"
          onClick={handleRenameDimension}
          disabled={isSaving || !renameDimensionText.trim()}
          className="mt-4"
        >
          {isSaving ? "Saving…" : "Save"}
        </Button>
      </BottomSheet>
    </div>
  );
}
