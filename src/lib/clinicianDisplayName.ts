import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";

// The one place a clinician reference gets formatted app-wide. We
// verify each clinician's specialty but never capture an honorific --
// "Dr." is an assumption, and a misrepresentation for a future
// non-doctoral clinician (SLT, OT, etc). NEVER prepend a title here.
//
// Formal/first reference on a surface: "[Full name], [Specialty]" --
// e.g. "Katie Smith, Behavioural Psychologist". Degrades gracefully
// (name alone, specialty alone, or the generic fallback) rather than
// fabricating either half when one is genuinely missing.
//
// Informal/repeat references on the same surface are NOT this
// function's job -- callers just render the plain full name a second
// time themselves; there's nothing to format for that case.
export function formatClinicianReference(
  fullName: string | null | undefined,
  specialty: string | null | undefined
): string {
  const specialtyLabel = specialty
    ? (CLINICIAN_SPECIALTY_LABEL[specialty as ClinicianSpecialty] ?? specialty)
    : null;
  if (fullName && specialtyLabel) return `${fullName}, ${specialtyLabel}`;
  if (fullName) return fullName;
  if (specialtyLabel) return specialtyLabel;
  return "your clinician";
}
