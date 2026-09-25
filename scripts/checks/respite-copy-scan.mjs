#!/usr/bin/env node
// The centre_manager dashboard build, 25 Sept 2026. Daniel's own
// instruction: "there isn't one, which is why ComposeMessageSheet
// leaked school copy onto a respite screen." Sibling to
// clinic-copy-scan.mjs, same mechanism, same prebuild wiring, own
// allowlist file -- deliberately a SEPARATE script rather than a
// widened CLINIC_REACHABLE_PATHS, because the two checks ask genuinely
// different questions (see KEYWORDS below) and a respite-reachable
// file is very rarely also a clinic-reachable one.
//
// TWO CHECKS, NOT ONE, because the actual incident this exists to
// prevent was NOT primarily a keyword-in-a-string-literal problem --
// it was a two-way `institutionType === "clinic" ? X : Y` TERNARY,
// which silently collapsed "school" and "respite_centre" into the
// same fallback branch. A plain keyword scan over quoted string
// literals (check 1, below, matching clinic-copy-scan.mjs's own
// mechanism exactly) would NOT have caught the actual
// ComposeMessageSheet leak -- both real hits were template-literal
// interpolations (`` `...${institutionType === "clinic" ? "clinic" :
// "school"}...` ``) and a JSX conditional expression, neither of which
// QUOTED_STRING_RE's 15+-character plain-double-quote pattern matches
// (a bare "school"/"clinic" literal used AS a ternary branch is
// exactly as short as the role-comparison literals check 1 is
// deliberately built to ignore). Stated plainly rather than glossed
// over: check 1 exists because a hardcoded prose leak IS still a real,
// separate risk (the same class check 1's own clinic sibling has
// caught before) -- but it is check 2 that would actually have caught
// this specific incident, and both are needed.
//
// CHECK 1 -- hardcoded copy: every quoted string literal 15+
// characters containing a school-track keyword, in a respite-reachable
// file. Same regex, same allowlist shape as clinic-copy-scan.mjs.
//
// CHECK 2 -- the two-way ternary shape itself: any
// `institutionType === "school"` / `institutionType === "clinic"` /
// their `!==` negations, found anywhere in a respite-reachable file.
// Not just inside a ternary syntactically -- ANY such comparison in
// code respite can reach is a standing risk, because the very next
// edit to that line can turn it into one. This is the check that
// converts this session's own manual grep sweep (see CLAUDE.md, the
// centre_manager dashboard build's own ternary-sweep entry) into
// something that runs on every build instead of once, by hand.
//
// WHY ONLY SCHOOL-TRACK KEYWORDS, NOT ALSO A GENERIC "clinic" KEYWORD
// FOR CHECK 1: unlike a school customer never learning a clinic
// exists (clinic-copy-scan.mjs's own reason for existing), a respite
// screen LEGITIMATELY references a child's own separate clinic
// relationship by design -- RespiteChildRecord reads a linked clinic's
// own Crisis Plan, BSP strategies and calm cards during an activated
// stay (PRD 11 Stage 4/5), and describing that content as coming from
// "their clinical team" is correct, not a leak. Flagging every use of
// "clinic"/"clinician" would bury the real signal under expected,
// reviewed hits. What check 1 DOES still catch: a respite screen
// falsely claiming something is true of the CENTRE ITSELF using
// school-track words that are never true of any respite institution
// -- "classroom", "teacher", "principal", "pupil", "enrolment", "SNA",
// "supply", "term". "countersign" is deliberately dropped from this
// list (present in clinic-copy-scan.mjs's own KEYWORDS) because it has
// a real, distinct RESPITE meaning -- finalising the post-stay report
// (CentreManagerAgreementScreen.tsx's own consent copy, PRD 11 Stage
// 2) -- not just a school-incident-flow false positive to allowlist
// away; the word itself is not a leak indicator in this track the way
// it is in the clinic one.
//
// WHEN THIS FLAGS SOMETHING: read the file:line. Check 1 -- fix it
// through vocabulary.ts/institutionType.ts, or add a reviewed
// allowlist entry with a real reason (never a rubber stamp -- confirm
// the string genuinely can't reach a respite session before adding
// it). Check 2 also has an allowlist, deliberately, NOT a bare
// fail-on-any-hit -- a CORRECTLY fixed three-way branch is written as
// a PAIR of two-way comparisons (`isClinic = type === "clinic"`,
// `isRespite = type === "respite_centre"`, combined as `isClinic ? A :
// isRespite ? B : C`), so a genuinely safe file will always trip this
// regex too; the fix for the ORIGINAL incident wasn't "never compare
// to one type," it was "never let ONE such comparison be the whole
// decision." Before allowlisting a hit, confirm one of two things is
// actually true, the same rigor this codebase's own allowlist-scanner
// entries already require (read the live code, don't take the
// surrounding comment's word for it): (a) it's one arm of a real,
// visible three-(or more-)way branch in this same file (every named
// institution type gets its own outcome, nothing falls into another
// type's branch by omission), or (b) it's a genuine fail-closed
// one-vs-rest gate (`!== "school"`, matching
// useGuardSchoolOnlyRoute.ts's own established, CLAUDE.md-documented
// shape) where every OTHER type is deliberately and identically
// blocked, not just the one being compared. A hit that is neither --
// a bare `? X : Y` with no third branch anywhere in the file -- is the
// real thing this check exists to catch, and needs fixing, not
// allowlisting.
//
// WHEN A NEW RESPITE-REACHABLE FILE IS ADDED: add its path to
// RESPITE_REACHABLE_PATHS below -- explicit, not "everything under
// src/", matching clinic-copy-scan.mjs's own stated principle.

