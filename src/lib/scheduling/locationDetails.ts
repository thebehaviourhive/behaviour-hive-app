// Booking WHERE section, found broken live: the confirm/Booked screens
// used to hardcode "At the clinic -- please ask them for directions..."
// for every in-person session, regardless of where that type actually
// happens. Daniel booked "In-person (Home)" and was told to go to the
// clinic. session_types.location_details (migration 0286) is the real
// fix -- director-written, per type, shown verbatim -- this is the one
// place that decides what to show when it's blank, so the fallback
// logic lives in exactly one function, not copied into every screen
// that renders a WHERE line (BookingSummaryCard, UpcomingBookingsCard).
//
// Never falls back to a clinic-specific claim -- a type that's blank
// might be at the clinic, a home, a school, anywhere; the honest
// fallback says the location is still to be confirmed, not that it's
// definitely at the clinic.
export function formatLocationDetails(locationMode: string, locationDetails: string | null | undefined): string | null {
  if (locationMode === "online") return null; // the Meet link covers this instead
  const trimmed = locationDetails?.trim();
  return trimmed ? trimmed : "Your clinic will confirm the exact location.";
}
