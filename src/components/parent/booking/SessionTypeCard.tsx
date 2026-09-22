// Booking-flow redesign, section 5, step 2 -- "Its name... Its length
// and where it happens, in one line... The clinic's own short
// description, where the director has written one." Length+mode is a
// STANDING line (always shown); description is an ADDITIONAL line,
// only when the director wrote one -- not an either/or the way the
// old fallback-only subtitle worked.

export interface BookableSessionType {
  id: string;
  name: string;
  description: string | null;
  locationMode: string;
  lengthMinutes: number;
  locationDetails: string | null;
}

// "at the clinic" was the same hardcoded assumption as the confirm/
// Booked screens' own WHERE bug (design brief follow-up, Sept 2026) --
// a mode-neutral phrase here, the real per-type location text lives in
// the description line below (director-written) and the WHERE section
// on later screens (formatLocationDetails()), never re-derived here.
const LOCATION_PHRASE: Record<string, string> = {
  online: "by video call",
  in_person: "in person",
  elsewhere: "elsewhere",
};

export function formatLengthAndLocation(type: BookableSessionType): string {
  const phrase = LOCATION_PHRASE[type.locationMode] ?? type.locationMode;
  return `${type.lengthMinutes} minutes, ${phrase}`;
}

export function SessionTypeCard({ type, onSelect }: { type: BookableSessionType; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
    >
      <p className="font-sans text-body font-bold text-brand-neutral-black">{type.name}</p>
      <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/60">{formatLengthAndLocation(type)}</p>
      {type.description && <p className="mt-1.5 font-sans text-eyebrow text-brand-neutral-black/40">{type.description}</p>}
    </button>
  );
}
