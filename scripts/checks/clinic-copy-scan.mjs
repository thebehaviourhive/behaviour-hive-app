#!/usr/bin/env node
// Item 4, 22 Sept 2026 -- Daniel's own instruction: "a scan once finds
// today's leaks; only a check stops tomorrow's." This is that check,
// wired into `npm run build` (see package.json's own "prebuild").
//
// WHAT IT DOES: greps every file reachable by a clinic role (the list
// below, built from this session's own render-and-scan) for a quoted
// string literal containing one of the school-track words Daniel
// named, and fails the build on any hit that isn't in the checked-in
// allowlist (clinic-copy-allowlist.json, same directory).
//
// WHY AN ALLOWLIST, NOT A BARE FAIL-ON-ANY-HIT: a naive keyword grep
// is not precise enough to gate a build on directly -- most real hits
// in this codebase are legitimate (a role comparison literal, a
// correctly institutionType-branched ternary where BOTH branches
// happen to contain a keyword, a CSS classname). Flagging all of them
// would be noise nobody trusts, exactly the failure mode this check
// exists to avoid. The allowlist is a snapshot of every hit already
// reviewed and found safe (this session's own final, fixed state) --
// anything NEW that shows up beyond it is exactly the shape of leak
// this session found six times, and fails the build until it's either
// fixed or deliberately, visibly added to the allowlist with a reason.
//
// WHEN THIS FLAGS SOMETHING: read the file:line, decide whether it's a
// real leak (fix it through the vocabulary/institutionType layer, the
// same way this session fixed six of them) or a genuine false
// positive (add it to the allowlist with a one-line reason -- never
// silently, the allowlist entry itself is the record).
//
// WHEN A NEW CLINIC-REACHABLE FILE IS ADDED: add its path to
// CLINIC_REACHABLE_PATHS below. This list is deliberately explicit,
// not "everything under src/" -- a school-only file (teacher/, sna/)
// gaining a school word is not this check's problem.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWLIST_PATH = fileURLToPath(new URL("./clinic-copy-allowlist.json", import.meta.url));

// Every directory/file confirmed reachable by a clinic role this
// session, plus the full /principal tree -- useRequireRole("principal")
// has no institution-type check, so any /principal/* route or
// component is technically reachable by a clinic director via direct
// URL even where the clinic nav (principalNavTabs.ts) doesn't link to
// it, matching item 3's own "technical reachability matters" standard.
const CLINIC_REACHABLE_PATHS = [
  "src/app/principal",
  "src/app/clinician",
  "src/app/clinic-admin",
  "src/app/clinical-lead",
  "src/app/consent",
  "src/app/more",
  "src/app/parent-dashboard",
  "src/app/passport",
  "src/app/messages",
  "src/app/calm",
  "src/app/morning-checkin",
  "src/components/clinic",
  "src/components/clinician",
  "src/components/consent",
  "src/components/principal",
  "src/components/parent",
  "src/components/questionnaire",
  "src/components/abc-logger",
  "src/components/ui/PassportProgress.tsx",
  // Caught by this check's own sanity test, 22 Sept 2026 -- a hook can
  // return or throw a user-facing string just as easily as a
  // component can render one, and nothing above covered src/hooks/ at
  // all. Scanned whole rather than picked apart hook-by-hook, matching
  // this file's own "explicit, not everything under src/" principle at
  // the directory level, not the individual-hook level -- a school-
  // only hook (useRequireRole's own onboarding copy, say) can still
  // gain a false positive here, same tradeoff as scanning the whole
  // /principal tree above.
  "src/hooks",
];

// Files under a clinic-reachable directory ABOVE that are, on
// inspection, genuinely never reached by a clinic role -- gated by
// something this scanner can't see statically (a role prop passed only
// from a school-only call site, a route that's school-only by what it
// does, not just by convention). Confirmed during item 4's own build,
// 22 Sept 2026 -- re-check this list, don't just grow it, if a file
// here later gains a real clinic-facing caller.
const KNOWN_SCHOOL_ONLY_EXCEPTIONS = [
  "src/app/principal/classes",
  "src/app/principal/incidents",
  "src/app/principal/school",
  "src/app/principal/term-overview",
  "src/components/principal/AddClassChildSheet.tsx",
  "src/components/principal/AddClassTeacherSheet.tsx",
  "src/components/principal/AssignClassSnaSheet.tsx",
  "src/components/principal/CreateClassSheet.tsx",
  "src/components/principal/EndEnrolmentSheet.tsx",
  "src/components/principal/IncidentLocationsCard.tsx",
  "src/components/principal/IncidentCard.tsx",
  "src/components/principal/SetCutoffSheet.tsx",
  "src/components/principal/SetStartTimeSheet.tsx",
  "src/components/principal/directory/ClassDetail.tsx",
  "src/components/principal/directory/ClassesList.tsx",
  // TeacherAgreementScreen/SnaAgreementScreen render only for
  // class_teacher/sna roles (consent/page.tsx's own switch) -- never
  // reachable by any clinic role, ever, by construction.
  "src/components/consent/TeacherAgreementScreen.tsx",
  "src/components/consent/SnaAgreementScreen.tsx",
  // PRD 11 Stage 2 -- same reasoning, same switch: centre_manager/
  // care_staff render only for their own two roles, never any clinic
  // role. CentreManagerAgreementScreen's own lede uses "countersign"
  // in its respite sense (finalising the post-stay report, per
  // Daniel's own answer during Stage 2 scoping) -- a real match on
  // this scanner's keyword list, and a genuine false positive, since
  // the string can never reach a clinic-reachable screen at all.
  "src/components/consent/CentreManagerAgreementScreen.tsx",
  "src/components/consent/CareStaffAgreementScreen.tsx",
  // grant_passport_access() (0148) only ever admits a target with
  // role in ('class_teacher', 'sna') -- a clinic has neither. Finding
  // 1 (22 Sept 2026) hid the "Access" tab that was this sheet's only
  // entry point for a clinic; the sheet itself is now dead code for
  // that institution type, not just wrongly worded.
  "src/components/principal/GrantPassportAccessSheet.tsx",
  // Support alerts (raise_support_alert()) are a class_teacher-only
  // concept, and this sheet's own single caller sits well after
  // ClinicDirectorDashboard.tsx's early return in principal/dashboard/
  // page.tsx -- dead code for a clinic, structurally, not by
  // convention.
  "src/components/principal/MarkSupportAlertFollowedUpSheet.tsx",
];

