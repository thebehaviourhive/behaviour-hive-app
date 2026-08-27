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

## 2.4c Principal handover

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
