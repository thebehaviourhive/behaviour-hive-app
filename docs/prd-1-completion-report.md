# PRD 1 — Staff Lifecycle & Principal Access Protocol: Completion Report

Written at the close of Stage 7. This is the input to PRD 2, not a
victory lap — every section below is written to be checked against the
live schema, not taken on trust.

---

## 1. The architecture, as it stands

### 1.1 How a child comes to exist

Two paths, genuinely different, both live:

- **Parent self-creates.** `passport/section-a` — a `passports` row with
  `user_id` set directly. Pre-dates this PRD entirely. Still the only
  write path for a passport's Section A fields (`date_of_birth`,
  `school`, `important_people`, `diagnoses`).
- **School-creates.** `create_school_passport()` (Stage 6, migration
  `0113`/`0121`) — a principal names a child, and in one atomic
  transaction: the `passports` row (`child_name` and
  `passport_status = 'not_started'` only — nothing else), a
  `passport_institution_links` row, and an `enrolments` row all come into
  existence together. No Section A content. A guardian later claims it
  (below) and can *see* it, but there is still no UI path for a claimed
  guardian to *complete* Section A on a school-created passport — see
  §2.

A child can exist under **both** paths independently — nothing merges
them. A parent who already has a self-created passport and later claims
a school-created one for the same child ends up with two rows. This is
named, not fixed (§2, §4).

### 1.2 Institution membership and staff authority

`institution_staff` is the one table every authority check ultimately
traces back to: `institution_id`, `user_id`, `role`
(`principal`/`class_teacher`/`sna`; `institution_admin` exists as a
schema-level role with **no reachable onboarding path**, unchanged since
migration `0033`), `approved_at`/`approved_by`, `deactivated_at`/
`deactivated_by`/`deactivation_reason`.

- **Joining** is a direct client-side insert of a row into
  `institution_staff`, self-keyed (`src/app/teacher/join-institution/
  page.tsx` — the only client-side INSERT into this table anywhere in the
  codebase). It lands `pending` unless the institution has no active
  principal at all, in which case it auto-approves (the bootstrap rule —
  bounded by `institution_staff_one_principal_per_institution`, which
  caps this at exactly one wrong founding principal, discoverable the
  same way a genuine second-principal collision surfaces).
- **Approval** is `approve_staff_join()`/`reject_staff_join()`,
  principal-only, same-institution-only, append-only (a rejected row is
  terminal; re-requesting is a new row).
- **The canonical "is this person currently real staff here" check** is
  `institution_staff_has_current_standing(user_id, institution_id)`
  (migration `0105`) — `approved_at is not null and deactivated_at is
  null`. **Nine independent lineages** check this membership across the
  schema; three were found hand-writing the `deactivated_at` condition
  incorrectly (fixed this stage, `0119`) and the two roster RPCs were
  found checking `approved_at` for the caller but never `deactivated_at`
  (fixed, `0120`). Any new code checking institution membership must use
  this helper — it has now been got wrong four separate times by hand.
- **Deactivation** (`deactivate_institution_staff()`) cascades narrowly:
  `passport_access`, `class_teachers`, `child_assignments` rows for that
  person at that institution are closed. It cannot target a principal —
  `institution_staff_one_principal_per_institution`'s ALLOW branch needs
  two simultaneously active principals, a state the index excludes by
  design.
- **Principal handover** (`hand_over_principal()`, atomic) is the only
  way a principal ever stops being one through the product. The outgoing
  principal either leaves (deactivated, cascade fires) or steps down to
  `class_teacher`/`sna` (no cascade — they keep the children they work
  with). The successor's row is closed with `role_change` and a new
  `principal` row inserted, same transaction — the institution is never
  observably principal-less, even momentarily.
- **A principal who leaves without handing over** has no in-product
  recovery path at all. This is the one case `institution_admin`
  onboarding (C-08) actually exists to solve, and it doesn't exist yet —
  see §2.

### 1.3 Enrolment vs. access — two different questions

