// PRD 9, Stage 2 -- PRD section 6 assumes "a passport number [the
// clinician] already works with" exists somewhere in the app today. It
// doesn't -- checked directly, no such concept exists anywhere in this
// schema or UI. `passports.passport_code` is the nearest-sounding
// column but is a real, still-live security credential (the parent-
// generated code that grants a teacher passport_access -- see migration
// 0114's own header on why it was deliberately NOT reused for the
// guardian-claim flow either) and must never appear on a calendar event
// any number of clinic staff, or Google itself, might see.
//
// This is a NEW, non-security, display-only reference -- derived
// entirely from the passport's own id, not a stored column, so it
// needs no migration and carries no write path anyone could tamper
// with. Purely a recognition aid for a clinician who runs many
// clients' worth of sessions through one calendar and needs to tell
// them apart at a glance -- never used for lookup, authorization, or
// anything else. If Daniel has an existing reference-number convention
// in mind (matching an external record system, say), this is the one
// place to change -- a single pure function, one call site.
export function formatPassportReference(passportId: string): string {
  const hex = passportId.replace(/-/g, "").slice(0, 8).toUpperCase();
  return `${hex.slice(0, 4)}-${hex.slice(4, 8)}`;
}
