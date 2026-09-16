// Extracted from teacher/join-institution/page.tsx (its original, only
// home) once a second call site (the new post-code role picker at
// role-select/school-staff) needed the identical translation -- two
// copies of the same Postgres-constraint-name match is exactly the
// kind of duplication that drifts silently, per this file's own
// project history.
//
// The one-principal-per-institution constraint (migration 0068,
// deliberately NOT widened for handover -- see 0102's own migration
// comment) is enforced at the database, not the UI -- a second
// principal's self-link fails with a raw Postgres unique-violation,
// which is not something to put in front of someone mid-onboarding.
// Matched on the constraint NAME (stable, chosen by the migration
// itself), not by fragile string-matching against Postgres's own
// message wording. Points at the real mechanism now that
// hand_over_principal() exists -- ask the current principal, or join
// as staff instead -- rather than "contact support," which is the
// abandoned-principal path, not the ordinary one.
export function friendlyJoinError(rawMessage: string): string {
  if (rawMessage.includes("institution_staff_one_principal_per_institution")) {
    return "This school already has a principal. Ask them to hand over the role to you, or join as a class teacher instead.";
  }
  return rawMessage;
}