Stage 6 drew a line this system didn't have before: **"is this child a
pupil here"** (`enrolments`) is a separate question from **"who can see
this child's passport"** (below). An `enrolments` row has
`started_at/started_by`, `ended_at/ended_by/end_reason` (paired, one of
three closed values: `graduated`/`left`/`transferred`), and a partial
unique index enforcing at most one active enrolment per child — checked
empirically at Stage 6's own outset; production had zero passports with
two simultaneous institution links, so the constraint shipped with no
backfill needed.

Ending an enrolment (`end_enrolment()`, principal-only, same-institution)
cascades **narrowly and deliberately**: it closes `class_children`,
`child_assignments`, `passport_access`, and (since Stage 7) any
`clinician_access` row this institution itself engaged — all scoped to
`institution_id`, proven not to touch a second institution's own grants
on the same child (`JJ-5d`, and its `clinician_access` mirror `KK-24`).
It deliberately does **not** touch `passport_institution_links.
approved_by_parent` (that flag is the parent's own consent, not a
principal's to clear) or `incidents`/`owning_teacher_id` (an incident's
authorship and countersign chain outlives the enrolment that produced
it — matching a decision migration `0069` made independently, years
before Stage 6 existed, re-confirmed rather than re-litigated).

### 1.4 How access to a specific child is derived — the real complexity

There is no single "access" table. **Five independent mechanisms** grant
a staff member or clinician the ability to see a specific child, plus a
sixth for guardianship itself:

1. **`passport_access`** — an explicit, named grant
   (`grant_passport_access()`/`revoke_passport_access()`), principal-only,
   full audit trail (`granted_by`/`revoked_at`/`revoked_by`/
   `revocation_reason`).
2. **Class membership** — `class_children` + `class_teachers` +
   `institution_staff`. A class teacher sees every child on their class
   roster without any per-child grant at all.
3. **`child_assignments`** — standing SNA-to-child assignment, one
   active assignment per child, same paired-columns/partial-unique-index
   shape as `enrolments`.
4. **Temporary, day-scoped cover** (Stage 3,
   `grant_temporary_access()`) — a genuinely separate mechanism from #3,
   activates at a fixed 07:30 local cut-off, expires at end of day.
5. **`clinician_access`** (Stage 7) — its own axis entirely, split by
   `engaged_by` (`'parent'` or `'institution'`), never merged with the
   staff-access mechanisms above. A clinician's access to a child has
   nothing to do with `institution_staff` at all.

