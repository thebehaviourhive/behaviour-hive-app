#!/usr/bin/env node
// Item 4, 22 Sept 2026 -- the second half of Daniel's own instruction:
// "a function checks role = 'clinician' against a target without also
// admitting a verified director or lead." Wired into `npm run build`
// alongside clinic-copy-scan.mjs.
//
// WHAT IT DOES: greps every migration for `role = 'clinician'` or
// `role in ('clinician'...)`, resolves EACH MATCHED FUNCTION NAME to
// its LIVE definition (the highest-numbered `create or replace
// function` for that name -- a superseded definition in an old
// migration is never itself a live bug, per this schema's own standing
// "read the live definition, not the first one you find" rule), and
// fails when that live body still contains the bare pattern and isn't
// in the allowlist below.
//
// WHY AN ALLOWLIST, NOT A BARE FAIL: this session found five real
// instances (three in PRD 10 Stage 1, the Workspace email setter, and
// _clinician_authored_at_institution) plus four more in the follow-up
// sweep (0276) -- but also several LOOK-ALIKE occurrences that are
// correct as written: a CALLER's own authorization gate (one of
// several parallel role branches, each already scoped correctly, e.g.
// end_clinic_episode's practitioner branch) is a different shape from
// a check against a TARGET, and this script can't tell the two apart
// by pattern alone -- a human already did that triage once, per
// function name, and the allowlist is the record of it.
//
// WHEN THIS FLAGS SOMETHING: read the function, work out whether the
// role check is against a TARGET (someone other than the caller) --
// if so, it's very likely the same bug class this session found five
// times, and should be widened to
// `role in ('clinician', 'clinical_lead', 'principal')` the same way
// 0275/0276 did. If it's genuinely the caller's own gate, or another
// legitimate reason the bare check is correct, add the function name
// to CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN below with a one-line
// reason -- never silently.

import { readFileSync, readdirSync } from "fs";
import { join, basename } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const MIGRATIONS_DIR = join(ROOT, "supabase/migrations");

// Functions already confirmed, this session, to correctly admit a
// director/lead as a TARGET (fixed in 0268/0272/0275/0276) -- their
// live body no longer matches the bare pattern at all, so these would
// never actually trigger a flag; listed for the record, not because
// the script needs them.
//
// Functions where the bare role = 'clinician' check is a CALLER'S OWN
// gate (one of several parallel, independently-scoped branches -- a
// director/lead already passes through their OWN branch, never through
// this one) or is TARGET-SPECIFIC BY DESIGN (the function's entire
// point is admitting an independent/school-track clinician
// specifically, not "any practitioner") -- reviewed this session,
// 22 Sept 2026.
const CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN = {
  end_clinic_episode:
    "The 'clinician' branch is the CALLER'S OWN gate -- one of three parallel, independently-scoped branches (director/lead/practitioner, 0216); a director/lead already passes through their own branch, never this one.",
  onboard_clinic_client:
    "Caller's own gate -- role in ('principal','clinic_admin') already admits a director unconditionally; the clinician branch is an ADDITIONAL, toggle-gated option, not the only path.",
  reopen_clinic_episode: "Same shape as onboard_clinic_client -- caller's own gate, director already admitted unconditionally via a separate branch.",
  approve_staff_join:
    "Target-specific by design -- creates a NEWLY-APPROVED PRACTITIONER's own clinicians row on approval. A director/lead gets theirs via select_director_specialty() instead, a separate, correct mechanism -- this branch isn't meant to admit them.",
  can_view_message:
    "Caller-side check already uses is_verified_clinician() (role-agnostic, true for a verified director/lead too). The one bare 'clinician' reference is message_recipients.recipient_role inside a NOT EXISTS guard against duplicate broad visibility -- an over-admission edge case for a third party, not a director-refusal, and a different bug class from this check's own target.",
  _clinic_director_can_read_clinician_session_notes:
    "Dead code -- explicitly dropped by 0233 (`drop function if exists public._clinic_director_can_read_clinician_session_notes(uuid);`) once session_notes' own SELECT policy was repointed to _clinic_director_can_read_clinician_material(), which IS widened. This script's own function-resolution walks migration order but doesn't parse DROP statements, so it still sees 0229's stale definition as \"live\" -- a known, accepted limitation, not a live bug.",

  // Found once TARGET_RE was widened (22 Sept 2026) to catch
  // 'clinician' anywhere in a role IN-list, not just first position --
  // the fix that caught abc_logs_logged_by_role_check also surfaced
  // these four. All genuinely already admit a director/lead; they just
  // don't match WIDENED_RE's specific clinician-then-clinical_lead-
  // then-principal (or reverse) adjacency, because each list also
  // contains OTHER roles (class_teacher, sna, clinic_admin, ...)
  // interleaved. Reviewed individually below, not batch-waved through.
  "institution_staff.institution_staff_role_check":
    "The WHOLE-TABLE role enum (0203, live) -- 'class_teacher', 'institution_admin', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin' all appear. Not a \"does this admit a director as a clinician-like target\" check at all; a director/lead is already a first-class legal value here.",
  "consents.consents_role_check":
    "Same shape as institution_staff_role_check -- the whole-table role enum (0208, live), already includes 'principal' and 'clinical_lead' alongside every other real role.",
  "principal_handovers.principal_handovers_staying_role_check":
    "Deliberately does NOT include 'principal' -- CLAUDE.md's own PRD 5 Stage 2 entry documents why: one can't \"stay\" as principal when handing the principal role over, by definition. Already includes 'clinician' and 'clinical_lead' (0204, live); the missing value here is correct, not a bug.",
  get_institution_staff_candidates:
    "The staff-messaging recipient-candidate list (0205, live) -- role in ('class_teacher', 'sna', 'principal', 'clinician', 'clinical_lead', 'clinic_admin'), already includes a director/lead as a valid message recipient.",
};

