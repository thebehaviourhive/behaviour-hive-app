// Extracted from YourTeamCard.tsx (its own original, unchanged logic)
// so the booking flow's own clinician cards (design brief, Sept 2026,
// section 5, step 1: "Initials in a circle where there is no photo --
// never a blank avatar") can share it rather than re-deriving it --
// there is no photo field anywhere in this schema (checked directly),
// so this is the ONLY avatar treatment any clinician ever gets, not a
// fallback for a photo state that doesn't exist yet.
export function getInitials(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() ?? "?";
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}
