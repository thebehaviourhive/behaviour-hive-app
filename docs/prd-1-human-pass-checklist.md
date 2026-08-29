# PRD 1 — the full 375px human pass

Deferred since Stage 1. One coherent journey, walked by hand, at mobile
width, on the deployed app — not the adversarial suite (which proves the
database, never the screen) and not a scripted browser-tool pass (which
proves the screen once, from one angle). This is the thing PRD 1 was
building toward: does it actually feel like a working product to a person
holding a phone.

**Environment: `https://behaviour-hive-app.vercel.app` (deployed), not
local-dev.** Set your browser (or devtools device toolbar) to **375px
wide** for all of this — iPhone SE/mini width, the narrowest live target,
not the desktop layout.

**The fixture is already up. Do not tear it down** — `scripts/dev/
humanpass-fixture-setup.mjs` deliberately does not use the `ZZFIXTURE`
naming convention, so `scripts/dev/teardown.mjs` structurally refuses to
touch it (institution codes must start with `ZZFIXTURE`; it refuses
"everything else, unconditionally"). It survives any future automated
fixture sweep on its own. If you ever want it gone, that's a manual
service-role cleanup, told to do explicitly — not a script run.

If you want a fresh fixture instead of reusing this one, re-run:
```bash
node --env-file=.env.local scripts/dev/humanpass-fixture-setup.mjs
```
— it creates a new institution with a random code suffix each time and
leaves the old one in place (nothing here is torn down automatically).

## Accounts

All passwords: `HumanPass-2026!`. Institution code: **`HUMANPASS3919`**
("The Meadow School").

| Role | Email | Starting state |
|---|---|---|
| Principal | `humanpass.principal@thebehaviourhive.com` | Active (founding principal) |
| Teacher | `humanpass.teacher@thebehaviourhive.com` | **Pending join** — approve in Step 1 |
| SNA 1 | `humanpass.sna1@thebehaviourhive.com` | **Pending join** — approve in Step 1 (standing assignment) |
| SNA 2 | `humanpass.sna2@thebehaviourhive.com` | **Pending join** — approve in Step 1 (temporary cover) |
| Parent | `humanpass.parent@thebehaviourhive.com` | Active, no data yet — claims the child in Step 6 |
| Clinician | `humanpass.clinician@thebehaviourhive.com` | **Pre-verified** — code **`CL-5378`** |

Two things pre-done for you, both because there's genuinely no UI path to
do them any other way — everything else below is the real product, done
by hand:

- The principal's own `institution_staff` row (nothing in the product
  creates an institution's first principal — every fixture in this repo
  hits this same wall).
- The clinician's verification (`approve_clinician()` is service-role-only
  by design; there has never been a self-verify screen).

---

## The walkthrough

### 1. Principal approves the pending joins
Sign in as the **principal**. `/principal/staff` → three pending rows
(Tara Teacher, Sam SNA, Sian SNA), each with a **"Review Request"**
button. Approve all three. Confirm all three flip to **Active**.

*What this proves*: the join-approval mechanism (Stage 1b) — the exact
screen a real school's staff use, not a bypass.

### 2. Principal enrols a child
`/principal/passports` → **"+ Enrol"** (top right) → name the child
(e.g. "Alex Sample"). Confirm the child appears under **Active** with an
**Enrolled** badge on its own detail page.

*What this proves*: `create_school_passport()` (Stage 6) — atomically
creates the passport, the institution link, and the enrolment row
together.

### 3. Principal generates a claim code
Open the child's own passport detail page (tap through from the list) →
**Parent / Guardian** section → **"Generate Claim Code"**. Note the code
shown — you'll use it as the parent in Step 6.

### 4. Principal creates a class and assigns the teacher
`/principal/classes` → **"+"** (top right, "Create a class") → name it
(e.g. "Room 3"). Open the new class → **Teachers** section → **"+ Add"**
→ assign Tara Teacher. Then **Roster** section → **"+ Add"** → add the
enrolled child to the class.

*What this proves*: `create_class()`/`add_class_teacher()`/
`add_class_child()` (Stage 2) — the standing structure everything else
(SNA assignment, incident ownership, roster visibility) sits on top of.

