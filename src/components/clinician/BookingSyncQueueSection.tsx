"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { WorkQueueRow } from "@/components/shared/WorkQueueRow";

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

  const load = useCallback(async () => {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_bookings_needing_attention");
    if (!error) {
      setRows(
        (
          (data ?? []) as {
            booking_id: string;
            child_name: string;
            session_type_name: string;
            session_start_at: string;
            google_sync_status: string;
          }[]
        ).map((row) => ({
          bookingId: row.booking_id,
          childName: row.child_name,
          sessionTypeName: row.session_type_name,
          sessionStartAt: row.session_start_at,
          syncStatus: row.google_sync_status,
        }))
      );
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

  if (isLoading || rows.length === 0) {
    return null;
  }

  return (
    <section className="mb-6 px-4">
      <h2 className="mb-2 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-golden-brown">
        Needs Your Attention
      </h2>
      {actionError && (
        <p role="alert" className="mb-2 rounded-xl bg-brand-golden-brown/10 px-4 py-3 font-sans text-body font-medium text-brand-golden-brown">
          {actionError}
        </p>
      )}
      <div className="flex flex-col gap-2">
        {rows.map((row) => {
          const copy = STATUS_COPY[row.syncStatus] ?? STATUS_COPY.sync_failed;
          const isPending = pendingBookingId === row.bookingId;
          return (
            <WorkQueueRow
              key={row.bookingId}
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
