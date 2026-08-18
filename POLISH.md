# Polish backlog

Deferred, non-blocking findings — documented so they aren't lost, not
scheduled. Nothing here is a bug affecting current behaviour.

## `"teacher"` vs `"class_teacher"` role-string inconsistency

The codebase has two different string spellings for the same role,
depending on which type they were added under:

- `"class_teacher"` — the real value, matches `app_metadata.role`,
  `institution_staff.role`, `passport_access.actor_role`, and most
  role-union types (`ABCLoggerRole`, `MessageRole`, the `Role` type in
  role-select, etc).
- `"teacher"` — used only by `ClinicalTeamViewerRole`
  (`src/components/passport/clinical-team/ClinicalTeamSection.tsx`),
  predating the rest of the codebase's convention. Never a real
  `app_metadata.role` value; every call site currently passes the
  literal string `"teacher"` by hand, so it's internally consistent
  today, just off-pattern from everything else.

Found originally while auditing the SNA role build (Phase 0 report,
2026-08-18). Re-found in Phase 3/4 while widening
`ClinicalTeamViewerRole` to admit `"sna"` — flagged again there rather
than fixed, to avoid an unrelated rename touching every call site of
`ClinicalTeamSection` in the same change as the SNA work.

**Why not fixed yet:** a rename touches every caller
(`TeacherPassportPage`, `SnaPassportPage`, `ParentClinicalTeamCard`,
the clinician passport view) for a purely cosmetic inconsistency with
no behavioural effect — real scope creep relative to whatever prompted
touching this file.

**How to apply, when someone picks this up:** rename
`ClinicalTeamViewerRole`'s `"teacher"` member to `"class_teacher"`,
update the two conditionals in `ClinicalTeamSection.tsx` that check
`viewerRole === "teacher"`, and update every call site that passes the
literal `"teacher"` string. Grep for `viewerRole="teacher"` and
`ClinicalTeamViewerRole` to find them all.
