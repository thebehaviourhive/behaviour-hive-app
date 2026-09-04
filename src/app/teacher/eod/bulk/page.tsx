"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { EodWizardForChild } from "@/components/teacher/EodWizardForChild";
import { resolveTeacherEodQueue, type TeacherEodQueueChild } from "@/lib/teacherEodQueue";

// Bulk EOD update -- item 3. One walk through every remaining child
// across every class this teacher currently teaches, instead of one
// navigation per child. Queue resolution itself lives in
// teacherEodQueue.ts, shared with the dashboard card's own count so the
// two can never disagree about what "remaining" means -- see that
// file's own header comment for why that sharing matters here
// specifically.
//
// TIME GATE: this route itself is reachable any time, exactly like
// /teacher/eod/[passportId] always has been -- the >=13:00 rule lives
// only on the dashboard card that links here (matching the existing
// single-child "Complete EOD Update" button's own gate, confirmed live
// at teacher/passport/[passportId]/page.tsx:327), not invented twice.

type QueueChild = TeacherEodQueueChild;

export default function TeacherBulkEodPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("class_teacher");

  const [isLoading, setIsLoading] = useState(true);
  const [queue, setQueue] = useState<QueueChild[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);

  const load = useCallback(async () => {
    if (!user) return;
    setIsLoading(true);
    const supabase = createClient();

    const remaining = await resolveTeacherEodQueue(supabase, user.id);
    setQueue(remaining);
    setCurrentIndex(0);
    setIsLoading(false);
  }, [user]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleMarkAbsent(child: QueueChild) {
    if (!user) return;
    const supabase = createClient();
    const { error: insertError } = await supabase.from("teacher_updates").insert({
      passport_id: child.passportId,
      teacher_id: user.id,
      marked_absent: true,
    });
    if (insertError) throw new Error(insertError.message);
    advance();
  }

  function advance() {
    setCurrentIndex((i) => i + 1);
  }

  if (!isReady || !user || isLoading) {
    return null;
  }

  const total = queue.length;
  const current = queue[currentIndex];

  // Nothing left -- reached directly (no in-flight queue built this
  // page load) or the walk just finished. Same screen either way: both
  // mean "there is currently nothing to do here".
  if (!current) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4 text-center">
        <span aria-hidden className="text-4xl">
          ✅
        </span>
        <p className="font-heading text-lg font-semibold text-brand-neutral-black">
          {total === 0 && currentIndex === 0 ? "Nothing left to update today." : "All done for today."}
        </p>
        <button
          type="button"
          onClick={() => router.push("/teacher/dashboard")}
          className="rounded-2xl bg-brand-golden-brown px-6 py-3 text-sm font-semibold text-white"
        >
          Back to Dashboard
        </button>
      </div>
    );
  }

  return (
    <EodWizardForChild
      key={current.passportId}
      passportId={current.passportId}
      teacherId={user.id}
      childName={current.childName}
      progressLabel={`Child ${currentIndex + 1} of ${total} · ${current.className}`}
      onDone={advance}
      onMarkAbsent={() => handleMarkAbsent(current)}
    />
  );
}