// FULL AUDIT, 22 Sept 2026, per Daniel's own instruction after the
// abc_logs entry turned out to have been added on an unverified
// inference (see CLAUDE.md's own "AN ALLOWLIST ENTRY IS A CLAIM, NOT A
// FORMALITY" entry) -- every entry above was re-checked two ways: (1)
// read the LIVE definition directly and confirm the stated reason is
// still true today, not just plausible; (2) removed the entry and
// re-ran this script to confirm it is actually flagged without it --
// proof the entry does something, not decoration. Two entries failed
// (2), not (1): `reject_clinician` and `submit_clinician_verification`
// were REMOVED here -- neither function's live body contains the word
// "role" anywhere at all (both gate on clinicians.verification_status,
// not any role column), so TARGET_RE never matched them in the first
// place and they were never going to be flagged with or without an
// allowlist entry. Their own stated reasons ("independent-clinician
// verification track only") were not FALSE, just answering a question
// the scanner was never going to ask -- added by the same reasoning-
// without-testing habit this audit exists to catch, just with a
// harmless outcome this time instead of a silenced bug. Every
// remaining entry passed both checks and is recorded above with the
// live migration/table it was verified against.

function walkMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

// Found live, 22 Sept 2026: the original `role\s+in\s*\(\s*'clinician'`
// only matched 'clinician' as the FIRST value in an IN-list --
// abc_logs_logged_by_role_check's own list has it third
// (parent/class_teacher/clinician/sna), so this never matched at all
// and the constraint was silently invisible to this check from the
// day it shipped. Widened to match 'clinician' ANYWHERE inside a
// `role in (...)` clause.
const TARGET_RE = /role\s*=\s*'clinician'|role\s+in\s*\([^)]*'clinician'/i;
const WIDENED_RE = /role\s+in\s*\([^)]*'clinician'[^)]*'clinical_lead'[^)]*'principal'|role\s+in\s*\([^)]*'clinician'[^)]*'principal'[^)]*'clinical_lead'/i;

function findFunctionDefinitions(files) {
  // name -> [{ file, startLine, body }] across ALL migrations, in file
  // order (filenames are zero-padded sequential, so lexical order is
  // migration order).
  const defsByName = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/create\s+(?:or\s+replace\s+)?function\s+public\.([a-z0-9_]+)/i);
      if (!m) continue;
      const name = m[1];
      // Body = from this line to the next top-level `$$;` (function
      // terminator) or end of file -- good enough for this pattern
      // check, doesn't need a real SQL parser.
      let end = i;
      for (let j = i; j < lines.length; j++) {
        if (/^\$\$;\s*$/.test(lines[j]) && j > i) {
          end = j;
          break;
        }
        end = j;
      }
      const body = lines.slice(i, end + 1).join("\n");
      const list = defsByName.get(name) ?? [];
      list.push({ file: basename(file), body, kind: "function" });
      defsByName.set(name, list);
    }
  }
  return defsByName;
}