const KEYWORDS = [
  "school",
  "principal",
  "pupil",
  "classroom",
  "class",
  "teacher",
  "SNA",
  "enrolment",
  "enrol",
  "incident",
  "countersign",
  "supply",
  "cover",
  "term",
];
const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "i");

function walk(path, files = []) {
  const stat = statSync(path);
  if (stat.isFile()) {
    if (path.endsWith(".tsx") || path.endsWith(".ts")) files.push(path);
    return files;
  }
  for (const entry of readdirSync(path)) {
    walk(join(path, entry), files);
  }
  return files;
}

function collectFiles() {
  const files = new Set();
  for (const p of CLINIC_REACHABLE_PATHS) {
    const abs = join(ROOT, p);
    try {
      for (const f of walk(abs)) files.add(f);
    } catch {
      console.warn(`clinic-copy-scan: configured path missing, skipping: ${p}`);
    }
  }
  const excluded = KNOWN_SCHOOL_ONLY_EXCEPTIONS.map((p) => join(ROOT, p));
  return [...files]
    .filter((f) => !excluded.some((e) => f === e || f.startsWith(e + "/")))
    .sort();
}

// Same refined pattern the manual sweep converged on: a quoted string
// of 15+ characters (long enough to be a real sentence fragment, not a
// bare role/type comparison literal like "principal"), containing a
// keyword, on a line that isn't a comment and isn't an import path.
const QUOTED_STRING_RE = /"[^"]{15,}"/g;

function scanFile(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const hits = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    if (/^import\b/.test(trimmed)) return;
    const matches = line.match(QUOTED_STRING_RE);
    if (!matches) return;
    for (const m of matches) {
      const inner = m.slice(1, -1);
      if (m.startsWith('"@/') || m.startsWith('"./') || m.startsWith('"../')) continue;
      // A route href -- "/principal/dashboard" etc. Never copy.
      if (inner.startsWith("/")) continue;
      // An HTML id/CSS-class-style identifier -- lowercase, digits,
      // hyphens/underscores only, no spaces. Real copy always has a
      // space somewhere in 15+ characters; an identifier never does.
      if (/^[a-z0-9_-]+$/.test(inner)) continue;
      // A DB column list -- snake_case identifiers joined by ", ",
      // three or more commas, never a real sentence in this shape.
      if ((inner.match(/,/g) ?? []).length >= 3 && /^[a-z0-9_, ]+$/.test(inner)) continue;
      if (!KEYWORD_RE.test(m)) continue;
      hits.push({ line: i + 1, text: m });
    }
  });
  return hits;
}

function loadAllowlist() {
  try {
    return JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
  } catch {
    return {};
  }
}

function main() {
  const allowlist = loadAllowlist();
  const files = collectFiles();
  const newHits = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs);
    const hits = scanFile(abs);
    // {"line:text": "reason it's safe"} -- the reason is documentation,
    // not read by the check itself; every entry needs one anyway, so a
    // reviewer can tell a real allowlist from a rubber stamp.
    const allowedForFile = allowlist[rel] ?? {};
    for (const hit of hits) {
      const key = `${hit.line}:${hit.text}`;
      if (Object.prototype.hasOwnProperty.call(allowedForFile, key)) continue;
      newHits.push({ file: rel, ...hit });
    }
  }

  if (newHits.length === 0) {
    console.log(`clinic-copy-scan: clean (${files.length} clinic-reachable files checked).`);
    return;
  }

  console.error(`clinic-copy-scan: ${newHits.length} unreviewed hardcoded school-word string(s) found in clinic-reachable code:\n`);
  for (const hit of newHits) {
    console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
  }
  console.error(
    `\nEach one is either a real leak (fix it through the vocabulary/institutionType layer -- see CLAUDE.md's own item-1 entry for the pattern) or a genuine false positive (add "${'{line}'}:${'{text}'}" to that file's own array in scripts/checks/clinic-copy-allowlist.json, with a reason).`
  );
  process.exit(1);
}

main();
