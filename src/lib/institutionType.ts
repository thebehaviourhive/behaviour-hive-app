// PRD 5 Stage 1: institutions.type is real now (migration 0200). This
// function reads it rather than assuming -- OPTION (A) from the
// Stage 1 recon: the caller passes the value in, since every real
// caller already has (or is already fetching) the institution row it
// needs the type of, and this avoids a redundant round-trip on top of
// that. It composes directly with getRoleLabel(), which needs
// InstitutionType as an input the same way.
//
// The previous version of this comment cited "CLAUDE.md's own account
// of why this PRD does not add a type column" -- that passage never
// existed; flagged in Stage 1's own recon (item 8) as a comment
// pointing at nothing, worse than no citation at all. Corrected here,
// not left to be found again: CLAUDE.md's real account of this stage
// is under "PRD 5 STAGE 1" in Deferred work.
//
// 'respite_centre' added, PRD 11 Stage 2, migration 0296. This is a
// union type deliberately -- every `Record<InstitutionType, X>` lookup
// in the codebase (vocabulary.ts's own ROLE_LABEL_DEFAULT is the load-
// bearing example) now fails to COMPILE without a respite_centre entry,
// which is the whole point: PRD 11 Stage 1's own recon named this as
// the one genuinely safe shape a two-way branch can take -- fails
// loudly, not a silent fall into the school branch. A plain
// `institutionType === "clinic" ? X : Y` ternary is NOT protected by
// this -- those are the ones Stage 2's own fail-closed sweep had to
// find and fix by hand, file by file.
export type InstitutionType = "school" | "clinic" | "respite_centre";

export function getInstitutionType(institution: { type: InstitutionType }): InstitutionType {
  return institution.type;
}
