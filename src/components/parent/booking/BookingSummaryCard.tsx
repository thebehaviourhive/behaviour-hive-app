// Booking-flow redesign, section 5, steps 4 and 5 -- "A summary card
// carrying everything: Who / What / When / Where." Shared between
// Confirm (step 4, before the Meet link exists) and Booked (step 5,
// "with the summary card repeated") rather than two near-identical
// cards -- the only real difference between the two moments is
// whether a real meetLink is known yet.

export interface BookingSummaryDetails {
  clinicianName: string;
  sessionTypeName: string;
  locationMode: string;
  startISO: string;
  endISO: string;
  address: string | null;
  meetLink: string | null;
}

function formatSlotTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function BookingSummaryCard({ details }: { details: BookingSummaryDetails }) {
  const { clinicianName, sessionTypeName, locationMode, startISO, endISO, address, meetLink } = details;
  const isOnline = locationMode === "online";

  return (
    <div className="rounded-2xl border border-black/5 bg-white p-4 shadow-sm">
      <p className="font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/40">Who</p>
      <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">{clinicianName}</p>

      <p className="mt-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/40">What</p>
      <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">{sessionTypeName}</p>

      <p className="mt-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/40">When</p>
      <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">
        {new Date(startISO).toLocaleDateString([], { weekday: "long", day: "numeric", month: "long" })}
        {" · "}
        {formatSlotTime(startISO)}–{formatSlotTime(endISO)}
      </p>

      <p className="mt-3 font-accent text-eyebrow font-bold uppercase tracking-wide text-brand-neutral-black/40">Where</p>
      {isOnline ? (
        meetLink ? (
          <a
            href={meetLink}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-0.5 inline-block font-sans text-body font-semibold text-brand-prussian-blue"
          >
            Join by video call
          </a>
        ) : (
          <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">
            A video link will be on your calendar invitation.
          </p>
        )
      ) : (
        <p className="mt-0.5 font-sans text-body font-semibold text-brand-neutral-black">
          {address ?? "At the clinic -- please ask them for directions if you haven't visited before."}
        </p>
      )}
    </div>
  );
}
