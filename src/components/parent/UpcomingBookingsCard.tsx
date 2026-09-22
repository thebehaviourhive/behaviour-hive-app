"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// PRD 9, Stage 2 -- answers PRD section 11's own open question ("what a
// parent sees of their own booking history, as distinct from what is
// upcoming"). Daniel's own answer, via this project's established
// Home/Passport split: UPCOMING lives here, on Home, because a session
// on Thursday is something-is-happening -- the same shape every other
// card on this page already has. HISTORY lives on the Passport record
// instead (BookingHistorySection) -- a list of past sessions is record
// material, not inbox material.
//
// Cancelling here calls the ONE shared /api/scheduling/cancel route --
// cancel_booking() itself derives that this is a parent cancelling, no
// role claimed client-side. The notice-period warning is copy only,
// never a block (billing is out of scope, so there is nothing for the
// app to enforce).

interface UpcomingBooking {
  bookingId: string;
  clinicianName: string;
  sessionTypeName: string;
  sessionStartAt: string;
  sessionEndAt: string;
  googleSyncStatus: string;
  googleMeetLink: string | null;
}

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) +
    " · " +
    new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function UpcomingBookingsCard({ passportId }: { passportId: string | null }) {
  const [bookings, setBookings] = useState<UpcomingBooking[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelTarget, setCancelTarget] = useState<UpcomingBooking | null>(null);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelError, setCancelError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!passportId) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_upcoming_bookings", { p_passport_id: passportId });
    if (!error) {
      setBookings(
        ((data ?? []) as { booking_id: string; clinician_name: string; session_type_name: string; session_start_at: string; session_end_at: string; google_sync_status: string; google_meet_link: string | null }[]).map(
          (row) => ({
            bookingId: row.booking_id,
            clinicianName: row.clinician_name,
            sessionTypeName: row.session_type_name,
            sessionStartAt: row.session_start_at,
            sessionEndAt: row.session_end_at,
            googleSyncStatus: row.google_sync_status,
            googleMeetLink: row.google_meet_link,
          })
        )
      );
    }
    setIsLoading(false);
  }, [passportId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load();
  }, [load]);

  async function handleCancel() {
    if (!cancelTarget) return;
    setIsCancelling(true);
    setCancelError(null);
    try {
      const response = await fetch("/api/scheduling/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookingId: cancelTarget.bookingId }),
      });
      const data = await response.json();
      setIsCancelling(false);
      if (!response.ok) {
        setCancelError(data.error ?? "Couldn't cancel this session.");
        return;
      }
      setBookings((prev) => prev.filter((b) => b.bookingId !== cancelTarget.bookingId));
      setCancelTarget(null);
    } catch {
      setIsCancelling(false);
      setCancelError("Couldn't cancel this session.");
    }
  }

  if (isLoading || bookings.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">Upcoming Sessions</h2>
      <div className="flex flex-col gap-2">
        {bookings.map((booking) => (
          <div key={booking.bookingId} className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
            <div className="flex items-start gap-3">
              <span aria-hidden className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/40 text-lg">
                📅
              </span>
              <div className="flex-1">
                <p className="text-sm font-semibold text-brand-neutral-black">
                  {booking.sessionTypeName} with {booking.clinicianName}
                </p>
                <p className="text-xs text-black/50">{formatWhen(booking.sessionStartAt)}</p>
                {booking.googleSyncStatus === "sync_failed" && (
                  <p className="mt-1 text-xs font-medium text-brand-golden-brown">
                    Your clinic is aware there may be a calendar issue with this session.
                  </p>
                )}
                {booking.googleMeetLink && (
                  <a
                    href={booking.googleMeetLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1.5 inline-block text-xs font-semibold text-brand-prussian-blue"
                  >
                    Join by video call
                  </a>
                )}
              </div>
            </div>
            {cancelTarget?.bookingId === booking.bookingId ? (
              <div className="mt-3 rounded-xl bg-brand-safe-ivory/40 p-3">
                <p className="text-xs text-brand-neutral-black/80">Cancel this session?</p>
                {cancelError && <p className="mt-1 text-xs font-medium text-brand-golden-brown">{cancelError}</p>}
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    onClick={handleCancel}
                    disabled={isCancelling}
                    className="rounded-full bg-brand-golden-brown px-4 py-1.5 text-xs font-semibold text-white disabled:opacity-40"
                  >
                    {isCancelling ? "Cancelling…" : "Yes, cancel"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setCancelTarget(null)}
                    disabled={isCancelling}
                    className="rounded-full border border-black/10 px-4 py-1.5 text-xs font-semibold text-black/60"
                  >
                    Keep session
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setCancelError(null);
                  setCancelTarget(booking);
                }}
                className="mt-2 text-xs font-semibold text-brand-prussian-blue"
              >
                Cancel session
              </button>
            )}
          </div>
        ))}
      </div>
    </section>
  );
}