import { readFileSync, readdirSync, statSync } from "fs";
import { join, relative } from "path";
import { fileURLToPath } from "url";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const ALLOWLIST_PATH = fileURLToPath(new URL("./respite-copy-allowlist.json", import.meta.url));

// Every directory/file reachable by a centre_manager or care_staff
// session, built from the centre_manager dashboard build's own render-
// and-verify pass, 25 Sept 2026.
const RESPITE_REACHABLE_PATHS = [
  "src/app/centre",
  "src/app/care",
  "src/components/respite",
  // Shared with clinic and school -- consent/page.tsx's own switch
  // resolves and renders CentreManagerAgreementScreen/
  // CareStaffAgreementScreen for these two roles specifically, and the
  // page's own institutionType-resolution logic (fixed in this same
  // session) is a real, respite-reachable code path.
  "src/app/consent",
  "src/components/consent",
  // ComposeMessageSheet.tsx (the actual site of the real leak this
  // script exists to prevent) lives here, rendered directly by
  // RespiteChildRecord for a child-scoped Handover -- not reached via
  // a dedicated respite messages ROUTE (none exists yet, PRD 11 Stage
  // 2's own deliberate scope cut), which is exactly why
  // src/app/messages alone would have missed it.
  "src/components/messages",
  // A hook can return or throw a user-facing string as easily as a
  // component can render one -- clinic-copy-scan.mjs's own sanity test
  // already found this once; scanned whole, same tradeoff accepted
  // there.
  "src/hooks",
];

// Files under a respite-reachable directory above that are, on
// inspection, genuinely never reached by a centre_manager/care_staff
// session -- confirmed during this script's own build, 25 Sept 2026.
// Re-check this list if a file here later gains a real respite caller,
// don't just grow it.
const KNOWN_NON_RESPITE_EXCEPTIONS = [
  // consent/page.tsx's own switch renders these only for
  // class_teacher/sna/principal/clinician/clinical_lead/clinic_admin --
  // never centre_manager/care_staff.
  "src/components/consent/TeacherAgreementScreen.tsx",
  "src/components/consent/SnaAgreementScreen.tsx",
  "src/components/consent/PrincipalAgreementScreen.tsx",
  "src/components/consent/ClinicianAgreementScreen.tsx",
  "src/components/consent/ClinicalLeadAgreementScreen.tsx",
  "src/components/consent/ClinicAdminAgreementScreen.tsx",
  // Gated on `role === "principal"` (checked directly, 25 Sept 2026) --
  // structurally unreachable by centre_manager/care_staff, since the
  // respite self-link INSERT policy (0296) never admits `principal` as
  // a legal role at a respite_centre institution. Included in
  // src/hooks' own whole-directory sweep (matching this script's own
  // "scan hooks whole" tradeoff) but confirmed dead for this track.
  "src/hooks/useClinicalWorkSwitch.ts",
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
  "supply",
  "cover",
  "term",
];
const KEYWORD_RE = new RegExp(`\\b(${KEYWORDS.join("|")})\\b`, "i");

// Check 2's own pattern -- matches institutionType (or the destructured
// alias every respite-reachable file uses for it) compared to exactly
// one of "school"/"clinic" with === or !==. Deliberately does NOT
// match a comparison to "respite_centre" itself -- `institutionType
// === "respite_centre"` is a one-vs-rest-safe form only when paired
// with an explicit third branch elsewhere, which this script cannot
// verify structurally either way; flagging every "school"/"clinic"
// comparison already catches the two-way trap at its actual source.
const TWO_WAY_TERNARY_RE = /institutionType\s*(===|!==)\s*"(school|clinic)"/g;

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
  for (const p of RESPITE_REACHABLE_PATHS) {
    const abs = join(ROOT, p);
    try {
      for (const f of walk(abs)) files.add(f);
    } catch {
      console.warn(`respite-copy-scan: configured path missing, skipping: ${p}`);
    }
  }
  const excluded = KNOWN_NON_RESPITE_EXCEPTIONS.map((p) => join(ROOT, p));
  return [...files]
    .filter((f) => !excluded.some((e) => f === e || f.startsWith(e + "/")))
    .sort();
}

