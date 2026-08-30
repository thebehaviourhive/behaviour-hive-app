/* scripts/dev/teardown.mjs -- tear down fixtures on production. Nothing
   else exists yet: the app has no separate dev/staging database, so
   every fixture this team creates to verify real work lives on
   production until this script removes it. Rule: every fixture you
   create, you tear down in the same session, nothing left behind.

   Usage:
     node scripts/dev/teardown.mjs institution <institution_code> [--force]
     node scripts/dev/teardown.mjs user <email> [--force]

   Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the
   environment (this repo's convention: `set -a; source .env.local; set +a`
   before running).

   FIXTURE-ONLY, BY CONVENTION, NO EXCEPTIONS
   -------------------------------------------
   This script refuses, unconditionally, to touch anything that doesn't
   look like a fixture:
     - institution mode: institution_code must start with "ZZFIXTURE"
       (case-insensitive). BHPS0000 -- the real trial school -- is also
       named explicitly so the refusal reads plainly, but the prefix
       check alone would already catch it and everything else real.
     - user mode: the email must contain "zzfixture" (case-insensitive).
   There is no flag to override either check. If a real institution or
   user genuinely needs removing, that is a deliberate, manual decision,
   not something this script automates. Every fixture script under
   scripts/ that creates an institution or user going forward should
   name it to match these conventions, specifically so this script can
   find and remove it later.

   --force gates a SEPARATE concern: a fixture that's still just an
   empty shell (a school with a teacher and no incident data) tears down
   with no extra confirmation. A fixture with real incident rows attached
   -- the thing this whole module exists to protect -- requires --force,
   even though it's a recognised fixture, because "this has signed,
   countersigned, attested incident data on it and I'm about to destroy
   it" deserves a second look every time, fixture or not.

   WHAT THIS SCRIPT WILL NEVER DO
   -------------------------------
   It will never add ON DELETE CASCADE, weaken a foreign key, or null out
   a column to make a delete succeed. incident_children.added_by,
   incident_amendments.author_id, incident_attestations.created_by,
   incident_injuries.staff_user_id, restrictive_practices.ncse_completed_by,
   incident_debriefs.completed_by, school_notices.acknowledged_by, and
   incidents.teacher_signed_by/countersigned_by are all NOT NULL-or-not,
   NO ACTION foreign keys to auth.users -- deliberately un-cascadable, by
   design, because a legal record that can lose its author is worthless.
   If deleting a user would require destroying one of THOSE rows on an
   incident that user didn't even create, this script refuses outright,
   before touching anything, and explains exactly which rows are in the
   way. That refusal is not overridable by --force. The fix is never "run
   it harder" -- it's "tear down the institution that incident belongs to
   first" (institution teardown cascades those rows away legitimately,
   because the whole institution -- incidents included -- is what's being
   removed, not just the person who happened to sign one of them).

   ORDER FOR A FULL FIXTURE TEARDOWN
   -----------------------------------
   Institution mode first, then user mode for each fixture account
   (teacher, parent, principal, ...). Institution teardown clears every
   incident-log row that would otherwise block deleting an account that
   touched them. Running user mode first, on an account that created,
   signed, attested, or was named in incident data, will correctly
   refuse or (if the account only ever CREATED its own incidents) cascade
   those incidents away as a side effect -- which is why that specific
   case requires --force too.

   NOTE ON EXISTING DB-LEVEL CASCADES
   -------------------------------------
   Large parts of this schema (everything from before the incident log --
   passports, institution_staff, passport_access, clinicians, fba_*,
   messages, calm cards, ...) already cascade at the DB level on
   institution_id/user_id/passport_id. This script still deletes
   explicitly, table by table, in dependency order, rather than firing
   one DELETE and trusting cascade to do the rest -- an explicit walk
   reports exactly what was removed from where, and if a future migration
   ever adds a table without a cascade, this script's own designed order
   still gets it, rather than surfacing an opaque failure three tables
   away from the real cause. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// Runs `applyFilter` against `table`'s delete builder and returns the
// row count removed. `applyFilter` may return null to mean "nothing to
// filter on (e.g. an empty id list) -- skip this table entirely" rather
// than issuing a `.in(col, [])` call, which PostgREST rejects.
async function del(table, applyFilter) {
  const query = applyFilter(admin.from(table).delete({ count: "exact" }));
  if (query === null) return 0;
  const { error, count } = await query;
  if (error) {
    fail(
      `Deleting from ${table} failed: ${error.message}\n\n` +
        `Stopped here. Everything before ${table} in this run is already gone; ${table} onward is untouched. Safe to re-run once resolved.`
    );
  }
  return count ?? 0;
}

function printReport(report) {
  console.log("\nRows deleted:");
  for (const [table, count] of report) {
    console.log(`  ${table.padEnd(28)} ${count}`);
  }
}

// ---------------------------------------------------------------------
// institution <code>
// ---------------------------------------------------------------------
async function teardownInstitution(code, force, withOrphanedPassports) {
  console.log(`\n=== INSTITUTION TEARDOWN: ${code} ===`);

  if (code.toUpperCase() === "BHPS0000") {
    fail(`Refusing: ${code} is the real trial institution. This script never touches it.`);
  }
  if (!/^ZZFIXTURE/i.test(code)) {
    fail(
      `Refusing: "${code}" does not start with ZZFIXTURE -- this script only tears down institutions ` +
        `created by a fixture script under that naming convention. If this is a real institution, or a ` +
        `pre-convention fixture, it needs manual cleanup, not this script.`
    );
  }

  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .select("id, institution_code, name")
    .eq("institution_code", code)
    .maybeSingle();
  if (instErr) fail(`Institution lookup failed: ${instErr.message}`);
  if (!inst) fail(`No institution found with code ${code}.`);

  const { data: incidentRows, error: incErr } = await admin.from("incidents").select("id").eq("institution_id", inst.id);
  if (incErr) fail(`Failed to check incident data: ${incErr.message}`);
  const incidentIds = (incidentRows ?? []).map((r) => r.id);

  if (incidentIds.length > 0 && !force) {
    fail(
      `${incidentIds.length} incident(s) exist under ${code} (${inst.name}). Pass --force to confirm permanent ` +
        `deletion of this incident data, including any signed or countersigned records.`
    );
  }
  if (incidentIds.length > 0) {
    console.log(`--force acknowledged: deleting ${incidentIds.length} incident(s) and everything under them.`);
  }

  const { data: injuryRows, error: injErr } = incidentIds.length
    ? await admin.from("incident_injuries").select("id").in("incident_id", incidentIds)
    : { data: [], error: null };
  if (injErr) fail(`Failed to resolve injuries: ${injErr.message}`);
  const injuryIds = (injuryRows ?? []).map((r) => r.id);

  // Captured BEFORE passport_institution_links is deleted below --
  // passports.create_school_passport() (0113) creates a passport with
  // no institution_id column at all (a passport genuinely isn't
  // institution-owned), so nothing in this function's own steps ever
  // reaches it. Without --with-orphaned-passports this stays exactly as
  // it always has: a fixture-created, guardian-less passport survives
  // institution teardown by design, same as it does for a real school.
  // See the orphaned-passport sweep after the report below.
  const { data: linkedPassportRows } = await admin
    .from("passport_institution_links")
    .select("passport_id")
    .eq("institution_id", inst.id);
  const linkedPassportIds = [...new Set((linkedPassportRows ?? []).map((r) => r.passport_id))];

  const inIncident = (col) => (t) => (incidentIds.length ? t.in(col, incidentIds) : null);

  const steps = [
    ["incident_attestations", inIncident("incident_id")],
    ["incident_body_marks", (t) => (injuryIds.length ? t.in("injury_id", injuryIds) : null)],
    ["incident_amendments", inIncident("incident_id")],
    ["incident_debriefs", inIncident("incident_id")],
    ["incident_injuries", inIncident("incident_id")],
    ["restrictive_practices", inIncident("incident_id")],
    ["incident_actions", inIncident("incident_id")],
    ["incident_staff", inIncident("incident_id")],
    ["incident_children", inIncident("incident_id")],
    ["school_notices", (t) => t.eq("institution_id", inst.id)],
    ["incidents", (t) => t.eq("institution_id", inst.id)],
    ["incident_locations", (t) => t.eq("institution_id", inst.id)],
    ["incident_injury_types", (t) => t.eq("institution_id", inst.id)],
    ["incident_action_types", (t) => t.eq("institution_id", inst.id)],
    ["incident_recovery_types", (t) => t.eq("institution_id", inst.id)],
    ["cpi_reason_types", (t) => t.eq("institution_id", inst.id)],
    ["cpi_disengagement_types", (t) => t.eq("institution_id", inst.id)],
    ["cpi_result_types", (t) => t.eq("institution_id", inst.id)],
    ["passport_access", (t) => t.eq("institution_id", inst.id)],
    // clinician_access.engaged_by_institution_id (0123) is a NON-
    // cascading FK to institutions -- deleting the institutions row
    // below fails loudly against it otherwise, exactly the same
    // "legal record can't lose its subject" posture this script
    // already applies elsewhere, just surfaced here for the first
    // time by a fixture that actually exercised institution-engaged
    // clinician access. Scoped narrowly to rows THIS institution
    // engaged -- a clinician's own parent-engaged rows for the same
    // passport (engaged_by_institution_id is null there) are
    // untouched, matching passport_access's own institution-only scope
    // immediately above.
    ["clinician_access", (t) => t.eq("engaged_by_institution_id", inst.id)],
    // enrolments (0121) would cascade automatically once the
    // institutions row itself is deleted below regardless -- explicit
    // here anyway, matching this script's own stated philosophy: an
    // explicit walk reports exactly what was removed from where, rather
    // than trusting an implicit cascade to also be a visible one.
    ["enrolments", (t) => t.eq("institution_id", inst.id)],
    ["passport_institution_links", (t) => t.eq("institution_id", inst.id)],
    ["institution_staff", (t) => t.eq("institution_id", inst.id)],
  ];

  const report = [];
  for (const [table, applyFilter] of steps) {
    report.push([table, await del(table, applyFilter)]);
  }
  report.push(["institutions", await del("institutions", (t) => t.eq("id", inst.id))]);

  printReport(report);

  const { data: verifyInst } = await admin.from("institutions").select("id").eq("institution_code", code);
  const { data: verifyStaff } = await admin.from("institution_staff").select("id").eq("institution_id", inst.id);
  const { data: verifyIncidents } = await admin.from("incidents").select("id").eq("institution_id", inst.id);
  const clean = (verifyInst?.length ?? 0) === 0 && (verifyStaff?.length ?? 0) === 0 && (verifyIncidents?.length ?? 0) === 0;

  console.log(
    `\nVerified by direct query: institutions=${verifyInst?.length ?? 0}, institution_staff=${verifyStaff?.length ?? 0}, ` +
      `incidents=${verifyIncidents?.length ?? 0} -- ${clean ? "CLEAN" : "NOT CLEAN -- investigate before trusting this teardown"}`
  );
  if (!clean) process.exit(1);

  // ---------------------------------------------------------------------
  // --with-orphaned-passports: NOT a change to institution mode's own
  // semantics -- a passport genuinely isn't institution-owned, so the
  // steps above never touch it, on purpose, for a real school exactly
  // as much as a fixture one. This is a SEPARATE, explicit sweep, opt-in
  // only, scoped to the exact passport_ids that WERE linked to this one
  // institution (captured before its own passport_institution_links
  // rows were deleted above) -- never a blanket scan of the whole
  // database.
  //
  // A passport deletes here if, right now, it has ZERO institution
  // links anywhere (not just this one -- a passport genuinely shared
  // across institutions in a more elaborate fixture keeps existing), no
  // self-created owner (user_id is null -- create_school_passport()'s
  // own signature), and every guardian on it (zero or more) is ITSELF a
  // recognised fixture account -- email contains "zzfixture", same
  // string check user mode already uses to decide what it's allowed to
  // touch. Originally this required zero guardians outright, which
  // meant a fixture that exercised the claim flow (generated a code,
  // had a real fixture parent redeem it -- Stage 3's own verification
  // pass, and apparently at least one earlier one) left its passport
  // behind every time, silently, with no failure to notice it by --
  // caught only by hand, twice. A passport with a genuine non-fixture
  // guardian is never touched by this, at any count: one recognised
  // real email among the guardians is enough to skip it outright.
  //
  // passport_claim_codes.passport_id and passport_guardians.passport_id
  // are both ON DELETE CASCADE (0114/0113) -- deleting the passports row
  // below removes them as a side effect, nothing to delete explicitly
  // first.
  //
  // Safe by construction, not just by this check: incident_children.
  // passport_id cascades (0068), but restrictive_practices.passport_id,
  // incident_injuries.passport_id, and school_notices.passport_id do
  // NOT (deliberately, same "a legal record can't lose its subject"
  // posture this script's own header already documents for auth.users).
  // If a passport this orphan check would otherwise delete is still
  // named on real incident data somehow, the delete fails loudly with a
  // foreign-key error instead of silently succeeding -- never overridden
  // here, not even by --force.
  if (withOrphanedPassports && linkedPassportIds.length > 0) {
    console.log(`\n=== ORPHANED-PASSPORT SWEEP (${linkedPassportIds.length} passport(s) linked to ${code}) ===`);

    // One batched lookup for the whole sweep, not one per guardian --
    // same listUsers({perPage: 1000}) shape teardownUser() already uses.
    const { data: allUsers, error: listUsersErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (listUsersErr) fail(`listUsers failed during orphaned-passport sweep: ${listUsersErr.message}`);
    const emailById = new Map((allUsers?.users ?? []).map((u) => [u.id, (u.email ?? "").toLowerCase()]));

    for (const passportId of linkedPassportIds) {
      const [{ count: remainingLinks }, { data: guardianRows }, { data: passportRow }] = await Promise.all([
        admin.from("passport_institution_links").select("id", { count: "exact", head: true }).eq("passport_id", passportId),
        admin.from("passport_guardians").select("user_id").eq("passport_id", passportId),
        admin.from("passports").select("id, child_name, user_id").eq("id", passportId).maybeSingle(),
      ]);

      if (!passportRow) {
        console.log(`  ${passportId}  already gone`);
        continue;
      }

      const guardians = guardianRows ?? [];
      const nonFixtureGuardians = guardians.filter((g) => !(emailById.get(g.user_id) ?? "").includes("zzfixture"));

      if ((remainingLinks ?? 0) > 0 || passportRow.user_id !== null || nonFixtureGuardians.length > 0) {
        console.log(
          `  ${passportId}  "${passportRow.child_name}"  SKIPPED -- still has ${remainingLinks ?? 0} other link(s), ` +
            `user_id=${passportRow.user_id ?? "null"}, ${guardians.length} guardian(s) (${nonFixtureGuardians.length} non-fixture)`
        );
        continue;
      }

      const { error: delErr } = await admin.from("passports").delete().eq("id", passportId);
      if (delErr) {
        console.log(`  ${passportId}  "${passportRow.child_name}"  FAILED: ${delErr.message} -- left in place, not overridden`);
        continue;
      }
      console.log(
        `  ${passportId}  "${passportRow.child_name}"  deleted (cascades: passport_claim_codes, passport_guardians ` +
          `[${guardians.length} recognised fixture guardian(s)], passport_section_b/c/d, enrolments, morning_checkins, activity_log, ...)`
      );
    }
  }
}

// ---------------------------------------------------------------------
// user <email>
// ---------------------------------------------------------------------
async function teardownUser(email, force) {
  console.log(`\n=== USER TEARDOWN: ${email} ===`);

  if (!email.toLowerCase().includes("zzfixture")) {
    fail(
      `Refusing: "${email}" does not contain "zzfixture" -- this script only tears down accounts created by a ` +
        `fixture script under that naming convention.`
    );
  }

  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) fail(`listUsers failed: ${listErr.message}`);
  const user = (listData?.users ?? []).find((u) => (u.email ?? "").toLowerCase() === email.toLowerCase());
  if (!user) fail(`No user found with email ${email}.`);
  const userId = user.id;

  const { data: ownIncidentRows, error: ownErr } = await admin.from("incidents").select("id").eq("created_by", userId);
  if (ownErr) fail(`Failed to resolve this account's own incidents: ${ownErr.message}`);
  const ownIncidentIds = (ownIncidentRows ?? []).map((r) => r.id);

  // Hard-block precheck. Every one of these columns is a NO ACTION
  // foreign key to auth.users -- deleting the row it points to is
  // structurally impossible without either destroying an incident this
  // account did NOT create (never done here) or refusing outright. Rows
  // that belong to an incident THIS account created are fine: deleting
  // that incident below cascades them away legitimately.
  const blockChecks = [
    ["incident_children.added_by", "incident_children", "added_by", "incident_id"],
    ["incident_amendments.author_id", "incident_amendments", "author_id", "incident_id"],
    ["incident_attestations.created_by", "incident_attestations", "created_by", "incident_id"],
    ["incident_injuries.staff_user_id", "incident_injuries", "staff_user_id", "incident_id"],
    ["restrictive_practices.ncse_completed_by", "restrictive_practices", "ncse_completed_by", "incident_id"],
    ["incident_debriefs.completed_by", "incident_debriefs", "completed_by", "incident_id"],
    ["school_notices.acknowledged_by", "school_notices", "acknowledged_by", "incident_id"],
  ];

  const blocks = [];
  for (const [label, table, col, incidentCol] of blockChecks) {
    const { data, error } = await admin.from(table).select(`id, ${incidentCol}`).eq(col, userId);
    if (error) fail(`Checking ${table}.${col} failed: ${error.message}`);
    const outside = (data ?? []).filter((r) => !ownIncidentIds.includes(r[incidentCol]));
    if (outside.length > 0) blocks.push([label, outside.length]);
  }
  for (const col of ["teacher_signed_by", "countersigned_by"]) {
    const { data, error } = await admin.from("incidents").select("id").eq(col, userId);
    if (error) fail(`Checking incidents.${col} failed: ${error.message}`);
    const outside = (data ?? []).filter((r) => !ownIncidentIds.includes(r.id));
    if (outside.length > 0) blocks.push([`incidents.${col}`, outside.length]);
  }

  if (blocks.length > 0) {
    console.error(
      `\nRefusing: this account is referenced on incident data it did not create, in columns that never cascade:`
    );
    for (const [label, n] of blocks) console.error(`  ${label}: ${n} row(s)`);
    console.error(
      `\nThese are append-only, witness, or signature columns -- a legal record can't lose its author. ` +
        `Not overridable with --force. If these rows belong to a fixture institution, tear that institution ` +
        `down first (its incidents will cascade these rows away as part of removing the whole institution, ` +
        `not by nulling or reassigning a signature after the fact).`
    );
    process.exit(1);
  }

  if (ownIncidentIds.length > 0 && !force) {
    fail(
      `This account created ${ownIncidentIds.length} incident(s). Deleting it cascades those incidents away ` +
        `entirely (created_by is ON DELETE CASCADE). Pass --force to confirm.`
    );
  }
  if (ownIncidentIds.length > 0) {
    console.log(`--force acknowledged: deleting this account cascades away ${ownIncidentIds.length} incident(s) it created.`);
  }

  const { data: injuryRows, error: injErr } = ownIncidentIds.length
    ? await admin.from("incident_injuries").select("id").in("incident_id", ownIncidentIds)
    : { data: [], error: null };
  if (injErr) fail(`Failed to resolve injuries: ${injErr.message}`);
  const injuryIds = (injuryRows ?? []).map((r) => r.id);

  const inOwnIncident = (col) => (t) => (ownIncidentIds.length ? t.in(col, ownIncidentIds) : null);

  const steps = [
    ["incident_attestations", inOwnIncident("incident_id")],
    ["incident_body_marks", (t) => (injuryIds.length ? t.in("injury_id", injuryIds) : null)],
    ["incident_amendments", inOwnIncident("incident_id")],
    ["incident_debriefs", inOwnIncident("incident_id")],
    ["incident_injuries", inOwnIncident("incident_id")],
    ["restrictive_practices", inOwnIncident("incident_id")],
    ["incident_actions", inOwnIncident("incident_id")],
    ["incident_staff", inOwnIncident("incident_id")],
    ["incident_children", inOwnIncident("incident_id")],
    ["school_notices", inOwnIncident("incident_id")],
    ["incidents", (t) => t.eq("created_by", userId)],
    ["passport_access", (t) => t.eq("teacher_id", userId)],
    ["institution_staff", (t) => t.eq("user_id", userId)],
    // passport_guardians (0113) -- Stage 5's claim flow can establish a
    // guardian relationship with passports.user_id left null (a
    // principal-created, guardian-claimed passport), so the old
    // user_id-keyed passports step below never reaches it. Without this,
    // auth.users deletion fails against passport_guardians.user_id's own
    // FK with an unhelpfully empty error object -- found live tearing
    // down a Stage 7 browser-verification fixture. Deliberately just the
    // guardian row, not the passport itself: same conservative posture
    // as institution mode's own orphaned-passport sweep (opt-in,
    // explicit) -- a guardian-less claimed passport is a legitimate
    // state, not something this step silently deletes.
    ["passport_guardians", (t) => t.eq("user_id", userId)],
    // clinician_access (0123) -- this account can appear here three
    // ways: as the clinician themselves (clinician_id), or as the
    // authority who granted or revoked a PARENT-engaged row
    // (granted_by/revoked_by; institution-engaged rows this account
    // acted on as a principal are already scoped and removed by
    // institution teardown's own engaged_by_institution_id step, but a
    // parent-engaged row has no institution scope at all, so nothing
    // else in this script ever reaches it). All three block auth.users
    // deletion with an unhelpfully empty error object otherwise -- found
    // live in the same fixture teardown as the passport_guardians gap
    // just above.
    ["clinician_access", (t) => t.or(`clinician_id.eq.${userId},granted_by.eq.${userId},revoked_by.eq.${userId}`)],
    ["passports", (t) => t.eq("user_id", userId)],
  ];

  const report = [];
  for (const [table, applyFilter] of steps) {
    report.push([table, await del(table, applyFilter)]);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) {
    fail(
      `auth.users deletion failed: ${delErr.message}\n\n` +
        `Everything else above is already gone; only the auth account remains. Safe to re-run once resolved.`
    );
  }
  report.push(["auth.users", 1]);

  printReport(report);

  const { data: verifyUser } = await admin.auth.admin.getUserById(userId);
  console.log(`\nVerified by direct query: getUserById -> ${verifyUser?.user ? "STILL EXISTS (FAIL)" : "not found (gone)"}`);
  if (verifyUser?.user) process.exit(1);

  // auth.identities isn't reachable via PostgREST (the auth schema isn't
  // exposed), so the only way to prove the email is genuinely free again
  // -- not just that the auth.users row is gone -- is to actually try to
  // reclaim it, then tear the probe straight back down. This is the real
  // functional check for the exact symptom that motivated this rule: an
  // email left claimed by a stale identity even after the user row goes.
  const probePassword = `Probe-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
  const { data: probe, error: probeErr } = await admin.auth.admin.createUser({
    email,
    password: probePassword,
    email_confirm: true,
  });
  if (probeErr) {
    console.error(
      `\nWARNING: could not re-claim ${email} after deletion (${probeErr.message}). A stale auth.identities row ` +
        `is still blocking this email -- manual cleanup needed (Supabase Studio -> Table Editor -> auth.identities). ` +
        `Not resolved by this run.`
    );
    process.exit(1);
  }
  const { error: probeDelErr } = await admin.auth.admin.deleteUser(probe.user.id);
  console.log(
    `Verified by direct query: auth.identities released -- ${email} was re-claimable and the probe account was torn ` +
      `back down (${probeDelErr ? "probe cleanup FAILED: " + probeDelErr.message : "cleanup ok"}).`
  );
  if (probeDelErr) process.exit(1);
}

// ---------------------------------------------------------------------
const [, , mode, identifier, ...rest] = process.argv;
const force = rest.includes("--force");
const withOrphanedPassports = rest.includes("--with-orphaned-passports");

if (mode === "institution" && identifier) {
  await teardownInstitution(identifier, force, withOrphanedPassports);
} else if (mode === "user" && identifier) {
  await teardownUser(identifier, force);
} else {
  console.log(`Usage:
  node scripts/dev/teardown.mjs institution <institution_code> [--force] [--with-orphaned-passports]
  node scripts/dev/teardown.mjs user <email> [--force]

--with-orphaned-passports: also deletes any passport that was linked to
this institution and, after teardown, has zero remaining institution
links, no self-created owner, and no guardian outside this fixture --
the shape create_school_passport() (optionally claimed via a real
fixture parent) leaves behind, since a passport was never institution-
owned and institution mode's own steps never reach it. A guardian
counts as "this fixture" only if their own account email contains
"zzfixture" -- the same check user mode uses -- so a passport claimed
by even one real guardian is never touched, at any guardian count.
Does not touch a passport still linked elsewhere or self-created.
Fails loudly (never silently, never overridden by --force) if the
passport is still named on real incident data via a non-cascading FK
(restrictive_practices/incident_injuries/school_notices).

Only tears down fixtures: institution codes must start with ZZFIXTURE,
user emails must contain "zzfixture". Refuses everything else,
unconditionally -- BHPS0000 included, no override.

For a full fixture teardown, run institution FIRST, then each fixture
user -- institution teardown clears the incident-log rows that would
otherwise block deleting a teacher/parent account that touched them.`);
  process.exit(1);
}
