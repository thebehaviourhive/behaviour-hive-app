import { getInitials } from "@/lib/initials";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";

// Booking-flow redesign, section 5, step 1 -- "Their name, prominent.
// Their specialty beneath it, as supporting detail. Initials in a
// circle where there is no photo -- never a blank avatar. The
// organisation they practise at, small." No photo field exists
// anywhere in this schema (checked directly) -- initials-in-a-circle
// is the permanent, only avatar treatment, not a fallback state.

export interface BookableClinician {
  clinicianId: string;
  fullName: string;
  specialty: string;
  organisationName: string | null;
}

export function ClinicianCard({ clinician, onSelect }: { clinician: BookableClinician; onSelect: () => void }) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white p-4 text-left shadow-sm"
    >
      <span
        aria-hidden
        className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-full bg-brand-pastel-blue/40 font-heading text-lg font-bold text-brand-prussian-blue"
      >
        {getInitials(clinician.fullName)}
      </span>
      <div className="min-w-0">
        <p className="truncate font-sans text-body font-bold text-brand-neutral-black">{clinician.fullName}</p>
        <p className="mt-0.5 font-sans text-eyebrow text-brand-neutral-black/60">
          {CLINICIAN_SPECIALTY_LABEL[clinician.specialty as ClinicianSpecialty] ?? clinician.specialty}
        </p>
        {clinician.organisationName && (
          <p className="mt-0.5 truncate font-sans text-[11px] text-brand-neutral-black/40">{clinician.organisationName}</p>
        )}
      </div>
    </button>
  );
}
