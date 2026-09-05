"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { CreateClassSheet } from "@/components/principal/CreateClassSheet";
import { PlusIcon } from "@/components/ui/icons";

// PRD 4, Stage 4 -- extracted from principal/classes/page.tsx. Below lg,
// each row is a real Link to /principal/classes/[classId] -- exactly
// today's push-to-detail navigation, unchanged. At lg+, the same click
// is intercepted (preventDefault) and calls onSelect instead, so the
// split view's right pane fills in without leaving this page -- one
// row, two behaviours, chosen at click time by matching Tailwind's own
// lg breakpoint (1024px), not a persistent resize listener.
//
// Layout/interaction redesign, Sep 2026 -- two changes, both matching
// ClassDetail.tsx's own redesign pass:
// 1. Each card now shows teacher names, class SNA status, and cover-
//    today, not just bare counts -- so the shape of a class reads
//    before opening it. Needs get_institution_classes_roster() widened
//    (0175) with teacher_names/class_sna_names/children_with_1to1/
//    cover_today_names; falls back to the old count-only line via `??`
//    if an older deployed function is ever hit (it shouldn't be, once
//    0175 is run, but costs nothing to guard).
// 2. The unlabeled circular "+" button is now a labeled "+ New class"
//    pill, matching the add-row wording pattern this same pass
//    introduced on the detail side.
export function ClassesList({
  institutionId,
  selectedClassId,
  onSelect,
  refreshToken,
}: {
  institutionId: string | null;
  selectedClassId: string | null;
  onSelect: (classId: string) => void;
  refreshToken: number;
}) {
  const [classes, setClasses] = useState<
    {
      id: string;
      name: string;
      teacherCount: number;
      childCount: number;
      teacherNames: string | null;
      classSnaNames: string | null;
      childrenWith1to1: number;
      coverTodayNames: string | null;
      isEnriched: boolean;
    }[]
  >([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);

  const load = useCallback(async (instId: string) => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();
    const { data: classRows, error: classErr } = await supabase.rpc("get_institution_classes_roster", {
      p_institution_id: instId,
    });
    if (classErr) {
      setError("Could not load classes.");
      setIsLoading(false);
      return;
    }
    setClasses(
      (
        (classRows ?? []) as {
          class_id: string;
          name: string;
          teacher_count: number;
          child_count: number;
          teacher_names?: string | null;
          class_sna_names?: string | null;
          children_with_1to1?: number | null;
          cover_today_names?: string | null;
        }[]
      ).map((c) => ({
        id: c.class_id,
        name: c.name,
        teacherCount: c.teacher_count,
        childCount: c.child_count,
        // Optional chaining/`?? null`: the enriched columns only exist
        // once migration 0175 has run. Until then this falls back to
        // the old count-only card rather than showing "undefined".
        teacherNames: c.teacher_names ?? null,
        classSnaNames: c.class_sna_names ?? null,
        childrenWith1to1: c.children_with_1to1 ?? 0,
        coverTodayNames: c.cover_today_names ?? null,
        isEnriched: "teacher_names" in c,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!institutionId) return;
    async function run() {
      await load(institutionId!);
    }
    run();
  }, [institutionId, load]);

  useEffect(() => {
    if (!institutionId || refreshToken === 0) return;
    async function run() {
      await load(institutionId!);
    }
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  return (
    <>
      <div className="mb-4 flex items-center justify-between">
        <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/50">
          {classes.length} class{classes.length === 1 ? "" : "es"}
        </p>
        {institutionId && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            className="flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-full bg-brand-prussian-blue py-2 pl-3 pr-4 text-xs font-semibold text-white shadow-sm"
          >
            <PlusIcon className="h-[15px] w-[15px]" />
            New class
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="flex flex-col gap-2">
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
          <div className="h-16 animate-pulse rounded-2xl bg-white" />
        </div>
      ) : error ? (
        <p className="font-sans text-body text-brand-neutral-black/60">{error}</p>
      ) : classes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center font-sans text-body text-brand-neutral-black/60">
          No classes yet.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {classes.map((c) => (
            <Link
              key={c.id}
              href={`/principal/classes/${c.id}`}
              onClick={(e) => {
                if (window.matchMedia("(min-width: 1024px)").matches) {
                  e.preventDefault();
                  onSelect(c.id);
                }
              }}
              className={`block rounded-2xl border p-4 shadow-sm ${
                c.id === selectedClassId ? "border-brand-prussian-blue bg-brand-pastel-blue/10" : "border-black/5 bg-white"
              }`}
            >
              <p className="font-heading text-h2 font-semibold text-brand-prussian-blue lg:text-body lg:font-semibold lg:text-brand-neutral-black">
                {c.name}
              </p>
              {c.isEnriched ? (
                <div className="mt-0.5 flex flex-col gap-0.5 font-sans text-body text-brand-neutral-black/60 lg:text-eyebrow">
                  <p>
                    {c.teacherNames ?? "No teacher assigned yet"} · {c.childCount} child
                    {c.childCount === 1 ? "" : "ren"}
                    {c.childrenWith1to1 > 0 ? `, ${c.childrenWith1to1} with a 1:1` : ""}
                  </p>
                  <p>{c.classSnaNames ? `Class SNA: ${c.classSnaNames}` : "Class SNA: not assigned"}</p>
                  {c.coverTodayNames && <p>Cover today: {c.coverTodayNames}</p>}
                </div>
              ) : (
                // Falls back to the old count-only line until migration
                // 0175 has run and the enriched columns exist.
                <p className="mt-0.5 font-sans text-body text-brand-neutral-black/50 lg:text-eyebrow">
                  {c.teacherCount} teacher{c.teacherCount === 1 ? "" : "s"} · {c.childCount} child
                  {c.childCount === 1 ? "" : "ren"}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {institutionId && (
        <CreateClassSheet
          isOpen={isCreateOpen}
          institutionId={institutionId}
          onClose={() => setIsCreateOpen(false)}
          onCreated={() => {
            setIsCreateOpen(false);
            load(institutionId);
          }}
        />
      )}
    </>
  );
}
