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

## Auth screen header markup duplicated across 5 pages, no shared layout

`/login`, `/register`, `/forgot-password`, `/reset-password`, and
`/verify-email` each hand-roll an identical
`logo → wordmark → heading` header block (`<div className="mb-6 flex
flex-col items-center gap-2 text-center">` wrapping `<BrandMark />`
and an `<h1>`) inside their own `page.tsx`/`*Content.tsx` — there's no
shared `AuthLayout` component or route-group `layout.tsx` for the auth
family.

Found while adding the "Behaviour Passport" wordmark to `/login` and
`/register` (2026-08-21): since there's no shared component, the
wordmark had to be added to both files by hand rather than once in a
shared place. `/forgot-password`, `/reset-password`, and
`/verify-email` still have the old logo-then-heading layout (no
wordmark) — they weren't in scope for that change, so they're now
visually inconsistent with `/login` and `/register` until someone
either adds the wordmark to them too or this gets consolidated.

**Why not fixed yet:** extracting a shared `AuthLayout` and doing the
wordmark rollout to all 5 screens was out of scope for a "small
copy/layout change" to just login/register.

**How to apply, when someone picks this up:** extract a shared
`<AuthHeader logo wordmark? heading />`-style component (or a route
group layout) from the duplicated block in
`src/app/login/LoginContent.tsx` / `src/app/register/page.tsx`, then
migrate `src/app/forgot-password/page.tsx`,
`src/app/reset-password/page.tsx`, and
`src/app/verify-email/VerifyEmailContent.tsx` onto it — decide then
whether the wordmark belongs on all 5 screens or stays login/register-only.
