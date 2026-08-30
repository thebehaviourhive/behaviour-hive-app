# PRD 2 input — principal screen inventory & RPC/table coverage

Factual only, no recommendations, no building. Read directly from the current codebase (`main`, commit `500d986`), not from memory of what was built.

---

## 1. The current `/principal` screen inventory

Seven files, five top-level routes:

### `/principal/dashboard` — [src/app/principal/dashboard/page.tsx](src/app/principal/dashboard/page.tsx)

**What's on it**: header (institution name, links to Classes/Staff/Incidents, a "record incident" button) → `AttestationPromptCard` → two incident lists: "Awaiting sign-off" (client-side filter: `teacher_signed_at` set, `countersigned_at` not) and "All incidents". Each row shows date, status pill, location, child count, owning teacher, an inherited-incident badge, restrictive-practice planning-status pills, debrief-required flag.

**Own components**: `IncidentRow` (local, not exported), `AttestationPromptCard` (shared, from `components/incident-log`).

**Load sequence**: resolve principal's own `institution_staff` row → best-effort `resolve_lapsed_incident_ownership()` (lazy materialization, errors swallowed) → `get_institution_incidents()`.

**Reusable for PRD 2**: the incident list/row rendering is a real candidate to fold into a tab; the "awaiting sign-off" split logic is pure client-side derivation from `get_institution_incidents()`'s own return shape, easy to lift as-is.

### `/principal/incidents` — [src/app/principal/incidents/page.tsx](src/app/principal/incidents/page.tsx)

**What's on it**: date-range + planning-status + NCSE-complete filter form, a CSV export button, and a filtered incident list (same row shape as the dashboard's, independently duplicated — not shared).

**Own components**: none exported; everything inline.

**Load**: same `resolve_lapsed_incident_ownership()` + `get_institution_incidents()` call, this time with the four filter params it already supports (`p_start`/`p_end`/`p_planning_status`/`p_ncse_complete`).

**Reusable for PRD 2**: this is effectively "the dashboard's own incident list, plus filters, plus export" — a second, independent implementation of the same list. A real candidate for merging with the dashboard's own list into one component with an optional filter bar, rather than kept as two separately-maintained copies.

### `/principal/staff` — [src/app/principal/staff/page.tsx](src/app/principal/staff/page.tsx)

**What's on it**: a flat staff list (active/pending/deactivated, one list, status pill per row) + a collapsed "Rejected requests" history section. Each active row: Deactivate button (unless self) or Hand Over button (if self + principal). Each pending row: Review Request button.

**Own components**: `StaffCard` (local). Sheets: `DeactivateStaffSheet`, `ReviewStaffJoinSheet`, `HandOverPrincipalSheet` (all `components/principal`).

**Load**: `get_institution_staff_roster(p_include_inactive: true, p_include_pending: true)` + `get_rejected_staff_joins()`, in parallel.

**Reusable for PRD 2**: the roster RPC and the three sheets are all clean, self-contained units — no rework needed to reuse the underlying data/actions in a different screen shape.

### `/principal/classes` — [src/app/principal/classes/page.tsx](src/app/principal/classes/page.tsx)

**What's on it**: a class list (name, teacher count, child count) + a temporary-cover cutoff-time display/edit control + a "+" create button.

**Own components**: `CreateClassSheet`, `SetCutoffSheet`.

**Load**: raw `classes` table select (`.eq("institution_id", ...)`, no RPC) → then, for teacher/child counts, two more raw table reads (`class_teachers`/`class_children`, `.is("ended_at", null)`, counted client-side) → separately, `institutions.temporary_access_cutoff_time` (raw select).

**No RPC exists for a class roster/list** — this page is entirely raw table reads composed client-side. See §2.

### `/principal/classes/[classId]` — [src/app/principal/classes/[classId]/page.tsx](src/app/principal/classes/[classId]/page.tsx)

