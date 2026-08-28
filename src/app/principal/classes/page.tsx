"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { CreateClassSheet } from "@/components/principal/CreateClassSheet";
import { SetCutoffSheet } from "@/components/principal/SetCutoffSheet";
import { formatCutoffTime } from "@/lib/temporaryAccessTime";

// PRD 1, Stage 2, Step 3. Reuses /principal/staff's own list idiom
// exactly (header with a back chevron + title, rounded-2xl white cards,
// a "+" action) -- no new visual pattern introduced for this page.
//
// Classes persist indefinitely (Step 0's own answer) -- there is no
// "ended" state for a class itself, only for membership within it, so
// this list never has a history section the way /principal/staff's
// rejected-requests one does. What DOES end -- a teacher's slot, a
// child's roster spot -- is shown on the class detail page instead,
// where the ended history actually belongs.

interface ClassRow {
  id: string;
  name: string;
  created_at: string;
  teacherCount: number;
  childCount: number;
}

export default function PrincipalClassesPage() {
  const { user, isReady } = useRequireRole("principal");
  const [institutionId, setInstitutionId] = useState<string | null>(null);
  const [classes, setClasses] = useState<ClassRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [cutoffTime, setCutoffTime] = useState<string>("15:00:00");
  const [isCutoffOpen, setIsCutoffOpen] = useState(false);

  const load = useCallback(async (instId: string) => {
    setIsLoading(true);
    setError(null);
    const supabase = createClient();

    const { data: classRows, error: classErr } = await supabase
      .from("classes")
      .select("id, name, created_at")
      .eq("institution_id", instId)
      .order("name");

    if (classErr) {
      setError("Could not load classes.");
      setIsLoading(false);
      return;
    }

    const classIds = (classRows ?? []).map((c) => c.id);
    if (classIds.length === 0) {
      setClasses([]);
      setIsLoading(false);
      return;
    }

    const [teacherRowsResult, childRowsResult] = await Promise.all([
      supabase.from("class_teachers").select("class_id").in("class_id", classIds).is("ended_at", null),
      supabase.from("class_children").select("class_id").in("class_id", classIds).is("ended_at", null),
    ]);

    const teacherCounts = new Map<string, number>();
    for (const row of teacherRowsResult.data ?? []) {
      teacherCounts.set(row.class_id, (teacherCounts.get(row.class_id) ?? 0) + 1);
    }
    const childCounts = new Map<string, number>();
    for (const row of childRowsResult.data ?? []) {
      childCounts.set(row.class_id, (childCounts.get(row.class_id) ?? 0) + 1);
    }

    setClasses(
      (classRows ?? []).map((c) => ({
        ...c,
        teacherCount: teacherCounts.get(c.id) ?? 0,
        childCount: childCounts.get(c.id) ?? 0,
      }))
    );
    setIsLoading(false);
  }, []);

  useEffect(() => {
    if (!user) return;
    let isMounted = true;

    async function resolveInstitutionAndLoad() {
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

      setInstitutionId(staffRow.institution_id);

      const { data: instRow } = await supabase
        .from("institutions")
        .select("temporary_access_cutoff_time")
        .eq("id", staffRow.institution_id)
        .single();
      if (isMounted && instRow?.temporary_access_cutoff_time) {
        setCutoffTime(instRow.temporary_access_cutoff_time);
      }

      await load(staffRow.institution_id);
    }

    resolveInstitutionAndLoad();
    return () => {
      isMounted = false;
    };
  }, [user, load]);

  if (!isReady) {
    return null;
  }

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
        <h1 className="flex-1 font-heading text-xl font-bold text-brand-prussian-blue">Classes</h1>
        {institutionId && (
          <button
            type="button"
            onClick={() => setIsCreateOpen(true)}
            aria-label="Create a class"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-prussian-blue text-lg text-white shadow-sm"
          >
            +
          </button>
        )}
      </header>

      {institutionId && (
        <div className="mx-4 mb-4 flex items-center justify-between rounded-2xl border border-black/5 bg-white/60 px-4 py-2.5 text-xs">
          <span className="text-brand-neutral-black/60">
            Temporary cover ends at <span className="font-semibold text-brand-neutral-black">{formatCutoffTime(cutoffTime)}</span> daily
          </span>
          <button type="button" onClick={() => setIsCutoffOpen(true)} className="font-semibold text-brand-prussian-blue">
            Change
          </button>
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
        ) : classes.length === 0 ? (
          <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
            No classes yet.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {classes.map((c) => (
              <Link
                key={c.id}
                href={`/principal/classes/${c.id}`}
                className="block rounded-2xl border border-black/5 bg-white p-4 shadow-sm"
              >
                <p className="text-sm font-semibold text-brand-neutral-black">{c.name}</p>
                <p className="mt-0.5 text-xs text-brand-neutral-black/50">
                  {c.teacherCount} teacher{c.teacherCount === 1 ? "" : "s"} · {c.childCount} child
                  {c.childCount === 1 ? "" : "ren"}
                </p>
              </Link>
            ))}
          </div>
        )}
      </main>

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

      {institutionId && (
        <SetCutoffSheet
          isOpen={isCutoffOpen}
          institutionId={institutionId}
          currentCutoffTime={cutoffTime}
          onClose={() => setIsCutoffOpen(false)}
          onSaved={(newCutoff) => {
            setCutoffTime(newCutoff);
            setIsCutoffOpen(false);
          }}
        />
      )}
    </div>
  );
}
