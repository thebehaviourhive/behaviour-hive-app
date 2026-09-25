"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { SnoozableWorkQueueRow } from "@/components/shared/SnoozableWorkQueueRow";
import { OUTSTANDING_TASK_QUEUES as Q } from "@/lib/outstandingTaskQueues";

// PRD 9, section 7 -- get_my_bookings_needing_attention()'s own first
// real client caller. A clinician who moved or deleted a booked
// session directly in their own Google Calendar sees it here, never
// silently adopted or auto-cancelled (CLAUDE.md's own standing
// instruction) -- two real actions per status, matching what the
// clinician actually needs to do differently for each (migration
// 0284's own reasoning for keeping the two statuses separate).
//
// Renders nothing when the queue is empty -- same "genuinely absent,
// not an empty state" posture MyTagChangeRequestsSection already uses
// on this same dashboard; an empty sync-issues queue is the normal,
// good state, not something worth a card saying so.

interface QueueRow {
  bookingId: string;
  childName: string;
  sessionTypeName: string;
  sessionStartAt: string;
  syncStatus: string;
  institutionId: string;
}

interface SnoozeStatusRow {
  queue_key: string;
  item_id: string;
  is_currently_snoozed: boolean;
  snoozed_until: string;
  snooze_count: number;
}

const STATUS_COPY: Record<string, { exception: string; primaryLabel: string; secondaryLabel: string; primaryAction: string; secondaryAction: string }> = {
  drifted: {
    exception: "This session may have moved in Google Calendar",
    primaryLabel: "Keep new time",
    secondaryLabel: "Revert",
    primaryAction: "reschedule",
    secondaryAction: "revert",
  },
  deleted_in_google: {
    exception: "This session was deleted in Google Calendar",
    primaryLabel: "Confirm cancelled",
    secondaryLabel: "Restore",
    primaryAction: "confirm",
    secondaryAction: "restore",
  },
  sync_failed: {
    exception: "This session's calendar event may not have synced correctly",
    primaryLabel: "Restore",
    secondaryLabel: "Confirm cancelled",
    primaryAction: "restore",
    secondaryAction: "confirm",
  },
};

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) +
    " · " +
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function BookingSyncQueueSection() {
  const [rows, setRows] = useState<QueueRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [pendingBookingId, setPendingBookingId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Outstanding-task snoozing, 25 Sept 2026. Deliberately NOT the shared
  // useOutstandingTaskSnoozes hook -- that hook is built for one
  // institution per page. A clinician's own sync-issues queue can
  // genuinely span more than one clinic (a real, if rare, shape this
  // schema already supports -- a practitioner working across clinics),
  // so this fetches snooze status and each institution's own default
  // separately, per distinct institution_id actually present in the
  // rows, and merges them into one lookup map keyed the same way the
  // shared hook keys its own.
  const [snoozeStatus, setSnoozeStatus] = useState<Map<string, SnoozeStatusRow>>(new Map());
  const [defaultDaysByInstitution, setDefaultDaysByInstitution] = useState<Map<string, number>>(new Map());
  const [showSnoozed, setShowSnoozed] = useState(false);

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_bookings_needing_attention");
    if (error) {
      setIsLoading(false);
      return;
    }
    const loadedRows = (
      (data ?? []) as {
        booking_id: string;
        child_name: string;
        session_type_name: string;
        session_start_at: string;
        google_sync_status: string;
        institution_id: string;
      }[]
    ).map((row) => ({
      bookingId: row.booking_id,
      childName: row.child_name,
      sessionTypeName: row.session_type_name,
      sessionStartAt: row.session_start_at,
      syncStatus: row.google_sync_status,
      institutionId: row.institution_id,
    }));
    setRows(loadedRows);

    const distinctInstitutionIds = Array.from(new Set(loadedRows.map((r) => r.institutionId)));
    if (distinctInstitutionIds.length > 0) {
      const [statusResults, institutionResults] = await Promise.all([
        Promise.all(
          distinctInstitutionIds.map((id) =>
            supabase.rpc("get_institution_snooze_status", {
              p_institution_id: id,
              p_queue_key: Q.BOOKING_NEEDS_ATTENTION,
            })
          )
        ),
        Promise.all(
          distinctInstitutionIds.map((id) =>
            supabase.from("institutions").select("id, default_snooze_days").eq("id", id).maybeSingle()
          )
        ),
      ]);
      const statusMap = new Map<string, SnoozeStatusRow>();
      for (const result of statusResults) {
        for (const row of (result.data ?? []) as SnoozeStatusRow[]) {
          statusMap.set(`${row.queue_key}:${row.item_id}`, row);
        }
      }
      setSnoozeStatus(statusMap);
      const daysMap = new Map<string, number>();
      for (const result of institutionResults) {
        if (result.data?.id && result.data.default_snooze_days) {
          daysMap.set(result.data.id, result.data.default_snooze_days);
        }
      }
      setDefaultDaysByInstitution(daysMap);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function resolve(bookingId: string, action: string) {
    setPendingBookingId(bookingId);
    setActionError(null);
    try {
      const response = await fetch("/api/scheduling/resolve-sync-issue", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId, action }),
      });
      const data = await response.json();
      setPendingBookingId(null);
      if (!response.ok) {
        setActionError(data.error ?? "Couldn't resolve this. Please try again.");
        return;
      }
      setRows((prev) => prev.filter((r) => r.bookingId !== bookingId));
    } catch {
      setPendingBookingId(null);
      setActionError("Couldn't resolve this. Please try again.");
    }
  }

  const visibleRows = showSnoozed
    ? rows
    : rows.filter((row) => !snoozeStatus.get(`${Q.BOOKING_NEEDS_ATTENTION}:${row.bookingId}`)?.is_currently_snoozed);

  if (isLoading || (rows.length === 0)) {
    return null;
  }
  if (visibleRows.length === 0 && !showSnoozed) {
    // Everything here has been snoozed -- still offer the way back,
    // per the brief's own "if they disappear with no way back, this is
    // a delete, not a snooze."
    return (
      <section className="mb-6 px-4">
        <button
          type="button"
          onClick={() => setShowSnoozed(true)}
          className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
        >
          Show snoozed
        </button>
      </section>
    );
  }

  return (
    <section className="mb-6 px-4">
      <div className="mb-2 flex items-center justify-between">
        <h2 className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
          Needs Your Attention
        </h2>
        <button
          type="button"
          onClick={() => setShowSnoozed((v) => !v)}
          className="font-sans text-eyebrow font-semibold text-brand-prussian-blue underline underline-offset-2"
        >
          {showSnoozed ? "Hide snoozed" : "Show snoozed"}
        </button>
      </div>
      {actionError && (
        <p role="alert" className="mb-2 rounded-xl bg-brand-golden-brown/10 px-4 py-3 font-sans text-body font-medium text-brand-golden-brown">
          {actionError}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {visibleRows.map((row) => {
          const copy = STATUS_COPY[row.syncStatus] ?? STATUS_COPY.sync_failed;
          const isPending = pendingBookingId === row.bookingId;
          const statusRow = snoozeStatus.get(`${Q.BOOKING_NEEDS_ATTENTION}:${row.bookingId}`);
          return (
            <SnoozableWorkQueueRow
              key={row.bookingId}
              institutionId={row.institutionId}
              queueKey={Q.BOOKING_NEEDS_ATTENTION}
              itemId={row.bookingId}
              defaultSnoozeDays={defaultDaysByInstitution.get(row.institutionId) ?? 5}
              snoozeMeta={
                statusRow
                  ? {
                      isCurrentlySnoozed: statusRow.is_currently_snoozed,
                      snoozedUntil: statusRow.snoozed_until,
                      snoozeCount: statusRow.snooze_count,
                      lastReason: "",
                      lastSnoozedByName: null,
                      lastSnoozedAt: "",
                    }
                  : undefined
              }
              onSnoozed={load}
              entity={row.childName}
              exception={`${copy.exception} — ${row.sessionTypeName}`}
              context={formatWhen(row.sessionStartAt)}
              urgent
              actionLabel={isPending ? "Working…" : copy.primaryLabel}
              isActionPending={isPending}
              onAction={() => resolve(row.bookingId, copy.primaryAction)}
              secondaryActionLabel={copy.secondaryLabel}
              onSecondaryAction={() => resolve(row.bookingId, copy.secondaryAction)}
            />
          );
        })}
      </div>
    </section>
  );
}