**What's on it**: the single richest principal screen today. Four sections: Teachers (active/removed, 3-slot cap), Roster (active/removed children, each with an "Assign SNA"/"Reassign SNA" + Remove action), Temporary Cover (active/past grants, class-scoped, grant/revoke).

**Own components**: `AddClassTeacherSheet`, `AddClassChildSheet` (both `components/principal`); `AssignSnaSheet`, `GrantTemporaryAccessSheet`, `ReasonConfirmSheet` (all `components/shared` — already role-agnostic, teacher/class page reuses the same three).

**Load**: raw `classes` row select → in parallel: raw `class_teachers`/`class_children` selects (this class only), `get_institution_staff_roster(p_include_inactive: true)`, `get_institution_child_roster()` (for name resolution only), `institutions.temporary_access_cutoff_time`, raw `temporary_access` select scoped to `class_id` → then a further raw `child_assignments` select scoped to this class's own active passport ids (SNA assignment lookup, since that table has no roster RPC either).

**Reusable for PRD 2**: `AssignSnaSheet`/`GrantTemporaryAccessSheet`/`ReasonConfirmSheet` are already shared, teacher-track-compatible components — no porting needed. The name-resolution pattern (two roster RPCs called purely to build `Map<id, name>` lookups) recurs on almost every principal screen — see §2's roster-RPC answer.

### `/principal/passports` — [src/app/principal/passports/page.tsx](src/app/principal/passports/page.tsx)

**What's on it**: a searchable child list, split Active / collapsed "Past Pupils" (by `enrolment_ended_at`), a "+ Enrol" button.

**Own components**: `EnrolChildSheet`.

**Load**: `get_institution_child_roster()` only (returns `passport_id`, `child_name`, `enrolment_ended_at` — three columns, see §2).

### `/principal/passports/[passportId]` — [src/app/principal/passports/[passportId]/page.tsx](src/app/principal/passports/[passportId]/page.tsx)

**What's on it**: the second-richest principal screen. Four sections: Enrolment (status badge + End Enrolment action), Parent/Guardian (claimed guardian list, or an outstanding claim code + regenerate, or a "generate code" empty state), Current Access (active/collapsed-history `passport_access` grants, grant/revoke), Clinical Team (both engaged_by authorities shown, revoke offered only for this institution's own `engaged_by='institution'` rows).

**Own components**: `GrantPassportAccessSheet`, `EndEnrolmentSheet`, `GrantClinicianAccessSheet` (all `components/principal`); `ReasonConfirmSheet` (shared, two independent instances — access revoke and clinician revoke).

**Load**: resolve principal's own institution → `get_institution_child_roster()` (to confirm this child is genuinely on the roster; a stale/wrong `passportId` resolves to an honest "not on your roster" state, not a crash) → in parallel: `get_passport_access_for_child()`, `get_institution_staff_roster()`, `get_passport_guardians_for_child()`, `get_passport_claim_code_status()`, a raw `enrolments` select (this passport + this institution, most recent), `get_passport_clinicians()`.

**Reusable for PRD 2**: this screen is effectively "everything about one child, from the school's side" already — the closest existing thing to what a PRD 2 child-detail tab would need. Every RPC it calls already returns institution-scoped, principal-authorized data.

---

## 2. RPC/table coverage — the five specific questions, then the general pattern

### Is there a roster/list RPC for children, staff, classes?

- **Children**: yes — `get_institution_child_roster(p_institution_id)`. Returns exactly `passport_id, child_name, enrolment_ended_at` (three columns, confirmed from the live definition, migration `0122`). No class membership, no diagnosis/age info, no clinical-team count, nothing else.
- **Staff**: yes — `get_institution_staff_roster(p_institution_id, p_include_inactive, p_include_pending)`. Returns `id, user_id, full_name, role, is_active, is_pending`.
- **Classes**: **no RPC exists.** Both `/principal/classes` and `/principal/classes/[classId]` read the `classes` table directly, then separately read `class_teachers`/`class_children` to derive counts/membership client-side. Building a `get_institution_classes_roster()`-shaped RPC (matching the other two roster RPCs' own naming/shape convention) is new SQL, not wiring.

### Does anything today surface "children enrolled but not assigned to a class"?

**No.** `get_institution_child_roster()`'s three columns have no class-membership field at all. Cross-referencing "enrolled" (from `enrolments`, already in the roster RPC as `enrolment_ended_at`) against "has an active `class_children` row" would need either: (a) a new column added to the existing roster RPC (a `LEFT JOIN` to `class_children`, one more `DROP + CREATE` matching `0122`'s own precedent for widening this exact function), or (b) a new dedicated RPC. Either way, new SQL — nothing today computes or returns this.

