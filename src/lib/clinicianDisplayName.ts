// "Dr. [clinician last name]" -- the Clinical Support card family's
// standard clinician reference (States B/C). Same whitespace-split
// shape as getChildDisplayName/getChildFirstName in childDisplayName.ts,
// just extracting the last token instead of the first.
export function getClinicianLastName(fullName: string | null | undefined): string {
  if (!fullName) return "your clinician";
  const parts = fullName.trim().split(/\s+/);
  return parts[parts.length - 1];
}
