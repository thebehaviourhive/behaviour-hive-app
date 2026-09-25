"use client";

import { useState } from "react";
import { SnoozableWorkQueueRow } from "@/components/shared/SnoozableWorkQueueRow";
import { ReviewStaffJoinSheet } from "@/components/principal/ReviewStaffJoinSheet";
import { OUTSTANDING_TASK_QUEUES as Q } from "@/lib/outstandingTaskQueues";
import type { useOutstandingTaskSnoozes } from "@/hooks/useOutstandingTaskSnoozes";
import type { AwaitingReportRow, PendingStaffRow } from "@/hooks/useCentreDashboardOverview";

// Respite UI Stage 2a, block 3 -- the real work queue, snoozing intact
// and unchanged. "All clear." used to be the dashboard's own biggest
// block; at thirty children it would almost never appear, so it's now
// one line, not the centrepiece -- the block itself (this section)
// still renders even when clear, it just says so plainly instead of
// filling the page.
export function NeedsDoingSection({
  institutionId,
  awaitingReport,
  pendingStaff,
  snoozes,
  isLoading,
  onResolved,
}: {
  institutionId: string | null;
  awaitingReport: AwaitingReportRow[];
  pendingStaff: PendingStaffRow[];
  snoozes: ReturnType<typeof useOutstandingTaskSnoozes>;
  isLoading: boolean;
  onResolved: () => void;
}) {
  const [reviewTarget, setReviewTarget] = useState<PendingStaffRow | null>(null);

  if (isLoading || !institutionId) {
    return (
      <section>
        <div className="h-6 w-28 animate-pulse rounded bg-black/10" />
        <div className="mt-2 h-14 animate-pulse rounded-2xl bg-white" />
      </section>
    );
  }

  const awaitingReportVisible = snoozes.filterVisible(awaitingReport, Q.CENTRE_NEEDS_REPORT, (r) => r.stay_id);
  const pendingStaffVisible = snoozes.filterVisible(pendingStaff, Q.PENDING_STAFF_JOIN, (r) => r.id);
  const outstandingCount = awaitingReportVisible.length + pendingStaffVisible.length;

  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-prussian-blue">
          Needs Doing
        </h2>
        <button
          type="button"
          onClick={() => snoozes.setShowSnoozed((v) => !v)}
          className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
        >
          {snoozes.showSnoozed ? "Hide snoozed" : "Show snoozed"}
        </button>
      </div>

      {outstandingCount === 0 && !snoozes.showSnoozed ? (
        <p className="rounded-2xl border border-dashed border-black/10 bg-white/60 p-4 text-center text-sm text-brand-neutral-black/60">
          All clear. Nothing outstanding today.
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          {(snoozes.showSnoozed ? awaitingReport : awaitingReportVisible).map((stay) => (
            <SnoozableWorkQueueRow
              key={stay.stay_id}
              institutionId={institutionId}
              queueKey={Q.CENTRE_NEEDS_REPORT}
              itemId={stay.stay_id}
              defaultSnoozeDays={snoozes.defaultSnoozeDays}
              snoozeMeta={snoozes.getMeta(Q.CENTRE_NEEDS_REPORT, stay.stay_id)}
              onSnoozed={snoozes.refresh}
              entity={stay.child_name ?? "This child"}
              exception="Stay ended, no report yet"
              context={`Ended ${new Date(stay.ends_at).toLocaleDateString()}`}
              actionLabel="Write report"
              href={`/centre/report/${stay.stay_id}`}
              urgent
            />
          ))}
          {(snoozes.showSnoozed ? pendingStaff : pendingStaffVisible).map((member) => (
            <SnoozableWorkQueueRow
              key={member.id}
              institutionId={institutionId}
              queueKey={Q.PENDING_STAFF_JOIN}
              itemId={member.id}
              defaultSnoozeDays={snoozes.defaultSnoozeDays}
              snoozeMeta={snoozes.getMeta(Q.PENDING_STAFF_JOIN, member.id)}
              onSnoozed={snoozes.refresh}
              entity={member.full_name}
              exception="Waiting for approval"
              actionLabel="Approve"
              onAction={() => setReviewTarget(member)}
            />
          ))}
        </div>
      )}

      {reviewTarget && (
        <ReviewStaffJoinSheet
          member={reviewTarget}
          isOpen={Boolean(reviewTarget)}
          onClose={() => setReviewTarget(null)}
          onResolved={() => {
            setReviewTarget(null);
            onResolved();
          }}
          institutionType="respite_centre"
          overrides={{}}
        />
      )}
    </section>
  );
}