// Found live, 22 Sept 2026, the same day as the four target-checks
// above: this function-only search NEVER SAW the actual bug in item 1
// of Daniel's own two-part follow-up. "Clinicians can insert abc logs
// for passports they access" (0029) requires `logged_by_role =
// 'clinician'` in a bare `with check (...)` clause on a CREATE POLICY
// statement -- not a `create function` body at all, so
// findFunctionDefinitions() above never captured it, in either its
// buggy or fixed state. A raw `alter table ... add constraint ... check
// (logged_by_role in (...))` (abc_logs_logged_by_role_check, 0065) has
// the identical blind spot -- a CHECK CONSTRAINT is not a function
// either. Extended here rather than left as a documented gap, matching
// this session's own "found the check missed something, so fix the
// check" precedent (clinic-copy-scan.mjs's own src/hooks/ addition,
// same day, found by its own sanity test).
//
// Policies and constraints have no `$$;` terminator (that's PL/pgSQL-
// specific) -- bounded here by scanning to the next line whose trimmed
// text ends in a bare `;`, which is how every CREATE POLICY / ALTER
// TABLE ADD CONSTRAINT in this schema's own migrations is formatted.
// Named as `table.policy_or_constraint_name` so it shares the
// CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN allowlist's own shape
// without colliding with a same-named function.
function findPolicyAndConstraintDefinitions(files) {
  const defsByName = new Map();
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      // ALTER POLICY updates an EXISTING named policy's own USING/WITH
      // CHECK in place -- this schema's own established way to repoint
      // a policy at a newly-fixed helper (0251's own "repoint both live
      // policies to the new signatures" is exactly this). Tracked as
      // the SAME name as its own CREATE POLICY, appended to the same
      // list, so "last in file order" correctly resolves to the ALTER,
      // not the original CREATE -- caught live the first time this
      // script ran against session_notes' own policy, which 0251
      // widened via ALTER POLICY and this scanner, before this fix,
      // still reported as 0228's original, unwidened text.
      const policyMatch = lines[i].match(/create\s+policy\s+"([^"]+)"/i) ?? lines[i].match(/alter\s+policy\s+"([^"]+)"/i);
      const constraintMatch = lines[i].match(/add\s+constraint\s+([a-z0-9_]+)/i);
      if (!policyMatch && !constraintMatch) continue;

      // The table name is on this line or the next couple (policy's own
      // `on public.TABLE` clause) -- OR, for a constraint, on the
      // PRECEDING `alter table public.TABLE` line, this schema's own
      // established two-line drop-then-add convention. Checked
      // backward first: a constraint's own table is never restated on
      // the "add constraint" line itself.
      let table = null;
      for (let k = Math.max(0, i - 2); k <= Math.min(i + 3, lines.length - 1); k++) {
        const tableMatch = lines[k].match(/\bpublic\.([a-z0-9_]+)/i);
        if (tableMatch) {
          table = tableMatch[1];
          break;
        }
      }
      const rawName = policyMatch ? policyMatch[1] : constraintMatch[1];
      const name = `${table ?? "unknown_table"}.${rawName}`;

      let end = i;
      for (let j = i; j < lines.length; j++) {
        end = j;
        if (/;\s*$/.test(lines[j])) break;
      }
      const body = lines.slice(i, end + 1).join("\n");
      const list = defsByName.get(name) ?? [];
      list.push({ file: basename(file), body, kind: policyMatch ? "policy" : "constraint" });
      defsByName.set(name, list);
    }
  }
  return defsByName;
}

function main() {
  const files = walkMigrations();
  const defsByName = findFunctionDefinitions(files);
  const policyDefsByName = findPolicyAndConstraintDefinitions(files);
  const problems = [];

  for (const [name, defs] of defsByName) {
    // Migration filenames sort lexically = migration order (zero-
    // padded sequence numbers) -- the LAST definition in file order is
    // the live one, never the first.
    const live = defs[defs.length - 1];
    if (!TARGET_RE.test(live.body)) continue;
    if (WIDENED_RE.test(live.body)) continue; // already admits director/lead
    if (Object.prototype.hasOwnProperty.call(CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN, name)) continue;
    problems.push({ name, file: live.file, kind: "function" });
  }

  // Same "last definition in file order is live" resolution, and the
  // same known limitation as _clinic_director_can_read_clinician_
  // session_notes above: a policy/constraint DROPped in a later
  // migration with no replacement still looks "live" here. Accepted for
  // the same reason -- adding DROP-awareness is real, separate work,
  // not something to half-do under this fix.
  for (const [name, defs] of policyDefsByName) {
    const live = defs[defs.length - 1];
    if (!TARGET_RE.test(live.body)) continue;
    if (WIDENED_RE.test(live.body)) continue;
    if (Object.prototype.hasOwnProperty.call(CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN, name)) continue;
    problems.push({ name, file: live.file, kind: live.kind });
  }

  const totalDefs = defsByName.size + policyDefsByName.size;

  if (problems.length === 0) {
    console.log(`clinician-role-target-scan: clean (${totalDefs} functions/policies/constraints checked).`);
    return;
  }

  console.error(`clinician-role-target-scan: ${problems.length} unreviewed function/policy/constraint(s) checking role = 'clinician' without also admitting a director/lead:\n`);
  for (const p of problems) {
    const suffix = p.kind === "function" ? "()" : ` [${p.kind}]`;
    console.error(`  ${p.name}${suffix} -- live in ${p.file}`);
  }
  console.error(
    `\nFor each: if this checks a TARGET (someone other than the caller), it's very likely this session's own bug class -- widen to role in ('clinician', 'clinical_lead', 'principal') the way 0275/0276/0277 did. If it's the caller's own gate or target-specific by design for a real reason, add the name to CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN in scripts/checks/clinician-role-target-scan.mjs with that reason (functions by name; policies/constraints as "table.policy_or_constraint_name").`
  );
  process.exit(1);
}

main();
