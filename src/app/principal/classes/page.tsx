"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import { createClient } from "@/lib/supabase/client";
import { CreateClassSheet } from "@/components/principal/CreateClassSheet";
import { PrincipalBottomNav } from "@/components/principal/PrincipalBottomNav";

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
//
// PRD 2, Stage 5: get_institution_classes_roster() (0129) replaces the
// three raw reads (classes, class_teachers counted, class_children
// counted) this page used to compose client-side. Same query-shape
// discipline as every other roster screen in this app -- one RPC, not
// three tables joined in the client.
//
// PRD 2, Stage 6: the cut-off-time control (SetCutoffSheet) moves off
// this page entirely, to /principal/school's own Settings section --
// School's own header comment named this exact move as deferred until
// "Temporary access... gets its real design", which this stage is.
// The cut-off is an institution-wide setting, not a classes concern;
// living here was always this page borrowing space for a control that
// belonged elsewhere. The live cover roster itself moves to its own
// destination too: /principal/temporary-access, alongside Staff/
// Classes/Passports under Directory.

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
      ((classRows ?? []) as { class_id: string; name: string; created_at: string; teacher_count: number; child_count: number }[]).map(
        (c) => ({
          id: c.class_id,
          name: c.name,
          created_at: c.created_at,
          teacherCount: c.teacher_count,
          childCount: c.child_count,
        })
      )
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
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40 pb-24">
      <header className="flex items-center gap-3 px-4 pt-6 pb-4">
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

      <PrincipalBottomNav />
    </div>
  );
}