### Is there any RPC returning the dashboard's outstanding items, or does that need building?

**Needs building, in full.** Nothing today aggregates "things needing a principal's attention" across categories. What exists, scattered:
- Incidents awaiting sign-off: derived **client-side** from `get_institution_incidents()`'s own rows (`teacher_signed_at` set, `countersigned_at` not) — no RPC-level "outstanding count," just a full row-set the client filters.
- Pending staff joins: derived **client-side** from `get_institution_staff_roster()`'s own `is_pending` flag — same pattern, no dedicated "how many pending" RPC.
- **`school_notices` already has principal-relevant notice types** (`staff_join_requested`, `principal_handover`, added migrations `0100`/`0102`) — the backend writes these rows — **but no principal-side screen reads `school_notices` at all** (confirmed: zero references in `src/app/principal` or `src/components/principal`). A principal currently discovers a pending join only by visiting `/principal/staff` and seeing the badge, not from any notice/inbox. If PRD 2 wants a unified "outstanding items" feed, `school_notices` is the closest existing building block, but nothing currently reads it from the principal side, and it may not cover every category an "outstanding items" view would want (no notice type yet for, say, "child enrolled but unassigned to a class," "claim code expiring soon," or "temporary cover ending without a permanent SNA assigned").
- Nothing anywhere returns claim-code expiry status in aggregate (only per-child, via `get_passport_claim_code_status()`, called one passport at a time on the detail page).

### What surfaces temporary access grants for a principal to see?

**Only a raw, class-scoped table read** — `classes/[classId]/page.tsx`'s own direct `.from("temporary_access").select(...).eq("class_id", classId)`. No RPC. No institution-wide view: a principal cannot see "every temporary cover grant active today across the whole school" anywhere today — they'd have to open every class individually. `classes/page.tsx` itself only reads `institutions.temporary_access_cutoff_time` (the cutoff setting), not the grants table.

### What returns a child's clinical team with `engaged_by`?

**Yes, fully built** — `get_passport_clinicians(p_passport_id)` (extended migration `0124`), returns `clinician_access_id, clinician_id, full_name, specialty, last_review_date, linked_at, engaged_by, engaged_by_institution_id, engaged_by_institution_name`. Already authorized for both the owning parent and a principal at any linked institution (its own `WHERE` clause covers both). Already wired into `/principal/passports/[passportId]`'s own Clinical Team section — this one is fully "wiring, not building" if PRD 2 needs it elsewhere.

### The general pattern, across all seven screens

Two RPCs (`get_institution_child_roster`, `get_institution_staff_roster`) do essentially all of the "who/what is at this school" work; everything else layers on top with either purpose-built RPCs (one per specific write-action or detail view — `get_passport_access_for_child`, `get_passport_guardians_for_child`, `get_passport_claim_code_status`, `get_passport_clinicians`, `get_rejected_staff_joins`, `get_staff_deactivation_preview`) or raw table reads scoped by hand in the client (`classes`, `class_teachers`, `class_children`, `child_assignments`, `temporary_access`, `enrolments`, `institutions.temporary_access_cutoff_time`). The three areas with **no RPC at all today** are classes-as-a-roster, temporary-access-grants-in-aggregate, and any cross-cutting "outstanding items" view — those three are where PRD 2's own sequencing needs to budget for new SQL, not just new screens.
