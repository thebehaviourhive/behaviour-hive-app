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
  reject_clinician: "Independent-clinician verification track only (logged_by_role on an audit/log table, unrelated to institution_staff or the clinic-institution track).",
  submit_clinician_verification: "Same as reject_clinician -- independent-clinician verification track only.",
  update_clinician_last_review:
    "abc_logs.logged_by_role has its own CHECK constraint admitting only parent/class_teacher/clinician/sna -- never principal/clinical_lead -- and ABCLogger's own role prop is passed explicitly per call site (/clinician/log hardcodes role=\"clinician\" for a director/lead too). Checked live this session; not a live bug.",
  _clinic_director_can_read_clinician_session_notes:
    "Dead code -- explicitly dropped by 0233 (`drop function if exists public._clinic_director_can_read_clinician_session_notes(uuid);`) once session_notes' own SELECT policy was repointed to _clinic_director_can_read_clinician_material(), which IS widened. This script's own function-resolution walks migration order but doesn't parse DROP statements, so it still sees 0229's stale definition as \"live\" -- a known, accepted limitation, not a live bug.",
};

function walkMigrations() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

const TARGET_RE = /role\s*=\s*'clinician'|role\s+in\s*\(\s*'clinician'/i;
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
      list.push({ file: basename(file), body });
      defsByName.set(name, list);
    }
  }
  return defsByName;
}

function main() {
  const files = walkMigrations();
  const defsByName = findFunctionDefinitions(files);
  const problems = [];

  for (const [name, defs] of defsByName) {
    // Migration filenames sort lexically = migration order (zero-
    // padded sequence numbers) -- the LAST definition in file order is
    // the live one, never the first.
    const live = defs[defs.length - 1];
    if (!TARGET_RE.test(live.body)) continue;
    if (WIDENED_RE.test(live.body)) continue; // already admits director/lead
    if (Object.prototype.hasOwnProperty.call(CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN, name)) continue;
    problems.push({ name, file: live.file });
  }

  if (problems.length === 0) {
    console.log(`clinician-role-target-scan: clean (${defsByName.size} functions checked).`);
    return;
  }

  console.error(`clinician-role-target-scan: ${problems.length} unreviewed function(s) checking role = 'clinician' without also admitting a director/lead:\n`);
  for (const p of problems) {
    console.error(`  ${p.name}() -- live in ${p.file}`);
  }
  console.error(
    `\nFor each: if this checks a TARGET (someone other than the caller), it's very likely this session's own bug class -- widen to role in ('clinician', 'clinical_lead', 'principal') the way 0275/0276 did. If it's the caller's own gate or target-specific by design for a real reason, add the function name to CALLER_GATE_OR_TARGET_SPECIFIC_BY_DESIGN in scripts/checks/clinician-role-target-scan.mjs with that reason.`
  );
  process.exit(1);
}

main();