All of #1–#3 are unified behind one chokepoint function,
**`has_child_access(user_id, passport_id)`** (`has_class_teacher_access()`
OR `has_sna_access()`, migration `0104`) — the single place that decides
"can this staff member see this child." #4 is checked separately
(`has_sna_access()`'s own fourth branch, added Stage 3). Every RPC that
resolves "children I can access" is supposed to route through this
chokepoint or its own roster-scoped equivalent
(`get_institution_child_roster()`) rather than reading a table directly —
**this has been the single most common bug class across the whole PRD**:
`useSnaChildren.ts` reading `class_children` directly instead of through
`has_sna_access()` (fixed Stage 3), `/sna/passports` querying
`passport_access` directly instead of via the chokepoint (fixed Stage 3),
`/sna/passport/[passportId]`'s own guard predating the chokepoint
entirely (fixed Stage 3), a passport list page's `.maybeSingle()`
assuming one row per parent (fixed Stage 5). See §4 for one instance of
this class that is **not yet fixed**.

**Ownership is separate again.** `passport_guardians` (Stage 5) +
`owns_passport()` is the parent/guardian's own claim to a passport — not
"access" in the staff sense at all, and not scoped to any institution.

### 1.5 Who can do what — the practical summary

| Role | Sees | Can grant/revoke | Cannot |
|---|---|---|---|
| **Principal** | Every child on the institution's roster (`get_institution_child_roster()`) | `passport_access`, class/SNA assignment, temporary cover, claim codes, `clinician_access` (institution side), staff deactivation, handover | Revoke a parent's or another institution's own `clinician_access`; edit a passport's Section A content; act on incidents outside their own institution |
| **Class teacher** | Their own class roster + any explicit `passport_access` grant | Nothing beyond logging incidents/ABC data for children they can already see | Grant access to anyone; see children outside their own class/grants |
| **SNA** | Standing-assigned children + temporary-cover children for the current day | Nothing | Grant access; see children outside their assignment |
| **Parent/guardian** | Their own child(ren) via `passport_guardians` | Approving a school by code (`passport_institution_links.approved_by_parent`, one direction only — see §4.1, revoking is no longer offered); `clinician_access` (parent side) | Revoke a school's own access at all — removed deliberately (§4.1), not a gap; edit a school-created passport's Section A |
| **Clinician** | Every child they are `clinician_access`-engaged for, either authority | Their own engagement, always (self-revoke, either authority) | Anything about staff, classes, or enrolment |

---

## 2. Every deferred and parked item, what is owed

Consolidated from CLAUDE.md's own "Deferred work" section plus this
session's own findings — one list, not scattered across seven stages'
worth of notes.

1. **`institution_admin` onboarding (C-08).** Referenced as the proper
   fix in three separate places across this PRD (join-approval
   delegation, abandoned-principal recovery, and implicitly every "no
   reachable UI" gap below). No onboarding path exists at all. Owed: a
   real design pass — who invites an `institution_admin`, what they can
   do that a principal can't, how the abandoned-principal case actually
   resolves through them rather than a support ticket.

2. **Abandoned principal recovery.** Currently a documented,
   service-role support operation, not a product feature. Blocked on
   #1.

3. **The `passport_guardians` dual-write trigger
   (`sync_passport_guardian_from_user_id()`, `0113`) is a bridge, not
   permanent.** Every fixture and the real signup flow still writes
   `passports.user_id` directly; the trigger keeps `passport_guardians`
   in sync underneath. Owed, in order: (a) every write path that
   establishes guardianship writes `passport_guardians` directly, not
   via `user_id`; (b) no fixture sets `user_id` as its way of
   establishing guardian state; (c) `passports.user_id`'s own
   `unique(user_id)` constraint is retired once nothing still targets it
   as an `onConflict`. Two live blockers on (c): `passport/section-a`
   and `passport/welcome`'s own upserts, and `usePassportSection{B,C,D}.
   ts`'s three `onConflict: "user_id"` targets — Step 1b (switch to
   `passport_id`, then drop the old constraints) is mechanical and still
   unstarted.

4. **A claimed, school-created passport can be read but not completed.**
   `passport/section-a` is the only UI that writes Section A fields, and
   it's still `user_id`-keyed — a claimed guardian landing there
   directly would silently start a second, unrelated passport rather
   than complete the one they claimed. Currently contained (not solved)
   by `passport/welcome`'s own redirect: a parent with any existing
   passport never sees the create-new form. The real fix — extend
   Section A's write path to guardian-based auth, or build a dedicated
   completion flow — is unstarted.

5. **Clinician double-engagement** (`unique(passport_id, clinician_id)`)
   — a family's own private clinician cannot also be the school's formal
   engagement for the same child at the same time. Both write paths
   refuse the second attempt with a real explanation, not a raw
   constraint error, so the gap is never silent — but the underlying
   case (rare, real) has no resolution. Owed: a second row or join table
   representing two independent authorities over one relationship, if
   this turns out to matter in practice.

6. **Cross-institution / multi-role access** — `grant_temporary_access()`
   grants real database-level access to a supply teacher covering a
   different institution, but `app_metadata.role` is a single JWT claim
   used for all primary navigation routing (`useRequireRole`/
   `getPostAuthRedirect`). Someone whose account already claims a role
   has no reachable screen for a *second* role's own access, even though
   the grant is real. See §4 — this is broader than the one instance
   already named.

7. **`fetchApprovedInstitutionPhone()`
   ([src/lib/messages/institutionPhone.ts](../src/lib/messages/institutionPhone.ts))
   can show the wrong school's emergency contact number** — its query is
   `passport_id` + `approved_by_parent = true`, `.limit(1)`, with no
   `institution_id` scoping, for a child genuinely linked to two
   institutions at once (confirmed reachable, not theoretical). This is
   the compose sheet's tap-to-call fallback. Real, not fixed, needs the
   caller's own institution context threaded through rather than a bare
   passport-level lookup.

8. **Two guardians of the same passport can each submit their own
   morning check-in** the same day — `morning_checkins`' own RLS is
   correctly `user_id`-scoped (own-contributor semantics, not an
   ownership bug), but `parent-dashboard/page.tsx`'s own query answers
   "did *I* submit today" when the card's intent is passport-scoped.
   Pure client-query fix, no migration needed, unstarted.

9. **`revoke_passport_claim_code()` is dead code.** Built (`0114`/
   `0115`), no client caller anywhere — the principal UI uses "Generate a
   new code" instead, which atomically revokes-and-reissues, a working
   substitute for the common case. `get_passport_claim_code_status()`
   doesn't return the code's own `id`, so there's nothing for a
   standalone "Revoke" button to call yet.

10. **A parent's own "Revoke Access" does not close class-derived
    access.** New finding this pass, not previously documented — see §4,
    it's substantial enough to warrant its own entry there rather than a
    one-line summary here.

---

## 3. Known limitations, accepted deliberately — and why

These were *decided*, not missed. Each one has a real reason, recorded
at the time:

- **No forced incident reassignment when enrolment ends.** An incident's
  `owning_teacher_id` survives untouched. Re-confirmed against migration
  `0069`'s own original decision (years before Stage 6 existed) rather
  than re-litigated — an incident record's authorship is a historical
  fact, not a live assignment to transfer.
- **Enrolment ending doesn't touch `approved_by_parent`.** A principal
  ending a child's enrolment is a school-side administrative fact; a
  parent's consent to be contactable by that school is the parent's own,
  separate decision. Conflating them would let a principal unilaterally
  revoke something that was never theirs to grant.
- **Staff departure and handover never cascade to `clinician_access`.**
  "The engagement belongs to the institution, not the person who created
  it, the same way a class survives its teacher leaving." A principal
  who engaged a clinician and later leaves doesn't take that
  relationship with them.
- **The `'grandfathered'` `approval_source` value is a permanent,
  unrepeatable historical fact,** the signature of migration `0101`'s
  one-time backfill. No live path can ever produce it again — the one
  test fixture that referenced it was correctly torn down as debris, and
  the adversarial check that used to depend on it is now a named,
  reasoned skip rather than either restored or silently dropped.
- **The principal sees both a parent's and the institution's own
  clinician engagements, read-only on the ones they don't hold
  authority over.** Deliberate symmetry — "a school engaging a clinician
  for someone's child is not something a parent should discover by
  accident," and the mirror is true for a principal too. Neither
  authority can revoke the other's engagement; both can see it.

---

## 4. What's wrong or fragile that we have not addressed

This section exists because "verified" and "sound" are different
claims. Everything here is real and code-verified this pass, not a
hunch.

### 4.1 A parent's "Revoke Access" did not close a school's class-derived access — RESOLVED BY REMOVAL, not a fix

**Update, same session this report was written in:** originally reported
here as a bug to fix (a parent's "Revoke Access" only touched
`passport_institution_links.approved_by_parent` and that institution's
`passport_access` rows, never `class_children`/`child_assignments` —
`has_class_teacher_access()`/`has_sna_access()`, migration `0104`, never
checked `approved_by_parent` at all, by Stage 4's own deliberate design).
Daniel's call, correctly: this was never a bug to fix. **The action
itself has been removed.** The school owns the child's file once
enrolled — a parent revoking a school's access to a child who attends
that school was a leftover from the parent-led model this PRD moved
past, not a control the product should have kept offering. Ending a
school's own access to a child is now exclusively `end_enrolment()`, a
principal's action.

Whether class-derived access "should" have survived the old revoke path
no longer matters — nothing calls it any more. Named here only so the
history is legible: this was found as a live gap, and closed by removing
the feature it lived in, not by extending its cascade.

**What goes with this removal — audited, not yet decided, in a separate
pass the same session:** the approved-institutions list on
`passport/dashboard` (kept, read-only, for now), `ShareBottomSheet`'s own
school-approval-by-code flow (kept, unchanged, for now — Daniel's own
framing: "the old direction entirely," a live open question), and every
place the product's consent/privacy copy promises a parent controls
school access (two locations, both flagged for the pending
consent-copy rewrite, not touched here). See the session notes for the
full audit; this report is not restated to duplicate it.

### 4.2 The access-derivation surface is wide, and nothing structurally enforces routing through it

Five independent access mechanisms (§1.4) is a lot of surface for a new
screen to get wrong by reading a table directly instead of going through
`has_child_access()`/the roster RPCs. This has already happened
repeatedly — three separate "grant access, but the destination screen
reads the wrong thing" bugs were found and fixed across Stages 3–4
(`useSnaChildren.ts`, `/sna/passports`, `/sna/passport/[passportId]`),
plus a `.maybeSingle()` assumption in Stage 5. Every one of those was
found by hand, via live browser verification, not by any structural
guarantee. There is no lint rule, no single mandatory hook, nothing that
would stop a sixth instance of the same class shipping tomorrow. The
"test the destination" discipline (CLAUDE.md) catches this reactively,
per-feature; nothing catches it proactively.

### 4.3 Single-role-per-account is a real architectural constraint, not just a temporary-access edge case

`app_metadata.role` is one claim. Every routing decision
(`useRequireRole`, `getPostAuthRedirect`) is built on the assumption a
person is exactly one thing. This has already surfaced once, narrowly
(§2.6, a supply teacher covering a second institution with real
database-level access and no screen to reach it). The same constraint is
broader than that one instance: a parent who is also a class teacher at
their own child's school, a clinician who is also a parent — none of
these are exotic in a special-education context, and none of them are
representable today without a second account. This wants a real product
decision (does Behaviour Hive support multiple roles per person, and if
so which combinations), not an accretion of one-off workarounds each
time a new instance is found.

---

## 5. What I would do next

In priority order, and why:

1. **§4.1 is done — removed, not fixed.** Follow through on what it
   implies: rewrite the consent/privacy copy that still promises a
   parent can revoke a school's access (two locations, listed and
   handed off separately), and decide the fate of the read-only
   approved-institutions list and `ShareBottomSheet`'s own
   approve-by-code flow, both currently kept as-is pending that
   decision.

2. **Scope `institution_admin` onboarding as PRD 2's own first stage,
   not a someday item.** It's been "the proper fix" for three separate
   gaps across this PRD (join-approval delegation, abandoned-principal
   recovery, and implicitly every "no self-serve path" gap along the
   way) without ever being scoped as real work. Every time it comes up
   again, that's a sign it's overdue, not a sign it can keep waiting.

3. **Make a real product decision on multi-role accounts (§4.3)** before
   the next instance of the single-role constraint forces a rushed
   one-off fix. This is a product question first, an engineering one
   second.

4. **Retire the `passport_guardians` dual-write trigger.** Not urgent,
   but it's real debt: every day it stays live is another day new code
   could accidentally write `passports.user_id` instead of
   `passport_guardians` and still appear to work, right up until it
   doesn't. Step 1b (the `onConflict` migration) is mechanical and
   low-risk — there's no reason for it to still be open.

5. **Fix `fetchApprovedInstitutionPhone()` (§2.7).** Small, contained,
   and it's the emergency-contact fallback — the cost of it being wrong
   is higher than its size suggests.

6. **Consider a single, mandatory "why can I see this child"
   resolution point** for anything client-side that currently guesses
   at "children I can access" by reading a table directly, rather than
   continuing to catch each new instance of §4.2's bug class by hand
   after it ships. Not urgent on its own, but worth deciding whether
   PRD 2's own new screens should be required to go through it from day
   one, rather than inheriting the same risk by default.

None of the above blocks PRD 2 from starting. All of it is worth reading
before PRD 2 decides what it's building on top of.
