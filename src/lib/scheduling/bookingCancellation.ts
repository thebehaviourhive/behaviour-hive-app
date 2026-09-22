// Booking-flow redesign (design brief, Sept 2026), section 7 -- the
// Upcoming card now needs the same cancelled_via -> label mapping
// BookingHistorySection.tsx already had, since a cancelled-but-still-
// upcoming booking is no longer removed from the card (migration
// 0283's own get_my_upcoming_bookings() widening). One shared function,
// not two hand-copied maps drifting apart.
export const CANCELLED_VIA_LABEL: Record<string, string> = {
  parent: "Cancelled by you",
  clinician: "Cancelled by the clinician",
  clinician_google: "Cancelled by the clinician",
  director: "Cancelled by the clinic",
  discharge: "Cancelled -- care ended",
  rescheduled: "Rescheduled",
  system: "Cancelled",
};

export function formatCancelledVia(cancelledVia: string | null): string {
  if (!cancelledVia) return "Cancelled";
  return CANCELLED_VIA_LABEL[cancelledVia] ?? "Cancelled";
}

// The Upcoming card's own three states (design brief section 7) need
// to distinguish "the parent did this" from "the clinic did this" at a
// coarser grain than the full cancelled_via vocabulary -- director and
// clinician_google both read as "the clinic", matching the brief's own
// two-way split (parent / clinic) rather than surfacing every internal
// value as its own visual state.
export type UpcomingCancellationSource = "parent" | "clinic" | "other";

export function cancellationSource(cancelledVia: string | null): UpcomingCancellationSource {
  if (cancelledVia === "parent") return "parent";
  if (cancelledVia === "director" || cancelledVia === "clinician" || cancelledVia === "clinician_google") return "clinic";
  return "other";
}
