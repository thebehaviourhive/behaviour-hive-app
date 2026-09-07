"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { getChildDisplayName } from "@/lib/childDisplayName";

// SUPPLY TEACHER PROMPT TO REVIEW THE CLASS'S PASSPORTS (migration
// 0178, CLAUDE.md). Someone walking into a room for one day, with no
// prior knowledge of these children, needs to know before anything
// happens who has what triggers, what calms them, and their
// communication needs -- reading that after an incident is too late.
//
// SCOPED TO THREE OF FOUR SECTIONS, DELIBERATELY, NAMED PLAINLY IN THE
// COPY BELOW: triggers, calming approaches, and communication needs are
// all real, all confirmed reachable through the exact "sna" tier access
// a temporary cover grant already provides. MEDICAL AND INTIMATE CARE
// NEEDS ARE NOT -- neither field exists anywhere in the passport
// schema, under any name. Not a design decision made here; a
// pre-existing product gap (CLAUDE.md, deferred work), going to
// Catherine separately. This card does not silently cover three of four
// and imply completeness.
//
// Self-contained per class, matching TemporaryAccessBanner/
// QuestionnairePromptCard's own established idiom on this same page --
// fetches its own data, renders nothing while loading, nothing when
// there's no active grant for this class, and nothing once every child
// is reviewed (get_covering_passport_review_status() simply stops
// listing anyone -- the card clearing IS the empty state, not a
// separate "all done" message that would then need its own dismissal).
//
// "Reviewed" = opened, tracked per child, no extra tap (Daniel's own
// call) -- mark_passport_reviewed() fires from /sna/passport/
// [passportId]'s own mount effect, not from anything this card does
// directly. Dismiss marks every currently-unreviewed child reviewed in
// one write -- same end state as reading through each one, for someone
// who already knows this class and shouldn't be nagged.

interface ReviewStatusRow {
  passport_id: string;
  child_name: string;
  viewed_at: string | null;
}

export function SupplyTeacherPassportReviewCard({ classId, className }: { classId: string; className: string }) {
  const router = useRouter();
  const [rows, setRows] = useState<ReviewStatusRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isDismissing, setIsDismissing] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_covering_passport_review_status", { p_class_id: classId });
    // Fails silently, same as QuestionnairePromptCard -- a load error
    // here just means the prompt doesn't show, not an alarming card for
    // something outside the viewer's control.
    if (!error) {
      setRows((data ?? []) as ReviewStatusRow[]);
    }
    setIsLoading(false);
  }, [classId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleDismiss() {
    setIsDismissing(true);
    const supabase = createClient();
    await supabase.rpc("dismiss_passport_review", { p_class_id: classId });
    setIsDismissing(false);
    load();
  }

  if (isLoading) return null;

  const unreviewed = rows.filter((r) => !r.viewed_at);
  if (unreviewed.length === 0) return null;

  return (
    <div className="mb-4 rounded-2xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4 shadow-md">
      <p className="font-heading text-sm font-bold text-brand-neutral-black">Review {className} before you start</p>
      <p className="mt-1 text-xs text-brand-neutral-black/70">
        Triggers, calming approaches, and communication needs for each child -- one tap each. (Medical and intimate
        care needs aren&apos;t recorded in this app yet.)
      </p>
      <div className="mt-3 flex flex-col gap-2">
        {unreviewed.map((row) => (
          <button
            key={row.passport_id}
            type="button"
            onClick={() => router.push(`/sna/passport/${row.passport_id}`)}
            className="flex items-center justify-between rounded-xl border border-black/5 bg-white px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
          >
            <span className="text-sm font-semibold text-brand-neutral-black">
              {getChildDisplayName(row.child_name)}
            </span>
            <span className="text-xs text-brand-prussian-blue">Review →</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        disabled={isDismissing}
        className="mt-3 text-xs font-semibold text-brand-neutral-black/50 underline decoration-dotted underline-offset-2 disabled:opacity-50"
      >
        {isDismissing ? "Dismissing…" : "I already know this class -- dismiss"}
      </button>
    </div>
  );
}