### 5. Principal assigns both SNAs — two different mechanisms
Still on the class detail page, find the child in the **Roster** list:

- **Standing assignment**: tap **"Assign SNA"** on the child's row →
  choose Sam SNA. This is the ordinary, no-end-date cover — Sam now has
  passport access to this child until someone ends it.
- **Temporary cover**: scroll to the **Temporary Cover** section → **"+
  Grant Cover"** → choose Sian SNA, today's date. This is Stage 3's own
  day-scoped mechanism — genuinely separate machinery from the standing
  assignment above, not a variant of it.

  *Note*: temporary cover only shows as *active* from 07:30 local time
  onward on its granted date (a fixed cut-off, not configurable) — the
  grant itself will succeed regardless of when you do this, but if you
  do this before 07:30, don't be surprised if Sian's own access doesn't
  show as live until then.

*What this proves*: two children can be legitimately covered by two
different SNAs through two different mechanisms at once — exactly the
kind of case CHECK AA/BB prove at the database and client-query level,
now proven end to end.

### 6. Staff log an incident
Sign in as the **teacher**. `/teacher/class` → confirm you see the child
and Room 3. Open the child's passport → **"+ Log Incident"** → walk
through the ABC logger for a minor, invented incident. Confirm it appears
on the child's own **Incident Timeline**.

*What this proves*: incident creation is really gated on class
membership derived from Step 4/5, not a bypass — this teacher has never
been granted `passport_access` directly.

### 7. A guardian claims
Sign in as the **parent** (fresh account, nothing on their dashboard yet).
Go to `/passport/claim` (or `/passport/welcome` → "Already have a code
from your child's school?") and redeem the code from Step 3. Confirm the
child's passport now appears on the parent's own dashboard, with the
incident logged in Step 6 visible on the timeline.

*What this proves*: the claim flow (Stage 5) — a school-created passport
becomes a real guardian relationship through `passport_guardians`, not a
`passports.user_id` hand-off.

### 8. A clinician is engaged
Still signed in as the parent: passport dashboard → **"Manage Access" /
"Share"** → **clinician code** field → enter `CL-5378`. Confirm the
clinician appears under **Clinical Team** as *"Connected by you"*, with a
**Revoke Access** button.

Then sign in as the **clinician** (`humanpass.clinician@...`) →
`/clinician/passports` → confirm the child appears with *"Connected by
the family"*. Open the child's own clinical file → confirm **"End your
involvement"** is offered (don't tap it — leave the engagement live for
now, unless you want to exercise self-revoke too).

*What this proves*: Stage 7 end to end — `connect_clinician()`, the
principal/parent symmetry (sign in as the principal too and check the
child's own detail page: the same clinician should appear read-only,
*"Connected by the family"*, no revoke button), and the clinician's own
caseload view.

### 9. A staff member leaves
Sign in as the **principal**. `/principal/staff` → find Sam SNA (the
*standing* assignment from Step 5, not Sian's temporary cover) →
**"Deactivate"** → give a reason. Confirm:
- Sam drops off the active staff list.
- The child's own class-detail page shows **no SNA assigned** again
  (Sam's `child_assignments` row closed by the cascade).
- Sian's temporary cover, the teacher's own class assignment, and the
  parent's claimed passport are all **untouched** — the cascade is
  narrow, not a blast radius.

*What this proves*: `deactivate_institution_staff()`'s cascade (Stage 1)
— narrow, correct, and now watched end to end against every other piece
of state this same journey built, not just its own isolated fixture.

---

## What "done" looks like

By the end: one child, enrolled, in a class, with a teacher, a
(recently-departed) SNA's history and a currently-active second SNA's
temporary cover, one incident on the timeline, one guardian who claimed
through a real code, one clinician connected and visible symmetrically to
both the parent and the principal. Every piece of PRD 1 touched by one
continuous, human-paced journey — not seven isolated stage fixtures.

If anything on this list doesn't behave as described, that's a real
finding — this checklist is deliberately naive about what "should" work;
it only records what the product is supposed to do, not a hedge about
edge cases the adversarial suite already covers elsewhere.