const QUOTED_STRING_RE = /"[^"]{15,}"/g;

function scanFile(path) {
  const text = readFileSync(path, "utf8");
  const lines = text.split("\n");
  const copyHits = [];
  const ternaryHits = [];
  lines.forEach((line, i) => {
    const trimmed = line.trim();
    const isComment = trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");

    if (!isComment) {
      const ternaryMatches = line.match(TWO_WAY_TERNARY_RE);
      if (ternaryMatches) {
        for (const m of ternaryMatches) ternaryHits.push({ line: i + 1, text: m });
      }
    }

    if (isComment) return;
    if (/^import\b/.test(trimmed)) return;
    const matches = line.match(QUOTED_STRING_RE);
    if (!matches) return;
    for (const m of matches) {
      const inner = m.slice(1, -1);
      if (m.startsWith('"@/') || m.startsWith('"./') || m.startsWith('"../')) continue;
      if (inner.startsWith("/")) continue;
      if (/^[a-z0-9_-]+$/.test(inner)) continue;
      if ((inner.match(/,/g) ?? []).length >= 3 && /^[a-z0-9_, ]+$/.test(inner)) continue;
      if (!KEYWORD_RE.test(m)) continue;
      copyHits.push({ line: i + 1, text: m });
    }
  });
  return { copyHits, ternaryHits };
}

// {"copy": {"<path>": {"line:text": "reason"}}, "ternary": {"<path>":
// {"line:text": "reason"}}} -- two sections, one file, since both
// checks share the same "reviewed exception, never a silent skip"
// shape; kept as two distinct keys rather than one merged map so a
// reviewer can tell at a glance which check an entry is answering for.
function loadAllowlist() {
  try {
    const parsed = JSON.parse(readFileSync(ALLOWLIST_PATH, "utf8"));
    return { copy: parsed.copy ?? {}, ternary: parsed.ternary ?? {} };
  } catch {
    return { copy: {}, ternary: {} };
  }
}

function main() {
  const allowlist = loadAllowlist();
  const files = collectFiles();
  const newCopyHits = [];
  const newTernaryHits = [];

  for (const abs of files) {
    const rel = relative(ROOT, abs);
    const { copyHits, ternaryHits: fileTernaryHits } = scanFile(abs);

    const allowedCopyForFile = allowlist.copy[rel] ?? {};
    for (const hit of copyHits) {
      const key = `${hit.line}:${hit.text}`;
      if (Object.prototype.hasOwnProperty.call(allowedCopyForFile, key)) continue;
      newCopyHits.push({ file: rel, ...hit });
    }

    const allowedTernaryForFile = allowlist.ternary[rel] ?? {};
    for (const hit of fileTernaryHits) {
      const key = `${hit.line}:${hit.text}`;
      if (Object.prototype.hasOwnProperty.call(allowedTernaryForFile, key)) continue;
      newTernaryHits.push({ file: rel, ...hit });
    }
  }

  if (newCopyHits.length === 0 && newTernaryHits.length === 0) {
    console.log(`respite-copy-scan: clean (${files.length} respite-reachable files checked).`);
    return;
  }

  if (newTernaryHits.length > 0) {
    console.error(`respite-copy-scan: ${newTernaryHits.length} unreviewed two-way institutionType comparison(s) found in respite-reachable code -- this is the exact shape that leaked "phone the school" onto a real centre_manager's Handover screen:\n`);
    for (const hit of newTernaryHits) {
      console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
    }
    console.error(
      `\nEach one is either a real trap (fix it into a genuine three-(or more-)way branch) or, once actually verified safe per this file's own header, a reviewed exception -- add "${'{line}'}:${'{text}'}" to that file's own array under "ternary" in scripts/checks/respite-copy-allowlist.json, with a reason.\n`
    );
  }

  if (newCopyHits.length > 0) {
    console.error(`respite-copy-scan: ${newCopyHits.length} unreviewed hardcoded school-word string(s) found in respite-reachable code:\n`);
    for (const hit of newCopyHits) {
      console.error(`  ${hit.file}:${hit.line}: ${hit.text}`);
    }
    console.error(
      `\nEach one is either a real leak (fix it through the vocabulary/institutionType layer) or a genuine false positive (add "${'{line}'}:${'{text}'}" to that file's own array in scripts/checks/respite-copy-allowlist.json, with a reason -- never without first confirming the string genuinely can't reach a respite session).`
    );
  }

  process.exit(1);
}

main();
