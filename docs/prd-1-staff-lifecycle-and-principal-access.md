# PRD 1 — Staff Lifecycle & Principal Access Protocol

Status: draft, in progress. Sections below are added as Daniel writes them;
absence of a section number here means it hasn't been provided yet, not
that it's been decided and omitted.

Stage 1 of this PRD (institution_staff gains a real membership state —
`deactivated_at`/`deactivated_by`/`deactivation_reason`, the
`deactivate_institution_staff()` RPC, active-membership gating across
every call site that reads `institution_staff`) is built and running —
migration `0097_institution_staff_lifecycle.sql`.

---

## 2.4b Institution join approval

**Ordering: this comes before 2.4c (handover), not after.** Handover hands the highest-privilege role in the product to someone who joined through an unapproved path — approval has to exist first, or handover just moves the problem to a more privileged seat.

**Why this is an access problem, not an empty-dashboard problem.** Institution codes are openly readable by design (migration `0009`'s own stated model). Today that's low-stakes: joining with a code gets you a dashboard with nothing in it until a parent separately grants `passport_access`. Under this PRD, institution membership itself confers roster-tier read access to every child in the school — the incident log's own `get_institution_child_roster()`/`get_institution_staff_roster()` shape, not a per-child grant. The moment that's true, "anyone who knows a code can join" stops being a UX gap and becomes a real access boundary with nothing behind it.

**Shape:**

- A pending state on `institution_staff` — `approved_at`/`approved_by`, nullable, same shape as `deactivated_at`/`deactivated_by`. Not approved means not active, full stop: every Stage 1 call site that now checks `deactivated_at is null` also needs `approved_at is not null` alongside it — the exact same call-site map Stage 1 already built becomes this feature's scaffolding, not new discovery work.
- A principal-facing approve/reject action, mirroring `deactivate_institution_staff()`'s own shape (active-principal-only, same-institution-only).
- A notice to the principal when someone requests — reuse `school_notices` with a new `notice_type`, not a new table; this is exactly the "something needs a principal's attention" pattern that table already exists for.
- A clear pending screen for the requester — not the join form again, not a broken dashboard; a third, honest state alongside "here's the form" and "here's your dashboard."
- Append-only. A rejected request is never deleted — same discipline as attestation withdrawal and amendments elsewhere in this build. A rejected row is terminal; if the person should join later, that's a new request, not a reopened one — matching "reactivation is a new row," not a null-out.

**Grandfathering existing joins: approved.** Backfill every existing `institution_staff` row with `approved_at = created_at`, `approved_by = null` — null, not a fabricated approver, since nothing in the old ungated model recorded one and inventing one would break the same "two honest facts, nothing invented" discipline `countersigned_via` was built on. The alternative — retroactively unapproving everyone — locks out every live fixture and any real school mid-build for no real gain; there is no way to reconstruct after the fact whether an old join would have been approved.

**The bootstrap problem: auto-approve a principal-role join if and only if the institution currently has no active principal.** Bounded by the constraint that already exists — `institution_staff_one_principal_per_institution` caps this at exactly one wrong founding principal, discoverable the same way a second-principal collision already surfaces today. Every `class_teacher`/`sna` join is gated unconditionally, including ones that arrive before any principal exists — they sit pending until one does. This rule has a useful second property, not a coincidence: "no active principal" is also true for 2.4c's own abandoned-principal case once Behaviour Hive resolves it out-of-band — the same auto-approve rule covers both a genuinely new institution and a recovered abandoned one, with no second mechanism.

This is deliberately NOT built on `institution_admin` (C-08, no reachable onboarding since migration `0033`). That role is the more principled long-term answer — approving on the institution's behalf as a real, onboarded role rather than a bounded-risk bootstrap rule — but it's separate, materially bigger work, and nothing here blocks building it later. The bootstrap rule above would simply become unreachable once it exists, the same way four of Stage 1's own checks are structural until handover ships.

**Stage prompt shape, for whenever this is built — not written as a runnable prompt yet:**

- *Mission*: institution join requires principal approval before any access is granted; no ordinary path exists today for a principal to see, approve, or reject who joins their school.
- *Step 0 — Recon*: every current read/write of `institution_staff`'s INSERT policy and the self-link flow; every downstream consumer that currently treats "row exists" as "may act" and will now need "row exists AND approved" instead (the Stage 1 call-site list, re-audited, not re-discovered).
- *Step 1 — SQL*: `approved_at`/`approved_by` columns, the auto-approve rule (no-active-principal), the grandfathering backfill, `approve`/`reject_staff_join()` RPCs mirroring `deactivate_institution_staff()`'s authorization shape, the `school_notices` notice type.
- *Step 2 — Adversarial coverage*: written before client code, per the standing rule. Must include: a pending join grants nothing until approved; grandfathered rows still work exactly as before; the auto-approve rule fires only when genuinely no active principal exists, and not otherwise; a rejected request stays rejected and visible, never deleted, and re-requesting creates a new row; principal-only approve/reject, same-institution-only.
- *Step 3 — Client*: the pending screen for the requester, the principal's approve/reject surface (likely folded into the existing `/principal/staff` list rather than a separate page — a pending row is just another state alongside active/deactivated).
- *VERIFY*: same checklist as Stage 1 — every call site listed with its check, full suite green, `tsc`/`eslint` clean, live-verified on the DEPLOYED app (not local-dev) against a disposable fixture, migration run and committed, deployed SHA confirmed.
- *Do not build in this pass*: `institution_admin` onboarding itself (the bootstrap rule stands in for it); any change to `passport_access`/child-level grants; anything from Stage 2 (classes, assignment).

## 2.4c Principal handover

**Depends on 2.4b (join approval) shipping first.** Handover promotes an existing active staff member to principal — if that staff member joined through an unapproved path, handover would be handing the highest-privilege role in the product to someone nobody vetted. 2.4b closes that before this is built.

`institution_staff_one_principal_per_institution` permits one active principal per institution, and `deactivate_institution_staff()` requires an active principal caller who is not the target. Together those mean a principal can never be deactivated by any ordinary path - a departed principal would keep institution-wide access to every child's record indefinitely.

Handover is the answer, and it must be atomic: the successor is promoted and the predecessor stood down in a single transaction, so the unique index never sees two active principals.

**Who initiates.** The outgoing principal. This is the normal case and it covers a planned departure, a retirement, or stepping down.

**Who succeeds.** An existing active staff member at that institution. Never an outside account, never an unclaimed invitation. The successor must already be in the building.

**What happens to the outgoing principal** — two outcomes, chosen at handover:

- **Leaving the school.** Their membership is deactivated, with the ordinary `passport_access` cascade. They lose everything.
- **Staying in another role.** They are demoted to `class_teacher` or `sna`. No cascade - they keep the children they work with.

**What happens to the successor.** Their existing row is closed with reason `role_change` and a new `principal` row is inserted. A role change never cascades. Their existing `passport_access` grants survive, because a class teacher promoted to principal has not stopped working with their class.

That gives a clean rule for the whole system: cascade on departure, never on role change.

**Recorded, not silent.** Who handed over, to whom, when, and which outcome was chosen. This is the highest-privilege change the product supports and it must be reconstructable years later. The successor is notified via `school_notices` with a new notice type.

**The abandoned case.** A principal who leaves without handing over - dismissed, ill, simply gone - cannot be resolved in-product, because the only account authorised to act is the one that has gone. This needs an out-of-band path.

The proper home for it is the `institution_admin` role, which already exists in the schema but has no reachable onboarding (flagged as C-08 since migration `0033`). Until that exists, the abandoned case is a documented support operation performed by Behaviour Hive, not a product feature. That gap must be named in the documentation rather than left to be discovered by a school with no principal and no way to appoint one.

**Owed to this stage's build prompt, VERIFY section — do not omit when Stage 1c is written up** (corrected here from an earlier "Stage 1b" slip in this same paragraph — this section is 2.4c, Stage 1c; Stage 1b is the completed join-approval stage referenced below, a different one): Stage 1 shipped four structural-only adversarial checks that could not be live-fired because no principal could be deactivated by any real path — `deactivate_institution_staff()`'s last-principal guard, `can_countersign_incident()`'s principal branch, `incident_locations` add/edit principal branches, and `mark_parent_called()`'s principal branch (see CLAUDE.md, "Deferred work"). Stage 1b (join approval) added a fifth of the same kind: `approve_staff_join()`/`reject_staff_join()`'s caller check and `derive_staff_join_approval()`'s EXISTS clause both correctly exclude a pending-or-rejected principal from counting as active, but no such row can exist to test against — a second principal-role insert at an institution that already has one fails at `institution_staff_one_principal_per_institution` outright, confirmed empirically, before it can persist in any state. Stage 1b's own Step 3 browser verification added a sixth: the pending/rejected overlay's actual on-screen rendering was verified for class_teacher/sna (live, on `/teacher/join-institution`) and the principal case's routing-away behavior was verified, but the overlay's own appearance for a principal was not — there is no pending/rejected principal to render it against.

**Four of these six converted with this stage, not five as an earlier pass through this section claimed** — `can_countersign_incident()`'s principal branch, `incident_locations` add/edit, `mark_parent_called()`'s principal branch, and `/principal/dashboard`'s own redirect-away behavior (corrected from "overlay browser check" — that page never renders a pending/rejected overlay; it redirects to `/teacher/join-institution`, which is where any such overlay actually lives). Each just needed SOME real deactivated principal to exist, which `hand_over_principal()`'s 'leaving' outcome now produces (structurally identical in shape to what `deactivate_institution_staff()` would have produced, had it ever been able to target a principal). All four are converted and verified: the first three via CHECK X's adversarial coverage, the fourth via live browser verification on the deployed app.

**Two are permanently structural, corrected after checking against the real, now-shipped `hand_over_principal()` rather than assumed:**
- `deactivate_institution_staff()`'s own last-principal guard — its ALLOW branch needs two simultaneously active principals at one institution, a state the one-principal index excludes by design and handover's own atomicity preserves (see the decision recorded directly in `institution_staff_one_principal_per_institution`'s migration comment — deliberately not widened for handover).
- `approve_staff_join()`/`reject_staff_join()`'s caller check and `derive_staff_join_approval()`'s EXISTS clause. This one was originally placed on the "converts with 1c" list on the reasoning that handover would open a window where a second principal-role join could sit pending or rejected. Verified empirically once `hand_over_principal()` existed, rather than left as an assumption, and that reasoning doesn't hold: handover's atomicity means the institution is never observably principal-less — the successor's new row goes active in the same transaction that closes the predecessor's — so a third party's ordinary principal-role join attempt immediately after a real handover still fails at the same unique index (`duplicate key value violates unique constraint`, confirmed live). This needs the identical two-simultaneous-principals state as the guard above, for the same reason.

Stage 1c's own verification must convert the four to live-fired/screen-verified checks against a real handed-over, deactivated principal, and record both permanently-structural items explicitly rather than silently dropping either from the list.

**Also owed to this stage's build prompt, in scope, not deferred — corrected after checking the actual code:** the second-principal join already has a designed message, not a raw error. `src/app/teacher/join-institution/page.tsx`'s `friendlyJoinError()` already matches the `institution_staff_one_principal_per_institution` constraint by name and returns "This school already has a principal registered. If that should be you, contact Behaviour Hive support." — and it's the only client-side INSERT into `institution_staff` in the codebase, so this is the one place that matters. The real Stage 1c work is updating that one message to reference self-service handover once it exists, not building message-handling from scratch.
