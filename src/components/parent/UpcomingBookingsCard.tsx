"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { cancellationSource, formatCancelledVia } from "@/lib/scheduling/bookingCancellation";
import { formatLocationDetails } from "@/lib/scheduling/locationDetails";

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
//
// Booking-flow redesign, Sept 2026, section 7 -- THREE states, not
// one: booked, cancelled by the parent, cancelled by the clinic. A
// cancelled booking used to vanish from this card the instant it was
// cancelled (get_my_upcoming_bookings()'s own old WHERE clause
// excluded it) -- the brief is explicit that a clinic cancellation
// must "show as cancelled, clearly, with an explanation, not quietly
// removed." Migration 0283 widened the RPC to include a cancelled
// booking for as long as its ORIGINAL scheduled time hasn't passed;
// this component is what actually renders the three resulting states.
// A parent-cancelled booking also stays visible here (not just
// filtered from the local list on cancel, as it used to be) for the
// same reason -- "cancelled by you" is still a real fact about an
// upcoming session, not something to hide.

interface UpcomingBooking {
  bookingId: string;
  clinicianName: string;
  sessionTypeName: string;
  sessionTypeMode: string;
  sessionTypeLocationDetails: string | null;
  sessionStartAt: string;
  sessionEndAt: string;
  googleSyncStatus: string;
  googleMeetLink: string | null;
  cancelledAt: string | null;
  cancelledVia: string | null;
  cancellationReason: string | null;
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
  // Standing rule, 22 Sept 2026 -- everything on the parent dashboard
  // is dismissible. A cancelled booking is a DEAD item (already closed,
  // nothing left to do): dismiss just hides it, no warning, per
  // dismiss_upcoming_booking_notice() (0291) -- per-guardian, so one
  // guardian dismissing never hides it from another.
  const [dismissingId, setDismissingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!passportId) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_my_upcoming_bookings", { p_passport_id: passportId });
    if (!error) {
      setBookings(
        (
          (data ?? []) as {
            booking_id: string;
            clinician_name: string;
            session_type_name: string;
            session_type_mode: string;
            session_type_location_details: string | null;
            session_start_at: string;
            session_end_at: string;
            google_sync_status: string;
            google_meet_link: string | null;
            cancelled_at: string | null;
            cancelled_via: string | null;
            cancellation_reason: string | null;
          }[]
        ).map((row) => ({
          bookingId: row.booking_id,
          clinicianName: row.clinician_name,
          sessionTypeName: row.session_type_name,
          sessionTypeMode: row.session_type_mode,
          sessionTypeLocationDetails: row.session_type_location_details,
          sessionStartAt: row.session_start_at,
          sessionEndAt: row.session_end_at,
          googleSyncStatus: row.google_sync_status,
          googleMeetLink: row.google_meet_link,
          cancelledAt: row.cancelled_at,
          cancelledVia: row.cancelled_via,
          cancellationReason: row.cancellation_reason,
        }))
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
      setCancelTarget(null);
      // Re-fetch rather than filtering it out locally -- a cancelled
      // booking now stays on the card (in its cancelled state), it
      // doesn't disappear.
      load();
    } catch {
      setIsCancelling(false);
      setCancelError("Couldn't cancel this session.");
    }
  }

  async function handleDismiss(bookingId: string) {
    setDismissingId(bookingId);
    const supabase = createClient();
    const { error } = await supabase.rpc("dismiss_upcoming_booking_notice", { p_booking_id: bookingId });
    if (error) {
      console.error("Failed to dismiss booking notice:", error);
      setDismissingId(null);
      return;
    }
    setBookings((prev) => prev.filter((b) => b.bookingId !== bookingId));
    setDismissingId(null);
  }

  if (isLoading || bookings.length === 0) {
    return null;
  }

  return (
    <section className="mb-6">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-black/40">Upcoming Sessions</h2>
      <div className="flex flex-col gap-2">
        {bookings.map((booking) => {
          const isCancelled = Boolean(booking.cancelledAt);
          const source = cancellationSource(booking.cancelledVia);
          return (
            <div
              key={booking.bookingId}
              className={`rounded-2xl border p-4 shadow-sm ${
                isCancelled ? "border-black/5 bg-black/[0.02]" : "border-black/5 bg-white"
              }`}
            >
              <div className="flex items-start gap-3">
                <span
                  aria-hidden
                  className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-lg ${
                    isCancelled ? "bg-black/5 grayscale" : "bg-brand-pastel-blue/40"
                  }`}
                >
                  📅
                </span>
                <div className="flex-1">
                  <p
                    className={`text-sm font-semibold ${
                      isCancelled ? "text-brand-neutral-black/50 line-through" : "text-brand-neutral-black"
                    }`}
                  >
                    {booking.sessionTypeName} with {booking.clinicianName}
                  </p>
                  <p className="text-xs text-black/50">{formatWhen(booking.sessionStartAt)}</p>

                  {isCancelled ? (
                    <div className="mt-1.5 rounded-lg bg-brand-golden-brown/10 px-2.5 py-1.5">
                      <p className="text-xs font-bold uppercase tracking-wide text-brand-golden-brown">
                        {formatCancelledVia(booking.cancelledVia)}
                      </p>
                      {source === "clinic" && (
                        <p className="mt-0.5 text-xs text-brand-neutral-black/70">
                          {booking.cancellationReason ?? "Your clinic cancelled this session. Contact them for a new time."}
                        </p>
                      )}
                    </div>
                  ) : (
                    <>
                      {booking.googleSyncStatus === "sync_failed" && (
                        <p className="mt-1 text-xs font-medium text-brand-golden-brown">
                          Your clinic is aware there may be a calendar issue with this session.
                        </p>
                      )}
                      {booking.googleMeetLink ? (
                        <a
                          href={booking.googleMeetLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1.5 inline-block text-xs font-semibold text-brand-prussian-blue"
                        >
                          Join by video call
                        </a>
                      ) : (
                        (() => {
                          const whereText = formatLocationDetails(booking.sessionTypeMode, booking.sessionTypeLocationDetails);
                          return whereText ? <p className="mt-1 text-xs text-brand-neutral-black/60">{whereText}</p> : null;
                        })()
                      )}
                    </>
                  )}
                </div>
              </div>

              {!isCancelled &&
                (cancelTarget?.bookingId === booking.bookingId ? (
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
                ))}

              {isCancelled && (
                <button
                  type="button"
                  onClick={() => handleDismiss(booking.bookingId)}
                  disabled={dismissingId === booking.bookingId}
                  className="mt-2 text-xs font-semibold text-brand-neutral-black/50 disabled:opacity-40"
                >
                  {dismissingId === booking.bookingId ? "Dismissing…" : "Dismiss"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
