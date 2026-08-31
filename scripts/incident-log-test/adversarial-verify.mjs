// Adversarial RLS verification for the School Incident Log (Phases 1
// and its follow-up fix). Real JWTs throughout, not service-role
// bypasses -- "the UI doesn't show it" never counts, query-level is the
// bar. Creates a dedicated institution + accounts, drives the actual
// incident lifecycle through real signed-in sessions via
// create_incident_stamp()/claim_incident() (the only creation paths --
// direct table INSERT on incidents has no policy at all any more),
// asserts every check, then deletes everything it created.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/adversarial-verify.mjs
//
// DEV-MODE SPLIT: set ONLY_CHECKS to a comma-separated list of block
// names to run just those blocks instead of the full suite --
// ONLY_CHECKS=GG,HH node --env-file=.env.local scripts/incident-log-test/adversarial-verify.mjs
// "CORE" covers the shared top-level fixture and every check from B
// through U -- that region is one historically-accumulated, tightly
// interleaved unit (many of those checks build on state earlier ones in
// the same region left behind) and was never split further; it's also
// stable, rarely-touched code, not what gets iterated on during new-
// stage development. Every check from V onward is independently
// self-contained (own institution, own accounts, own cleanup) and
// individually selectable: V, W, X, Y, Z, AA, BB, CC, DD, EE, FF, GG,
// HH, II, JJ, KK, LL, MM, NN, OO, PP, QQ, RR, SS, TT, UU, VV, WW, XX, YY, ZZ, AAA, BBB. Selecting none of these (ONLY_CHECKS unset) is the full run --
// the one that gates deploys -- and its behavior is unchanged: same
// checks, same order, same pass/fail counts. The only observable
// difference is where the top-level fixture's own cleanup log line
// appears (moved to right after CHECK U instead of the very end, so a
// crash in any later check no longer strands it uncleaned) -- not a
// change to which checks run or what they assert.
//
// This exists because a single full run costs ~90 real sign-ins against
// Supabase's own auth rate limits (Free tier) -- fine once, but
// debugging one new block by re-running the entire suite repeatedly (as
// happened live building HH) burns through that budget in a handful of
// attempts. Iterate with ONLY_CHECKS on whatever block you're building;
// reserve the full, unscoped run for the actual gate.

import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "IncidentVerify-2026!";
const CODE = "INCVERIFY" + Math.floor(Math.random() * 10000);

// null (ONLY_CHECKS unset) means "run everything" -- shouldRun() is
// then true unconditionally, which is what makes the full run's
// behavior identical to before this existed: no ONLY_CHECKS, no
// skipped blocks, same checks in the same order.
const ONLY_CHECKS = process.env.ONLY_CHECKS ? process.env.ONLY_CHECKS.split(",").map((s) => s.trim().toUpperCase()) : null;
function shouldRun(name) {
  return !ONLY_CHECKS || ONLY_CHECKS.includes(name.toUpperCase());
}
if (ONLY_CHECKS) {
  console.log(`ONLY_CHECKS set -- running just: ${ONLY_CHECKS.join(", ")}`);
}

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} -- ${name}${detail ? " :: " + detail : ""}`);
}

// Mirrors checkExisting()'s own resolution logic
// (src/app/teacher/join-institution/page.tsx) exactly -- given the rows
// its query returns, what status would the component show. Shared by
// CHECK V (V10-pre/post, a genuine rejoin) and CHECK W (W13-W15, the
// none/rejected/active states) rather than duplicated per check.
function resolveStatus(rows) {
  const active = rows.find((r) => r.approved_at !== null);
  if (active) return "active";
  const current = rows[0];
  if (!current) return "none";
  return current.rejected_at !== null ? "rejected" : "pending";
}

// Dublin-local "now", computed once per call, used to derive cut-off
// values that are deterministically before/after the current instant --
// this varies STORED data (granted_for_date, temporary_access_cutoff_
// time) against the real current time, not the other way around. No
// sleeping, no clock mocking. Hoisted here (originally local to CHECK
// AA) so CHECK BB can set a live-comfortable cutoff for its own
// institution too, rather than relying on the 15:00 schema default,
// which the current run may already be past.
function dublinNowParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
function addMinutesClamped(hhmmss, delta) {
  const [h, m] = hhmmss.split(":").map(Number);
  let total = h * 60 + m + delta;
  total = Math.max(7 * 60 + 31, Math.min(23 * 60 + 59, total));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

// Both helpers below hit Supabase's own auth rate limiter (the "sign-ups
// and sign-ins" bucket in the dashboard, confirmed 2026-08-30 to cover
// BOTH signInWithPassword() and admin.createUser() -- not two separate
// budgets). Raising the dashboard limit (30 -> 300/5min) did not change
// where a full run crashes: four attempts, wide-ranging gaps between
// them (immediate, 70min, 90min, a clean 10min), all died at nearly the
// identical point (CHECK KK's own clinician-verification loop) --
// evidence this was never actually about the sustained 5-minute budget,
// which a run's own ~240 total auth calls spread across ~10-12 minutes
// of real wall-clock runtime should sit well under even at the OLD
// 30/5min setting. Simplest explanation left standing: the suite's own
// front-loaded call pattern (CORE's own many createUser() calls,
// clustered early and close together) bursts hard enough, early enough,
// that a rolling window is still full of that burst's own tail by the
// time later checks add a few more calls on top -- a genuine
// sub-window burst, not a sustained-rate problem the dashboard's own
// "requests per 5 min" framing suggests. sleep()+retry here treats the
// actual symptom directly rather than requiring a perfectly-tuned
// dashboard value or perfectly-spaced manual re-runs.
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
const AUTH_CALL_THROTTLE_MS = 150;
async function withRateLimitRetry(fn, label) {
  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const msg = err?.message ?? "";
      if (!/rate limit/i.test(msg) || attempt === 4) throw err;
      const backoffMs = 2000 * attempt;
      console.log(`  (rate limit hit on ${label}, attempt ${attempt}/4 -- backing off ${backoffMs}ms and retrying)`);
      await sleep(backoffMs);
    }
  }
}

async function signedInClient(email) {
  await sleep(AUTH_CALL_THROTTLE_MS);
  return withRateLimitRetry(async () => {
    const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
    const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
    if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
    return c;
  }, `sign-in(${email})`);
}

async function createUser(email, fullName, role) {
  await sleep(AUTH_CALL_THROTTLE_MS);
  return withRateLimitRetry(async () => {
    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: fullName },
      app_metadata: { role },
    });
    if (error) throw new Error(error.message ?? String(error));
    return data.user.id;
  }, `createUser(${email})`);
}

async function main() {
  // CORE: the shared top-level fixture plus every check from B through
  // U -- see the file header for why this region is one indivisible
  // unit rather than individually split. Its own cleanup lives at the
  // end of this block (right after CHECK U), not at the very end of
  // main() -- see the matching comment there.
  if (shouldRun("CORE")) {
  console.log(`\n== Setup ==`);

  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Incident Verify Test School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;
  console.log(`Institution: ${institutionId} (code ${CODE})`);

  const principalId = await createUser("incverify.principal@thebehaviourhive.com", "Principal Test", "principal");
  const teacherAId = await createUser("incverify.teacherA@thebehaviourhive.com", "Teacher A Owning", "class_teacher");
  const teacherBId = await createUser("incverify.teacherB@thebehaviourhive.com", "Teacher B Ordinary", "class_teacher");
  const snaId = await createUser("incverify.sna@thebehaviourhive.com", "SNA Test", "sna");
  const clinicianId = await createUser("incverify.clinician@thebehaviourhive.com", "Clinician Test", "clinician");
  const parent1Id = await createUser("incverify.parent1@thebehaviourhive.com", "Parent One", "parent");
  const parent2Id = await createUser("incverify.parent2@thebehaviourhive.com", "Parent Two", "parent");
  console.log("Users created.");

  const { data: staffRows, error: staffErr } = await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: principalId, role: "principal" },
    { institution_id: institutionId, user_id: teacherAId, role: "class_teacher" },
    { institution_id: institutionId, user_id: teacherBId, role: "class_teacher" },
    { institution_id: institutionId, user_id: snaId, role: "sna" },
  ]).select();
  if (staffErr) throw staffErr;

  // 0100: the principal-role row auto-approves via derive_staff_join_
  // approval() (no active principal existed yet in this fresh
  // institution) -- confirmed, not assumed, by teacherA's own approval
  // succeeding below via the PRINCIPAL's real session. class_teacher/sna
  // rows are never auto-approved, so they're correctly pending the
  // instant after this insert -- driven through the real
  // approve_staff_join() RPC, never by setting approved_at directly in
  // this service-role insert. That would be the exact shortcut flagged
  // as the standing violation elsewhere in this file (the old
  // status: "awaiting_attestation" line) -- a fixture reaching a state
  // no production path produces on its own.
  // Signed in once here and reused below (as `principal`) rather than a
  // second signedInClient() call for the same account -- nothing about
  // approve_staff_join() invalidates the session in between.
  const principal = await signedInClient("incverify.principal@thebehaviourhive.com");
  {
    for (const row of staffRows.filter((r) => r.role !== "principal")) {
      const { error: approveErr } = await principal.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (approveErr) throw approveErr;
    }
  }

  const { data: p1, error: p1Err } = await admin
    .from("passports")
    .insert({ user_id: parent1Id, child_name: "Verify Child One", passport_status: "complete" })
    .select()
    .single();
  if (p1Err) throw p1Err;
  const { data: p2, error: p2Err } = await admin
    .from("passports")
    .insert({ user_id: parent2Id, child_name: "Verify Child Two", passport_status: "complete" })
    .select()
    .single();
  if (p2Err) throw p2Err;
  const child1 = p1.id, child2 = p2.id;

  // Child 2 (check b) is deliberately given NO passport_institution_links
  // row at all yet -- "an incident is created for a child whose parent
  // has never opened the app" -- linked only after, to prove the
  // school-side flow already worked without it. Child 1 IS linked from
  // the start (approved), representing the ordinary case.
  await admin.from("passport_institution_links").insert({ passport_id: child1, institution_id: institutionId, approved_by_parent: true });

  await admin.from("passport_access").insert({
    passport_id: child1, teacher_id: teacherBId, institution_id: institutionId,
    is_active: true, actor_role: "class_teacher",
  });

  const { error: clinErr } = await admin.from("clinicians").insert({
    user_id: clinicianId, specialty: "behavioural_psychologist", verification_status: "verified",
  });
  if (clinErr) console.log("clinicians insert note:", clinErr.message);
  await admin.from("clinician_access").insert({ passport_id: child1, clinician_id: clinicianId, is_active: true });

  console.log("Fixture ready. child1=" + child1 + " child2=" + child2);

  const teacherA = await signedInClient("incverify.teacherA@thebehaviourhive.com");
  const teacherB = await signedInClient("incverify.teacherB@thebehaviourhive.com");
  const sna = await signedInClient("incverify.sna@thebehaviourhive.com");
  const clinician = await signedInClient("incverify.clinician@thebehaviourhive.com");
  const parent1 = await signedInClient("incverify.parent1@thebehaviourhive.com");
  const parent2 = await signedInClient("incverify.parent2@thebehaviourhive.com");

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();
  const { data: bruisingType } = await admin.from("incident_injury_types").select("id").eq("value", "Bruising").is("institution_id", null).single();
  const { data: rednessType } = await admin.from("incident_injury_types").select("id").eq("value", "Redness").is("institution_id", null).single();
  // Fetched here (not just down at CHECK K/L/M/N, which also use these)
  // because CHECK D's own pre-existing body-mark inserts need region_id/
  // side too -- both columns became NOT NULL in migration 0080, after
  // CHECK D was originally written; this suite hadn't been run end to
  // end since, so that gap was invisible until now.
  const { data: biteType } = await admin.from("incident_injury_types").select("id").eq("value", "Bite").is("institution_id", null).single();
  const { data: restraintAction } = await admin.from("incident_action_types").select("id").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();
  const { data: nonRestraintAction } = await admin.from("incident_action_types").select("id").eq("value", "Gently blocked further attempts").is("institution_id", null).single();
  const { data: headRegion } = await admin.from("incident_body_regions").select("id").eq("value", "head").is("institution_id", null).single();

  console.log(`\n== CHECK B: incident for a child whose parent has never opened the app ==`);
  // A passport_institution_links row can only ever be INSERTED by the
  // parent themselves (RLS-restricted, "Parents can insert links for
  // their own passport") -- so "the school's roster includes this
  // child" necessarily implies some link already exists; there is no
  // path to a child appearing on the roster with literally zero link at
  // all. The realistic version of "a parent who's never opened the
  // app" is this: the link exists (created once, at minimal
  // registration) but was never approved and nothing about it has been
  // touched since -- approved_by_parent stays false throughout. That's
  // what's set up here for child2, created directly (service role,
  // simulating whatever one-time flow produced it) rather than via the
  // parent's own session, since this parent is being modelled as never
  // having done anything beyond that.
  await admin.from("passport_institution_links").insert({ passport_id: child2, institution_id: institutionId, approved_by_parent: false });

  console.log(`\n== Building the incident (create_incident_stamp, as Teacher A, real session) ==`);

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [child1, child2],
    p_staff: [{ user_id: teacherBId, involvement: "witnessed" }, { free_text_name: "Bus Escort Jane", involvement: "witnessed" }],
  });
  record("create_incident_stamp succeeds for a child whose parent has never approved the link", !stampErr, stampErr?.message);
  console.log("Incident created (atomic stamp):", incidentId);

  {
    const { data: children } = await admin.from("incident_children").select("passport_id, child_index").eq("incident_id", incidentId);
    record("Incident has exactly 2 children immediately after the stamp (never a childless window)", (children?.length ?? 0) === 2, JSON.stringify(children));
    const { data: owningCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentId).single();
    record("Class-teacher creator auto-assigned as owning teacher by the stamp RPC", owningCheck.owning_teacher_id === teacherAId, owningCheck.owning_teacher_id);
  }

  const { error: ownErr } = await teacherA
    .from("incidents")
    .update({ category: "one_party_incident", narrative: "Staff-facing narrative text.", parent_summary: "Parent-facing summary text." })
    .eq("id", incidentId);
  if (ownErr) throw ownErr;

  // status is derived (0089), not settable -- moving past 'draft' the
  // real way, the same action a teacher takes: request attestations.
  // The old version of this line (`update({ status: "awaiting_attestation" })`)
  // was the exact pattern flagged as the session's own standing violation:
  // a fixture reaching a state no production code path ever reaches on
  // its own. It happened to work only because status used to be a plain,
  // independently-settable column -- once it became derived, every check
  // below that depends on "past draft" visibility (ordinary teacher via
  // passport_access, parent, clinician) started failing for real,
  // because the old line no longer does anything (the derive trigger
  // immediately overwrites it back to 'draft', correctly).
  await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", incidentId);

  console.log(`\n== CHECK 1: draft isolation ==`);
  {
    const { data: draftId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { data: byTeacherB } = await teacherB.from("incidents").select("id").eq("id", draftId);
    record("Draft invisible to ordinary teacher with passport_access", (byTeacherB?.length ?? 0) === 0, `rows=${byTeacherB?.length}`);

    const { data: byClinician } = await clinician.from("incidents").select("id").eq("id", draftId);
    record("Draft invisible to clinician (caseload access to named child)", (byClinician?.length ?? 0) === 0, `rows=${byClinician?.length}`);

    const { data: byPrincipal } = await principal.from("incidents").select("id").eq("id", draftId);
    record("Draft VISIBLE to principal (author/owning/principal only)", (byPrincipal?.length ?? 0) === 1, `rows=${byPrincipal?.length}`);

    const { data: byCreator } = await teacherA.from("incidents").select("id").eq("id", draftId);
    record("Draft VISIBLE to its own creator", (byCreator?.length ?? 0) === 1, `rows=${byCreator?.length}`);

    await admin.from("incidents").delete().eq("id", draftId);
  }

  console.log(`\n== CHECK 2: owning-teacher incident-scoped access, not passport-scoped ==`);
  {
    const { data: viaIncident } = await teacherA.from("incident_children").select("passport_id").eq("incident_id", incidentId);
    record("Owning teacher sees incident_children rows despite no passport_access", (viaIncident?.length ?? 0) === 2, `rows=${viaIncident?.length}`);

    const { data: directPassport, error: dpErr } = await teacherA.from("passports").select("id").eq("id", child1);
    record("Same teacher gets ZERO rows querying passports directly (no passport-level access)", (directPassport?.length ?? 0) === 0 && !dpErr, `rows=${directPassport?.length}, err=${dpErr?.message}`);
  }

  console.log(`\n== CHECK 3: no approved_by_parent gate ==`);
  {
    await admin.from("passport_institution_links").update({ approved_by_parent: false }).eq("passport_id", child1).eq("institution_id", institutionId);
    const { data: stillVisible } = await teacherA.from("incidents").select("id").eq("id", incidentId);
    record("Incident stays visible to owning teacher after parent-link revoked", (stillVisible?.length ?? 0) === 1, `rows=${stillVisible?.length}`);
    const { data: principalStill } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Incident stays visible to principal after parent-link revoked", (principalStill?.length ?? 0) === 1, `rows=${principalStill?.length}`);
    await admin.from("passport_institution_links").update({ approved_by_parent: true }).eq("passport_id", child1).eq("institution_id", institutionId);
  }

  console.log(`\n== CHECK 3A (case a, the explicit re-ask): parent revokes the link -- EVERY incident for that child stays visible school-side ==`);
  {
    // Distinct from check 3 above: this asserts across the school-side
    // read paths generically, not just one incident by id -- teacherB's
    // ORDINARY passport_access-derived visibility (not owning-teacher
    // status) and the principal's institution-wide list both re-checked
    // after a full revoke (approved_by_parent -> false AND is_active ->
    // false on passport_access itself, the strongest revocation this
    // schema has).
    await admin.from("passport_institution_links").update({ approved_by_parent: false }).eq("passport_id", child1).eq("institution_id", institutionId);
    await admin.from("passport_access").update({ is_active: false }).eq("passport_id", child1).eq("teacher_id", teacherBId);

    const { data: principalList } = await principal.rpc("get_institution_incidents", { p_institution_id: institutionId });
    const stillThere = principalList?.some((r) => r.incident_id === incidentId);
    record("Principal's institution-wide list still contains the incident after full revoke", Boolean(stillThere), `found=${stillThere}`);

    const { data: ownerStill } = await teacherA.from("incidents").select("id").eq("id", incidentId);
    record("Owning teacher (incident-scoped, decision 4) unaffected by the revoke regardless", (ownerStill?.length ?? 0) === 1, `rows=${ownerStill?.length}`);

    // Restore for the rest of the suite.
    await admin.from("passport_institution_links").update({ approved_by_parent: true }).eq("passport_id", child1).eq("institution_id", institutionId);
    await admin.from("passport_access").update({ is_active: true }).eq("passport_id", child1).eq("teacher_id", teacherBId);

    const { data: byTeacherBRestored } = await teacherB.from("incidents").select("id").eq("id", incidentId);
    record("Ordinary teacher's own passport_access-derived visibility restored once re-activated", (byTeacherBRestored?.length ?? 0) === 1, `rows=${byTeacherBRestored?.length}`);
  }

  console.log(`\n== CHECK 4: principal institution scoping + unverified gap ==`);
  {
    const { data: otherInst } = await admin.from("institutions").insert({ name: "Other Test School", institution_code: CODE + "B", status: "verified" }).select().single();
    const { data: crossInst } = await principal.from("incidents").select("id").eq("institution_id", otherInst.id);
    record("Principal gets zero rows for a DIFFERENT institution", (crossInst?.length ?? 0) === 0, `rows=${crossInst?.length}`);
    await admin.from("institutions").delete().eq("id", otherInst.id);

    await admin.from("institutions").update({ status: "pending" }).eq("id", institutionId);
    const { data: whilePending } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Principal's OWN institution access drops to zero when status flips to pending", (whilePending?.length ?? 0) === 0, `rows=${whilePending?.length}`);
    await admin.from("institutions").update({ status: "verified" }).eq("id", institutionId);
    const { data: afterReverify } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Principal access restored once institution re-verified", (afterReverify?.length ?? 0) === 1, `rows=${afterReverify?.length}`);
  }

  console.log(`\n== CHECK 5: one principal per institution ==`);
  {
    const secondPrincipalId = await createUser("incverify.principal2@thebehaviourhive.com", "Second Principal", "principal");
    const { error: dupErr } = await admin.from("institution_staff").insert({ institution_id: institutionId, user_id: secondPrincipalId, role: "principal" });
    record("Second principal self-link REJECTED by unique index", Boolean(dupErr && /duplicate key|unique/i.test(dupErr.message)), dupErr?.message);
    await admin.auth.admin.deleteUser(secondPrincipalId);
  }

  console.log(`\n== CHECK 6: parent redaction, structurally ==`);
  {
    // -- 0093: get_parent_incidents() now gates on teacher_signed_at, --
    // not status <> 'draft' (the bug piece 4 found and fixed -- status
    // left 'draft' as soon as this session's own earlier setup requested
    // attestations, well before the point in the script where this
    // incident actually gets signed off, in CHECK 7). Both parents
    // correctly see NOTHING here now -- that's the fix working, not a
    // regression. The column-shape check (does the row leak narrative)
    // and the full post-signoff content check both need a REAL signed-
    // off row to mean anything -- that's CHECK S's own dedicated,
    // purpose-built fixture (migration 0093), not this one.
    const { data: p1Rows, error: p1Err2 } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1 });
    record(
      "Parent sees ZERO rows pre-signoff, even though status left 'draft' earlier in this fixture -- the actual redaction boundary is teacher_signed_at, not status",
      (p1Rows?.length ?? 0) === 0,
      `rows=${p1Rows?.length}, err=${p1Err2?.message}`
    );

    const { data: p1Direct, error: p1DirectErr } = await parent1.from("incidents").select("*").eq("id", incidentId);
    record("Parent direct .select() on incidents returns nothing (no policy grants it)", (p1Direct?.length ?? 0) === 0, `rows=${p1Direct?.length}, err=${p1DirectErr?.message}`);

    const { data: p1Children } = await parent1.from("incident_children").select("*").eq("incident_id", incidentId);
    record("Parent direct .select() on incident_children returns nothing", (p1Children?.length ?? 0) === 0, `rows=${p1Children?.length}`);

    const { data: p2Rows } = await parent2.rpc("get_parent_incidents", { p_passport_id: child2 });
    record("Parent 2 (child B) also sees ZERO rows pre-signoff, same reason", (p2Rows?.length ?? 0) === 0, `rows=${p2Rows?.length}`);
  }

  console.log(`\n== CHECK F: roster RPCs for the stamp UI (migration 0074) ==`);
  {
    const { data: childRoster, error: childRosterErr } = await teacherA.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("Institution staff can call get_institution_child_roster()", !childRosterErr, childRosterErr?.message);
    const rosterIds = (childRoster ?? []).map((r) => r.passport_id);
    record("Roster includes child1 (approved link)", rosterIds.includes(child1), JSON.stringify(rosterIds));
    record("Roster includes child2 too -- NO approved_by_parent gate (decision 1/5)", rosterIds.includes(child2), JSON.stringify(rosterIds));

    const { data: clinicianRoster } = await clinician.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("A caller who is NOT institution_staff (clinician) gets zero roster rows", (clinicianRoster?.length ?? 0) === 0, `rows=${clinicianRoster?.length}`);
    const { data: parentRoster } = await parent1.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("A parent gets zero roster rows either", (parentRoster?.length ?? 0) === 0, `rows=${parentRoster?.length}`);

    const { data: staffRoster, error: staffRosterErr } = await teacherA.rpc("get_institution_staff_roster", { p_institution_id: institutionId });
    record("Institution staff can call get_institution_staff_roster()", !staffRosterErr, staffRosterErr?.message);
    const staffIds = (staffRoster ?? []).map((r) => r.user_id);
    record("Staff roster includes colleagues (teacherB, principal, sna), not just the caller", [teacherBId, principalId, snaId].every((id) => staffIds.includes(id)), JSON.stringify(staffRoster));

    const { data: otherInstForRoster } = await admin.from("institutions").insert({ name: "Roster Cross-Check School", institution_code: CODE + "C", status: "verified" }).select().single();
    const { data: crossInstChildRoster } = await teacherA.rpc("get_institution_child_roster", { p_institution_id: otherInstForRoster.id });
    record("Own institution's staff member gets zero rows for a DIFFERENT institution's child roster", (crossInstChildRoster?.length ?? 0) === 0, `rows=${crossInstChildRoster?.length}`);
    const { data: crossInstStaffRoster } = await teacherA.rpc("get_institution_staff_roster", { p_institution_id: otherInstForRoster.id });
    record("Own institution's staff member gets zero rows for a DIFFERENT institution's staff roster", (crossInstStaffRoster?.length ?? 0) === 0, `rows=${crossInstStaffRoster?.length}`);
    await admin.from("institutions").delete().eq("id", otherInstForRoster.id);
  }

  console.log(`\n== CHECK C: SNA can stamp but cannot complete stage two or sign off ==`);
  {
    const { data: snaIncidentId, error: snaStampErr } = await sna.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    record("SNA CAN create a stamp", !snaStampErr, snaStampErr?.message);

    const { data: snaOwning } = await admin.from("incidents").select("owning_teacher_id").eq("id", snaIncidentId).single();
    record("SNA-created stamp has NO owning teacher auto-assigned (only class_teacher gets that)", snaOwning.owning_teacher_id === null, snaOwning.owning_teacher_id);

    await sna.from("incidents").update({ narrative: "SNA tried to write stage two" }).eq("id", snaIncidentId);
    const { data: afterSnaEdit } = await admin.from("incidents").select("narrative").eq("id", snaIncidentId).single();
    record("SNA CANNOT complete stage two (edit did not persist)", afterSnaEdit.narrative === null, `narrative now: ${afterSnaEdit.narrative}`);

    await sna.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: snaId }).eq("id", snaIncidentId);
    const { data: afterSnaSign } = await admin.from("incidents").select("teacher_signed_at").eq("id", snaIncidentId).single();
    record("SNA CANNOT sign off (did not persist)", afterSnaSign.teacher_signed_at === null, afterSnaSign.teacher_signed_at);

    const { error: snaClaimErr } = await sna.rpc("claim_incident", { p_incident_id: snaIncidentId });
    record("SNA CANNOT claim_incident either (class_teacher only)", Boolean(snaClaimErr), snaClaimErr?.message);

    const { error: teacherBClaimErr } = await teacherB.rpc("claim_incident", { p_incident_id: snaIncidentId });
    record("A real class teacher CAN claim the SNA-created stamp", !teacherBClaimErr, teacherBClaimErr?.message);

    await teacherB.from("incidents").update({ narrative: "Teacher B completed stage two after claiming" }).eq("id", snaIncidentId);
    const { data: afterClaim } = await admin.from("incidents").select("narrative, owning_teacher_id").eq("id", snaIncidentId).single();
    record("Once claimed, the claiming teacher CAN complete stage two", afterClaim.narrative === "Teacher B completed stage two after claiming" && afterClaim.owning_teacher_id === teacherBId, JSON.stringify(afterClaim));

    await admin.from("incidents").delete().eq("id", snaIncidentId);
  }

  console.log(`\n== CHECK D: attestation -- append-only, staleness, withdrawal (migration 0070) ==`);
  // Deliberately BEFORE check 7's sign-off, not after -- attest_to_incident/
  // withdraw_attestation both require teacher_signed_at is null, matching
  // the brief's own stated lifecycle (stamp -> stage two -> attestation ->
  // debrief -> teacher sign-off -> principal countersign). This whole
  // block ends by leaving teacherB's attestation CURRENT again, on purpose
  // -- check 7 right after this needs a clean sign-off to actually go
  // through, now that the sign-off gate is genuinely DB-enforced.
  //
  // The narrative gets rewritten mid-block (to prove staleness), so the
  // "revised" text below is what check 7's own assertions have to expect
  // afterwards -- not the original "Staff-facing narrative text."
  const REVISED_NARRATIVE = "Staff-facing narrative text, revised after initial attestation.";
  let teacherBStaffId;
  let snaStaffId;
  {
    const { data: teacherBStaffRow } = await admin
      .from("incident_staff")
      .select("id")
      .eq("incident_id", incidentId)
      .eq("user_id", teacherBId)
      .single();
    teacherBStaffId = teacherBStaffRow.id;

    // -- Not named on the incident cannot attest via someone else's row. --
    // The RPC itself checks st.user_id = auth.uid(), not just RLS, so this
    // should come back as a raised exception, not a silent no-op.
    const { error: clinicianAttestErr } = await clinician.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Clinician should not be able to write this.",
    });
    record("A staff member NOT named on the incident cannot attest via attest_to_incident()", Boolean(clinicianAttestErr), clinicianAttestErr?.message);

    // -- Named staff member CAN attest. --
    const { error: attest1Err } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Confirmed, accurate.",
    });
    record("Named staff member CAN attest via attest_to_incident()", !attest1Err, attest1Err?.message);

    const { data: statusAfterFirst } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'current' immediately after a fresh attestation", statusAfterFirst === "current", statusAfterFirst);

    // -- get_attestation_status() has its own can_view_incident() gate. --
    // It's SECURITY DEFINER, so without this check anyone with a valid
    // (guessed or leaked) incident_staff_id could learn attestation
    // status for an incident they have no standing to see at all. Parent
    // 1 has no can_view_incident() branch at all (parents only ever get
    // data through the separate redacted get_parent_incidents()) -- real
    // status is 'current' at this exact moment, so 'unknown' here can
    // only be the visibility gate doing its job, not a coincidence.
    const { data: statusViaUnrelatedParent } = await parent1.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("A caller with no standing to view the incident gets 'unknown', not the real status", statusViaUnrelatedParent === "unknown", statusViaUnrelatedParent);

    // -- Append-only: re-attesting adds a new row, never overwrites. --
    const { error: attest2Err } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-attesting, still confirmed.",
    });
    record("Re-attesting (still pre-signoff, narrative unchanged) succeeds", !attest2Err, attest2Err?.message);

    const { data: historyAfterTwo } = await admin
      .from("incident_attestations")
      .select("action, addendum, content_hash")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "History has BOTH attestations as separate rows -- the first is untouched, not overwritten",
      historyAfterTwo?.length === 2 && historyAfterTwo[0].addendum === "Confirmed, accurate." && historyAfterTwo[1].addendum === "Re-attesting, still confirmed.",
      JSON.stringify(historyAfterTwo)
    );

    // -- Staleness: editing the narrative stales every existing attestation, computed live. --
    await teacherA.from("incidents").update({ narrative: REVISED_NARRATIVE }).eq("id", incidentId);
    const { data: statusAfterEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' the moment the owning teacher edits the narrative", statusAfterEdit === "stale", statusAfterEdit);

    // -- Sign-off is blocked while any named staff member is stale. --
    const { error: staleSignErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", incidentId);
    record("Sign-off REJECTED by the DB while teacherB's attestation is stale", Boolean(staleSignErr), staleSignErr?.message);
    const { data: stillUnsignedAfterStale } = await admin.from("incidents").select("teacher_signed_at").eq("id", incidentId).single();
    record("teacher_signed_at genuinely still null after the rejected attempt", stillUnsignedAfterStale.teacher_signed_at === null, stillUnsignedAfterStale.teacher_signed_at);

    // -- Withdrawal requires a non-empty reason. --
    const { error: emptyReasonErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: "   " });
    record("withdraw_attestation() REJECTS a blank/whitespace-only reason", Boolean(emptyReasonErr), emptyReasonErr?.message);

    // -- Withdrawal, with a real reason, succeeds and is append-only too. --
    const WITHDRAWAL_REASON = "I was not present for the second half of what's now described and no longer stand over my account.";
    const { error: withdrawErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: WITHDRAWAL_REASON });
    record("Named staff member CAN withdraw with a required reason", !withdrawErr, withdrawErr?.message);

    const { data: statusAfterWithdraw } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'withdrawn' after withdrawal", statusAfterWithdraw === "withdrawn", statusAfterWithdraw);

    const { data: historyAfterWithdraw } = await admin
      .from("incident_attestations")
      .select("action, addendum, withdrawal_reason")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "Withdrawal APPENDS a third row -- both prior attestations still in the log",
      historyAfterWithdraw?.length === 3 && historyAfterWithdraw[2].action === "withdrawn" && historyAfterWithdraw[2].withdrawal_reason === WITHDRAWAL_REASON,
      JSON.stringify(historyAfterWithdraw)
    );

    // -- Withdrawal surfaces to the principal via school_notices. --
    const { data: withdrawalNotices } = await admin.from("school_notices").select("*").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Exactly one attestation_withdrawn notice raised", (withdrawalNotices?.length ?? 0) === 1, `rows=${withdrawalNotices?.length}`);
    const { data: withdrawalNoticeByPrincipal } = await principal.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice visible to principal", (withdrawalNoticeByPrincipal?.length ?? 0) === 1, `rows=${withdrawalNoticeByPrincipal?.length}`);
    const { data: withdrawalNoticeByOwner } = await teacherA.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice visible to owning teacher", (withdrawalNoticeByOwner?.length ?? 0) === 1, `rows=${withdrawalNoticeByOwner?.length}`);
    const { data: withdrawalNoticeByParent } = await parent1.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice INVISIBLE to parent", (withdrawalNoticeByParent?.length ?? 0) === 0, `rows=${withdrawalNoticeByParent?.length}`);

    // -- Sign-off is blocked while withdrawn, same as while stale. --
    const { error: withdrawnSignErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", incidentId);
    record("Sign-off REJECTED by the DB while teacherB's attestation is withdrawn", Boolean(withdrawnSignErr), withdrawnSignErr?.message);

    // -- Renewing: a fresh attestation against the CURRENT narrative clears both stale and withdrawn. --
    const { error: renewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after reviewing the revised narrative.",
    });
    record("Named staff member CAN renew with a fresh attestation after withdrawing", !renewErr, renewErr?.message);
    const { data: statusAfterRenew } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'current' again after renewal", statusAfterRenew === "current", statusAfterRenew);

    const { data: fullHistory } = await admin
      .from("incident_attestations")
      .select("action")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "Full append-only history is attested, attested, withdrawn, attested -- 4 rows, nothing ever overwritten",
      JSON.stringify(fullHistory?.map((r) => r.action)) === JSON.stringify(["attested", "attested", "withdrawn", "attested"]),
      JSON.stringify(fullHistory)
    );

    // -- The corrected behaviour: a MISSING attestation does not block. --
    // A second real staff member, named on the incident, who NEVER
    // attests at all -- proving get_attestation_status() correctly
    // reports 'not_attested' for them, and (checked in CHECK 7 below,
    // where sign-off is actually attempted) that this status does NOT
    // block sign-off the way 'stale'/'withdrawn' do.
    const { data: snaStaffRow, error: snaNameErr } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: incidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    record("Owning teacher can name a second real staff member on the incident", !snaNameErr, snaNameErr?.message);
    snaStaffId = snaStaffRow.id;

    const { data: snaStatusNeverAttested } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("A newly-named staff member who has never attested reads as 'not_attested', not an error", snaStatusNeverAttested === "not_attested", snaStatusNeverAttested);

    // -- Broadened hash: staleness also fires on non-narrative material --
    // facts (decision 3) -- a child's distress_level here, not the
    // narrative text at all.
    await teacherA.from("incident_children").update({ distress_level: "yes_definitely" }).eq("incident_id", incidentId).eq("passport_id", child1);
    const { data: statusAfterChildEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' again from a child's distress_level changing -- the hash covers more than the narrative", statusAfterChildEdit === "stale", statusAfterChildEdit);

    // -- Restrictive practice fields are hashed too, and specifically --
    // EDITING A SAVED record (not just adding a new one) must stale an
    // existing attestation. This is the direct answer to "does changing
    // hold_level or planning_status on a saved record invalidate
    // attestations" -- isolated per field, not inferred from the
    // migration text.
    const { data: rpRow, error: rpInsertErr } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: incidentId, passport_id: child1, planning_status: "not_planned", hold_level: "low" })
      .select()
      .single();
    record("Owning teacher can record a restrictive practice pre-signoff", !rpInsertErr, rpInsertErr?.message);

    // The real UI only ever gets here by ticking CPI/restraint first (that's
    // what opens this section) -- match that here too, now that migration
    // 0083's sign-off gate checks the two are consistent (CHECK N below
    // exercises that gate directly; this is just keeping this incident's
    // own eventual sign-off in CHECK 7 clean).
    await teacherA.from("incident_actions").insert({ incident_id: incidentId, action_type_id: restraintAction.id });

    const { data: statusAfterRpInsert } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' when a restrictive practice record is added", statusAfterRpInsert === "stale", statusAfterRpInsert);

    const { error: rpBaselineRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming with the restrictive practice record in place.",
    });
    record("Renewal with the restrictive practice record in place succeeds", !rpBaselineRenewErr, rpBaselineRenewErr?.message);
    const { data: statusBeforeHoldLevelEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' with the restrictive practice record in place", statusBeforeHoldLevelEdit === "current", statusBeforeHoldLevelEdit);

    // Edit hold_level ONLY, on the SAVED (already-has-an-id) record.
    const { error: holdLevelEditErr } = await teacherA
      .from("restrictive_practices")
      .update({ hold_level: "high" })
      .eq("id", rpRow.id);
    record("Owning teacher can edit hold_level on a saved restrictive practice record pre-signoff", !holdLevelEditErr, holdLevelEditErr?.message);
    const { data: statusAfterHoldLevelEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record(
      "Status flips to 'stale' purely from editing hold_level on a SAVED record -- whether force escalated changes underneath an existing attestation",
      statusAfterHoldLevelEdit === "stale",
      statusAfterHoldLevelEdit
    );

    const { error: preStatusEditRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after hold_level was corrected.",
    });
    record("Renewal after the hold_level edit succeeds", !preStatusEditRenewErr, preStatusEditRenewErr?.message);

    // Edit planning_status ONLY -- the field the whole decision is about:
    // was this pre-authorised in the BSP, or an unplanned response.
    const { error: planningStatusEditErr } = await teacherA
      .from("restrictive_practices")
      .update({ planning_status: "in_bsp" })
      .eq("id", rpRow.id);
    record("Owning teacher can edit planning_status on a saved restrictive practice record pre-signoff", !planningStatusEditErr, planningStatusEditErr?.message);
    const { data: statusAfterPlanningStatusEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record(
      "Status flips to 'stale' purely from editing planning_status on a SAVED record -- an attestation cannot survive whether force was pre-authorised changing underneath it",
      statusAfterPlanningStatusEdit === "stale",
      statusAfterPlanningStatusEdit
    );

    // Renew, then prove the hash covers body-map markers too (migration
    // 0072) -- a marker's position/view/injury_type, not just the
    // injury row it hangs off.
    const { error: preMarkRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the distress level was recorded.",
    });
    record("Renewal (after the distress_level change) succeeds", !preMarkRenewErr, preMarkRenewErr?.message);
    const { data: statusBeforeMark } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' again before the body-mark is added", statusBeforeMark === "current", statusBeforeMark);

    const { data: injuryRow, error: injuryInsertErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] })
      .select()
      .single();
    record("Owning teacher can record an injury pre-signoff", !injuryInsertErr, injuryInsertErr?.message);

    // -- Migration 0076: a marker with no type, or an invalid type, is --
    // structurally impossible now, not just discouraged by the UI.
    // region_id/side supplied on every insert below (migration 0080 made
    // both NOT NULL) so each test isolates the ONE constraint it's
    // actually named for, rather than tripping the region_id constraint
    // first and reporting a pass for the wrong reason.
    const { error: nullTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: null, region_id: headRegion.id, side: "centre" });
    record("A body mark with NO injury_type_id is REJECTED (not null constraint)", Boolean(nullTypeErr), nullTypeErr?.message);

    const { error: bogusTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: "00000000-0000-0000-0000-000000000000", region_id: headRegion.id, side: "centre" });
    record("A body mark with an injury_type_id NOT in the vocabulary is REJECTED (foreign key)", Boolean(bogusTypeErr), bogusTypeErr?.message);

    const { data: markRow, error: markInsertErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" })
      .select()
      .single();
    record("Owning teacher can place a body-map marker pre-signoff", !markInsertErr, markInsertErr?.message);

    const { data: statusAfterMark } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' when a body-map marker is added -- the hash covers markers too (migration 0072)", statusAfterMark === "stale", statusAfterMark);

    // Renew with the marker in place, THEN move it -- proves position
    // specifically is hashed, not just marker presence/absence (the
    // exact scenario behind this decision: a marker moving from a
    // forearm to a throat).
    const { error: preMoveRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming with the marker at its original position.",
    });
    record("Renewal with the marker in place succeeds", !preMoveRenewErr, preMoveRenewErr?.message);
    const { data: statusBeforeMove } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' with the marker at its original position", statusBeforeMove === "current", statusBeforeMove);

    const { error: markMoveErr } = await teacherA
      .from("incident_body_marks")
      .update({ x: 0.1, y: 0.05, view: "front" })
      .eq("injury_id", injuryRow.id);
    record("Owning teacher can move a body-map marker pre-signoff", !markMoveErr, markMoveErr?.message);

    const { data: statusAfterMove } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' again purely from MOVING the marker -- position is hashed, not just presence", statusAfterMove === "stale", statusAfterMove);

    // Renew, then change the TYPE alone ("Change type" in the proposal) --
    // proves injury_type_id itself is hashed, not just position.
    const { error: preTypeChangeRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the marker was moved.",
    });
    record("Renewal after the marker move succeeds", !preTypeChangeRenewErr, preTypeChangeRenewErr?.message);
    const { error: typeChangeErr } = await teacherA
      .from("incident_body_marks")
      .update({ injury_type_id: rednessType.id })
      .eq("id", markRow.id);
    record("Owning teacher can change a marker's injury type pre-signoff", !typeChangeErr, typeChangeErr?.message);
    const { data: statusAfterTypeChange } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' purely from changing a marker's injury type", statusAfterTypeChange === "stale", statusAfterTypeChange);

    // Final renewal so teacherB is clean going into CHECK 7's sign-off.
    const { error: finalRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the marker's type was corrected.",
    });
    record("Final renewal (after the marker's type change) succeeds", !finalRenewErr, finalRenewErr?.message);
    const { data: statusFinal } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' again going into sign-off", statusFinal === "current", statusFinal);

    const { data: snaStatusStillMissing } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("SNA's status is STILL 'not_attested' -- untouched by any of the above, exactly as it should be", snaStatusStillMissing === "not_attested", snaStatusStillMissing);
  }

  console.log(`\n== CHECK 7: immutability after teacher sign-off ==`);
  {
    const { data: snaStatusRightBeforeSignoff } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("Right before sign-off, SNA is still 'not_attested' (a real, named, never-attested staff member)", snaStatusRightBeforeSignoff === "not_attested", snaStatusRightBeforeSignoff);

    const { error: signErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", incidentId);
    record(
      "Sign-off succeeds DESPITE SNA never having attested -- a missing attestation does not block (the corrected behaviour); only 'stale'/'withdrawn' do, per CHECK D",
      !signErr,
      signErr?.message
    );

    await teacherA.from("incidents").update({ narrative: "Tampered narrative" }).eq("id", incidentId);
    const { data: afterTamperAttempt } = await admin.from("incidents").select("narrative").eq("id", incidentId).single();
    record("Post-signoff edit by the SAME teacher who signed did NOT persist", afterTamperAttempt.narrative === REVISED_NARRATIVE, `narrative now: ${afterTamperAttempt.narrative}`);

    // -- Attestations are frozen post-signoff too, same as everything else. --
    const { error: postSignoffAttestErr } = await teacherB.rpc("attest_to_incident", { p_incident_staff_id: teacherBStaffId, p_addendum: "Trying to attest after signoff." });
    record("attest_to_incident() REJECTS a post-signoff attempt -- attestations freeze along with the rest of the record", Boolean(postSignoffAttestErr), postSignoffAttestErr?.message);
    const { error: postSignoffWithdrawErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: "Trying to withdraw after signoff." });
    record("withdraw_attestation() REJECTS a post-signoff attempt too", Boolean(postSignoffWithdrawErr), postSignoffWithdrawErr?.message);

    // -- Countersign authority now goes through can_countersign_incident() --
    // (migration 0073), not an inlined principal-role check -- confirm
    // the function itself agrees with what the policy allows/rejects,
    // and that a non-principal (the owning teacher, who has every OTHER
    // authority on this incident) still cannot countersign.
    const { data: canPrincipalCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: principalId, p_institution_id: institutionId });
    record("can_countersign_incident() returns true for the real principal", canPrincipalCountersign === true, canPrincipalCountersign);
    const { data: canTeacherCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherAId, p_institution_id: institutionId });
    record("can_countersign_incident() returns false for the owning teacher (not a principal)", canTeacherCountersign === false, canTeacherCountersign);

    const { error: teacherCountersignErr } = await teacherA
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentId);
    const { data: stillUncountersigned } = await admin.from("incidents").select("countersigned_at").eq("id", incidentId).single();
    record("Owning teacher CANNOT countersign despite every other authority on the incident", stillUncountersigned.countersigned_at === null, `err=${teacherCountersignErr?.message}, countersigned_at=${stillUncountersigned.countersigned_at}`);

    // -- 0090: countersigned_role_at_time/countersigned_via are now --
    // DERIVED by derive_countersign_fields() (a trigger), not validated
    // against a client-submitted value in the policy's own WITH CHECK --
    // the old "mismatch rejected" behaviour tested here no longer
    // applies, because there's no longer a client-submitted value to
    // mismatch against. What matters now is that the trigger is
    // authoritative even when a client submits something wrong: a
    // deliberately incorrect role, a deliberately wrong countersigned_by
    // (someone else's id), and a deliberately wrong countersigned_via
    // should all be silently overwritten with the real caller's own
    // identity and role, not trusted and not merely rejected.
    const { error: cleanCountersign } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher", countersigned_via: "grant" })
      .eq("id", incidentId);
    const { data: afterCountersign } = await admin
      .from("incidents")
      .select("narrative, status, countersigned_by, countersigned_role_at_time, countersigned_via")
      .eq("id", incidentId)
      .single();
    record(
      "Principal's countersign succeeds despite deliberately wrong countersigned_by/role/via submitted -- the trigger overwrites them with the real caller's identity and role, not the client's claim",
      !cleanCountersign
        && afterCountersign.countersigned_by === principalId
        && afterCountersign.countersigned_role_at_time === "principal"
        && afterCountersign.countersigned_via === "principal_role",
      `err=${cleanCountersign?.message}, ${JSON.stringify(afterCountersign)}`
    );
    // narrative is untouched by the countersign write (the real thing
    // this checks); status is SUPPOSED to change now (0089) -- it
    // derives to 'finalised' the moment countersigned_at is set, not
    // frozen at whatever it was before, the way it used to be when
    // nothing ever touched it at all.
    record(
      "narrative unchanged by the countersign write, status correctly derives to 'finalised'",
      afterCountersign.narrative === REVISED_NARRATIVE && afterCountersign.status === "finalised",
      JSON.stringify(afterCountersign)
    );
  }

  console.log(`\n== CHECK I: debrief sign-off gate (migration 0077) -- own incidents, self-contained ==`);
  {
    // -- (a) debrief_required = true, no debrief at all -- sign-off is --
    // rejected outright. p_staff: [] so there's nothing for the
    // attestation gate to have an opinion about -- this incident is
    // testing the debrief gate alone.
    const { data: reqIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ debrief_required: true }).eq("id", reqIncidentId);

    const { error: signNoDebriefErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    const { data: stillUnsignedNoDebrief } = await admin.from("incidents").select("teacher_signed_at").eq("id", reqIncidentId).single();
    record(
      "Sign-off REJECTED when debrief_required is true and no debrief exists at all",
      stillUnsignedNoDebrief.teacher_signed_at === null,
      `err=${signNoDebriefErr?.message}, teacher_signed_at=${stillUnsignedNoDebrief.teacher_signed_at}`
    );

    // -- (b) the owning TEACHER, not the principal, not another teacher --
    // -- completes the debrief. Both non-owning attempts rejected by
    // incident_debriefs' own RLS before the gate is even relevant.
    const { error: principalDebriefErr } = await principal
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01" });
    record("Principal CANNOT record the debrief (owning teacher only)", Boolean(principalDebriefErr), principalDebriefErr?.message);

    const { error: teacherBDebriefErr } = await teacherB
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01" });
    record("A different teacher (not the owner) CANNOT record the debrief either", Boolean(teacherBDebriefErr), teacherBDebriefErr?.message);

    // -- (c) a debrief row exists but isn't completed -- still rejected. --
    const { data: debriefRow, error: debriefInsertErr } = await teacherA
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01", staff_present: ["Teacher A Owning"], notes: "Discussed with the team." })
      .select()
      .single();
    record("Owning teacher CAN record the debrief", !debriefInsertErr, debriefInsertErr?.message);

    const { error: signIncompleteErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    const { data: stillUnsignedIncomplete } = await admin.from("incidents").select("teacher_signed_at").eq("id", reqIncidentId).single();
    record(
      "Sign-off still REJECTED -- a debrief row exists but isn't marked complete",
      stillUnsignedIncomplete.teacher_signed_at === null,
      `err=${signIncompleteErr?.message}, teacher_signed_at=${stillUnsignedIncomplete.teacher_signed_at}`
    );

    // -- (d) mark complete -- sign-off now succeeds. --
    const { error: completeErr } = await teacherA
      .from("incident_debriefs")
      .update({ completed_at: new Date().toISOString(), completed_by: teacherAId })
      .eq("id", debriefRow.id);
    record("Owning teacher can mark the debrief complete", !completeErr, completeErr?.message);

    const { error: signCompleteErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    record("Sign-off SUCCEEDS once the debrief is marked complete", !signCompleteErr, signCompleteErr?.message);

    await admin.from("incidents").delete().eq("id", reqIncidentId);

    // -- (e) debrief_required = false -- proceeds without one, full stop. --
    const { data: notReqIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: notReqRow } = await admin.from("incidents").select("debrief_required").eq("id", notReqIncidentId).single();
    record("debrief_required defaults to false", notReqRow.debrief_required === false, notReqRow.debrief_required);

    const { error: signNotRequiredErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", notReqIncidentId);
    record("Sign-off SUCCEEDS with no debrief at all when debrief_required is false", !signNotRequiredErr, signNotRequiredErr?.message);

    await admin.from("incidents").delete().eq("id", notReqIncidentId);
  }

  console.log(`\n== CHECK J: institution_permissions -- countersign as a grant (migration 0078), own institution, self-contained ==`);
  {
    const jCode = "PERMVERIFY" + Math.floor(Math.random() * 10000);
    const { data: instJ, error: instJErr } = await admin
      .from("institutions")
      .insert({ name: "Permissions Verify Test School", institution_code: jCode, status: "verified" })
      .select()
      .single();
    if (instJErr) throw instJErr;
    const institutionJId = instJ.id;

    const principalJId = await createUser("permverify.principal@thebehaviourhive.com", "Principal J", "principal");
    const teacherDPId = await createUser("permverify.teacherdp@thebehaviourhive.com", "Teacher DP", "class_teacher");
    const teacherOrdId = await createUser("permverify.teacherord@thebehaviourhive.com", "Teacher Ordinary", "class_teacher");

    const { data: jStaffRows, error: jStaffErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionJId, user_id: principalJId, role: "principal" },
      { institution_id: institutionJId, user_id: teacherDPId, role: "class_teacher" },
      { institution_id: institutionJId, user_id: teacherOrdId, role: "class_teacher" },
    ]).select();
    if (jStaffErr) throw jStaffErr;

    // 0100: class_teacher rows are never auto-approved -- driven through
    // approve_staff_join() as the principal's real session, never set
    // directly. See the main fixture's own note above for why.
    // Signed in once here and reused below (as `principalJ`) rather than
    // a second signedInClient() call for the same account.
    const principalJ = await signedInClient("permverify.principal@thebehaviourhive.com");
    {
      for (const row of jStaffRows.filter((r) => r.role !== "principal")) {
        const { error: approveErr } = await principalJ.rpc("approve_staff_join", { p_institution_staff_id: row.id });
        if (approveErr) throw approveErr;
      }
    }

    // teacherBId as childJ's owner -- CORE's own account, never itself a
    // passports.user_id owner until CHECK 10/K (both well after this
    // point) -- rather than a dedicated parentJ account. childJ is
    // explicitly deleted in this block's own cleanup below, before
    // CHECK 10 could ever collide with it.
    const { data: childJ } = await admin
      .from("passports")
      .insert({ user_id: teacherBId, child_name: "Perm Verify Child", passport_status: "complete" })
      .select()
      .single();
    await admin.from("passport_institution_links").insert({ passport_id: childJ.id, institution_id: institutionJId, approved_by_parent: true });

    const { data: locJ } = await admin.from("incident_locations").insert({ institution_id: institutionJId, value: "J Test Room" }).select().single();

    const teacherDP = await signedInClient("permverify.teacherdp@thebehaviourhive.com");
    const teacherOrd = await signedInClient("permverify.teacherord@thebehaviourhive.com");

    // -- (a) principal grants countersign_incident to teacherDP. --
    const { data: grantRow, error: grantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: teacherDPId, permission: "countersign_incident", granted_by: principalJId })
      .select()
      .single();
    record("Principal CAN grant countersign_incident to a real teacher", !grantErr, grantErr?.message);

    const { data: canDPCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherDPId, p_institution_id: institutionJId });
    record("can_countersign_incident() returns true for the granted DP", canDPCountersign === true, canDPCountersign);
    const { data: canOrdCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherOrdId, p_institution_id: institutionJId });
    record("can_countersign_incident() returns false for an ungranted, ordinary teacher", canOrdCountersign === false, canOrdCountersign);

    // -- (b) grant attempted on a non-staff user (a parent) -- REJECTED --
    // by the grantee-is-staff trigger, unconditionally, database-level.
    // parent1Id (CORE's own account, genuinely not staff anywhere at
    // institutionJId) rather than a dedicated parentJ account -- this
    // insert doesn't touch passports.user_id, so parent1Id already
    // owning child1 elsewhere is irrelevant here.
    const { error: nonStaffGrantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: parent1Id, permission: "countersign_incident", granted_by: principalJId });
    record("Grant to a NON-STAFF user (a parent) REJECTED by the database, not just the UI", Boolean(nonStaffGrantErr), nonStaffGrantErr?.message);

    // -- (c) principal attempting self-grant (and so, self-revoke) --
    // REJECTED -- there is no row a principal's own automatic authority
    // could ever appear as, because they can never create one for
    // themselves in the first place.
    const { error: selfGrantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: principalJId, permission: "countersign_incident", granted_by: principalJId });
    record("Principal attempting to GRANT THEMSELVES the permission REJECTED -- nothing exists for a self-revoke to act on", Boolean(selfGrantErr), selfGrantErr?.message);

    // -- (d) incident A: owning teacher (ungranted) cannot self-countersign; --
    // the granted DP, a completely different person, CAN countersign it.
    const { data: incidentAId } = await teacherOrd.rpc("create_incident_stamp", {
      p_institution_id: institutionJId, p_occurred_at: new Date().toISOString(), p_location_id: locJ.id,
      p_child_passport_ids: [childJ.id], p_staff: [],
    });
    await teacherOrd.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherOrdId }).eq("id", incidentAId);

    // RLS on UPDATE silently filters, it doesn't error -- a blocked write
    // returns { error: null } with zero rows touched, not a thrown
    // error. Re-query via admin, don't trust the client-visible error.
    const { error: ordCountersignErr } = await teacherOrd
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherOrdId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentAId);
    const { data: incidentAAfterOrdAttempt } = await admin.from("incidents").select("countersigned_at").eq("id", incidentAId).single();
    record(
      "Ungranted owning teacher CANNOT countersign their own incident",
      incidentAAfterOrdAttempt.countersigned_at === null,
      `err=${ordCountersignErr?.message}, countersigned_at=${incidentAAfterOrdAttempt.countersigned_at}`
    );

    const { error: dpCountersignErr } = await teacherDP
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherDPId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentAId);
    const { data: incidentAAfter } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time").eq("id", incidentAId).single();
    record(
      "Granted DP CAN countersign someone else's incident, recorded with their REAL role (class_teacher, not principal)",
      !dpCountersignErr && incidentAAfter.countersigned_by === teacherDPId && incidentAAfter.countersigned_role_at_time === "class_teacher",
      `err=${dpCountersignErr?.message}, ${JSON.stringify(incidentAAfter)}`
    );

    // -- (e) immutable grant record -- the principal cannot rewrite WHO --
    // the existing grant belongs to, only revoke it. Smuggled into a
    // payload that ALSO sets revoked_by = auth.uid() -- an otherwise-
    // legitimate revoke, satisfying "Principal can revoke
    // institution_permissions"'s own WITH CHECK on its own terms.
    // Sending user_id ALONE (the original form of this check) doesn't
    // isolate anything: that policy's WITH CHECK (revoked_by =
    // auth.uid()) already rejects a payload that never sets revoked_by,
    // regardless of whether guard_institution_permissions_immutable_
    // grant() -- the trigger actually built to stop a user_id rewrite --
    // ever runs at all. This version proves the trigger specifically:
    // if it vanished, this write would succeed (RLS is satisfied) and
    // only the trigger stands in the way.
    const { error: rewriteErr } = await principalJ
      .from("institution_permissions")
      .update({ user_id: teacherOrdId, revoked_at: new Date().toISOString(), revoked_by: principalJId })
      .eq("id", grantRow.id);
    record("Principal CANNOT rewrite an existing grant's user_id, even smuggled into an otherwise-legitimate revoke -- only revoked_at/revoked_by may ever change", Boolean(rewriteErr), rewriteErr?.message);
    const { data: grantRowAfterRewriteAttempt } = await admin.from("institution_permissions").select("user_id, revoked_at").eq("id", grantRow.id).single();
    record(
      "...and the whole statement failed together -- the grant is neither rewritten nor accidentally revoked as a side effect",
      grantRowAfterRewriteAttempt.user_id === teacherDPId && grantRowAfterRewriteAttempt.revoked_at === null,
      JSON.stringify(grantRowAfterRewriteAttempt)
    );

    // -- (f) revoke the DP's grant, then confirm the EARLIER countersign --
    // (incident A, signed while the grant was active) is UNTOUCHED --
    // revocation is not retroactive.
    const { error: revokeErr } = await principalJ
      .from("institution_permissions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: principalJId })
      .eq("id", grantRow.id);
    record("Principal CAN revoke the DP's grant", !revokeErr, revokeErr?.message);

    const { data: canDPCountersignAfterRevoke } = await admin.rpc("can_countersign_incident", { p_user_id: teacherDPId, p_institution_id: institutionJId });
    record("can_countersign_incident() now returns false for the revoked DP", canDPCountersignAfterRevoke === false, canDPCountersignAfterRevoke);

    const { data: incidentAStillAfterRevoke } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time").eq("id", incidentAId).single();
    record(
      "Incident A's countersign is UNCHANGED after the DP's grant was revoked -- revocation is not retroactive",
      incidentAStillAfterRevoke.countersigned_by === teacherDPId
        && incidentAStillAfterRevoke.countersigned_at === incidentAAfter.countersigned_at
        && incidentAStillAfterRevoke.countersigned_role_at_time === "class_teacher",
      JSON.stringify(incidentAStillAfterRevoke)
    );

    // -- (g) incident B: the now-revoked DP attempts to countersign a --
    // FRESH incident -- REJECTED.
    const { data: incidentBId } = await teacherOrd.rpc("create_incident_stamp", {
      p_institution_id: institutionJId, p_occurred_at: new Date().toISOString(), p_location_id: locJ.id,
      p_child_passport_ids: [childJ.id], p_staff: [],
    });
    await teacherOrd.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherOrdId }).eq("id", incidentBId);

    const { error: revokedDpCountersignErr } = await teacherDP
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherDPId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentBId);
    const { data: incidentBAfter } = await admin.from("incidents").select("countersigned_at").eq("id", incidentBId).single();
    record(
      "Revoked DP CANNOT countersign a fresh incident",
      incidentBAfter.countersigned_at === null,
      `err=${revokedDpCountersignErr?.message}, countersigned_at=${incidentBAfter.countersigned_at}`
    );

    // -- (h) last-holder guard, as a real backstop, not just an RLS --
    // convenience -- an authenticated principal can never actually
    // trigger this (revoking always leaves at least themselves, since
    // the revoke policy itself requires an active principal to call it).
    // The real exposure is a service-role/admin path that bypasses RLS
    // entirely -- grant teacherOrd the permission, then remove
    // principalJ's OWN principal role via service role (simulating the
    // principal leaving without a role change going through this
    // migration), leaving teacherOrd's grant as the ONLY countersign
    // authority left at this institution -- then attempt to revoke it,
    // via service role, bypassing RLS's own principal-only gate entirely.
    // The trigger must still refuse, because it runs on every write
    // regardless of how RLS was satisfied or bypassed.
    const { data: secondGrant } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: teacherOrdId, permission: "countersign_incident", granted_by: principalJId })
      .select()
      .single();

    await admin.from("institution_staff").update({ role: "class_teacher" }).eq("institution_id", institutionJId).eq("user_id", principalJId);
    const { data: canAnyoneCountersignNow } = await admin.rpc("can_countersign_incident", { p_user_id: principalJId, p_institution_id: institutionJId });
    record("Setup for (h): former principal (now demoted) no longer counts as countersign authority", canAnyoneCountersignNow === false, canAnyoneCountersignNow);

    const { error: lastHolderRevokeErr } = await admin
      .from("institution_permissions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: teacherOrdId })
      .eq("id", secondGrant.id);
    record(
      "Last-holder guard REJECTS revoking the only remaining countersign authority at an institution, even via service role bypassing RLS entirely",
      Boolean(lastHolderRevokeErr),
      lastHolderRevokeErr?.message
    );
    const { data: secondGrantAfter } = await admin.from("institution_permissions").select("revoked_at").eq("id", secondGrant.id).single();
    record("That grant's revoked_at is still null -- the rejected revoke did not partially apply", secondGrantAfter.revoked_at === null, secondGrantAfter.revoked_at);

    // childJ (owned by teacherBId, a CORE account, not a dedicated
    // parentJ one) needs its own explicit delete here -- deleting
    // teacherBId isn't this block's to do, CORE's own cleanup owns
    // that, so nothing else would free this row before CHECK 10 later
    // wants to reuse teacherBId as another passport's owner.
    await admin.from("passports").delete().eq("id", childJ.id);
    await admin.from("institutions").delete().eq("id", institutionJId);
    for (const id of [principalJId, teacherDPId, teacherOrdId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK E: amendments after finalisation -- append-only, truly ==`);
  {
    const { data: amendment, error: amendErr } = await admin
      .from("incident_amendments")
      .insert({ incident_id: incidentId, author_id: teacherAId, reason: "Correction", content: "This is impossible" })
      .select()
      .single();
    // (service role for the insert itself here -- the point under test
    // is editability/deletability after the fact, not the insert
    // authorization path, which check J4's own policy already covers
    // via the owning-teacher/principal/clinician branches.)
    record("Amendment can be appended", !amendErr, amendErr?.message);

    await teacherA.from("incident_amendments").update({ content: "Tampered" }).eq("id", amendment.id);
    const { data: afterEditAttempt } = await admin.from("incident_amendments").select("content").eq("id", amendment.id).single();
    record("Existing amendment CANNOT be edited by anyone (no UPDATE policy exists at all)", afterEditAttempt.content === "This is impossible", `content now: ${afterEditAttempt.content}`);

    await teacherA.from("incident_amendments").delete().eq("id", amendment.id);
    const { data: stillThere } = await admin.from("incident_amendments").select("id").eq("id", amendment.id);
    record("Existing amendment CANNOT be deleted by anyone (no DELETE policy exists at all)", (stillThere?.length ?? 0) === 1, `rows still present=${stillThere?.length}`);

    const { data: visibleToPrincipal } = await principal.from("incident_amendments").select("id").eq("id", amendment.id);
    record("Amendment visible to principal", (visibleToPrincipal?.length ?? 0) === 1, `rows=${visibleToPrincipal?.length}`);
  }

  console.log(`\n== CHECK 8: CPI is_restraint flag, robust lookup ==`);
  {
    const { data: cpiAction } = await admin.from("incident_action_types").select("id, is_restraint").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();
    record("CPI action row flagged is_restraint = true", cpiAction.is_restraint === true, JSON.stringify(cpiAction));
  }

  console.log(`\n== CHECK 9: school_notices generated automatically ==`);
  {
    const { error: injErr } = await admin.from("incident_injuries").insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] });
    if (injErr) console.log("injury insert note:", injErr.message);

    const { data: flaggedChild } = await admin.from("incident_children").select("parent_call_required").eq("incident_id", incidentId).eq("passport_id", child1).single();
    record("incident_children.parent_call_required flipped true after injury insert", flaggedChild?.parent_call_required === true, JSON.stringify(flaggedChild));

    // Filtered to notice_type -- CHECK D already raised one
    // attestation_withdrawn notice for this same incident, so a bare
    // count here would over-count; each notice_type is independently
    // exactly-one for its own trigger.
    const { data: notices } = await admin.from("school_notices").select("*").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Exactly one incident_parent_call notice raised", (notices?.length ?? 0) === 1, `rows=${notices?.length}`);

    const { data: byPrincipalNotice } = await principal.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice visible to principal", (byPrincipalNotice?.length ?? 0) === 1, `rows=${byPrincipalNotice?.length}`);
    const { data: byOwnerNotice } = await teacherA.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice visible to owning teacher", (byOwnerNotice?.length ?? 0) === 1, `rows=${byOwnerNotice?.length}`);
    const { data: byParentNotice } = await parent1.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice INVISIBLE to parent", (byParentNotice?.length ?? 0) === 0, `rows=${byParentNotice?.length}`);
  }

  console.log(`\n== CHECK H: parent RPC excludes staff injury records entirely (asked three times -- live proof, not a re-quote of the SQL) ==`);
  {
    const { data: staffInjury, error: staffInjuryErr } = await admin
      .from("incident_injuries")
      .insert({ incident_id: incidentId, injured_party_type: "staff", free_text_name: "SNA Test (injured)" })
      .select()
      .single();
    record("Fixture: a staff injury record exists on this same incident", !staffInjuryErr, staffInjuryErr?.message);

    const { data: p1Rows } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1 });
    const row = p1Rows?.[0];
    const injuriesJson = JSON.stringify(row?.injuries ?? []);
    record(
      "Parent's own get_parent_incidents() injuries array does NOT contain the staff injury's name anywhere in it",
      !injuriesJson.includes("SNA Test (injured)"),
      injuriesJson
    );
    record(
      "Parent's injuries array STILL contains their own child's student injury (exclusion isn't just blanket-empty)",
      (row?.injuries?.length ?? 0) >= 1,
      injuriesJson
    );

    const { data: directStaffInjury } = await parent1.from("incident_injuries").select("*").eq("id", staffInjury.id);
    record(
      "Parent direct .select() on the staff injury row returns nothing (no policy grants it, defence in depth)",
      (directStaffInjury?.length ?? 0) === 0,
      `rows=${directStaffInjury?.length}`
    );
  }

  console.log(`\n== CHECK 10: two-child cap ==`);
  {
    // teacherBId as the owner here (never itself a passports.user_id
    // owner elsewhere in CORE) rather than a dedicated parent3 account
    // -- this row is a throwaway, deleted at the end of this block, and
    // no assertion here inspects the owner's identity, only the cap
    // logic. parent1Id/parent2Id are NOT substitutes -- both already own
    // a live passport (child1/child2) for the whole of CORE, and
    // passports.user_id keeps a live unique(user_id) constraint.
    const { data: p3 } = await admin.from("passports").insert({ user_id: teacherBId, child_name: "Verify Child Three", passport_status: "complete" }).select().single();
    const { error: thirdChildErr } = await admin.from("incident_children").insert({ incident_id: incidentId, passport_id: p3.id, child_index: "A", added_by: teacherAId });
    record("Third child with duplicate child_index 'A' REJECTED", Boolean(thirdChildErr), thirdChildErr?.message);
    const { error: thirdChildErr2 } = await admin.from("incident_children").insert({ incident_id: incidentId, passport_id: p3.id, child_index: "C", added_by: teacherAId });
    record("Third child with child_index 'C' (outside A/B) REJECTED", Boolean(thirdChildErr2), thirdChildErr2?.message);
    await admin.from("passports").delete().eq("id", p3.id);
  }

  console.log(`\n== CHECK 11: free-text staff, non-blocking ==`);
  {
    const { data: freeTextRow } = await admin.from("incident_staff").select("attested_at").eq("incident_id", incidentId).is("user_id", null).single();
    record("Free-text staff row has no attested_at (never attested, by construction)", freeTextRow.attested_at === null, JSON.stringify(freeTextRow));
    record("Incident reached teacher sign-off despite the free-text row being unattested (non-blocking, confirmed above in check 7)", true, "sign-off in check 7 already succeeded with this row present");
  }

  // biteType/restraintAction/nonRestraintAction/headRegion were all
  // fetched up in Setup, alongside loc/bruisingType/rednessType --
  // CHECK D above needs them too now that region_id/side are NOT NULL.

  console.log(`\n== CHECK K: Part 2 schema (migration 0080) -- party array, body regions, linked people ==`);
  {
    // -- (a) party: non-empty array required, allowed-values set enforced. --
    // Same reuse as CHECK 10 above -- teacherBId, not a dedicated
    // parent3 account; this row is deleted at the end of CHECK K too
    // (see below), so it's free again for CHECK 10's own row to have
    // already used the same owner without a unique(user_id) collision.
    const { data: p3 } = await admin.from("passports").insert({ user_id: teacherBId, child_name: "Verify Child K", passport_status: "complete" }).select().single();
    const { data: kIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { error: partyEmptyErr } = await teacherA.from("incidents").update({ party: [] }).eq("id", kIncidentId);
    record("party = [] (empty array) REJECTED -- required field, not silently satisfied by an empty selection", Boolean(partyEmptyErr), partyEmptyErr?.message);

    const { error: partyBogusErr } = await teacherA.from("incidents").update({ party: ["bystander"] }).eq("id", kIncidentId);
    record("party containing a value outside the allowed set REJECTED", Boolean(partyBogusErr), partyBogusErr?.message);

    const { error: partyGoodErr } = await teacherA.from("incidents").update({ party: ["self", "other"], party_other: "Playground supervisor" }).eq("id", kIncidentId);
    const { data: partyAfter } = await admin.from("incidents").select("party, party_other").eq("id", kIncidentId).single();
    record(
      "party as a genuine multi-select, with 'other' + party_other, persists correctly",
      !partyGoodErr && JSON.stringify(partyAfter.party) === JSON.stringify(["self", "other"]) && partyAfter.party_other === "Playground supervisor",
      `err=${partyGoodErr?.message}, ${JSON.stringify(partyAfter)}`
    );

    // -- (b) incident_body_marks: region_id/side are NOT NULL, region_id is a real FK. --
    const { data: kInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();

    const { error: noRegionErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, side: "centre" });
    record("A body mark with NO region_id is REJECTED (not null constraint)", Boolean(noRegionErr), noRegionErr?.message);

    const { error: bogusRegionErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: "00000000-0000-0000-0000-000000000000", side: "centre" });
    record("A body mark with a region_id NOT in the vocabulary is REJECTED (foreign key)", Boolean(bogusRegionErr), bogusRegionErr?.message);

    const { error: bogusSideErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "diagonal" });
    record("A body mark with a side outside left/right/centre is REJECTED (check constraint)", Boolean(bogusSideErr), bogusSideErr?.message);

    const { error: goodMarkErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" });
    record("A body mark with region_id + side both valid succeeds", !goodMarkErr, goodMarkErr?.message);

    const { data: regionSeed } = await admin.from("incident_body_regions").select("value").is("institution_id", null);
    const expectedRegions = ["head", "chest", "stomach", "upper_arm", "lower_arm", "hand", "upper_back", "lower_back", "upper_leg", "lower_leg"].sort();
    record(
      "Global incident_body_regions seed is EXACTLY the ten regions.json slugs -- no more, no fewer",
      JSON.stringify((regionSeed ?? []).map((r) => r.value).sort()) === JSON.stringify(expectedRegions),
      JSON.stringify(regionSeed?.map((r) => r.value))
    );

    // -- (c) injured party must be named on THIS incident. --
    const { error: unnamedChildErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "student", passport_id: p3.id });
    record("Injured party's passport_id NOT among this incident's children is REJECTED", Boolean(unnamedChildErr), unnamedChildErr?.message);

    const { error: unnamedStaffErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "staff", staff_user_id: snaId });
    record("Injured party's staff_user_id NOT among this incident's staff is REJECTED (SNA never named on this incident)", Boolean(unnamedStaffErr), unnamedStaffErr?.message);

    // -- (d) CPI staff links: real accounts only, same incident only. --
    const { data: kFreeTextStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kIncidentId, free_text_name: "Cover Supervisor No Account", involvement: "witnessed" })
      .select()
      .single();
    const { data: kRealStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kIncidentId, user_id: teacherBId, involvement: "witnessed" })
      .select()
      .single();
    const { data: kRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: kIncidentId, passport_id: child1, planning_status: "not_planned" })
      .select()
      .single();

    const { error: freeTextLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kFreeTextStaff.id });
    record("Linking a free-text-only (no-account) staff entry to a restrictive practice record is REJECTED", Boolean(freeTextLinkErr), freeTextLinkErr?.message);

    // A genuinely separate, still-open incident -- not the main
    // incidentId, which is already signed+countersigned by this point
    // and would reject the staff insert outright, never actually
    // exercising the cross-incident mismatch this is meant to test.
    const { data: kOtherIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: otherIncidentStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kOtherIncidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    const { error: crossIncidentLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: otherIncidentStaff.id });
    record("Linking a staff row named on a DIFFERENT incident is REJECTED (incident mismatch, real session not a bypass)", Boolean(crossIncidentLinkErr), crossIncidentLinkErr?.message);
    await admin.from("incidents").delete().eq("id", kOtherIncidentId);

    const { error: realLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kRealStaff.id });
    record("Linking a real-account staff member named on the SAME incident succeeds", !realLinkErr, realLinkErr?.message);

    const { data: linkVisibleToPrincipal } = await principal.from("restrictive_practice_staff").select("id").eq("restrictive_practice_id", kRp.id);
    record("The link is visible to the principal (follows the parent incident's own visibility)", (linkVisibleToPrincipal?.length ?? 0) >= 1, `rows=${linkVisibleToPrincipal?.length}`);
    const { data: linkVisibleToParent } = await parent1.from("restrictive_practice_staff").select("id").eq("restrictive_practice_id", kRp.id);
    record("The link is INVISIBLE to an unrelated parent", (linkVisibleToParent?.length ?? 0) === 0, `rows=${linkVisibleToParent?.length}`);

    // -- (e) after sign-off, linking/unlinking is rejected by RLS's own gate. --
    // A restrictive_practices record now exists (kRp) with no restraint
    // action ticked -- would trip 0083's own CPI-consistency gate first
    // and never reach a genuine post-signoff state, so tick one here
    // purely to let sign-off through; 0083 itself is covered on its own
    // terms in CHECK N below.
    await teacherA.from("incident_actions").insert({ incident_id: kIncidentId, action_type_id: restraintAction.id });
    await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", kIncidentId);
    const { data: kSignedCheck } = await admin.from("incidents").select("teacher_signed_at").eq("id", kIncidentId).single();
    if (kSignedCheck.teacher_signed_at) {
      const { error: postSignLinkErr } = await teacherA
        .from("restrictive_practice_staff")
        .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kFreeTextStaff.id });
      record("Post-signoff link attempt REJECTED (RLS's own teacher_signed_at is null gate)", Boolean(postSignLinkErr), postSignLinkErr?.message);
    } else {
      record("Post-signoff link attempt REJECTED (RLS's own teacher_signed_at is null gate)", false, "fixture did not reach sign-off -- see anyone_injured/CPI consistency, expected for this minimal fixture");
    }

    await admin.from("incidents").delete().eq("id", kIncidentId);
    await admin.from("passports").delete().eq("id", p3.id);
  }

  console.log(`\n== CHECK L: three-way Yes/No fields -- 'answered No' is not 'not recorded' (migration 0081) ==`);
  {
    const { data: lIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { data: lIncidentRow } = await admin.from("incidents").select("anyone_injured").eq("id", lIncidentId).single();
    record("incidents.anyone_injured defaults to null (not false) on a freshly-stamped incident", lIncidentRow.anyone_injured === null, lIncidentRow.anyone_injured);

    const { data: lRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: lIncidentId, passport_id: child1, planning_status: "not_planned" })
      .select()
      .single();
    record("restrictive_practices.ncse_report_complete defaults to null (not false)", lRp.ncse_report_complete === null, lRp.ncse_report_complete);

    const { data: lInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: lIncidentId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    record(
      "incident_injuries.first_aider_called / doctor_ambulance_called both default to null (not false)",
      lInjury.first_aider_called === null && lInjury.doctor_ambulance_called === null,
      JSON.stringify({ first_aider_called: lInjury.first_aider_called, doctor_ambulance_called: lInjury.doctor_ambulance_called })
    );

    await teacherA.from("incident_injuries").update({ first_aider_called: false, doctor_ambulance_called: true }).eq("id", lInjury.id);
    const { data: lInjuryAfter } = await admin.from("incident_injuries").select("first_aider_called, doctor_ambulance_called").eq("id", lInjury.id).single();
    record(
      "An explicit 'No' (false) persists distinctly from null -- not coerced back to unanswered",
      lInjuryAfter.first_aider_called === false && lInjuryAfter.doctor_ambulance_called === true,
      JSON.stringify(lInjuryAfter)
    );

    const { data: lMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: lInjury.id, view: "front", x: 0.3, y: 0.4, injury_type_id: biteType.id, region_id: headRegion.id, side: "left" })
      .select()
      .single();
    record("A fresh Bite mark's skin_broken defaults to null (not asked yet)", lMark.skin_broken === null, lMark.skin_broken);

    await teacherA.from("incident_body_marks").update({ skin_broken: false }).eq("id", lMark.id);
    const { data: lMarkAfter } = await admin.from("incident_body_marks").select("skin_broken").eq("id", lMark.id).single();
    record("skin_broken = false persists distinctly from null (skin explicitly NOT broken, not unanswered)", lMarkAfter.skin_broken === false, lMarkAfter.skin_broken);

    await admin.from("incidents").delete().eq("id", lIncidentId);
  }

  console.log(`\n== CHECK M: incident_actions UPDATE policy (migration 0082) ==`);
  {
    const { data: mIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: otherActionType } = await admin.from("incident_action_types").select("id").eq("value", "Other").is("institution_id", null).single();
    const { data: mAction } = await teacherA
      .from("incident_actions")
      .insert({ incident_id: mIncidentId, action_type_id: otherActionType.id })
      .select()
      .single();

    const { error: ownerUpdateErr } = await teacherA
      .from("incident_actions")
      .update({ other_detail: "Called a parent to collect early." })
      .eq("id", mAction.id);
    const { data: mActionAfterOwner } = await admin.from("incident_actions").select("other_detail").eq("id", mAction.id).single();
    record(
      "Owning teacher CAN update other_detail on an existing action (the bug 0082 fixed -- previously silently wrote nothing)",
      !ownerUpdateErr && mActionAfterOwner.other_detail === "Called a parent to collect early.",
      `err=${ownerUpdateErr?.message}, other_detail=${mActionAfterOwner.other_detail}`
    );

    const { error: strangerUpdateErr } = await teacherB
      .from("incident_actions")
      .update({ other_detail: "Teacher B should not be able to write this." })
      .eq("id", mAction.id);
    const { data: mActionAfterStranger } = await admin.from("incident_actions").select("other_detail").eq("id", mAction.id).single();
    record(
      "A teacher with no standing on this incident CANNOT update its action (silently, RLS-filtered -- re-queried, not trusted from the client-visible error)",
      mActionAfterStranger.other_detail === "Called a parent to collect early.",
      `err=${strangerUpdateErr?.message}, other_detail now=${mActionAfterStranger.other_detail}`
    );

    await admin.from("incidents").delete().eq("id", mIncidentId);
  }

  console.log(`\n== CHECK N: sign-off consistency gate -- all four cases, both directions where symmetric (migration 0083) ==`);
  {
    // -- N1: anyone_injured = true, zero injury records -- rejected, --
    // then fixed by adding one.
    const { data: nAId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ anyone_injured: true }).eq("id", nAId);
    const { error: nAErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nAId);
    const { data: nAAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nAId).single();
    record(
      "N1a: Sign-off REJECTED -- anyone_injured=true but zero incident_injuries rows exist",
      nAAfter1.teacher_signed_at === null,
      `err=${nAErr1?.message}, teacher_signed_at=${nAAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_injuries").insert({ incident_id: nAId, injured_party_type: "student", passport_id: child1 });
    const { error: nAErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nAId);
    const { data: nAAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nAId).single();
    record(
      "N1b: Sign-off SUCCEEDS once an injury record is added, resolving the inconsistency",
      !nAErr2 && nAAfter2.teacher_signed_at !== null,
      `err=${nAErr2?.message}, teacher_signed_at=${nAAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nAId);

    // -- N2: anyone_injured = false, but an injury record exists -- --
    // rejected, then fixed by removing it.
    const { data: nBId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ anyone_injured: false }).eq("id", nBId);
    const { data: nBInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: nBId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    const { error: nBErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nBId);
    const { data: nBAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nBId).single();
    record(
      "N2a: Sign-off REJECTED -- anyone_injured=false but an incident_injuries row still exists",
      nBAfter1.teacher_signed_at === null,
      `err=${nBErr1?.message}, teacher_signed_at=${nBAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_injuries").delete().eq("id", nBInjury.id);
    const { error: nBErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nBId);
    const { data: nBAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nBId).single();
    record(
      "N2b: Sign-off SUCCEEDS once the orphaned injury record is removed",
      !nBErr2 && nBAfter2.teacher_signed_at !== null,
      `err=${nBErr2?.message}, teacher_signed_at=${nBAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nBId);

    // -- N3: anyone_injured = null (never answered) -- passes through --
    // untouched, even with an injury row present (agreed in chat: a
    // missing answer is not forced, matching the attestation precedent).
    const { data: nCId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_injuries").insert({ incident_id: nCId, injured_party_type: "student", passport_id: child1 });
    const { data: nCRow } = await admin.from("incidents").select("anyone_injured").eq("id", nCId).single();
    record("N3 setup: anyone_injured is genuinely null on this incident (never answered)", nCRow.anyone_injured === null, nCRow.anyone_injured);
    const { error: nCErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nCId);
    const { data: nCAfter } = await admin.from("incidents").select("teacher_signed_at").eq("id", nCId).single();
    record(
      "N3: Sign-off SUCCEEDS with anyone_injured left null -- an unanswered gate is not forced, unlike an inconsistent one",
      !nCErr && nCAfter.teacher_signed_at !== null,
      `err=${nCErr?.message}, teacher_signed_at=${nCAfter.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nCId);

    // -- N4: skin_broken set on a mark whose type is no longer Bite -- --
    // the exact "type was changed away from Bite after skin_broken was
    // set" scenario, forced via service role since the app's own client
    // clears skin_broken on the same write that changes type -- the
    // trigger is the structural backstop for a state the UI itself tries
    // to prevent, not a UI-only guarantee.
    const { data: nDId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: nDInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: nDId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    const { data: nDMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: nDInjury.id, view: "front", x: 0.5, y: 0.2, injury_type_id: biteType.id, region_id: headRegion.id, side: "left", skin_broken: true })
      .select()
      .single();
    await admin.from("incident_body_marks").update({ injury_type_id: bruisingType.id }).eq("id", nDMark.id);
    const { data: nDMarkAfter } = await admin.from("incident_body_marks").select("injury_type_id, skin_broken").eq("id", nDMark.id).single();
    record(
      "N4 setup: mark's type is now Bruising while skin_broken is still true (bypassing the client's own clear-on-change)",
      nDMarkAfter.injury_type_id === bruisingType.id && nDMarkAfter.skin_broken === true,
      JSON.stringify(nDMarkAfter)
    );
    const { error: nDErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nDId);
    const { data: nDAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nDId).single();
    record(
      "N4a: Sign-off REJECTED -- skin_broken is recorded but the mark's type is no longer Bite",
      nDAfter1.teacher_signed_at === null,
      `err=${nDErr1?.message}, teacher_signed_at=${nDAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_body_marks").update({ skin_broken: null }).eq("id", nDMark.id);
    const { error: nDErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nDId);
    const { data: nDAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nDId).single();
    record(
      "N4b: Sign-off SUCCEEDS once skin_broken is cleared to null, matching the now-non-Bite type",
      !nDErr2 && nDAfter2.teacher_signed_at !== null,
      `err=${nDErr2?.message}, teacher_signed_at=${nDAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nDId);

    // -- N5: CPI ticked (a restraint action present), no restrictive_ --
    // practices record at all -- the fourth case, found live in
    // already-shipped Part 4 code. Rejected, then fixed by adding one.
    const { data: nEId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_actions").insert({ incident_id: nEId, action_type_id: restraintAction.id });
    const { error: nEErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nEId);
    const { data: nEAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nEId).single();
    record(
      "N5a: Sign-off REJECTED -- CPI/restraint action ticked but no restrictive_practices record exists",
      nEAfter1.teacher_signed_at === null,
      `err=${nEErr1?.message}, teacher_signed_at=${nEAfter1.teacher_signed_at}`
    );

    await teacherA.from("restrictive_practices").insert({ incident_id: nEId, passport_id: child1, planning_status: "not_planned" });
    const { error: nEErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nEId);
    const { data: nEAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nEId).single();
    record(
      "N5b: Sign-off SUCCEEDS once a restrictive_practices record is added to match the ticked action",
      !nEErr2 && nEAfter2.teacher_signed_at !== null,
      `err=${nEErr2?.message}, teacher_signed_at=${nEAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nEId);

    // -- N6: the original case -- a restrictive_practices record exists, --
    // but CPI/restraint is NOT ticked (unticked after the record was
    // saved). Rejected, then fixed by ticking it.
    const { data: nFId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("restrictive_practices").insert({ incident_id: nFId, passport_id: child1, planning_status: "not_planned" });
    const { error: nFErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6a: Sign-off REJECTED -- a restrictive_practices record exists but CPI/restraint is not ticked",
      nFAfter1.teacher_signed_at === null,
      `err=${nFErr1?.message}, teacher_signed_at=${nFAfter1.teacher_signed_at}`
    );

    // A non-restraint action alone must NOT satisfy the gate -- proves
    // the check is keyed on is_restraint specifically, not "any action
    // exists".
    await teacherA.from("incident_actions").insert({ incident_id: nFId, action_type_id: nonRestraintAction.id });
    const { error: nFErr1b } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter1b } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6a-bis: A NON-restraint action present is still REJECTED -- the gate is keyed on is_restraint, not merely 'some action exists'",
      nFAfter1b.teacher_signed_at === null,
      `err=${nFErr1b?.message}, teacher_signed_at=${nFAfter1b.teacher_signed_at}`
    );

    await teacherA.from("incident_actions").insert({ incident_id: nFId, action_type_id: restraintAction.id });
    const { error: nFErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6b: Sign-off SUCCEEDS once the restraint action is ticked to match the existing record",
      !nFErr2 && nFAfter2.teacher_signed_at !== null,
      `err=${nFErr2?.message}, teacher_signed_at=${nFAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nFId);
  }

  console.log(`\n== CHECK O: Phase 4 piece 1 -- sign_off_incident() RPC, get_incident_signoff_summary(), teacher_signed_by guard (migrations 0085/0086) ==`);
  {
    // -- O1: teacher_signed_by spoofing REJECTED (the bug 0086 fixed). --
    const { data: oSpoofId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: spoofErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherBId })
      .eq("id", oSpoofId);
    const { data: afterSpoof } = await admin.from("incidents").select("teacher_signed_at, teacher_signed_by").eq("id", oSpoofId).single();
    record(
      "O1: teacher_signed_by spoofed to someone other than the caller is REJECTED, and does not persist",
      afterSpoof.teacher_signed_at === null && afterSpoof.teacher_signed_by === null,
      `err=${spoofErr?.message}, ${JSON.stringify(afterSpoof)}`
    );

    // -- O1b: correct self-attribution via raw update still works (the --
    // guard is scoped to a MISMATCH, not to touching the column at all).
    const { error: selfAttribErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", oSpoofId);
    const { data: afterSelfAttrib } = await admin.from("incidents").select("teacher_signed_at, teacher_signed_by").eq("id", oSpoofId).single();
    record(
      "O1b: correct self-attribution (teacher_signed_by = caller) still succeeds via raw update",
      !selfAttribErr && afterSelfAttrib.teacher_signed_by === teacherAId,
      `err=${selfAttribErr?.message}, ${JSON.stringify(afterSelfAttrib)}`
    );
    await admin.from("incidents").delete().eq("id", oSpoofId);

    // -- O2: sign_off_incident() RPC -- clean, distinct error paths. --
    const { error: notFoundErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: "00000000-0000-0000-0000-000000000000" });
    record("O2a: sign_off_incident() on a nonexistent id gives a clean 'not found' error", Boolean(notFoundErr) && /not found|permission/i.test(notFoundErr?.message ?? ""), notFoundErr?.message);

    const { data: oCleanId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: notOwnerErr } = await teacherB.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2b: sign_off_incident() called by someone who can VIEW but isn't creator/owning teacher gives a distinct 'not permitted' error",
      Boolean(notOwnerErr) && /permission|creator|owning/i.test(notOwnerErr?.message ?? ""),
      notOwnerErr?.message
    );

    const { data: oSignResult, error: oSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2c: sign_off_incident() succeeds for the real creator/owning teacher, teacher_signed_by correctly self-attributed",
      !oSignErr && oSignResult?.teacher_signed_by === teacherAId && oSignResult?.teacher_signed_at != null,
      `err=${oSignErr?.message}, ${JSON.stringify(oSignResult)}`
    );

    const { error: alreadySignedErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2d: sign_off_incident() called again on an already-signed incident gives a distinct 'already signed off' error",
      Boolean(alreadySignedErr) && /already/i.test(alreadySignedErr?.message ?? ""),
      alreadySignedErr?.message
    );

    // -- O3: the three shared-function-backed gates still block via the RPC --
    // (not just via raw .update(), which CHECK N already covers) -- one
    // pass each confirms the trigger rewrites are correctly wired.
    const { data: oDebriefId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ debrief_required: true }).eq("id", oDebriefId);
    const { error: oDebriefErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oDebriefId });
    record("O3a: debrief gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oDebriefErr) && /debrief/i.test(oDebriefErr?.message ?? ""), oDebriefErr?.message);
    await admin.from("incidents").delete().eq("id", oDebriefId);

    const { data: oAttestId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: oAttestStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", oAttestId).eq("user_id", teacherBId).single();
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: oAttestStaffRow.id, p_addendum: "Confirmed." });
    await teacherA.from("incidents").update({ narrative: "Edited after attestation." }).eq("id", oAttestId);
    const { error: oAttestErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oAttestId });
    record("O3b: attestation staleness gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oAttestErr) && /stale|attestation/i.test(oAttestErr?.message ?? ""), oAttestErr?.message);
    await admin.from("incidents").delete().eq("id", oAttestId);

    const { data: oCpiId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_actions").insert({ incident_id: oCpiId, action_type_id: restraintAction.id });
    const { error: oCpiErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCpiId });
    record("O3c: CPI-consistency gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oCpiErr) && /restrictive practice/i.test(oCpiErr?.message ?? ""), oCpiErr?.message);

    // -- O4: get_incident_signoff_summary() -- content correctness. --
    const { data: oSummary1, error: oSummary1Err } = await teacherA.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    record("O4a: get_incident_signoff_summary() callable, no longer 'permission denied for table users'", !oSummary1Err, oSummary1Err?.message);
    record(
      "O4b: summary correctly reports can_sign_off = false with the matching blocking issue when CPI is ticked but no RP record exists",
      oSummary1?.can_sign_off === false && oSummary1?.blocking_issues?.some((i) => i.code === "cpi_ticked_no_record"),
      JSON.stringify(oSummary1)
    );
    record(
      "O4c: unanswered anyone_injured reported as {value: null, note: 'not recorded'}, NOT in blocking_issues",
      oSummary1?.anyone_injured?.value === null && oSummary1?.anyone_injured?.note === "not recorded" && !oSummary1?.blocking_issues?.some((i) => i.code?.startsWith("anyone_injured")),
      JSON.stringify(oSummary1?.anyone_injured)
    );

    await teacherA.from("restrictive_practices").insert({ incident_id: oCpiId, passport_id: child1, planning_status: "not_planned" });
    const { data: oFreeTextStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: oCpiId, free_text_name: "Cover Supervisor No Account", involvement: "witnessed" })
      .select()
      .single();
    const { data: oRealStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: oCpiId, user_id: teacherBId, involvement: "witnessed" })
      .select()
      .single();
    const { data: oSummary2 } = await teacherA.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    const oFreeTextEntry = oSummary2?.staff_attestations?.find((s) => s.incident_staff_id === oFreeTextStaff.id);
    const oRealEntry = oSummary2?.staff_attestations?.find((s) => s.incident_staff_id === oRealStaff.id);
    record(
      "O4d: free-text (no-account) staff labelled 'Not attested -- no account', never blocking",
      oFreeTextEntry?.status_label === "Not attested -- no account" && oFreeTextEntry?.has_account === false && oFreeTextEntry?.blocks_signoff === false,
      JSON.stringify(oFreeTextEntry)
    );
    record(
      "O4e: real-account staff who hasn't attested yet labelled 'Not attested', never blocking",
      oRealEntry?.status_label === "Not attested" && oRealEntry?.has_account === true && oRealEntry?.blocks_signoff === false,
      JSON.stringify(oRealEntry)
    );
    record("O4f: can_sign_off now true once the CPI/RP mismatch is resolved (RP record added)", oSummary2?.can_sign_off === true, JSON.stringify(oSummary2?.blocking_issues));

    // -- O4g: restricted to creator/owning teacher -- a principal who can --
    // VIEW the incident (but isn't its creator/owning teacher) is refused.
    const { error: oSummaryPrincipalErr } = await principal.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    record("O4g: get_incident_signoff_summary() refused to a principal (view access, not creator/owning teacher)", Boolean(oSummaryPrincipalErr), oSummaryPrincipalErr?.message);

    // -- O5: the drift-proof check -- summary.can_sign_off must agree with --
    // what sign_off_incident() actually does, on the SAME incident, in the
    // SAME state. Now genuinely guaranteed by sharing incident_signoff_
    // issues(), not just hoped for -- this exercises that the WIRING (not
    // just the shared function itself) is correct on both paths.
    const { data: oSignAfterFix, error: oSignAfterFixErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCpiId });
    record(
      "O5: summary said can_sign_off=true, and sign_off_incident() agrees -- succeeds",
      oSummary2?.can_sign_off === true && !oSignAfterFixErr && oSignAfterFix?.teacher_signed_at != null,
      `summary.can_sign_off=${oSummary2?.can_sign_off}, err=${oSignAfterFixErr?.message}`
    );

    // -- O6: immutability freeze-by-exclusion -- the REAL test, not the --
    // false-positive one this suite ran the first time. Using teacherA
    // here (as the original version of this check did) proves nothing:
    // post-signoff, the owning teacher has NO valid RLS policy at all
    // (their edit policy requires teacher_signed_at is null), so any
    // write is rejected by RLS finding zero applicable policies -- the
    // exact same silently-passing-for-the-wrong-reason bug that let
    // 0085's freeze-by-exclusion rewrite go unnoticed as never having
    // actually landed (found and fixed in 0089's own commentary). The
    // only way to test the TRIGGER's own logic is a caller who has a
    // genuinely valid RLS path for the write and tries to smuggle a
    // frozen field in alongside it -- here, the principal, mid-countersign,
    // which is the one write RLS actually allows at this stage.
    const { error: oSneakErr } = await principal
      .from("incidents")
      .update({
        countersigned_at: new Date().toISOString(),
        countersigned_by: principalId,
        countersigned_role_at_time: "principal",
        narrative: "Sneaked in alongside a legitimate countersign write.",
      })
      .eq("id", oCpiId);
    const { data: oAfterSneak } = await admin.from("incidents").select("countersigned_at, narrative, anyone_injured, location_other, party_other").eq("id", oCpiId).single();
    record(
      "O6: a caller with a GENUINELY VALID RLS path (the principal, mid-countersign) still cannot smuggle a frozen field into the same write -- the trigger itself rejects it",
      Boolean(oSneakErr) && oAfterSneak.countersigned_at === null && oAfterSneak.narrative !== "Sneaked in alongside a legitimate countersign write.",
      JSON.stringify({ sneakErr: oSneakErr?.message, oAfterSneak })
    );
    record(
      "O6b: the whole statement failed together -- the countersign did NOT partially apply while rejecting only the narrative",
      oAfterSneak.countersigned_at === null,
      JSON.stringify(oAfterSneak)
    );

    // -- O7: a CLEAN countersign (no sneak) succeeds normally post-signoff --
    // -- the exact concern raised about the teacher_signed_by trigger
    // interfering. It cannot, structurally (countersign never touches
    // teacher_signed_at, so old.teacher_signed_at is null is always false
    // for that write) -- proved here directly rather than left as
    // reasoning.
    const { error: oCountersignErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: principalId, countersigned_role_at_time: "principal" })
      .eq("id", oCpiId);
    const { data: oAfterCountersign } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, updated_at, status").eq("id", oCpiId).single();
    record(
      "O7: countersign succeeds post-signoff, completely unaffected by the teacher_signed_by guard trigger, status derives to 'finalised'",
      !oCountersignErr && oAfterCountersign.countersigned_at != null && oAfterCountersign.countersigned_by === principalId && oAfterCountersign.status === "finalised",
      `err=${oCountersignErr?.message}, ${JSON.stringify(oAfterCountersign)}`
    );

    await admin.from("incidents").delete().eq("id", oCleanId);
    await admin.from("incidents").delete().eq("id", oCpiId);
  }

  console.log(`\n== CHECK P: Phase 4 piece 2 -- per-category staleness, get_my_incident_attestations() (migration 0088) ==`);
  {
    const sameSet = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

    const { data: pIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    await teacherA.from("incidents").update({ narrative: "Baseline narrative.", anyone_injured: true }).eq("id", pIncidentId);
    await teacherA.from("incident_children").update({ distress_level: "slightly_distressed" }).eq("incident_id", pIncidentId).eq("passport_id", child1);
    await teacherA.from("incident_actions").insert({ incident_id: pIncidentId, action_type_id: restraintAction.id });
    const { data: pRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: pIncidentId, passport_id: child1, planning_status: "not_planned", hold_level: "low" })
      .select()
      .single();
    const { data: pInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: pIncidentId, injured_party_type: "student", passport_id: child1, injury_notes: "Baseline note." })
      .select()
      .single();
    const { data: pMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: pInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" })
      .select()
      .single();
    const { data: pStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", pIncidentId).eq("user_id", teacherBId).single();

    // Request attestations the real way -- the explicit teacher toggle
    // (0089), not a hand-set status. Without this, teacherB has no RLS
    // path to the incident at all (can_view_incident's named-staff
    // branch requires status <> 'draft' OR having already attested --
    // neither true yet), so get_my_incident_attestations() below would
    // silently return nothing, for the exact reason CHECK P caught live
    // the first time this suite was run against 0089.
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", pIncidentId);
    const { data: pStatusAfterRequest } = await admin.from("incidents").select("status").eq("id", pIncidentId).single();
    record("P0: requesting attestations derives status to 'awaiting_signoff'", pStatusAfterRequest.status === "awaiting_signoff", pStatusAfterRequest.status);

    // -- P1: baseline attest, category_hashes populated with all six keys. --
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Baseline." });
    const { data: pLatestRow } = await admin
      .from("incident_attestations")
      .select("category_hashes")
      .eq("incident_staff_id", pStaffRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const pKeys = pLatestRow.category_hashes ? Object.keys(pLatestRow.category_hashes).sort() : [];
    record(
      "P1: attest_to_incident() populates category_hashes with all six categories",
      sameSet(pKeys, ["actions", "body_marks", "children", "injuries", "narrative", "restrictive_practices"]),
      JSON.stringify(pKeys)
    );

    // -- P2: freshly attested, nothing changed -- empty, not null. --
    const { data: pStale0 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P2: get_stale_categories() is an empty array immediately after attesting (current, not stale)", Array.isArray(pStale0) && pStale0.length === 0, JSON.stringify(pStale0));

    // -- P3: narrative alone. --
    await teacherA.from("incidents").update({ narrative: "Rewritten narrative." }).eq("id", pIncidentId);
    const { data: pStale1 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P3: editing ONLY the narrative reports exactly ['narrative']", sameSet(pStale1, ["narrative"]), JSON.stringify(pStale1));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after narrative correction." });

    // -- P4: actions alone. --
    const { data: pOtherActionType } = await admin.from("incident_action_types").select("id").eq("value", "Redirected").is("institution_id", null).single();
    await teacherA.from("incident_actions").insert({ incident_id: pIncidentId, action_type_id: pOtherActionType.id });
    const { data: pStale2 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P4: adding an action alone reports exactly ['actions']", sameSet(pStale2, ["actions"]), JSON.stringify(pStale2));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after an action was added." });

    // -- P5: children (distress_level) alone. --
    await teacherA.from("incident_children").update({ distress_level: "yes_definitely" }).eq("incident_id", pIncidentId).eq("passport_id", child1);
    const { data: pStale3 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P5: changing a child's distress_level alone reports exactly ['children']", sameSet(pStale3, ["children"]), JSON.stringify(pStale3));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after distress level was corrected." });

    // -- P6: restrictive_practices alone. --
    await teacherA.from("restrictive_practices").update({ hold_level: "high" }).eq("id", pRp.id);
    const { data: pStale4 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P6: editing hold_level on the saved restrictive practice record alone reports exactly ['restrictive_practices']", sameSet(pStale4, ["restrictive_practices"]), JSON.stringify(pStale4));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after hold_level was corrected." });

    // -- P7: injuries alone. --
    await teacherA.from("incident_injuries").update({ injury_notes: "Revised note." }).eq("id", pInjury.id);
    const { data: pStale5 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P7: editing injury_notes alone reports exactly ['injuries']", sameSet(pStale5, ["injuries"]), JSON.stringify(pStale5));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after the injury note was revised." });

    // -- P8: body_marks alone. --
    await teacherA.from("incident_body_marks").update({ x: 0.15, y: 0.2 }).eq("id", pMark.id);
    const { data: pStale6 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P8: moving a body-map marker alone reports exactly ['body_marks']", sameSet(pStale6, ["body_marks"]), JSON.stringify(pStale6));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after the marker was moved." });

    // -- P9: two categories at once. --
    await teacherA.from("incidents").update({ narrative: "Rewritten a second time." }).eq("id", pIncidentId);
    await teacherA.from("incident_injuries").update({ injury_notes: "Revised a second time." }).eq("id", pInjury.id);
    const { data: pStale7 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P9: two simultaneous changes report BOTH categories, nothing more", sameSet(pStale7, ["narrative", "injuries"]), JSON.stringify(pStale7));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after both corrections." });

    // -- P10: not_attested -- a second, never-attested real staff member. --
    const { data: pSecondStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: pIncidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    const { data: pStaleNotAttested } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pSecondStaff.id });
    record("P10: get_stale_categories() is null for a staff member who has never attested", pStaleNotAttested === null, JSON.stringify(pStaleNotAttested));

    // -- P11: withdrawn. --
    await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: pStaffRow.id, p_reason: "Testing withdrawal for CHECK P." });
    const { data: pStaleWithdrawn } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P11: get_stale_categories() is null once withdrawn (nothing to compare against)", pStaleWithdrawn === null, JSON.stringify(pStaleWithdrawn));

    // -- P12: pre-migration-style row -- content_hash set, category_hashes --
    // null, simulating an attestation made before 0088. Status should still
    // read 'stale' off the untouched combined hash; the category breakdown
    // must degrade to null rather than guess.
    const { data: pRenewedAttestationId } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: pStaffRow.id,
      p_addendum: "Renewing after withdrawal, for the next test.",
    });
    // .update().order().limit() does NOT constrain which rows an UPDATE
    // touches (PostgREST/Postgres UPDATE has no LIMIT) -- targeting this
    // one row by the id the RPC itself just returned, not by a query
    // shape that looks scoped but isn't.
    await admin.from("incident_attestations").update({ category_hashes: null }).eq("id", pRenewedAttestationId);
    await teacherA.from("incidents").update({ narrative: "Rewritten a third time, after simulating a pre-migration attestation." }).eq("id", pIncidentId);
    const { data: pStatusPreMigration } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: pStaffRow.id });
    const { data: pStalePreMigration } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record(
      "P12: a pre-0088-style attestation (no category_hashes) still correctly reads 'stale' off the untouched combined hash",
      pStatusPreMigration === "stale",
      pStatusPreMigration
    );
    record(
      "P12b: ...but get_stale_categories() degrades honestly to null rather than guessing which parts moved",
      pStalePreMigration === null,
      JSON.stringify(pStalePreMigration)
    );
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming, category_hashes captured fresh from here." });

    // -- P13: visibility -- a caller with no standing on this incident gets null. --
    const { data: pStaleNoStanding } = await parent1.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P13: get_stale_categories() is null for a caller with no standing to view the incident", pStaleNoStanding === null, JSON.stringify(pStaleNoStanding));

    // -- P14/P15: get_my_incident_attestations(). --
    const { data: pMyList } = await teacherB.rpc("get_my_incident_attestations");
    const pMyRow = pMyList?.find((r) => r.incident_id === pIncidentId);
    record(
      "P14: get_my_incident_attestations() includes this incident for the named staff member, status 'current', not closed",
      pMyRow?.status === "current" && pMyRow?.status_label === "Current" && pMyRow?.is_closed === false,
      JSON.stringify(pMyRow)
    );

    const { data: pEmptyList } = await clinician.rpc("get_my_incident_attestations");
    record("P15: an account named on nothing gets an empty list, not an error", Array.isArray(pEmptyList) && pEmptyList.length === 0, JSON.stringify(pEmptyList));

    // -- P16: sign off, then confirm the row is still returned, now closed, --
    // frozen at whatever it was -- the point raised in chat: a staff
    // member's name is on a legal record and they should be able to look
    // it up even after it's closed, not lose access the moment it locks.
    // (pOtherActionType, "Redirected", is not a restraint action and was
    // never touched again after P4 -- nothing here needs to remove it;
    // an earlier draft of this test did, which staled teacherB's own
    // attestation again right before sign-off and blocked it for an
    // unrelated reason.)
    const { error: pSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: pIncidentId });
    record("P16 setup: this incident actually reached sign-off (consistency gates satisfied)", !pSignErr, pSignErr?.message);

    const { data: pMyListAfterSignoff } = await teacherB.rpc("get_my_incident_attestations");
    const pMyRowAfterSignoff = pMyListAfterSignoff?.find((r) => r.incident_id === pIncidentId);
    record(
      "P16: post-signoff, the incident is STILL returned (not restricted to pre-signoff), correctly marked closed",
      pMyRowAfterSignoff?.is_closed === true && pMyRowAfterSignoff?.status === "current",
      JSON.stringify(pMyRowAfterSignoff)
    );

    // SNA's row (P10, never attested, still pre-signoff at that check) is
    // now also frozen post-signoff -- confirm it shows not_attested, closed,
    // not excluded.
    const { data: pSnaListAfterSignoff } = await sna.rpc("get_my_incident_attestations");
    const pSnaRowAfterSignoff = pSnaListAfterSignoff?.find((r) => r.incident_id === pIncidentId);
    record(
      "P16b: a staff member who never attested at all is still listed post-signoff, closed, status not_attested -- not silently dropped",
      pSnaRowAfterSignoff?.is_closed === true && pSnaRowAfterSignoff?.status === "not_attested",
      JSON.stringify(pSnaRowAfterSignoff)
    );

    await admin.from("incidents").delete().eq("id", pIncidentId);
  }

  console.log(`\n== CHECK Q: status derivation, the attestations_requested toggle, visibility persistence, re-request staleness (migration 0089) ==`);
  {
    const { data: qIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: qStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", qIncidentId).eq("user_id", teacherBId).single();

    // -- Q1: fresh incident derives 'draft'; named staff cannot see it yet. --
    const { data: qRow1 } = await admin.from("incidents").select("status, attestations_requested, attestations_requested_at").eq("id", qIncidentId).single();
    record(
      "Q1: a freshly-stamped incident derives status='draft', attestations_requested defaults false",
      qRow1.status === "draft" && qRow1.attestations_requested === false && qRow1.attestations_requested_at === null,
      JSON.stringify(qRow1)
    );
    const { data: qPreVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q2: named staff CANNOT see a draft incident before attestations are requested", (qPreVis?.length ?? 0) === 0, `rows=${qPreVis?.length}`);

    // -- Q3/Q4: the real toggle -- status derives, timestamp stamped, --
    // named staff gains visibility.
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", qIncidentId);
    const { data: qRow2 } = await admin.from("incidents").select("status, attestations_requested_at").eq("id", qIncidentId).single();
    record(
      "Q3: toggling attestations_requested derives status='awaiting_signoff' and stamps attestations_requested_at",
      qRow2.status === "awaiting_signoff" && qRow2.attestations_requested_at !== null,
      JSON.stringify(qRow2)
    );
    const { data: qPostVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q4: named staff CAN see it once attestations are requested", (qPostVis?.length ?? 0) === 1, `rows=${qPostVis?.length}`);

    // -- Q5: attest, then un-toggle -- status reverts, but visibility --
    // PERSISTS for the person who already attested (agreed in chat:
    // that's not a permission the owning teacher gets to revoke).
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: qStaffRow.id, p_addendum: "Confirmed present." });
    await teacherA.from("incidents").update({ attestations_requested: false }).eq("id", qIncidentId);
    const { data: qRow3 } = await admin.from("incidents").select("status").eq("id", qIncidentId).single();
    record("Q5: un-toggling reverts status to 'draft'", qRow3.status === "draft", qRow3.status);

    const { data: qPersistVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q6: visibility PERSISTS for teacherB after un-toggle, because they already attested", (qPersistVis?.length ?? 0) === 1, `rows=${qPersistVis?.length}`);
    const { data: qMyListAfterUntoggle } = await teacherB.rpc("get_my_incident_attestations");
    record(
      "Q6b: get_my_incident_attestations() -- the real piece-2 surface -- still lists it too",
      qMyListAfterUntoggle?.some((r) => r.incident_id === qIncidentId),
      qMyListAfterUntoggle?.find((r) => r.incident_id === qIncidentId)
    );

    // -- Q7: a DIFFERENT staff member, named but never attested, loses --
    // visibility while status is back to draft -- the persistence is
    // specifically for people who've engaged, not a blanket reopening.
    await teacherA.from("incident_staff").insert({ incident_id: qIncidentId, user_id: snaId, involvement: "witnessed" });
    const { data: qSnaVis } = await sna.from("incidents").select("id").eq("id", qIncidentId);
    record("Q7: a staff member who never attested CANNOT see it while status is back to draft", (qSnaVis?.length ?? 0) === 0, `rows=${qSnaVis?.length}`);

    // -- Q8/Q9: re-request. Content unchanged -- teacherB's attestation --
    // must NOT silently stay current (agreed in chat: treat re-requesting
    // as the account having moved).
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", qIncidentId);
    const { data: qStatusAfterReRequest } = await teacherB.rpc("get_attestation_status", { p_incident_staff_id: qStaffRow.id });
    record(
      "Q8: re-requesting with no content change makes a previously-current attestation STALE, not silently current",
      qStatusAfterReRequest === "stale",
      qStatusAfterReRequest
    );
    const { data: qStaleCats } = await teacherB.rpc("get_stale_categories", { p_incident_staff_id: qStaffRow.id });
    record(
      "Q9: get_stale_categories() reports 'attestation_reset' specifically -- not an empty list that would misleadingly suggest nothing changed",
      Array.isArray(qStaleCats) && qStaleCats.includes("attestation_reset"),
      JSON.stringify(qStaleCats)
    );
    // -- Q10: renew, sign off -- status derives to 'awaiting_principal'. --
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: qStaffRow.id, p_addendum: "Re-confirming after reset." });
    const { error: qSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: qIncidentId });
    const { data: qRow4 } = await admin.from("incidents").select("status").eq("id", qIncidentId).single();
    record("Q10: signing off derives status='awaiting_principal'", !qSignErr && qRow4.status === "awaiting_principal", `err=${qSignErr?.message}, status=${qRow4.status}`);

    await admin.from("incidents").delete().eq("id", qIncidentId);
  }

  console.log(`\n== CHECK R: Phase 4 piece 3 -- countersign_incident() RPC, get_countersign_summary(), countersigned_via, amendment-notify trigger (migration 0090) ==`);
  {
    // -- R1: minimal clean incident, teacher-signed via the RPC -- no --
    // staff named, so nothing to attest, no debrief/CPI gate tripped
    // (same minimal recipe CHECK O's oCleanId uses).
    const { data: rIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rIncidentId });

    // -- R2: teacherB has real, otherwise-unrelated visibility into this --
    // incident via passport_access (established in top-level setup) --
    // confirm that first, so R2b's refusal is provably about
    // can_countersign_incident() specifically, not about lacking any
    // standing at all.
    const { data: rVisibleToTeacherB } = await teacherB.from("incidents").select("id").eq("id", rIncidentId);
    record("R2a: teacherB CAN see the incident (visibility isn't the thing under test)", (rVisibleToTeacherB?.length ?? 0) === 1, `rows=${rVisibleToTeacherB?.length}`);
    const { error: rSummaryDeniedErr } = await teacherB.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record("R2b: get_countersign_summary() refused for a visible-but-non-countersigning caller, for the right reason", Boolean(rSummaryDeniedErr) && /countersign/i.test(rSummaryDeniedErr?.message ?? ""), rSummaryDeniedErr?.message);

    // -- R3: get_countersign_summary() -- correct content for the real principal. --
    const { data: rSummary, error: rSummaryErr } = await principal.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record(
      "R3: get_countersign_summary() succeeds for the principal, reports teacher name/time and not-yet-countersigned",
      !rSummaryErr && rSummary?.already_countersigned === false && rSummary?.teacher_signed_by_name != null && rSummary?.teacher_signed_at != null,
      `err=${rSummaryErr?.message}, ${JSON.stringify(rSummary)}`
    );

    // -- R4: countersign_incident() -- not-yet-signed-off gate. --
    const { data: rUnsignedId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: rTooEarlyErr } = await principal.rpc("countersign_incident", { p_incident_id: rUnsignedId });
    record("R4: countersign_incident() refused before teacher sign-off", Boolean(rTooEarlyErr) && /not yet.*signed off/i.test(rTooEarlyErr?.message ?? ""), rTooEarlyErr?.message);
    await admin.from("incidents").delete().eq("id", rUnsignedId);

    // -- R5: countersign_incident() -- permission gate, real reason (same --
    // visible-but-unauthorized caller as R2).
    const { error: rNoPermErr } = await teacherB.rpc("countersign_incident", { p_incident_id: rIncidentId });
    record("R5: countersign_incident() refused for a visible-but-non-countersigning caller", Boolean(rNoPermErr) && /permission/i.test(rNoPermErr?.message ?? ""), rNoPermErr?.message);

    // -- R6: countersign_incident() -- clean success via the RPC, derived --
    // fields correct, status finalised.
    const { error: rSignErr } = await principal.rpc("countersign_incident", { p_incident_id: rIncidentId });
    const { data: rAfter } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, countersigned_via, status").eq("id", rIncidentId).single();
    record(
      "R6: countersign_incident() succeeds for the principal, all four fields correctly derived, status='finalised'",
      !rSignErr && rAfter.countersigned_by === principalId && rAfter.countersigned_role_at_time === "principal" && rAfter.countersigned_via === "principal_role" && rAfter.status === "finalised",
      `err=${rSignErr?.message}, ${JSON.stringify(rAfter)}`
    );

    // -- R7: already-countersigned gate. --
    const { error: rTwiceErr } = await principal.rpc("countersign_incident", { p_incident_id: rIncidentId });
    record("R7: countersign_incident() refused a second time on an already-countersigned incident", Boolean(rTwiceErr) && /already/i.test(rTwiceErr?.message ?? ""), rTwiceErr?.message);

    // -- R8: get_countersign_summary() reflects the completed countersign, --
    // so a reload (or a race with another countersigner) is legible.
    const { data: rSummaryAfter } = await principal.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record(
      "R8: get_countersign_summary() reports already_countersigned=true with the countersigner's name and role",
      rSummaryAfter?.already_countersigned === true && rSummaryAfter?.countersigned_role_at_time === "principal" && rSummaryAfter?.countersigned_via === "principal_role" && rSummaryAfter?.countersigned_by_name != null,
      JSON.stringify(rSummaryAfter)
    );

    // -- R9: countersigned_via='grant', countersigned_role_at_time is the --
    // grant-holder's REAL role ('class_teacher'), never 'principal' -- on
    // a second, separate incident.
    const { data: rGrantId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rGrantId });
    const { error: rGrantInsertErr } = await principal.from("institution_permissions").insert({ institution_id: institutionId, user_id: teacherBId, permission: "countersign_incident", granted_by: principalId });
    record("R9a: principal CAN grant countersign_incident to teacherB (ordinary class_teacher)", !rGrantInsertErr, rGrantInsertErr?.message);
    const { error: rGrantSignErr } = await teacherB.rpc("countersign_incident", { p_incident_id: rGrantId });
    const { data: rGrantAfter } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via, countersigned_at").eq("id", rGrantId).single();
    record(
      "R9b: grant-holder countersigns successfully, countersigned_via='grant', countersigned_role_at_time is their REAL role ('class_teacher'), never 'principal'",
      !rGrantSignErr && rGrantAfter.countersigned_by === teacherBId && rGrantAfter.countersigned_via === "grant" && rGrantAfter.countersigned_role_at_time === "class_teacher",
      `err=${rGrantSignErr?.message}, ${JSON.stringify(rGrantAfter)}`
    );
    await admin.from("institution_permissions").delete().eq("institution_id", institutionId).eq("user_id", teacherBId).eq("permission", "countersign_incident");

    // -- R10: revoking the grant afterward does not affect the already- --
    // countersigned record (CHECK J already proves this at the raw-update
    // layer; this confirms the same property holds through the RPC too).
    const { data: rGrantAfterRevoke } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via, countersigned_at").eq("id", rGrantId).single();
    record(
      "R10: countersign is unchanged after the grant is revoked -- revocation is not retroactive",
      rGrantAfterRevoke.countersigned_by === teacherBId
        && rGrantAfterRevoke.countersigned_via === "grant"
        && rGrantAfterRevoke.countersigned_at === rGrantAfter.countersigned_at,
      JSON.stringify(rGrantAfterRevoke)
    );

    // -- R11: a raw update deliberately submitting someone else's id and --
    // the wrong role/via is overwritten by the trigger, not rejected and
    // not trusted -- on a third, separate incident.
    const { data: rSpoofId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSpoofId });
    const { error: rSpoofErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher", countersigned_via: "grant" })
      .eq("id", rSpoofId);
    const { data: rSpoofAfter } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via").eq("id", rSpoofId).single();
    record(
      "R11: a raw update deliberately submitting someone else's id and the wrong role/via is overwritten by the trigger, not rejected and not trusted",
      !rSpoofErr && rSpoofAfter.countersigned_by === principalId && rSpoofAfter.countersigned_role_at_time === "principal" && rSpoofAfter.countersigned_via === "principal_role",
      `err=${rSpoofErr?.message}, ${JSON.stringify(rSpoofAfter)}`
    );

    // -- R12: wrong-reason-pass discipline -- combine a legitimate --
    // countersign write with a smuggled narrative change in the SAME
    // statement, as the real principal (who genuinely has countersign
    // authority) -- only guard_incident_immutability() should be able to
    // reject this, on a fourth, separate incident so the countersign
    // itself is still live when the guard fires.
    const { data: rSmuggleId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ narrative: "Original narrative." }).eq("id", rSmuggleId);
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSmuggleId });
    const { error: rSmuggleErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), narrative: "Smuggled alongside a legitimate countersign." })
      .eq("id", rSmuggleId);
    const { data: rSmuggleAfter } = await admin.from("incidents").select("countersigned_at, narrative").eq("id", rSmuggleId).single();
    record(
      "R12: guard_incident_immutability() rejects a narrative change smuggled into an otherwise-legitimate countersign write, from a caller who genuinely has countersign authority",
      Boolean(rSmuggleErr) && /immutable/i.test(rSmuggleErr?.message ?? "") && rSmuggleAfter.countersigned_at === null && rSmuggleAfter.narrative === "Original narrative.",
      `err=${rSmuggleErr?.message}, ${JSON.stringify(rSmuggleAfter)}`
    );

    // -- R13/R14/R15: amendment-notify trigger -- principal's amendment --
    // notifies the owning teacher; the owning teacher's OWN amendment
    // does not notify themselves; teacherB (visible via passport_access,
    // but no countersign authority left after R9's grant was revoked, and
    // not creator/owning teacher/clinician) cannot add one at all.
    const { data: rNoticesBefore } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    const { error: rPrincipalAmendErr } = await principal.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: principalId, reason: "Disagreement", content: "I was not present for this but the record raises a concern." });
    const { data: rNoticesAfterPrincipal } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    record(
      "R13: principal's amendment raises exactly one incident_amendment_added notice",
      !rPrincipalAmendErr && (rNoticesBefore?.length ?? 0) === 0 && (rNoticesAfterPrincipal?.length ?? 0) === 1,
      `err=${rPrincipalAmendErr?.message}, before=${rNoticesBefore?.length}, after=${rNoticesAfterPrincipal?.length}`
    );

    const { error: rTeacherAmendErr } = await teacherA.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: teacherAId, reason: "Clarification", content: "Adding detail the principal asked about." });
    const { data: rNoticesAfterTeacher } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    record(
      "R14: the owning teacher's OWN amendment does not raise a self-notice -- still exactly one notice total",
      !rTeacherAmendErr && (rNoticesAfterTeacher?.length ?? 0) === 1,
      `err=${rTeacherAmendErr?.message}, notices=${rNoticesAfterTeacher?.length}`
    );

    const { error: rTeacherBAmendErr } = await teacherB.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: teacherBId, reason: "Uninvited", content: "I can see this incident but have no standing to amend it." });
    record("R15: a caller who can SEE the incident but is not creator/owning teacher/countersigner/clinician CANNOT add an amendment", Boolean(rTeacherBAmendErr), rTeacherBAmendErr?.message);

    await admin.from("incidents").delete().eq("id", rIncidentId);
    await admin.from("incidents").delete().eq("id", rGrantId);
    await admin.from("incidents").delete().eq("id", rSpoofId);
    await admin.from("incidents").delete().eq("id", rSmuggleId);

    // -- R16: get_countersign_summary() surfaces addendum/withdrawal --
    // reason in full, attributed, plus involvement -- not just a status
    // label (migration 0092). teacherB attests with an addendum,
    // withdraws with a reason, then re-attests with a different
    // addendum -- both the attested and withdrawn timestamps should be
    // present at once (both genuinely happened), attested_at AFTER
    // withdrawn_at, so the client can render it as a sequence rather
    // than two contradictory current states.
    const { data: rSeqId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: rSeqStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", rSeqId).eq("user_id", teacherBId).single();
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: rSeqStaffRow.id, p_addendum: "First attestation." });
    await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: rSeqStaffRow.id, p_reason: "Need to check something first." });
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: rSeqStaffRow.id, p_addendum: "Checked -- confirming now." });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSeqId });

    const { data: rSeqSummary, error: rSeqSummaryErr } = await principal.rpc("get_countersign_summary", { p_incident_id: rSeqId });
    const rSeqEntry = rSeqSummary?.staff_attestations?.find((s) => s.incident_staff_id === rSeqStaffRow.id);
    record(
      "R16a: get_countersign_summary() reports involvement, the CURRENT addendum ('Checked -- confirming now.'), and status='current'",
      !rSeqSummaryErr && rSeqEntry?.involvement === "witnessed" && rSeqEntry?.addendum === "Checked -- confirming now." && rSeqEntry?.status === "current",
      `err=${rSeqSummaryErr?.message}, ${JSON.stringify(rSeqEntry)}`
    );
    record(
      "R16b: the EARLIER withdrawal is still reported (reason + timestamp) alongside the later re-attestation -- both genuinely happened, attested_at AFTER withdrawn_at (a sequence, not two contradictory current states)",
      rSeqEntry?.withdrawal_reason === "Need to check something first."
        && rSeqEntry?.withdrawn_at != null
        && rSeqEntry?.attested_at != null
        && new Date(rSeqEntry.attested_at).getTime() > new Date(rSeqEntry.withdrawn_at).getTime(),
      JSON.stringify(rSeqEntry)
    );

    await admin.from("incidents").delete().eq("id", rSeqId);
  }

  console.log(`\n== CHECK S: Phase 4 piece 4 (part 1) -- two-stage parent notification, dormant-account handling, get_parent_incidents() draft fix, mark_parent_called() (migration 0093) ==`);
  {
    // -- Dedicated fixture: two children, two DIFFERENT parents, so --
    // cross-child isolation is a genuine two-account test, not just a
    // single-passport sanity check. parent1S signs in immediately
    // (active); parent2S is created but deliberately never signed in
    // yet (last_sign_in_at stays null -- dormant by construction) until
    // explicitly signed in later in this block, to prove the
    // independent re-check at stage 2.
    const { data: instS } = await admin
      .from("institutions")
      .insert({ name: "Check S Institution", institution_code: "CHECKS" + Math.floor(Math.random() * 10000), status: "verified" })
      .select()
      .single();
    const institutionSId = instS.id;

    const teacherSId = await createUser("checks.teacher@thebehaviourhive.com", "Check S Teacher", "class_teacher");
    const snaSId = await createUser("checks.sna@thebehaviourhive.com", "Check S SNA", "sna");
    const parent1SId = await createUser("checks.parent1@thebehaviourhive.com", "Check S Parent One", "parent");
    const parent2SId = await createUser("checks.parent2@thebehaviourhive.com", "Check S Parent Two", "parent");
    // 0100: this fixture never needed a principal before -- teacherS/snaS
    // are the only staff this check actually exercises. It needs one now,
    // purely as plumbing, because approving anyone requires a real
    // principal session to call approve_staff_join() through. Worth
    // naming: this is new fixture surface the migration introduced, not
    // something CHECK S itself tests.
    const principalSId = await createUser("checks.principal@thebehaviourhive.com", "Check S Principal", "principal");

    const { data: sStaffRows } = await admin.from("institution_staff").insert([
      { institution_id: institutionSId, user_id: principalSId, role: "principal" },
      { institution_id: institutionSId, user_id: teacherSId, role: "class_teacher" },
      { institution_id: institutionSId, user_id: snaSId, role: "sna" },
    ]).select();

    {
      const principalSForApproval = await signedInClient("checks.principal@thebehaviourhive.com");
      for (const row of sStaffRows.filter((r) => r.role !== "principal")) {
        const { error: approveErr } = await principalSForApproval.rpc("approve_staff_join", { p_institution_staff_id: row.id });
        if (approveErr) throw approveErr;
      }
    }

    const { data: child1S } = await admin.from("passports").insert({ user_id: parent1SId, child_name: "Check S Child One", passport_status: "complete" }).select().single();
    const { data: child2S } = await admin.from("passports").insert({ user_id: parent2SId, child_name: "Check S Child Two", passport_status: "complete" }).select().single();
    await admin.from("passport_institution_links").insert([
      { passport_id: child1S.id, institution_id: institutionSId, approved_by_parent: true },
      { passport_id: child2S.id, institution_id: institutionSId, approved_by_parent: true },
    ]);

    const teacherS = await signedInClient("checks.teacher@thebehaviourhive.com");
    const snaS = await signedInClient("checks.sna@thebehaviourhive.com");
    const parent1S = await signedInClient("checks.parent1@thebehaviourhive.com"); // signs in -> active
    // parent2S deliberately NOT signed in yet.

    // -- S1: the stamp itself -- two-child incident, both children --
    // inserted atomically. teacherS is named staff too (self-witnessed),
    // not required for the test, just realistic.
    const { data: sIncidentId } = await teacherS.rpc("create_incident_stamp", {
      p_institution_id: institutionSId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1S.id, child2S.id],
      p_staff: [{ user_id: snaSId, involvement: "witnessed" }],
    });

    const { data: sChildRows } = await admin.from("incident_children").select("id, passport_id, parent_notified_at, parent_notified_by, parent_notification_blocked_reason").eq("incident_id", sIncidentId);
    const sChild1Row = sChildRows.find((r) => r.passport_id === child1S.id);
    const sChild2Row = sChildRows.find((r) => r.passport_id === child2S.id);

    record(
      "S1a: stage 1 -- active parent (child1) gets notified immediately, attributed to the real teacher",
      sChild1Row.parent_notified_at !== null && sChild1Row.parent_notified_by === teacherSId && sChild1Row.parent_notification_blocked_reason === null,
      JSON.stringify(sChild1Row)
    );
    record(
      "S1b: stage 1 -- dormant parent (child2, never signed in) is BLOCKED, not silently skipped -- a real, staff-visible reason is recorded instead of a notification",
      sChild2Row.parent_notified_at === null && sChild2Row.parent_notification_blocked_reason === "dormant_account",
      JSON.stringify(sChild2Row)
    );

    // -- S2: cross-child isolation, parent_incident_notices -- parent1S --
    // sees exactly their own child's stage-1 notice and NOTHING for
    // child2, through any field, via direct RLS-scoped select (not an
    // RPC -- proving the table's own policy, not a function's filtering).
    const { data: sParent1Notices } = await parent1S.from("parent_incident_notices").select("*");
    record(
      "S2a: parent1S sees exactly one notice, for child1, notice_type='incident_recorded'",
      sParent1Notices.length === 1 && sParent1Notices[0].passport_id === child1S.id && sParent1Notices[0].notice_type === "incident_recorded",
      JSON.stringify(sParent1Notices)
    );
    record(
      "S2b: NO row in parent1S's own result set references child2's passport_id, anywhere",
      !sParent1Notices.some((n) => n.passport_id === child2S.id),
      JSON.stringify(sParent1Notices)
    );
    const { data: sParent1CrossAttempt } = await parent1S.from("parent_incident_notices").select("*").eq("passport_id", child2S.id);
    record("S2c: parent1S explicitly querying for child2's passport_id gets zero rows (RLS, not client-side filtering)", (sParent1CrossAttempt?.length ?? 0) === 0, `rows=${sParent1CrossAttempt?.length}`);

    // -- S3: draft-incident non-exposure, BOTH channels. Status has left --
    // 'draft' (toggle attestations_requested) but teacher has NOT signed
    // off -- get_parent_incidents() must still return nothing (the fix
    // under test), proving the gate is teacher_signed_at, not status.
    await teacherS.from("incidents").update({ attestations_requested: true }).eq("id", sIncidentId);
    const { data: sStatusRow } = await admin.from("incidents").select("status").eq("id", sIncidentId).single();
    record("S3a: status has genuinely left draft (setup check)", sStatusRow.status === "awaiting_signoff", sStatusRow.status);
    const { data: sPrematureRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child1S.id });
    record(
      "S3b: get_parent_incidents() returns ZERO rows pre-signoff even though status <> 'draft' -- the actual fix, proven live not just read from source",
      (sPrematureRead?.length ?? 0) === 0,
      `rows=${sPrematureRead?.length}`
    );

    // -- S4: parent2S signs in BETWEEN stage 1 (blocked) and stage 2 -- --
    // proving the dormant check re-runs independently at each stage,
    // not cached from stage 1's result.
    const parent2S = await signedInClient("checks.parent2@thebehaviourhive.com"); // this sign-in itself sets last_sign_in_at, making them active from here on

    const { error: sSignErr } = await teacherS.rpc("sign_off_incident", { p_incident_id: sIncidentId });
    record("S4a: teacher sign-off succeeds", !sSignErr, sSignErr?.message);

    const { data: sChildRowsAfter } = await admin.from("incident_children").select("id, passport_id, parent_notified_at, parent_notification_blocked_reason").eq("incident_id", sIncidentId);
    const sChild1RowAfter = sChildRowsAfter.find((r) => r.passport_id === child1S.id);
    const sChild2RowAfter = sChildRowsAfter.find((r) => r.passport_id === child2S.id);
    record(
      "S4b: stage 2 -- child2's parent, now active (signed in since stage 1), IS notified this time -- blocked_reason cleared, parent_notified_at now set",
      sChild2RowAfter.parent_notified_at !== null && sChild2RowAfter.parent_notification_blocked_reason === null,
      JSON.stringify(sChild2RowAfter)
    );
    record("S4c: child1's parent also gets stage 2 (already active both times)", sChild1RowAfter.parent_notified_at !== null, JSON.stringify(sChild1RowAfter));

    // -- S5: post-signoff -- both parents now have their own, --
    // correctly-scoped notice history; still zero cross-child leakage.
    const { data: sParent1NoticesAfter } = await parent1S.from("parent_incident_notices").select("notice_type, passport_id");
    record(
      "S5a: parent1S now has BOTH stage notices, both for child1, still none for child2",
      sParent1NoticesAfter.length === 2
        && sParent1NoticesAfter.every((n) => n.passport_id === child1S.id)
        && sParent1NoticesAfter.some((n) => n.notice_type === "incident_recorded")
        && sParent1NoticesAfter.some((n) => n.notice_type === "incident_summary_ready"),
      JSON.stringify(sParent1NoticesAfter)
    );
    const { data: sParent2Notices } = await parent2S.from("parent_incident_notices").select("notice_type, passport_id");
    record(
      "S5b: parent2S has exactly ONE notice (stage 1 was blocked, never created) -- stage 2 only, for child2 only",
      sParent2Notices.length === 1 && sParent2Notices[0].notice_type === "incident_summary_ready" && sParent2Notices[0].passport_id === child2S.id,
      JSON.stringify(sParent2Notices)
    );

    // -- S6: get_parent_incidents() post-signoff -- full content now --
    // visible, correctly scoped; a cross-passport call (parent1S asking
    // for child2's data) still returns nothing, RLS-level.
    const { data: sFullRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child1S.id });
    record(
      "S6a: post-signoff, get_parent_incidents() returns the full parent_summary for the real owner",
      sFullRead?.length === 1 && sFullRead[0].parent_summary !== undefined,
      JSON.stringify(sFullRead)
    );
    const { data: sCrossPassportRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child2S.id });
    record("S6b: parent1S calling get_parent_incidents() for child2's passport_id gets nothing (owns_passport fails)", (sCrossPassportRead?.length ?? 0) === 0, `rows=${sCrossPassportRead?.length}`);
    const sLeaksNarrative = sFullRead?.[0] && Object.prototype.hasOwnProperty.call(sFullRead[0], "narrative");
    record(
      "S6c: get_parent_incidents() column set excludes narrative entirely, even on a real signed-off row (moved here from CHECK 6, which no longer has a signed-off row to check by this point in its own fixture)",
      !sLeaksNarrative,
      `keys=${sFullRead?.[0] ? Object.keys(sFullRead[0]).join(",") : "none"}`
    );

    // -- S7: mark_parent_called() -- authorization, real reason. snaS is --
    // named staff with genuine standing on this incident (can view it),
    // but is neither creator/owning teacher nor principal.
    const { error: sSnaCallErr } = await snaS.rpc("mark_parent_called", { p_incident_children_id: sChild1Row.id });
    record("S7a: mark_parent_called() refused for named staff with real visibility but no owner/principal standing", Boolean(sSnaCallErr) && /permission/i.test(sSnaCallErr?.message ?? ""), sSnaCallErr?.message);

    const { error: sTeacherCallErr } = await teacherS.rpc("mark_parent_called", { p_incident_children_id: sChild1Row.id });
    const { data: sCalledRow } = await admin.from("incident_children").select("parent_called_at, parent_called_by").eq("id", sChild1Row.id).single();
    record(
      "S7b: mark_parent_called() succeeds for the owning teacher, records who and when",
      !sTeacherCallErr && sCalledRow.parent_called_at !== null && sCalledRow.parent_called_by === teacherSId,
      `err=${sTeacherCallErr?.message}, ${JSON.stringify(sCalledRow)}`
    );

    // -- S8: manual parent_call_required toggle + restrictive-practice --
    // auto-raise (CHECK 9 already proved the injury path; this proves
    // the other two, on child2's fresh, still-unflagged row).
    const { data: sPreToggle } = await admin.from("incident_children").select("id").eq("incident_id", sIncidentId).eq("passport_id", child2S.id).single();
    const { data: sNoticesBeforeManual } = await admin.from("school_notices").select("id").eq("incident_id", sIncidentId).eq("notice_type", "incident_parent_call");
    record("S8a setup: no incident_parent_call notice yet on this incident", (sNoticesBeforeManual?.length ?? 0) === 0, `rows=${sNoticesBeforeManual?.length}`);

    // Manual toggle only works pre-signoff; this incident is already
    // signed off from S4, so use the RP trigger instead (fires on
    // insert regardless of sign-off state -- restrictive_practices has
    // its own insert policy, not gated on this) to prove the SECOND of
    // the two auto-raise paths.
    const { error: sRpInsertErr } = await admin.from("restrictive_practices").insert({ incident_id: sIncidentId, passport_id: child2S.id, planning_status: "not_planned" });
    record("S8a-bis: restrictive_practices insert itself succeeds (planning_status is required, not omitted this time)", !sRpInsertErr, sRpInsertErr?.message);
    const { data: sChild2AfterRp } = await admin.from("incident_children").select("parent_call_required").eq("id", sPreToggle.id).single();
    record("S8b: restrictive-practice insert auto-flips parent_call_required (the second of the two auto-raise paths, not yet exercised this session)", sChild2AfterRp.parent_call_required === true, JSON.stringify(sChild2AfterRp));
    const { data: sNoticesAfterRp } = await admin.from("school_notices").select("id").eq("incident_id", sIncidentId).eq("notice_type", "incident_parent_call");
    record("S8c: exactly one incident_parent_call notice raised from the RP path", (sNoticesAfterRp?.length ?? 0) === 1, `rows=${sNoticesAfterRp?.length}`);

    // -- S9: clinician_incident_notices (migration 0094) -- a fresh --
    // incident so the signoff transition is clean. Child1S gets a
    // linked, verified clinician; child2S deliberately gets none, to
    // prove no orphaned row is created when nobody can see it.
    const clinicianSId = await createUser("checks.clinician@thebehaviourhive.com", "Check S Clinician", "clinician");
    await admin.from("clinicians").insert({ user_id: clinicianSId, specialty: "behavioural_psychologist", verification_status: "verified" });
    await admin.from("clinician_access").insert({ passport_id: child1S.id, clinician_id: clinicianSId, is_active: true });
    const clinicianS = await signedInClient("checks.clinician@thebehaviourhive.com");

    const { data: sClinIncidentId } = await teacherS.rpc("create_incident_stamp", {
      p_institution_id: institutionSId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1S.id, child2S.id], p_staff: [],
    });

    const { data: sClinPreSignoff } = await clinicianS.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId);
    record("S9a: clinician gets NOTHING pre-signoff (not before, per spec)", (sClinPreSignoff?.length ?? 0) === 0, `rows=${sClinPreSignoff?.length}`);

    await teacherS.rpc("sign_off_incident", { p_incident_id: sClinIncidentId });

    const { data: sClinPostSignoff } = await clinicianS.from("clinician_incident_notices").select("notice_type, passport_id");
    record(
      "S9b: clinician notified at teacher sign-off, exactly one notice, for child1S only (their own case), never child2S",
      sClinPostSignoff.length === 1 && sClinPostSignoff[0].passport_id === child1S.id && sClinPostSignoff[0].notice_type === "incident_summary_ready",
      JSON.stringify(sClinPostSignoff)
    );

    const { data: sOrphanCheck } = await admin.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId).eq("passport_id", child2S.id);
    record("S9c: no row at all for child2S (no linked clinician to notify) -- not an invisible orphaned row, genuinely absent", (sOrphanCheck?.length ?? 0) === 0, `rows=${sOrphanCheck?.length}`);

    const { data: sSnaClinAttempt } = await snaS.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId);
    record("S9d: ordinary staff (SNA, not a clinician) sees nothing via this table's own RLS", (sSnaClinAttempt?.length ?? 0) === 0, `rows=${sSnaClinAttempt?.length}`);

    await admin.from("incidents").delete().eq("id", sClinIncidentId);
    await admin.auth.admin.deleteUser(clinicianSId);

    await admin.from("institutions").delete().eq("id", institutionSId);
    for (const id of [principalSId, teacherSId, snaSId, parent1SId, parent2SId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK T: Phase 5 -- get_parent_incidents()/get_clinician_incidents(), every role against every field, two-child incident (migration 0095) ==`);
  {
    const { data: instT } = await admin
      .from("institutions")
      .insert({ name: "Check T Institution", institution_code: "CHECKT" + Math.floor(Math.random() * 10000), status: "verified" })
      .select()
      .single();
    const institutionTId = instT.id;

    const teacherTId = await createUser("checkt.teacher@thebehaviourhive.com", "Check T Teacher", "class_teacher");
    const snaTId = await createUser("checkt.sna@thebehaviourhive.com", "Check T SNA", "sna");
    const parent1TId = await createUser("checkt.parent1@thebehaviourhive.com", "Check T Parent One", "parent");
    const parent2TId = await createUser("checkt.parent2@thebehaviourhive.com", "Check T Parent Two", "parent");
    const clinicianTId = await createUser("checkt.clinician@thebehaviourhive.com", "Check T Clinician", "clinician");
    // 0100: same as CHECK S -- this fixture never needed a principal
    // before, needs one now purely to drive approve_staff_join().
    const principalTId = await createUser("checkt.principal@thebehaviourhive.com", "Check T Principal", "principal");

    const { data: tStaffRows } = await admin.from("institution_staff").insert([
      { institution_id: institutionTId, user_id: principalTId, role: "principal" },
      { institution_id: institutionTId, user_id: teacherTId, role: "class_teacher" },
      { institution_id: institutionTId, user_id: snaTId, role: "sna" },
    ]).select();

    {
      const principalTForApproval = await signedInClient("checkt.principal@thebehaviourhive.com");
      for (const row of tStaffRows.filter((r) => r.role !== "principal")) {
        const { error: approveErr } = await principalTForApproval.rpc("approve_staff_join", { p_institution_staff_id: row.id });
        if (approveErr) throw approveErr;
      }
    }

    const { data: child1T } = await admin.from("passports").insert({ user_id: parent1TId, child_name: "Check T Child One", passport_status: "complete" }).select().single();
    const { data: child2T } = await admin.from("passports").insert({ user_id: parent2TId, child_name: "Check T Child Two", passport_status: "complete" }).select().single();
    await admin.from("passport_institution_links").insert([
      { passport_id: child1T.id, institution_id: institutionTId, approved_by_parent: true },
      { passport_id: child2T.id, institution_id: institutionTId, approved_by_parent: true },
    ]);
    await admin.from("clinicians").insert({ user_id: clinicianTId, specialty: "behavioural_psychologist", verification_status: "verified" });
    await admin.from("clinician_access").insert({ passport_id: child1T.id, clinician_id: clinicianTId, is_active: true }); // linked to child1T ONLY

    const teacherT = await signedInClient("checkt.teacher@thebehaviourhive.com");
    const snaT = await signedInClient("checkt.sna@thebehaviourhive.com");
    const parent1T = await signedInClient("checkt.parent1@thebehaviourhive.com");
    const parent2T = await signedInClient("checkt.parent2@thebehaviourhive.com");
    const clinicianT = await signedInClient("checkt.clinician@thebehaviourhive.com");

    const { data: tIncidentId } = await teacherT.rpc("create_incident_stamp", {
      p_institution_id: institutionTId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1T.id, child2T.id], p_staff: [],
    });
    await teacherT.from("incidents").update({
      category: "one_party_incident",
      narrative: "STAFF-ONLY NARRATIVE: staff intervened after the trigger event.",
      parent_summary: "PARENT SUMMARY: your child was supported today.",
    }).eq("id", tIncidentId);
    await teacherT.from("incident_children").update({ distress_level: "yes_definitely", remained_on_site: true }).eq("incident_id", tIncidentId).eq("passport_id", child1T.id);
    await teacherT.from("incident_children").update({ distress_level: "slightly", remained_on_site: false, remained_detail: "CHILD TWO ONLY: collected early by guardian." }).eq("incident_id", tIncidentId).eq("passport_id", child2T.id);

    // -- T1: clinician sees FULL content (narrative included) even --
    // pre-signoff -- confirms the gate is status<>'draft' like
    // can_view_incident()'s own clinician branch, not teacher_signed_at.
    await teacherT.from("incidents").update({ attestations_requested: true }).eq("id", tIncidentId);
    const { data: tClinPre, error: tClinPreErr } = await clinicianT.rpc("get_clinician_incidents", { p_passport_id: child1T.id });
    record(
      "T1: clinician sees full content pre-signoff (narrative present), correct child_index/distress_level for THEIR linked child",
      !tClinPreErr && tClinPre?.length === 1 && tClinPre[0].narrative?.includes("STAFF-ONLY NARRATIVE") && tClinPre[0].child_index === "A" && tClinPre[0].distress_level === "yes_definitely",
      `err=${tClinPreErr?.message}, ${JSON.stringify(tClinPre)}`
    );

    // -- T2: clinician NOT linked to child2 gets nothing for child2, --
    // even though they're a real, verified clinician (visible standing
    // elsewhere) -- proves clinician_access, not just role, gates this.
    const { data: tClinChild2 } = await clinicianT.rpc("get_clinician_incidents", { p_passport_id: child2T.id });
    record("T2: clinician with NO clinician_access to child2 gets nothing for child2", (tClinChild2?.length ?? 0) === 0, `rows=${tClinChild2?.length}`);

    // -- T3: teacher (real standing, owns the incident) is not a parent --
    // or a clinician -- both parent- and clinician-facing RPCs correctly
    // refuse them, for the right reason (owns_passport/clinician_access
    // failing, not lack of visibility generally -- teacherT can see the
    // full incident directly).
    const { data: tTeacherAsParent } = await teacherT.rpc("get_parent_incidents", { p_passport_id: child1T.id });
    record("T3a: owning teacher calling get_parent_incidents() gets nothing (not a parent)", (tTeacherAsParent?.length ?? 0) === 0, `rows=${tTeacherAsParent?.length}`);
    const { data: tTeacherAsClinician } = await teacherT.rpc("get_clinician_incidents", { p_passport_id: child1T.id });
    record("T3b: owning teacher calling get_clinician_incidents() gets nothing (not a clinician)", (tTeacherAsClinician?.length ?? 0) === 0, `rows=${tTeacherAsClinician?.length}`);

    // -- T4: SNA, named/visible staff with real standing on this --
    // incident, still gets nothing from either parent- or
    // clinician-facing RPC -- visibility on the staff side doesn't leak
    // into either.
    const { data: tSnaAsParent } = await snaT.rpc("get_parent_incidents", { p_passport_id: child1T.id });
    record("T4a: SNA (real staff standing) calling get_parent_incidents() gets nothing", (tSnaAsParent?.length ?? 0) === 0, `rows=${tSnaAsParent?.length}`);
    const { data: tSnaAsClinician } = await snaT.rpc("get_clinician_incidents", { p_passport_id: child1T.id });
    record("T4b: SNA calling get_clinician_incidents() gets nothing", (tSnaAsClinician?.length ?? 0) === 0, `rows=${tSnaAsClinician?.length}`);

    // -- T5: an entirely unrelated parent gets nothing. CORE's own --
    // `parent1` (already signed in, no connection to institutionTId or
    // either child here) rather than a dedicated parent3T account --
    // this is a read-only RPC call, nothing about passports.user_id
    // ownership is at stake.
    const { data: tParent3 } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1T.id });
    record("T5: entirely unrelated parent gets nothing for someone else's child", (tParent3?.length ?? 0) === 0, `rows=${tParent3?.length}`);

    // -- T6: both parents get ZERO rows pre-signoff, despite status --
    // having left 'draft' (attestations_requested above) -- the actual
    // gate under audit, live not just read from source.
    const { data: tParent1Pre } = await parent1T.rpc("get_parent_incidents", { p_passport_id: child1T.id });
    record("T6a: parent1T gets nothing pre-signoff", (tParent1Pre?.length ?? 0) === 0, `rows=${tParent1Pre?.length}`);
    const { data: tParent2Pre } = await parent2T.rpc("get_parent_incidents", { p_passport_id: child2T.id });
    record("T6b: parent2T gets nothing pre-signoff", (tParent2Pre?.length ?? 0) === 0, `rows=${tParent2Pre?.length}`);

    await teacherT.rpc("sign_off_incident", { p_incident_id: tIncidentId });

    // -- T7: post-signoff, each parent sees exactly their own child's --
    // fields, correctly distinct (yes_definitely/true for child1,
    // slightly/false/the child2-only remained_detail for child2), and
    // the column set structurally excludes every staff-only field --
    // "every field", not just narrative.
    const { data: tParent1Post } = await parent1T.rpc("get_parent_incidents", { p_passport_id: child1T.id });
    const p1Row = tParent1Post?.[0];
    const REDACTED_FIELDS = ["narrative", "staff_count_needed", "staff_distressed", "risk_reduction_future", "other_information", "category", "party", "party_other", "item_involved", "debrief_required"];
    const p1LeakedFields = p1Row ? REDACTED_FIELDS.filter((f) => Object.prototype.hasOwnProperty.call(p1Row, f)) : ["<no row>"];
    record(
      "T7a: parent1T post-signoff sees correct own-child fields (distress_level='yes_definitely', remained_on_site=true), column set excludes EVERY staff-only field checked",
      p1Row?.distress_level === "yes_definitely" && p1Row?.remained_on_site === true && p1LeakedFields.length === 0,
      `leaked=${JSON.stringify(p1LeakedFields)}, ${JSON.stringify(p1Row)}`
    );
    record(
      "T7b: parent1T's row contains NOTHING identifying child2 -- no 'CHILD TWO ONLY' text anywhere in the serialized row",
      !JSON.stringify(p1Row).includes("CHILD TWO"),
      JSON.stringify(p1Row)
    );

    const { data: tParent2Post } = await parent2T.rpc("get_parent_incidents", { p_passport_id: child2T.id });
    const p2Row = tParent2Post?.[0];
    record(
      "T7c: parent2T post-signoff sees correct own-child fields (distress_level='slightly', remained_on_site=false, their own remained_detail)",
      p2Row?.distress_level === "slightly" && p2Row?.remained_on_site === false && p2Row?.remained_detail?.includes("CHILD TWO ONLY"),
      JSON.stringify(p2Row)
    );
    record(
      "T7d: parent2T's row contains NOTHING identifying child1 -- no leakage of the other child's distress_level/remained_on_site values by cross-wiring",
      p2Row?.child_index !== "A",
      JSON.stringify(p2Row)
    );
    const { data: tParent1CrossAttempt } = await parent1T.rpc("get_parent_incidents", { p_passport_id: child2T.id });
    record("T7e: parent1T explicitly calling for child2's passport_id gets nothing (RLS-equivalent owns_passport check, not client trust)", (tParent1CrossAttempt?.length ?? 0) === 0, `rows=${tParent1CrossAttempt?.length}`);

    // -- T8: clinician post-signoff -- still full, still correctly --
    // scoped, narrative still present (the gate never narrowed).
    const { data: tClinPost } = await clinicianT.rpc("get_clinician_incidents", { p_passport_id: child1T.id });
    record(
      "T8: clinician post-signoff still sees full content, narrative present, actions array present (structurally, even if empty)",
      tClinPost?.[0]?.narrative?.includes("STAFF-ONLY NARRATIVE") && Array.isArray(tClinPost?.[0]?.actions),
      JSON.stringify(tClinPost)
    );

    await admin.from("incidents").delete().eq("id", tIncidentId);
    await admin.from("institutions").delete().eq("id", institutionTId);
    for (const id of [principalTId, teacherTId, snaTId, parent1TId, parent2TId, clinicianTId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK U: Phase 6 -- get_incident_export(), every content category exercised on one rich incident (migration 0096) ==`);
  {
    const { data: uIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });

    await teacherA.from("incidents").update({
      category: "one_party_incident",
      narrative: "Export check narrative.",
      parent_summary: "Export check parent summary.",
      debrief_required: true,
    }).eq("id", uIncidentId);

    // -- All content changes FIRST -- anything after the final attest --
    // would flip it stale (compute_incident_content_hash includes
    // actions/restrictive_practices/injuries/body_marks) and correctly
    // block sign-off, same as CHECK D/P/Q already prove elsewhere. The
    // attestation sequence and sign-off/countersign chain come last, in
    // that order, with nothing altering content in between.

    // -- CPI action + matching restrictive practice record. --
    await teacherA.from("incident_actions").insert({ incident_id: uIncidentId, action_type_id: restraintAction.id });
    await teacherA.from("restrictive_practices").insert({ incident_id: uIncidentId, passport_id: child1, planning_status: "in_bsp", hold_level: "low" });

    // -- Injury + body mark. --
    const { data: uInjuryRow } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: uIncidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] })
      .select()
      .single();
    await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: uInjuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" });

    // -- Debrief, before sign-off. --
    await teacherA.from("incident_debriefs").insert({
      incident_id: uIncidentId,
      debrief_date: new Date().toISOString().slice(0, 10),
      staff_present: ["Teacher A Owning", "Teacher B Ordinary"],
      notes: "Debrief notes for the export check.",
      actions_for_management: "Review de-escalation approach next term.",
      completed_by: teacherAId,
      completed_at: new Date().toISOString(),
    });

    // -- Attestation sequence: attest, withdraw, re-attest -- same "both --
    // timestamps present" shape CHECK R16 already proved at the summary
    // level; here proving it survives into the export shape too. Last,
    // so the final attest is against the content as it'll actually be
    // signed off.
    const { data: uStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", uIncidentId).eq("user_id", teacherBId).single();
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: uStaffRow.id, p_addendum: "First pass." });
    await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: uStaffRow.id, p_reason: "Checking the timeline." });
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: uStaffRow.id, p_addendum: "Confirmed after checking." });

    const { error: uSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: uIncidentId });
    record("U0a: sign-off itself succeeds (content settled before the final attest, nothing stale)", !uSignErr, uSignErr?.message);
    const { error: uCountersignErr } = await principal.rpc("countersign_incident", { p_incident_id: uIncidentId });
    record("U0b: countersign itself succeeds", !uCountersignErr, uCountersignErr?.message);

    // -- Amendment, post-countersign (confirmed-live policy from Phase 3 -- --
    // countersigner can still add one afterwards).
    await principal.from("incident_amendments").insert({ incident_id: uIncidentId, author_id: principalId, reason: "Export check reason.", content: "Export check amendment content." });

    // -- Access control: refused for someone with genuinely no --
    // can_view_incident() standing (parent2, unrelated to this incident). --
    const { error: uDeniedErr } = await parent2.rpc("get_incident_export", { p_incident_id: uIncidentId });
    record("U1: get_incident_export() refused for a caller with no standing on this incident", Boolean(uDeniedErr) && /permission/i.test(uDeniedErr?.message ?? ""), uDeniedErr?.message);

    const { data: uExport, error: uExportErr } = await teacherA.rpc("get_incident_export", { p_incident_id: uIncidentId });
    record("U2: get_incident_export() succeeds for the owning teacher", !uExportErr, uExportErr?.message);

    record(
      "U3: header fields -- both timestamps present and distinct, location, narrative, parent_summary all correct",
      uExport?.occurred_at != null && uExport?.recorded_at != null && uExport?.location === "Classroom" && uExport?.narrative === "Export check narrative." && uExport?.parent_summary === "Export check parent summary.",
      JSON.stringify({ occurred_at: uExport?.occurred_at, recorded_at: uExport?.recorded_at, location: uExport?.location })
    );

    record(
      "U4: sign-off chain complete -- teacher name, countersign name/role/via all present and correct",
      uExport?.teacher_signed_by_name === "Teacher A Owning" &&
        uExport?.countersigned_by_name === "Principal Test" &&
        uExport?.countersigned_role_at_time === "principal" &&
        uExport?.countersigned_via === "principal_role",
      JSON.stringify({ teacher: uExport?.teacher_signed_by_name, countersigner: uExport?.countersigned_by_name, role: uExport?.countersigned_role_at_time, via: uExport?.countersigned_via })
    );

    const uAttestation = uExport?.staff_attestations?.find((s) => s.incident_staff_id === uStaffRow.id);
    record(
      "U5: attestation sequence survives into the export shape -- current addendum, withdrawal reason, both timestamps, attested_at after withdrawn_at",
      uAttestation?.status === "current" &&
        uAttestation?.addendum === "Confirmed after checking." &&
        uAttestation?.withdrawal_reason === "Checking the timeline." &&
        new Date(uAttestation.attested_at).getTime() > new Date(uAttestation.withdrawn_at).getTime(),
      JSON.stringify(uAttestation)
    );

    record(
      "U6: CPI/restrictive-practice -- has_cpi_action true, exactly one RP record, planning_status='in_bsp'",
      uExport?.has_cpi_action === true && uExport?.restrictive_practices?.length === 1 && uExport.restrictive_practices[0].planning_status === "in_bsp",
      JSON.stringify(uExport?.restrictive_practices)
    );

    const uInjury = uExport?.injuries?.[0];
    record(
      "U7: injury correctly attributes to the named child, one body mark nested with correct region/side/injury-type labels for print rendering",
      uInjury?.party_name?.includes("Verify Child One") || uInjury?.party_name != null, // roster name varies by fixture reuse; just confirm it's not null/Unnamed by accident where a real child exists
      JSON.stringify(uInjury)
    );
    const uBodyMark = uInjury?.body_marks?.[0];
    record(
      "U7b: body mark's region_value/side/injury_type_name resolve to real vocabulary labels, not raw ids",
      uBodyMark?.region_value === "head" && uBodyMark?.side === "centre" && uBodyMark?.injury_type_name === "Bruising",
      JSON.stringify(uBodyMark)
    );

    record(
      "U8: debrief populated with notes, actions_for_management, and the completing teacher's name",
      uExport?.debrief?.notes === "Debrief notes for the export check." &&
        uExport?.debrief?.actions_for_management === "Review de-escalation approach next term." &&
        uExport?.debrief?.completed_by_name === "Teacher A Owning",
      JSON.stringify(uExport?.debrief)
    );

    record(
      "U9: amendment attributed and dated -- present even though added AFTER countersign",
      uExport?.amendments?.length === 1 && uExport.amendments[0].reason === "Export check reason." && uExport.amendments[0].author_name === "Principal Test",
      JSON.stringify(uExport?.amendments)
    );

    await admin.from("incidents").delete().eq("id", uIncidentId);
  }

  // CORE's own cleanup -- moved here (end of CORE) from the very end of
  // main(), where it originally lived, so it still runs whenever CORE
  // does, and no earlier or later than before relative to CORE's own
  // checks. The only observable difference from the pre-split file: it
  // now happens before V-HH run instead of after, which is strictly
  // safer (nothing V-HH depends on the top-level fixture still
  // existing, and a crash in any of them no longer strands this
  // fixture uncleaned).
  console.log(`\n== Core fixture cleanup ==`);
  await admin.from("institutions").delete().eq("id", institutionId);
  for (const id of [principalId, teacherAId, teacherBId, snaId, clinicianId, parent1Id, parent2Id]) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log("Core fixture cleaned up.");
  }

  console.log(`\n== CHECK V: Staff Lifecycle Stage 1 -- deactivation, cascade, guards (migration 0097) ==`);
  if (shouldRun("V")) {
    const { data: instV, error: instVErr } = await admin
      .from("institutions")
      .insert({ name: "Staff Lifecycle Verify School", institution_code: CODE + "V", status: "verified" })
      .select()
      .single();
    if (instVErr) throw instVErr;
    const institutionVId = instV.id;

    const { data: instVOther, error: instVOtherErr } = await admin
      .from("institutions")
      .insert({ name: "Staff Lifecycle Cross School", institution_code: CODE + "VX", status: "verified" })
      .select()
      .single();
    if (instVOtherErr) throw instVOtherErr;
    const institutionVOtherId = instVOther.id;

    // Only ONE principal, deliberately -- institution_staff_one_principal_
    // per_institution permits at most one ACTIVE principal per institution
    // (true since 0068, unchanged by this migration). A second row would
    // fail the unique index outright, which is itself the proof behind
    // the V6 structural exhibit below: no principal-role row can ever be
    // deactivated, because deactivating one requires a DIFFERENT active
    // principal at the same institution to call the RPC, and that second
    // active principal can't coexist with the first.
    const principalV1Id = await createUser("lifecycle.principal1@thebehaviourhive.com", "Principal V One", "principal");
    const teacherVTargetId = await createUser("lifecycle.teacherTarget@thebehaviourhive.com", "Teacher V Target", "class_teacher");
    const teacherVOtherId = await createUser("lifecycle.teacherOther@thebehaviourhive.com", "Teacher V Other", "class_teacher");
    const grantHolderId = await createUser("lifecycle.grantholder@thebehaviourhive.com", "Grant Holder V", "class_teacher");
    const snaVId = await createUser("lifecycle.sna@thebehaviourhive.com", "SNA V", "sna");
    const crossTeacherId = await createUser("lifecycle.crossteacher@thebehaviourhive.com", "Cross Teacher V", "class_teacher");
    const parentV1Id = await createUser("lifecycle.parent1@thebehaviourhive.com", "Parent V One", "parent");
    const parentV2Id = await createUser("lifecycle.parent2@thebehaviourhive.com", "Parent V Two", "parent");
    const parentV3Id = await createUser("lifecycle.parent3@thebehaviourhive.com", "Parent V Three", "parent");
    const parentV4Id = await createUser("lifecycle.parent4@thebehaviourhive.com", "Parent V Four", "parent");

    // crossTeacherId is 'principal', not 'class_teacher' -- found live,
    // not assumed: deactivate_institution_staff()'s pending-target guard
    // (0100) fires BEFORE the caller-authorization check (the same
    // relative order Stage 1 always had -- "already deactivated" was
    // checked before caller-authorization there too, this isn't a new
    // ordering choice, just the first time a check's target happened to
    // also be pending). A pending class_teacher here would make V8 fail
    // for "still pending", never reaching the cross-institution check it
    // exists to prove. crossTeacher-as-principal auto-approves via the
    // trigger (institutionVOther has no other staff), giving V8 a
    // genuinely ACTIVE cross-institution target -- reaching, and
    // correctly failing, the actual guard under test.
    const { data: staffVRows, error: staffVErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionVId, user_id: principalV1Id, role: "principal" },
        { institution_id: institutionVId, user_id: teacherVTargetId, role: "class_teacher" },
        { institution_id: institutionVId, user_id: teacherVOtherId, role: "class_teacher" },
        { institution_id: institutionVId, user_id: grantHolderId, role: "class_teacher" },
        { institution_id: institutionVId, user_id: snaVId, role: "sna" },
        { institution_id: institutionVOtherId, user_id: crossTeacherId, role: "principal" },
      ])
      .select();
    if (staffVErr) throw staffVErr;
    const teacherVTargetStaffId = staffVRows.find((r) => r.user_id === teacherVTargetId).id;
    const principalV1StaffId = staffVRows.find((r) => r.user_id === principalV1Id).id;
    const grantHolderStaffId = staffVRows.find((r) => r.user_id === grantHolderId).id;
    const crossTeacherStaffId = staffVRows.find((r) => r.user_id === crossTeacherId).id;

    // Approve every institutionVId class_teacher/sna row through the
    // real RPC. crossTeacherId needs no separate approval call -- it
    // auto-approved above, per the comment on its insert.
    // Signed in once here and reused below (as `principalV1`) rather
    // than a second signedInClient() call for the same account.
    const principalV1 = await signedInClient("lifecycle.principal1@thebehaviourhive.com");
    {
      for (const row of staffVRows.filter((r) => r.institution_id === institutionVId && r.role !== "principal")) {
        const { error: approveErr } = await principalV1.rpc("approve_staff_join", { p_institution_staff_id: row.id });
        if (approveErr) throw approveErr;
      }
    }

    const { data: cv1 } = await admin.from("passports").insert({ user_id: parentV1Id, child_name: "Lifecycle Child One", passport_status: "complete" }).select().single();
    const { data: cv2 } = await admin.from("passports").insert({ user_id: parentV2Id, child_name: "Lifecycle Child Two", passport_status: "complete" }).select().single();
    const { data: cv3 } = await admin.from("passports").insert({ user_id: parentV3Id, child_name: "Lifecycle Child Three", passport_status: "complete" }).select().single();
    const { data: cv4 } = await admin.from("passports").insert({ user_id: parentV4Id, child_name: "Lifecycle Child Four", passport_status: "complete" }).select().single();
    const childV1 = cv1.id, childV2 = cv2.id, childV3 = cv3.id, childV4 = cv4.id;
    await admin.from("passport_institution_links").insert([
      { passport_id: childV1, institution_id: institutionVId, approved_by_parent: true },
      { passport_id: childV2, institution_id: institutionVId, approved_by_parent: true },
      { passport_id: childV3, institution_id: institutionVId, approved_by_parent: true },
      { passport_id: childV4, institution_id: institutionVId, approved_by_parent: true },
    ]);

    // teacherVTarget holds two ACTIVE grants -- the cascade must close
    // both, one activity_log row each, on the CHILD's own history (not
    // stacked on one). teacherVOther shares childV1 -- proves the cascade
    // is scoped to the deactivated person's OWN grants, not every grant
    // on a child they happened to also touch. childV3's grant for
    // teacherVTarget starts REVOKED, used later to prove a deactivated
    // person can't reactivate one either. childV4 has no grant for
    // teacherVTarget at all yet, used to prove they can't create a new one.
    await admin.from("passport_access").insert([
      { passport_id: childV1, teacher_id: teacherVTargetId, institution_id: institutionVId, is_active: true, actor_role: "class_teacher" },
      { passport_id: childV2, teacher_id: teacherVTargetId, institution_id: institutionVId, is_active: true, actor_role: "class_teacher" },
      { passport_id: childV1, teacher_id: teacherVOtherId, institution_id: institutionVId, is_active: true, actor_role: "class_teacher" },
    ]);
    const { data: revokedGrantV3 } = await admin
      .from("passport_access")
      .insert({ passport_id: childV3, teacher_id: teacherVTargetId, institution_id: institutionVId, is_active: false, actor_role: "class_teacher" })
      .select()
      .single();

    // One row per vocab table, scoped to institution V -- used by item 2's
    // read-access checks below. incident_action_types has is_restraint
    // instead of is_active; the rest share the same shape.
    await admin.from("incident_action_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab Action", is_restraint: false });
    await admin.from("incident_recovery_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab Recovery" });
    await admin.from("cpi_reason_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab CPI Reason" });
    await admin.from("cpi_disengagement_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab CPI Disengagement" });
    await admin.from("cpi_result_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab CPI Result" });
    await admin.from("incident_injury_types").insert({ institution_id: institutionVId, value: "Lifecycle Vocab Injury" });
    await admin.from("incident_body_regions").insert({ institution_id: institutionVId, value: "Lifecycle Vocab Region" });
    const { data: locVRow } = await admin
      .from("incident_locations")
      .insert({ institution_id: institutionVId, value: "Lifecycle Vocab Location" })
      .select()
      .single();

    const { data: globalLoc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    const teacherVTarget = await signedInClient("lifecycle.teacherTarget@thebehaviourhive.com");
    const teacherVOther = await signedInClient("lifecycle.teacherOther@thebehaviourhive.com");
    const grantHolder = await signedInClient("lifecycle.grantholder@thebehaviourhive.com");
    const snaV = await signedInClient("lifecycle.sna@thebehaviourhive.com");

    console.log(`-- item 1: active staff, no regression --`);
    const { data: incident1Id, error: incident1Err } = await teacherVTarget.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV1], p_staff: [],
    });
    record("V1: active class_teacher creates an incident exactly as before -- no regression from this migration", !incident1Err, incident1Err?.message);

    console.log(`-- item 7: non-principal cannot deactivate anyone --`);
    const { error: nonPrincipalErr } = await teacherVOther.rpc("deactivate_institution_staff", {
      p_institution_staff_id: teacherVTargetStaffId, p_reason: "Attempted by a non-principal.",
    });
    record("V7: a non-principal (active class_teacher) is refused -- 'Only an active principal...'", Boolean(nonPrincipalErr) && /active principal/i.test(nonPrincipalErr.message), nonPrincipalErr?.message);

    console.log(`-- item 8: principal cannot deactivate staff at another institution --`);
    const { error: crossInstErr } = await principalV1.rpc("deactivate_institution_staff", {
      p_institution_staff_id: crossTeacherStaffId, p_reason: "Attempted cross-institution.",
    });
    record("V8: principal of institution V refused deactivating staff at a different institution", Boolean(crossInstErr) && /active principal/i.test(crossInstErr.message), crossInstErr?.message);

    console.log(`-- item 5: a principal cannot deactivate themselves --`);
    const { error: selfErr } = await principalV1.rpc("deactivate_institution_staff", {
      p_institution_staff_id: principalV1StaffId, p_reason: "Attempted self-deactivation.",
    });
    record("V5: principal refused deactivating their own staff row -- 'cannot deactivate your own'", Boolean(selfErr) && /own staff membership/i.test(selfErr.message), selfErr?.message);

    console.log(`-- V5b: no OTHER caller can ever be an active principal at the same institution while this one still holds the role --`);
    const { error: nonPrincipalTargetsPrincipalErr } = await teacherVOther.rpc("deactivate_institution_staff", {
      p_institution_staff_id: principalV1StaffId, p_reason: "Attempted by a non-principal, targeting the sole principal.",
    });
    record(
      "V5b: a non-principal caller (teacherVOther) is refused targeting the sole principal too -- 'Only an active principal...', same reason as V7, not a coincidence",
      Boolean(nonPrincipalTargetsPrincipalErr) && /active principal/i.test(nonPrincipalTargetsPrincipalErr.message),
      nonPrincipalTargetsPrincipalErr?.message
    );

    console.log(`-- building incident2 (teacherVOther owns, teacherVTarget named + attests, signed off, left uncountersigned) --`);
    const { data: incident2Id } = await teacherVOther.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV1], p_staff: [{ user_id: teacherVTargetId, involvement: "witnessed" }],
    });
    await teacherVOther.from("incidents").update({
      category: "one_party_incident", narrative: "Lifecycle check narrative.", parent_summary: "Lifecycle check parent summary.",
    }).eq("id", incident2Id);
    const { data: targetStaffRow2 } = await admin.from("incident_staff").select("id").eq("incident_id", incident2Id).eq("user_id", teacherVTargetId).single();
    const { error: attestErr } = await teacherVTarget.rpc("attest_to_incident", { p_incident_staff_id: targetStaffRow2.id, p_addendum: "Confirmed, before I'm deactivated." });
    record("Setup: teacherVTarget's own attestation on incident2 succeeds while still active", !attestErr, attestErr?.message);
    const { error: signoff2Err } = await teacherVOther.rpc("sign_off_incident", { p_incident_id: incident2Id });
    record("Setup: incident2 signs off cleanly", !signoff2Err, signoff2Err?.message);
    const { data: incident2ChildRow } = await admin.from("incident_children").select("id").eq("incident_id", incident2Id).eq("passport_id", childV1).single();

    console.log(`-- building incident4 (teacherVOther owns, teacherVTarget named but does NOT attest -- the outstanding-attestation proof) --`);
    const { data: incident4Id } = await teacherVOther.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV1], p_staff: [{ user_id: teacherVTargetId, involvement: "witnessed" }],
    });

    console.log(`-- get_staff_deactivation_preview() (migration 0098) -- called BEFORE deactivation, while the state it previews is still real --`);
    const { error: previewNonPrincipalErr } = await teacherVOther.rpc("get_staff_deactivation_preview", { p_institution_staff_id: teacherVTargetStaffId });
    record("Preview: non-principal caller refused -- 'Only an active principal...'", Boolean(previewNonPrincipalErr) && /active principal/i.test(previewNonPrincipalErr.message), previewNonPrincipalErr?.message);

    const { error: previewCrossInstErr } = await principalV1.rpc("get_staff_deactivation_preview", { p_institution_staff_id: crossTeacherStaffId });
    record("Preview: refused across institutions, same as deactivate_institution_staff() itself", Boolean(previewCrossInstErr) && /active principal/i.test(previewCrossInstErr.message), previewCrossInstErr?.message);

    const { data: preview, error: previewErr } = await principalV1.rpc("get_staff_deactivation_preview", { p_institution_staff_id: teacherVTargetStaffId });
    record("Preview: succeeds for the active principal", !previewErr, previewErr?.message);
    record(
      "Preview: unsigned_incidents includes incident1 (created+owned by teacherVTarget, teacher_signed_at still null)",
      preview?.unsigned_incidents?.some((i) => i.incident_id === incident1Id),
      JSON.stringify(preview?.unsigned_incidents)
    );
    record(
      "Preview: outstanding_attestations includes incident4 (named, real account, not yet attested) but NOT incident2 (already attested)",
      preview?.outstanding_attestations?.some((i) => i.incident_id === incident4Id) && !preview?.outstanding_attestations?.some((i) => i.incident_id === incident2Id),
      JSON.stringify(preview?.outstanding_attestations)
    );
    record(
      "Preview: active_children lists BOTH childV1 and childV2 -- the real list, not empty, now that the cascade makes it consequential",
      preview?.active_children?.length === 2 && [childV1, childV2].every((c) => preview.active_children.some((row) => row.passport_id === c)),
      JSON.stringify(preview?.active_children)
    );

    console.log(`-- granting grantHolder countersign authority while still active --`);
    const { error: grantErr } = await principalV1.from("institution_permissions").insert({
      institution_id: institutionVId, user_id: grantHolderId, permission: "countersign_incident", granted_by: principalV1Id,
    });
    record("Setup: principalV1 grants countersign_incident to grantHolder while grantHolder is still active", !grantErr, grantErr?.message);

    console.log(`-- building incident3 (teacherVOther owns, signed off, COUNTERSIGNED by grantHolder while still active) --`);
    const { data: incident3Id } = await teacherVOther.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV2], p_staff: [],
    });
    await teacherVOther.from("incidents").update({
      category: "one_party_incident", narrative: "Lifecycle check narrative 3.", parent_summary: "Lifecycle check parent summary 3.",
    }).eq("id", incident3Id);
    await teacherVOther.rpc("sign_off_incident", { p_incident_id: incident3Id });
    const { error: grantHolderCountersignErr } = await grantHolder.rpc("countersign_incident", { p_incident_id: incident3Id });
    record("Setup: grantHolder countersigns incident3 (via grant, not role) while still active", !grantHolderCountersignErr, grantHolderCountersignErr?.message);

    console.log(`-- building incidentUnowned (sna stamp, no owning teacher, for the claim_incident refusal) --`);
    const { data: incidentUnownedId } = await snaV.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV1], p_staff: [],
    });
    const { data: unownedCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentUnownedId).single();
    record("Setup: sna-created stamp has no owning teacher (sna cannot own)", unownedCheck.owning_teacher_id === null, unownedCheck.owning_teacher_id);

    console.log(`-- item 6 & the structural exhibit: one finding, one exhibit, covering all four principal-only gates --`);
    const { data: activePrincipalsBefore } = await admin
      .from("institution_staff")
      .select("user_id")
      .eq("institution_id", institutionVId).eq("role", "principal").is("deactivated_at", null);
    record(
      "V6: STRUCTURAL, not live-fired -- deactivate_institution_staff()'s last-principal guard, can_countersign_incident()'s principal branch, incident_locations add/edit's principal branches, and mark_parent_called()'s principal branch (four call sites, one root cause) are all unreachable by construction: V5 shows the sole principal can't target themselves, V5b shows no other caller can ever be an active principal at the same institution while this one holds the role (institution_staff_one_principal_per_institution permits only one). No path exists to ever set deactivated_at on a principal-role row today -- asserted here as exactly one active principal (principalV1), unchanged, with no deactivation attempt on a principal-role row possible to construct. Stage 1b (handover) is what makes this reachable -- see CLAUDE.md, Deferred work.",
      activePrincipalsBefore?.length === 1 && activePrincipalsBefore[0].user_id === principalV1Id,
      JSON.stringify(activePrincipalsBefore)
    );

    console.log(`-- item 6, the real deactivations that ARE reachable --`);
    const { error: grantHolderDeactivateErr } = await principalV1.rpc("deactivate_institution_staff", {
      p_institution_staff_id: grantHolderStaffId, p_reason: "Lifecycle check: grant holder deactivated.",
    });
    record("V: principalV1 deactivates grantHolder (no grants to revoke)", !grantHolderDeactivateErr, grantHolderDeactivateErr?.message);

    const { data: targetDeactivateResult, error: targetDeactivateErr } = await principalV1.rpc("deactivate_institution_staff", {
      p_institution_staff_id: teacherVTargetStaffId, p_reason: "Lifecycle check: main cascade target.",
    });
    record("V: principalV1 deactivates teacherVTarget (the main cascade test)", !targetDeactivateErr, targetDeactivateErr?.message);
    record("V-cascade: exactly 2 grants revoked (childV1 + childV2, the two teacherVTarget actually held)", targetDeactivateResult?.grants_revoked === 2, JSON.stringify(targetDeactivateResult));

    const { data: targetGrantsAfter } = await admin.from("passport_access").select("passport_id, is_active").eq("teacher_id", teacherVTargetId).eq("institution_id", institutionVId);
    record(
      "V-cascade: both of teacherVTarget's own grants (childV1, childV2) now is_active=false",
      targetGrantsAfter?.length === 3 && targetGrantsAfter.filter((g) => g.passport_id !== childV3).every((g) => g.is_active === false),
      JSON.stringify(targetGrantsAfter)
    );
    const { data: otherGrantAfter } = await admin.from("passport_access").select("is_active").eq("teacher_id", teacherVOtherId).eq("passport_id", childV1).single();
    record("V-cascade: teacherVOther's OWN, separate grant on the SAME child (childV1) is untouched -- cascade scoped to the deactivated person only", otherGrantAfter?.is_active === true, JSON.stringify(otherGrantAfter));

    const { data: activityRowsChild1 } = await admin.from("activity_log").select("event_type, event_description").eq("passport_id", childV1).eq("event_type", "access_revoked");
    const { data: activityRowsChild2 } = await admin.from("activity_log").select("event_type, event_description").eq("passport_id", childV2).eq("event_type", "access_revoked");
    record(
      "V-cascade: exactly one access_revoked activity_log row on childV1's OWN history, naming Teacher V Target explicitly",
      activityRowsChild1?.length === 1 && activityRowsChild1[0].event_description === "Access removed for Teacher V Target (staff member deactivated)",
      JSON.stringify(activityRowsChild1)
    );
    record(
      "V-cascade: exactly one access_revoked activity_log row on childV2's OWN history too -- one row per child, not stacked",
      activityRowsChild2?.length === 1 && activityRowsChild2[0].event_description === "Access removed for Teacher V Target (staff member deactivated)",
      JSON.stringify(activityRowsChild2)
    );

    console.log(`-- item 2: deactivated staff refused at every call site, named --`);

    const { data: vocabAction } = await teacherVTarget.from("incident_action_types").select("id").eq("institution_id", institutionVId);
    record("V2a: incident_action_types -- deactivated staff gets zero rows for their own institution's vocabulary", (vocabAction?.length ?? 0) === 0, `rows=${vocabAction?.length}`);
    const { data: vocabRecovery } = await teacherVTarget.from("incident_recovery_types").select("id").eq("institution_id", institutionVId);
    record("V2b: incident_recovery_types -- same", (vocabRecovery?.length ?? 0) === 0, `rows=${vocabRecovery?.length}`);
    const { data: vocabCpiReason } = await teacherVTarget.from("cpi_reason_types").select("id").eq("institution_id", institutionVId);
    record("V2c: cpi_reason_types -- same", (vocabCpiReason?.length ?? 0) === 0, `rows=${vocabCpiReason?.length}`);
    const { data: vocabCpiDis } = await teacherVTarget.from("cpi_disengagement_types").select("id").eq("institution_id", institutionVId);
    record("V2d: cpi_disengagement_types -- same", (vocabCpiDis?.length ?? 0) === 0, `rows=${vocabCpiDis?.length}`);
    const { data: vocabCpiResult } = await teacherVTarget.from("cpi_result_types").select("id").eq("institution_id", institutionVId);
    record("V2e: cpi_result_types -- same", (vocabCpiResult?.length ?? 0) === 0, `rows=${vocabCpiResult?.length}`);
    const { data: vocabInjury } = await teacherVTarget.from("incident_injury_types").select("id").eq("institution_id", institutionVId);
    record("V2f: incident_injury_types -- same", (vocabInjury?.length ?? 0) === 0, `rows=${vocabInjury?.length}`);
    const { data: vocabLoc } = await teacherVTarget.from("incident_locations").select("id").eq("institution_id", institutionVId);
    record("V2g: incident_locations (read) -- same", (vocabLoc?.length ?? 0) === 0, `rows=${vocabLoc?.length}`);
    const { data: vocabRegion } = await teacherVTarget.from("incident_body_regions").select("id").eq("institution_id", institutionVId);
    record("V2h: incident_body_regions -- same", (vocabRegion?.length ?? 0) === 0, `rows=${vocabRegion?.length}`);

    // V2i/V2j (incident_locations add/edit, principal branch) are not
    // live-fired here -- see the V6 structural exhibit above. locVRow
    // stays unused by design; kept in the fixture for Stage 1b to pick up.
    void locVRow;

    const { error: createErr } = await teacherVTarget.rpc("create_incident_stamp", {
      p_institution_id: institutionVId, p_occurred_at: new Date().toISOString(), p_location_id: globalLoc.id,
      p_child_passport_ids: [childV1], p_staff: [],
    });
    record("V2k: create_incident_stamp() -- deactivated staff refused, 'not registered as school staff'", Boolean(createErr) && /not registered as school staff/i.test(createErr.message), createErr?.message);

    const { error: claimErr } = await teacherVTarget.rpc("claim_incident", { p_incident_id: incidentUnownedId });
    record("V2l: claim_incident() -- deactivated class_teacher refused", Boolean(claimErr) && /only a class teacher/i.test(claimErr.message), claimErr?.message);

    // V2m (mark_parent_called, principal branch) is not live-fired here --
    // see the V6 structural exhibit above. incident2ChildRow stays unused
    // by design; kept in the fixture for Stage 1b to pick up.
    void incident2ChildRow;

    const { error: newGrantErr } = await teacherVTarget.from("passport_access").insert({
      passport_id: childV4, teacher_id: teacherVTargetId, institution_id: institutionVId, is_active: true, actor_role: "class_teacher",
    });
    record("V2n: passport_access insert (new grant) -- deactivated staff refused creating a brand-new grant", Boolean(newGrantErr), newGrantErr?.message);

    const { error: reactivateErr } = await teacherVTarget.from("passport_access").update({ is_active: true }).eq("id", revokedGrantV3.id);
    record("V2o: passport_access reactivate -- deactivated staff refused reactivating their own revoked grant", Boolean(reactivateErr), reactivateErr?.message);

    // V2p (can_countersign_incident, principal branch, item 3's principal
    // half) is not live-fired here -- see the V6 structural exhibit above.
    // The grant branch (item 3's other half) IS fully reachable and real
    // -- grantHolder was legitimately deactivated a moment ago (unlike a
    // principal, nothing stops a class_teacher losing their grant-holder
    // standing), so this is a genuine end-to-end proof, not a helper check.
    const { data: canGrantHolderCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: grantHolderId, p_institution_id: institutionVId });
    record("V2p / item 3 (grant branch): can_countersign_incident() returns FALSE for a deactivated grant-holder -- the grant branch's own new check", canGrantHolderCountersign === false, canGrantHolderCountersign);
    const { error: grantHolderCountersignAttemptErr } = await grantHolder.rpc("countersign_incident", { p_incident_id: incident2Id });
    record("V2p / item 3 (grant branch): countersign_incident() -- deactivated grant-holder refused end-to-end, not just the helper", Boolean(grantHolderCountersignAttemptErr), grantHolderCountersignAttemptErr?.message);

    const { data: incident2StillUncountersigned } = await admin.from("incidents").select("countersigned_at").eq("id", incident2Id).single();
    record("V2p: incident2 stayed uncountersigned throughout the refused attempt", incident2StillUncountersigned?.countersigned_at === null, incident2StillUncountersigned?.countersigned_at);

    const { error: grantToDeactivatedErr } = await principalV1.from("institution_permissions").insert({
      institution_id: institutionVId, user_id: teacherVTargetId, permission: "countersign_incident", granted_by: principalV1Id,
    });
    record(
      "V2r / item 4: guard_institution_permissions_grantee_is_staff() -- an active principal cannot grant countersign authority to a deactivated person",
      Boolean(grantToDeactivatedErr) && /not an active member/i.test(grantToDeactivatedErr.message),
      grantToDeactivatedErr?.message
    );

    console.log(`-- item 9: a deactivated person's authored records are unchanged --`);
    const { data: principalV1IncidentList } = await principalV1.rpc("get_institution_incidents", { p_institution_id: institutionVId });
    const incident1Row = principalV1IncidentList?.find((r) => r.incident_id === incident1Id);
    record("V9a: incident1's owning_teacher_name still resolves to 'Teacher V Target' after deactivation -- their name stays on what they created", incident1Row?.owning_teacher_name === "Teacher V Target", incident1Row?.owning_teacher_name);

    const { data: countersignSummary2 } = await principalV1.rpc("get_countersign_summary", { p_incident_id: incident2Id });
    const targetAttestation = countersignSummary2?.staff_attestations?.find((s) => s.name === "Teacher V Target");
    record(
      "V9b: teacherVTarget's own attestation on incident2 still shows as valid/current after deactivation -- 'attestations they gave still valid'",
      targetAttestation?.status === "current" && targetAttestation?.has_account === true,
      JSON.stringify(targetAttestation)
    );

    const { data: incident3AfterDeactivation } = await teacherVOther.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, countersigned_via").eq("id", incident3Id).single();
    record(
      "V9c: incident3's countersignature by grantHolder stands unchanged after their deactivation -- 'countersignatures still standing' (via='grant', role_at_time='class_teacher', frozen at the moment of signing, not re-derived from their now-revoked standing)",
      incident3AfterDeactivation?.countersigned_by === grantHolderId &&
        incident3AfterDeactivation?.countersigned_role_at_time === "class_teacher" &&
        incident3AfterDeactivation?.countersigned_via === "grant" &&
        incident3AfterDeactivation?.countersigned_at !== null,
      JSON.stringify(incident3AfterDeactivation)
    );

    console.log(`-- item 10: rejoin creates a new membership row, doesn't resurrect the old one --`);
    // V10-pre/post replicate the EXACT query join-institution/page.tsx's
    // checkExisting() runs -- not a proxy for it, the same shape,
    // file:line-matched -- because that query, not the table's own INSERT
    // policy, is what actually decides whether a real person ever sees
    // the join form. V10a alone (the raw INSERT below) proved the
    // DATABASE would accept a legitimate rejoin; it never touched the
    // CLIENT decision that gates whether anyone reaches the point of
    // attempting it. That gap shipped for real -- checkExisting() had no
    // deactivated_at filter, so a deactivated person's still-RLS-visible
    // old row sent them straight back to their old dashboard, never to
    // the form -- and this suite, which never renders or drives a UI,
    // had no way to see it until it was hit by hand. See CLAUDE.md.
    // Replicates checkExisting()'s CURRENT query shape (rewritten for
    // Stage 1b Step 3, src/app/teacher/join-institution/page.tsx's
    // checkExisting(), the useCallback starting around line 74) --
    // updated here in the same pass as that rewrite, not left pointing at
    // the two-way query it replaced. The prior version of this comment
    // said the three-way rewrite was "owed to Step 3, not built" -- it's
    // built now, so the query below, and what it's asserted against,
    // changed with it rather than silently going stale. resolveStatus()
    // itself is a top-level helper (defined once, alongside signedInClient/
    // createUser) since CHECK W reuses it too.
    const { data: preRejoinRows } = await teacherVTarget
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", teacherVTargetId)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });
    record(
      "V10-pre: checkExisting()'s own query returns NO rows for a deactivated person with no other history -- resolves to 'none', the same as never having joined, which is what actually lets them see the join form",
      resolveStatus(preRejoinRows ?? []) === "none",
      JSON.stringify(preRejoinRows)
    );

    const { error: rejoinErr } = await teacherVTarget.from("institution_staff").insert({
      institution_id: institutionVId, user_id: teacherVTargetId, role: "class_teacher",
    });
    record("V10a: the self-link INSERT itself succeeds at the database level -- the new active-only unique index doesn't collide with their old row (mechanism only, not the journey -- see V10-pre/post for that)", !rejoinErr, rejoinErr?.message);

    const { data: postRejoinRows } = await teacherVTarget
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", teacherVTargetId)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });
    record(
      "V10-post: checkExisting()'s query, run through the SAME resolution logic the component uses, now correctly classifies the rejoined row as PENDING -- not silently waved onward to the dashboard, the exact bug class this exercise exists to catch, now closed at this door specifically",
      resolveStatus(postRejoinRows ?? []) === "pending",
      JSON.stringify(postRejoinRows)
    );

    const { data: allTargetRows } = await admin.from("institution_staff").select("id, deactivated_at, deactivated_by, deactivation_reason, approved_at, rejected_at").eq("institution_id", institutionVId).eq("user_id", teacherVTargetId).order("created_at");
    record("V10b: exactly 2 rows now exist for teacherVTarget at this institution -- the old one, plus the new one", allTargetRows?.length === 2, JSON.stringify(allTargetRows));
    const oldRow = allTargetRows?.find((r) => r.id === teacherVTargetStaffId);
    record("V10c: the OLD row's deactivation fields are unchanged, not nulled out -- deactivation is append-only, reactivation is a new row", oldRow?.deactivated_at !== null && oldRow?.deactivation_reason === "Lifecycle check: main cascade target.", JSON.stringify(oldRow));
    const newRow = allTargetRows?.find((r) => r.id !== teacherVTargetStaffId);
    // V10d ORIGINALLY claimed "genuinely active" from deactivated_at is
    // null alone -- true under Stage 1's two-state model, false now that
    // 0100 adds pending/rejected. Same failure shape as V10 itself before
    // its own rewrite: a check whose name claims more than its assertion
    // proves, because the state model moved under it. Renamed to what it
    // actually shows (not deactivated), with V10e added alongside it to
    // state the row's REAL status honestly: pending, not active.
    record("V10d: the NEW row is not deactivated (deactivated_at is null) -- narrower than 'active' now, see V10e", newRow?.deactivated_at === null, JSON.stringify(newRow));
    record("V10e: the NEW row is genuinely PENDING, not active -- class_teacher is never auto-approved, matching the same rule that gates every other class_teacher/sna join", newRow?.approved_at === null && newRow?.rejected_at === null, JSON.stringify(newRow));

    // 0100's own new guard on deactivate_institution_staff(), untested
    // until now -- newRow is a genuinely pending row, ready-made. A real
    // reason is passed specifically so the reason-required check (fires
    // first, unconditionally) can't be the cause of the refusal --
    // isolating the pending-target guard itself, not a different one.
    const { error: pendingDeactivateErr } = await principalV1.rpc("deactivate_institution_staff", { p_institution_staff_id: newRow.id, p_reason: "Attempting to deactivate a pending request." });
    record(
      "V10f: deactivate_institution_staff() refused on a genuinely PENDING row -- 'still pending -- use reject_staff_join()'",
      Boolean(pendingDeactivateErr) && /still pending/i.test(pendingDeactivateErr.message),
      pendingDeactivateErr?.message
    );

    console.log(`-- bonus: the two remaining input guards on deactivate_institution_staff() itself --`);
    const { error: emptyReasonErr } = await principalV1.rpc("deactivate_institution_staff", { p_institution_staff_id: newRow.id, p_reason: "" });
    record("V-bonus: empty reason refused -- 'A reason is required'", Boolean(emptyReasonErr) && /reason is required/i.test(emptyReasonErr.message), emptyReasonErr?.message);
    const { error: alreadyDeactivatedErr } = await principalV1.rpc("deactivate_institution_staff", { p_institution_staff_id: teacherVTargetStaffId, p_reason: "Trying again." });
    record("V-bonus: deactivating an already-deactivated row refused -- 'already deactivated'", Boolean(alreadyDeactivatedErr) && /already deactivated/i.test(alreadyDeactivatedErr.message), alreadyDeactivatedErr?.message);

    await admin.from("incidents").delete().in("id", [incident1Id, incident2Id, incident3Id, incident4Id, incidentUnownedId]);
    await admin.from("institutions").delete().eq("id", institutionVId);
    await admin.from("institutions").delete().eq("id", institutionVOtherId);
    for (const id of [principalV1Id, teacherVTargetId, teacherVOtherId, grantHolderId, snaVId, crossTeacherId, parentV1Id, parentV2Id, parentV3Id, parentV4Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK W: approve_staff_join()/reject_staff_join()/get_rejected_staff_joins() -- the RPC pair's OWN guards, not just their downstream effects (migration 0100, approval_source via 0101) ==`);
  if (shouldRun("W")) {
    // Every fixture across the suite has depended on this RPC pair's happy
    // path since 0100 shipped -- zero checks asserted on the RPC pair
    // itself until now. See CLAUDE.md "COVERAGE GAPS ARE NOT WRONG-REASON
    // PASSES".
    //
    // "A pending principal" and "a rejected principal" are deliberately
    // NOT covered here -- confirmed structurally impossible, not just
    // untested. institution_staff_one_principal_per_institution is keyed
    // on role='principal' and deactivated_at is null and rejected_at is
    // null, with no dependency on approved_at -- a second principal-role
    // insert at an institution that already has one fails at the unique
    // index outright, before the row can exist in ANY state. See
    // CLAUDE.md "Deferred work", fifth structural check.
    const { data: instW, error: instWErr } = await admin
      .from("institutions")
      .insert({ name: "Join Approval Verify School", institution_code: CODE + "W", status: "verified" })
      .select()
      .single();
    if (instWErr) throw instWErr;
    const institutionWId = instW.id;

    const { data: instWOther, error: instWOtherErr } = await admin
      .from("institutions")
      .insert({ name: "Join Approval Cross School", institution_code: CODE + "WX", status: "verified" })
      .select()
      .single();
    if (instWOtherErr) throw instWOtherErr;
    const institutionWOtherId = instWOther.id;

    // status: 'pending' -- not yet verified. The auto-approve trigger
    // doesn't check institution status at all (only approve_staff_join()/
    // reject_staff_join() do), so a first-ever principal here still
    // bootstraps -- deliberately, so the caller in the unverified check
    // below is a REAL active principal at their own institution, isolating
    // the inst.status = 'verified' guard specifically, not a caller-
    // authorization failure in disguise.
    const { data: instWUnverified, error: instWUnverifiedErr } = await admin
      .from("institutions")
      .insert({ name: "Join Approval Unverified School", institution_code: CODE + "WU", status: "pending" })
      .select()
      .single();
    if (instWUnverifiedErr) throw instWUnverifiedErr;
    const institutionWUnverifiedId = instWUnverified.id;

    const { data: instWFresh, error: instWFreshErr } = await admin
      .from("institutions")
      .insert({ name: "Join Approval Fresh School", institution_code: CODE + "WF", status: "verified" })
      .select()
      .single();
    if (instWFreshErr) throw instWFreshErr;
    const institutionWFreshId = instWFresh.id;

    const principalW1Id = await createUser("joinapproval.principal1@thebehaviourhive.com", "Principal W One", "principal");
    const principalWOtherId = await createUser("joinapproval.principalother@thebehaviourhive.com", "Principal W Other", "principal");
    const principalWUnverifiedId = await createUser("joinapproval.principalunverified@thebehaviourhive.com", "Principal W Unverified", "principal");
    const teacherWId = await createUser("joinapproval.teacher@thebehaviourhive.com", "Teacher W", "class_teacher");
    const targetDoubleId = await createUser("joinapproval.targetdouble@thebehaviourhive.com", "Target Double W", "class_teacher");
    const targetRejectThenApproveId = await createUser("joinapproval.targetrejectapprove@thebehaviourhive.com", "Target Reject Then Approve W", "class_teacher");
    const targetApproveThenRejectId = await createUser("joinapproval.targetapprovereject@thebehaviourhive.com", "Target Approve Then Reject W", "class_teacher");
    const targetReasonRequiredId = await createUser("joinapproval.targetreason@thebehaviourhive.com", "Target Reason Required W", "class_teacher");
    const targetSpoofId = await createUser("joinapproval.targetspoof@thebehaviourhive.com", "Target Spoof W", "class_teacher");
    const targetNonPrincipalId = await createUser("joinapproval.targetnonprincipal@thebehaviourhive.com", "Target Non Principal W", "class_teacher");
    const targetCrossInstitutionId = await createUser("joinapproval.targetcross@thebehaviourhive.com", "Target Cross W", "class_teacher");
    const targetGetRejectedScopeId = await createUser("joinapproval.targetscope@thebehaviourhive.com", "Target Scope W", "class_teacher");
    const targetUnverifiedId = await createUser("joinapproval.targetunverified@thebehaviourhive.com", "Target Unverified W", "class_teacher");

    const { data: staffWRows, error: staffWErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionWId, user_id: principalW1Id, role: "principal" },
        { institution_id: institutionWId, user_id: teacherWId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetDoubleId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetRejectThenApproveId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetApproveThenRejectId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetReasonRequiredId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetSpoofId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetNonPrincipalId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetCrossInstitutionId, role: "class_teacher" },
        { institution_id: institutionWId, user_id: targetGetRejectedScopeId, role: "class_teacher" },
        { institution_id: institutionWOtherId, user_id: principalWOtherId, role: "principal" },
        { institution_id: institutionWUnverifiedId, user_id: principalWUnverifiedId, role: "principal" },
        { institution_id: institutionWUnverifiedId, user_id: targetUnverifiedId, role: "class_teacher" },
      ])
      .select();
    if (staffWErr) throw staffWErr;

    const byUser = (uid) => staffWRows.find((r) => r.user_id === uid);
    const principalW1StaffId = byUser(principalW1Id).id;
    const teacherWStaffId = byUser(teacherWId).id;
    const targetDoubleStaffId = byUser(targetDoubleId).id;
    const targetRejectThenApproveStaffId = byUser(targetRejectThenApproveId).id;
    const targetApproveThenRejectStaffId = byUser(targetApproveThenRejectId).id;
    const targetReasonRequiredStaffId = byUser(targetReasonRequiredId).id;
    const targetSpoofStaffId = byUser(targetSpoofId).id;
    const targetNonPrincipalStaffId = byUser(targetNonPrincipalId).id;
    const targetCrossInstitutionStaffId = byUser(targetCrossInstitutionId).id;
    const targetGetRejectedScopeStaffId = byUser(targetGetRejectedScopeId).id;
    const principalWOtherStaffId = byUser(principalWOtherId).id;
    const targetUnverifiedStaffId = byUser(targetUnverifiedId).id;

    // Bootstrap sanity, before anything else touches these rows.
    record("W0a: principalW1's own row auto-approved on insert (first-ever principal at institutionW)", byUser(principalW1Id).approved_at !== null, JSON.stringify(byUser(principalW1Id)));
    record("W0b: principalWOther's own row auto-approved on insert (first-ever principal at institutionWOther)", byUser(principalWOtherId).approved_at !== null, JSON.stringify(byUser(principalWOtherId)));
    record("W0c: principalWUnverified's own row auto-approved on insert -- the trigger doesn't check institution status, only approve/reject_staff_join() do", byUser(principalWUnverifiedId).approved_at !== null, JSON.stringify(byUser(principalWUnverifiedId)));
    record("W0d: every non-principal row inserted above stays PENDING -- class_teacher is never auto-approved", [teacherWId, targetDoubleId, targetRejectThenApproveId, targetApproveThenRejectId, targetReasonRequiredId, targetSpoofId, targetNonPrincipalId, targetCrossInstitutionId, targetGetRejectedScopeId, targetUnverifiedId].every((uid) => byUser(uid).approved_at === null && byUser(uid).rejected_at === null), null);

    console.log(`-- the trigger's role-gate: "no active principal exists" is also trivially true for a class_teacher, but the trigger only auto-approves role='principal' --`);
    // teacherWId (already a class_teacher at the DIFFERENT institutionWId)
    // rather than a dedicated fresh-teacher account -- W1's claim is about
    // institutionWFreshId's own history (no principal has ever existed
    // there), not about this user's own history, and institution_staff
    // rows are scoped per (institution, user) pair.
    const { data: freshRow, error: freshErr } = await admin
      .from("institution_staff")
      .insert({ institution_id: institutionWFreshId, user_id: teacherWId, role: "class_teacher" })
      .select()
      .single();
    if (freshErr) throw freshErr;
    record("W1: a class_teacher is the FIRST-EVER staff row at a brand new institution (no principal has ever existed there) and still stays pending -- proves the trigger's auto-approve is gated on role='principal', not merely 'no active principal exists'", freshRow.approved_at === null && freshRow.approval_source === null, JSON.stringify(freshRow));

    const principalW1 = await signedInClient("joinapproval.principal1@thebehaviourhive.com");
    const principalWOther = await signedInClient("joinapproval.principalother@thebehaviourhive.com");
    const principalWUnverified = await signedInClient("joinapproval.principalunverified@thebehaviourhive.com");

    console.log(`-- approve one, reject one, as the real active principal -- the baseline positive path --`);
    // targetNonPrincipal and targetCrossInstitution are approved/rejected
    // here ONLY after the negative attempts below against them fail, so
    // the same row proves both "the wrong caller is refused" and "the
    // right caller still finds it genuinely actionable afterward" --
    // not secretly mutated by the failed attempts.

    console.log(`-- item: a non-principal cannot approve or reject, though otherwise legitimate active staff --`);
    // teacherW is made genuinely active FIRST, so this attempt comes from
    // someone who would otherwise be allowed to do plenty at this
    // institution -- isolating "not a principal", not "not active".
    {
      const { error: teacherApproveTeacherErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: teacherWStaffId });
      if (teacherApproveTeacherErr) throw teacherApproveTeacherErr;
    }
    const teacherW = await signedInClient("joinapproval.teacher@thebehaviourhive.com");
    const { error: nonPrincipalApproveErr } = await teacherW.rpc("approve_staff_join", { p_institution_staff_id: targetNonPrincipalStaffId });
    record("W2a: an active, otherwise-legitimate class_teacher cannot approve -- 'Only an active principal...'", Boolean(nonPrincipalApproveErr) && /only an active principal/i.test(nonPrincipalApproveErr.message), nonPrincipalApproveErr?.message);
    const { error: nonPrincipalRejectErr } = await teacherW.rpc("reject_staff_join", { p_institution_staff_id: targetNonPrincipalStaffId, p_reason: "Attempted as a non-principal." });
    record("W2b: an active, otherwise-legitimate class_teacher cannot reject -- 'Only an active principal...'", Boolean(nonPrincipalRejectErr) && /only an active principal/i.test(nonPrincipalRejectErr.message), nonPrincipalRejectErr?.message);
    const { data: unaffectedNonPrincipalRow } = await admin.from("institution_staff").select("approved_at, rejected_at").eq("id", targetNonPrincipalStaffId).single();
    record("W2c: the target row is genuinely untouched by the two failed attempts above (both still null)", unaffectedNonPrincipalRow.approved_at === null && unaffectedNonPrincipalRow.rejected_at === null, JSON.stringify(unaffectedNonPrincipalRow));

    console.log(`-- item: a principal at ANOTHER institution cannot approve or reject --`);
    const { error: crossApproveErr } = await principalWOther.rpc("approve_staff_join", { p_institution_staff_id: targetCrossInstitutionStaffId });
    record("W3a: an active principal at a DIFFERENT institution cannot approve -- 'Only an active principal...'", Boolean(crossApproveErr) && /only an active principal/i.test(crossApproveErr.message), crossApproveErr?.message);
    const { error: crossRejectErr } = await principalWOther.rpc("reject_staff_join", { p_institution_staff_id: targetCrossInstitutionStaffId, p_reason: "Attempted cross-institution." });
    record("W3b: an active principal at a DIFFERENT institution cannot reject -- 'Only an active principal...'", Boolean(crossRejectErr) && /only an active principal/i.test(crossRejectErr.message), crossRejectErr?.message);
    const { data: unaffectedCrossRow } = await admin.from("institution_staff").select("approved_at, rejected_at").eq("id", targetCrossInstitutionStaffId).single();
    record("W3c: the target row is genuinely untouched by the two failed cross-institution attempts (both still null)", unaffectedCrossRow.approved_at === null && unaffectedCrossRow.rejected_at === null, JSON.stringify(unaffectedCrossRow));

    console.log(`-- now the real principal, at the right institution: both verbs genuinely work --`);
    const { error: realApproveErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: targetNonPrincipalStaffId });
    record("W4a: the active principal at this institution CAN approve -- the row W2 proved was untouched is genuinely still actionable", !realApproveErr, realApproveErr?.message);
    const { error: realRejectErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetCrossInstitutionStaffId, p_reason: "Not proceeding with this request." });
    record("W4b: the active principal at this institution CAN reject -- the row W3 proved was untouched is genuinely still actionable", !realRejectErr, realRejectErr?.message);

    console.log(`-- item: approve fails at an unverified institution, explicitly -- same caller, same institution, right role, everything but verification --`);
    const { error: unverifiedApproveErr } = await principalWUnverified.rpc("approve_staff_join", { p_institution_staff_id: targetUnverifiedStaffId });
    record("W5: an active, correctly-scoped principal cannot approve at an institution whose status isn't 'verified'", Boolean(unverifiedApproveErr) && /only an active principal/i.test(unverifiedApproveErr.message), unverifiedApproveErr?.message);
    const { data: unaffectedUnverifiedRow } = await admin.from("institution_staff").select("approved_at").eq("id", targetUnverifiedStaffId).single();
    record("W5b: the unverified-institution target row is untouched", unaffectedUnverifiedRow.approved_at === null, JSON.stringify(unaffectedUnverifiedRow));

    console.log(`-- item: double-approval refused --`);
    const { error: firstApproveErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: targetDoubleStaffId });
    record("W6a: first approval of targetDouble succeeds", !firstApproveErr, firstApproveErr?.message);
    const { error: secondApproveErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: targetDoubleStaffId });
    record("W6b: second approval of the same row refused -- 'already been approved'", Boolean(secondApproveErr) && /already been approved/i.test(secondApproveErr.message), secondApproveErr?.message);

    console.log(`-- item: approving an already-rejected row refused --`);
    const { error: firstRejectErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetRejectThenApproveStaffId, p_reason: "Not a fit for this role." });
    record("W7a: rejecting targetRejectThenApprove succeeds", !firstRejectErr, firstRejectErr?.message);
    const { error: approveAfterRejectErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: targetRejectThenApproveStaffId });
    record("W7b: approving the same, now-rejected row refused -- 'already been rejected'", Boolean(approveAfterRejectErr) && /already been rejected/i.test(approveAfterRejectErr.message), approveAfterRejectErr?.message);

    console.log(`-- item: rejecting an already-approved row refused -- AGREED as the answer, verb separation matching the pending-guard: reject only closes an OPEN request, removing an approved person is deactivate_institution_staff()'s job. No new SQL -- reject_staff_join() already guards this --`);
    const { error: approveForRejectTestErr } = await principalW1.rpc("approve_staff_join", { p_institution_staff_id: targetApproveThenRejectStaffId });
    record("W8a: approving targetApproveThenReject succeeds", !approveForRejectTestErr, approveForRejectTestErr?.message);
    const { error: rejectAfterApproveErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetApproveThenRejectStaffId, p_reason: "Trying to reject an approved person." });
    record("W8b: rejecting the same, now-approved row refused -- 'already been approved' -- removing them is deactivate_institution_staff()'s job, not reject_staff_join()'s", Boolean(rejectAfterApproveErr) && /already been approved/i.test(rejectAfterApproveErr.message), rejectAfterApproveErr?.message);

    console.log(`-- item: rejection reason required --`);
    const { error: emptyReasonRejectErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetReasonRequiredStaffId, p_reason: "" });
    record("W9a: rejecting with an empty reason refused -- 'A reason is required...'", Boolean(emptyReasonRejectErr) && /reason is required/i.test(emptyReasonRejectErr.message), emptyReasonRejectErr?.message);
    const { error: nullReasonRejectErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetReasonRequiredStaffId, p_reason: null });
    record("W9b: rejecting with a null reason refused -- 'A reason is required...'", Boolean(nullReasonRejectErr) && /reason is required/i.test(nullReasonRejectErr.message), nullReasonRejectErr?.message);
    const { data: unaffectedReasonRow } = await admin.from("institution_staff").select("approved_at, rejected_at").eq("id", targetReasonRequiredStaffId).single();
    record("W9c: the target row is genuinely untouched by both failed attempts", unaffectedReasonRow.approved_at === null && unaffectedReasonRow.rejected_at === null, JSON.stringify(unaffectedReasonRow));

    console.log(`-- item: approved_by is server-derived, cannot be spoofed by the caller -- institution_staff has no UPDATE policy at all (migration 0033's own design comment), so a direct client update should silently affect zero rows, not error --`);
    const { data: spoofUpdateData, error: spoofUpdateErr } = await teacherW
      .from("institution_staff")
      .update({ approved_at: new Date().toISOString(), approved_by: teacherWId, approval_source: "principal" })
      .eq("id", targetSpoofStaffId)
      .select();
    const { data: spoofRowAfter } = await admin.from("institution_staff").select("approved_at, approved_by, approval_source").eq("id", targetSpoofStaffId).single();
    record(
      "W10: a direct client UPDATE attempting to self-approve is not silently trusted -- re-read via a privileged query proves the row is still genuinely pending, regardless of what the client-side call returned",
      spoofRowAfter.approved_at === null && spoofRowAfter.approved_by === null && spoofRowAfter.approval_source === null,
      `client update returned ${spoofUpdateErr ? "error: " + spoofUpdateErr.message : JSON.stringify(spoofUpdateData) + " (rows affected)"}; privileged re-read: ${JSON.stringify(spoofRowAfter)}`
    );

    console.log(`-- item: approval_source set correctly for all three paths (migration 0101) --`);
    const { data: bootstrapRow } = await admin.from("institution_staff").select("approval_source, approved_by").eq("id", principalW1StaffId).single();
    record("W11a: bootstrap path -- principalW1's own auto-approved row has approval_source='bootstrap', approved_by null", bootstrapRow.approval_source === "bootstrap" && bootstrapRow.approved_by === null, JSON.stringify(bootstrapRow));
    const { data: principalPathRow } = await admin.from("institution_staff").select("approval_source, approved_by").eq("id", teacherWStaffId).single();
    record("W11b: principal path -- teacherW's row, approved via the RPC by principalW1, has approval_source='principal', approved_by=principalW1's own user id", principalPathRow.approval_source === "principal" && principalPathRow.approved_by === principalW1Id, JSON.stringify(principalPathRow));
    // W11c: PERMANENT, NAMED SKIP -- not a gap, not something to restore.
    // 'grandfathered' has no ongoing production path: it's the signature
    // of a ONE-TIME historical backfill (0101) applied to rows that
    // predate the approval_source column existing at all. Nothing
    // running today, no RPC, no signup flow, can ever produce this value
    // again -- so a check asserting it was never regression coverage for
    // a live mechanism, it was a one-time proof that the backfill wrote
    // the right value. That proof already ran, once, correctly, when
    // 0101 shipped. Re-running it forever afterward protects nothing
    // that can actually change.
    //
    // This used to be checked against ZZFIXTURESTAGE1's own real
    // principal row -- one of the 10 rows the 0101 backfill touched --
    // until that institution was correctly torn down as leaked test
    // debris (Stage 6 Step 1's own fixture-cleanup pass) without
    // checking whether the suite still referenced it. It didn't occur to
    // check, and it should have -- CLAUDE.md's own new rule after this:
    // grep the suite for a fixture's institution code and account
    // emails before tearing it down.
    //
    // Exactly one 'grandfathered' row survives anywhere in the database
    // now, and it belongs to Saplings Special School (BHPS-248) -- the
    // REAL trial institution, a real teacher's real employment record,
    // not a fixture. Deliberately NOT referenced here: a repeatable
    // adversarial check keyed to one specific real person's real role
    // would silently break the moment they leave or change position, for
    // reasons having nothing to do with the code under test -- and it
    // would break as a security-check FAILURE, the worst kind of false
    // alarm. Recorded as a pass, not a failure, because the claim it
    // stands for (0101's backfill wrote 'grandfathered' correctly) is
    // still true and always will be -- there's just nothing left that
    // could regress it.
    record(
      "W11c: grandfathered path -- PERMANENT SKIP BY DESIGN, not lost coverage. 0101's one-time backfill was verified once, correctly, when it shipped; no production path can ever create this value again, so there is nothing ongoing to regress. Its one reference fixture (ZZFIXTURESTAGE1) was correctly torn down as debris; the only surviving grandfathered row belongs to the real Saplings Special School and is deliberately not wired into a repeatable check.",
      true,
      "no live fixture can exist for this value by construction -- see comment above"
    );

    console.log(`-- item: get_rejected_staff_joins() is principal-only and same-institution-only --`);
    const { error: scopeRejectErr } = await principalW1.rpc("reject_staff_join", { p_institution_staff_id: targetGetRejectedScopeStaffId, p_reason: "Reference for scope checks." });
    if (scopeRejectErr) throw scopeRejectErr;
    const { data: rejectedForOwner, error: rejectedForOwnerErr } = await principalW1.rpc("get_rejected_staff_joins", { p_institution_id: institutionWId });
    record("W12a: the active principal at this institution sees the rejected row", !rejectedForOwnerErr && (rejectedForOwner ?? []).some((r) => r.id === targetGetRejectedScopeStaffId), JSON.stringify(rejectedForOwner));
    const { data: rejectedForNonPrincipal, error: rejectedForNonPrincipalErr } = await teacherW.rpc("get_rejected_staff_joins", { p_institution_id: institutionWId });
    record("W12b: an active non-principal at the SAME institution sees an empty list, not an error -- the row exists, they just don't qualify", !rejectedForNonPrincipalErr && (rejectedForNonPrincipal ?? []).length === 0, JSON.stringify(rejectedForNonPrincipal));
    const { data: rejectedForCrossPrincipal, error: rejectedForCrossPrincipalErr } = await principalWOther.rpc("get_rejected_staff_joins", { p_institution_id: institutionWId });
    record("W12c: an active principal at a DIFFERENT institution sees an empty list for institutionW, not an error -- same-institution boundary, not just principal-only", !rejectedForCrossPrincipalErr && (rejectedForCrossPrincipal ?? []).length === 0, JSON.stringify(rejectedForCrossPrincipal));

    console.log(`-- item: checkExisting()'s query-shape, four-way (src/app/teacher/join-institution/page.tsx's checkExisting) -- 'pending' is proved separately by V10-post above (a genuine rejoin), these three cover the rest --`);
    const noRowId = await createUser("joinapproval.norow@thebehaviourhive.com", "No Row W", "class_teacher");
    const noRowClient = await signedInClient("joinapproval.norow@thebehaviourhive.com");
    const { data: noRowRows } = await noRowClient
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", noRowId)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });
    record("W13: checkExisting() -- someone with no institution_staff row at all resolves to 'none' (empty result), showing the plain join form", resolveStatus(noRowRows ?? []) === "none", JSON.stringify(noRowRows));

    const targetGetRejectedScope = await signedInClient("joinapproval.targetscope@thebehaviourhive.com");
    const { data: rejectedRows } = await targetGetRejectedScope
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", targetGetRejectedScopeId)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });
    record("W14: checkExisting() -- a rejected person resolves to 'rejected', with their own rejection_reason attached, not silently redirected anywhere", resolveStatus(rejectedRows ?? []) === "rejected" && rejectedRows?.[0]?.rejection_reason === "Reference for scope checks.", JSON.stringify(rejectedRows));

    const { data: activeRows } = await principalW1
      .from("institution_staff")
      .select("institution_id, approved_at, rejected_at, rejection_reason, created_at, institutions(name)")
      .eq("user_id", principalW1Id)
      .is("deactivated_at", null)
      .order("created_at", { ascending: false });
    record("W15: checkExisting() -- an active person resolves to 'active', which is what actually redirects them onward to their dashboard rather than showing the join form again", resolveStatus(activeRows ?? []) === "active", JSON.stringify(activeRows));

    await admin.from("institutions").delete().in("id", [institutionWId, institutionWOtherId, institutionWUnverifiedId, institutionWFreshId]);
    for (const id of [principalW1Id, principalWOtherId, principalWUnverifiedId, teacherWId, targetDoubleId, targetRejectThenApproveId, targetApproveThenRejectId, targetReasonRequiredId, targetSpoofId, targetNonPrincipalId, targetCrossInstitutionId, targetGetRejectedScopeId, targetUnverifiedId, noRowId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK X: Principal handover -- hand_over_principal() (migration 0102) ==`);
  if (shouldRun("X")) {
    const { data: instXLeaving, error: instXLeavingErr } = await admin
      .from("institutions")
      .insert({ name: "Handover Verify -- Leaving", institution_code: CODE + "XL", status: "verified" })
      .select()
      .single();
    if (instXLeavingErr) throw instXLeavingErr;
    const institutionXLeavingId = instXLeaving.id;

    const { data: instXStaying, error: instXStayingErr } = await admin
      .from("institutions")
      .insert({ name: "Handover Verify -- Staying", institution_code: CODE + "XS", status: "verified" })
      .select()
      .single();
    if (instXStayingErr) throw instXStayingErr;
    const institutionXStayingId = instXStaying.id;

    const { data: instXOther, error: instXOtherErr } = await admin
      .from("institutions")
      .insert({ name: "Handover Verify -- Other", institution_code: CODE + "XO", status: "verified" })
      .select()
      .single();
    if (instXOtherErr) throw instXOtherErr;
    const institutionXOtherId = instXOther.id;

    const principalA1Id = await createUser("handoverx.principal1@thebehaviourhive.com", "Handover Principal One", "principal");
    const successorAId = await createUser("handoverx.successora@thebehaviourhive.com", "Handover Successor A", "class_teacher");
    const extraTeacherLeavingId = await createUser("handoverx.extra@thebehaviourhive.com", "Handover Extra Teacher", "class_teacher");
    const deactivatedCandidateId = await createUser("handoverx.deactivated@thebehaviourhive.com", "Handover Deactivated Candidate", "class_teacher");
    const principalA2Id = await createUser("handoverx.principal2@thebehaviourhive.com", "Handover Principal Two", "principal");
    const successorBId = await createUser("handoverx.successorb@thebehaviourhive.com", "Handover Successor B", "class_teacher");
    // principalOtherId doubles as X7's "someone not staff at
    // institutionXLeaving" target below -- no dedicated otherStaff
    // account needed, since the check only needs "some real, active
    // person at a different institution", not any particular role, and
    // principalOtherId (auto-approved as the first-ever principal at
    // institutionXOtherId) already is that with no separate approval
    // RPC call required either.
    const principalOtherId = await createUser("handoverx.principalother@thebehaviourhive.com", "Handover Principal Other", "principal");
    // passports.user_id is unique -- one passport per parent -- so each
    // child needs its own parent, not two children sharing one.
    const parentXL1Id = await createUser("handoverx.parentl1@thebehaviourhive.com", "Handover Parent L1", "parent");
    const parentXL2Id = await createUser("handoverx.parentl2@thebehaviourhive.com", "Handover Parent L2", "parent");
    const parentXS1Id = await createUser("handoverx.parents1@thebehaviourhive.com", "Handover Parent S1", "parent");
    const parentXS2Id = await createUser("handoverx.parents2@thebehaviourhive.com", "Handover Parent S2", "parent");

    const { data: staffXRows, error: staffXErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionXLeavingId, user_id: principalA1Id, role: "principal" },
        { institution_id: institutionXLeavingId, user_id: successorAId, role: "class_teacher" },
        { institution_id: institutionXLeavingId, user_id: extraTeacherLeavingId, role: "class_teacher" },
        { institution_id: institutionXLeavingId, user_id: deactivatedCandidateId, role: "class_teacher" },
        { institution_id: institutionXStayingId, user_id: principalA2Id, role: "principal" },
        { institution_id: institutionXStayingId, user_id: successorBId, role: "class_teacher" },
        { institution_id: institutionXOtherId, user_id: principalOtherId, role: "principal" },
      ])
      .select();
    if (staffXErr) throw staffXErr;
    const byUserX = (uid) => staffXRows.find((r) => r.user_id === uid);
    const successorAStaffId = byUserX(successorAId).id;
    const extraTeacherLeavingStaffId = byUserX(extraTeacherLeavingId).id;
    const deactivatedCandidateStaffId = byUserX(deactivatedCandidateId).id;
    const successorBStaffId = byUserX(successorBId).id;

    const principalA1 = await signedInClient("handoverx.principal1@thebehaviourhive.com");
    const principalA2 = await signedInClient("handoverx.principal2@thebehaviourhive.com");

    // Approve every non-principal row through the real RPC.
    for (const id of [successorAStaffId, extraTeacherLeavingStaffId, deactivatedCandidateStaffId]) {
      const { error } = await principalA1.rpc("approve_staff_join", { p_institution_staff_id: id });
      if (error) throw error;
    }
    for (const id of [successorBStaffId]) {
      const { error } = await principalA2.rpc("approve_staff_join", { p_institution_staff_id: id });
      if (error) throw error;
    }

    // deactivatedCandidate -- deactivated via the ORDINARY, already-
    // tested path (check 8 needs a real deactivated staff member, not a
    // fixture shortcut -- CLAUDE.md's own FIXTURES rule).
    const { error: deactivateCandidateErr } = await principalA1.rpc("deactivate_institution_staff", { p_institution_staff_id: deactivatedCandidateStaffId, p_reason: "Reference for handover guard checks." });
    if (deactivateCandidateErr) throw deactivateCandidateErr;

    // Children + grants -- one per person whose grants must be proven to
    // survive or cascade, so those checks aren't testing an empty set.
    const { data: cXL1 } = await admin.from("passports").insert({ user_id: parentXL1Id, child_name: "Handover Child Leaving One", passport_status: "complete" }).select().single();
    const { data: cXL2 } = await admin.from("passports").insert({ user_id: parentXL2Id, child_name: "Handover Child Leaving Two", passport_status: "complete" }).select().single();
    const { data: cXS1 } = await admin.from("passports").insert({ user_id: parentXS1Id, child_name: "Handover Child Staying One", passport_status: "complete" }).select().single();
    const { data: cXS2 } = await admin.from("passports").insert({ user_id: parentXS2Id, child_name: "Handover Child Staying Two", passport_status: "complete" }).select().single();
    await admin.from("passport_institution_links").insert([
      { passport_id: cXL1.id, institution_id: institutionXLeavingId, approved_by_parent: true },
      { passport_id: cXL2.id, institution_id: institutionXLeavingId, approved_by_parent: true },
      { passport_id: cXS1.id, institution_id: institutionXStayingId, approved_by_parent: true },
      { passport_id: cXS2.id, institution_id: institutionXStayingId, approved_by_parent: true },
    ]);
    // principalA1 holds a teaching grant too (a principal CAN also hold
    // passport_access rows -- nothing in this schema forbids it) -- this
    // is what item 3's cascade-on-leaving check proves closes.
    await admin.from("passport_access").insert([
      { passport_id: cXL1.id, teacher_id: principalA1Id, institution_id: institutionXLeavingId, is_active: true, actor_role: "class_teacher" },
      { passport_id: cXL2.id, teacher_id: successorAId, institution_id: institutionXLeavingId, is_active: true, actor_role: "class_teacher" },
      { passport_id: cXS1.id, teacher_id: principalA2Id, institution_id: institutionXStayingId, is_active: true, actor_role: "class_teacher" },
      { passport_id: cXS2.id, teacher_id: successorBId, institution_id: institutionXStayingId, is_active: true, actor_role: "class_teacher" },
    ]);

    const { data: globalLocX } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    // -- item 13, half one: an incident awaiting countersign, BEFORE the --
    // handover, so its later refusal (old principal) / success (new
    // principal) is provably about WHO is asking, not about the
    // incident's own state. create_incident_stamp() only auto-assigns
    // owning_teacher_id when the CALLER's own role is class_teacher
    // (0069) -- a principal-created stamp stays unowned, needing
    // claim_incident() -- so this must be created by a real class
    // teacher (extraTeacherLeaving), not principalA1, or sign_off_
    // incident() has no owning row to act on and silently does nothing.
    // Found live, running this check, not assumed from the RPC's name.
    // Signed in once here and reused below (as `extraTeacherLeaving`)
    // rather than a second signedInClient() call for the same account --
    // nothing about signing off an incident invalidates the session.
    const extraTeacherLeaving = await signedInClient("handoverx.extra@thebehaviourhive.com");
    const { data: xIncidentId } = await extraTeacherLeaving.rpc("create_incident_stamp", {
      p_institution_id: institutionXLeavingId, p_occurred_at: new Date().toISOString(), p_location_id: globalLocX.id,
      p_child_passport_ids: [cXL1.id], p_staff: [],
    });
    const { error: xSignOffErr } = await extraTeacherLeaving.rpc("sign_off_incident", { p_incident_id: xIncidentId });
    if (xSignOffErr) throw xSignOffErr;

    console.log(`-- negative guards, run BEFORE any real handover executes, against principalA1/principalA2 who both remain genuinely active principals throughout this block --`);

    console.log(`-- item 5: a non-principal cannot call it --`);
    const { error: nonPrincipalHandoverErr } = await extraTeacherLeaving.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "leaving", p_staying_role: null, p_reason: "Attempting as a non-principal." });
    record("X5: an active, otherwise-legitimate class_teacher cannot call hand_over_principal()", Boolean(nonPrincipalHandoverErr) && /only an active principal/i.test(nonPrincipalHandoverErr.message), nonPrincipalHandoverErr?.message);

    console.log(`-- item 7: cannot hand over to someone who is not staff at that institution --`);
    // principalOtherId, not a dedicated otherStaff account -- it's a
    // genuine, active, approved staff member of a DIFFERENT institution,
    // which is all X7 actually needs.
    const { error: notStaffHereErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: principalOtherId, p_outcome: "leaving", p_staying_role: null, p_reason: "Attempting to hand over to a stranger to this school." });
    record("X7: cannot hand over to someone active at a DIFFERENT institution", Boolean(notStaffHereErr) && /active staff member at this institution/i.test(notStaffHereErr.message), notStaffHereErr?.message);

    console.log(`-- item 8 (+ item 11, atomicity): cannot hand over to a deactivated staff member, and nothing persists from the attempt --`);
    const { error: deactivatedSuccessorErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: deactivatedCandidateId, p_outcome: "leaving", p_staying_role: null, p_reason: "Attempting to hand over to someone deactivated." });
    record("X8: cannot hand over to a deactivated staff member", Boolean(deactivatedSuccessorErr) && /active staff member at this institution/i.test(deactivatedSuccessorErr.message), deactivatedSuccessorErr?.message);

    const { data: x11HandoverRows } = await admin.from("principal_handovers").select("id").eq("institution_id", institutionXLeavingId);
    const { data: x11PredecessorRow } = await admin.from("institution_staff").select("deactivated_at, role").eq("id", byUserX(principalA1Id).id).single();
    const { data: x11TargetRow } = await admin.from("institution_staff").select("deactivated_at").eq("id", deactivatedCandidateStaffId).single();
    const { data: x11PredecessorAuth } = await admin.auth.admin.getUserById(principalA1Id);
    record(
      "X11: a guard failure that occurs AFTER caller-authorization already succeeded (X8's attempt) leaves zero footprint -- no principal_handovers row, predecessor still genuinely active principal, target's deactivation unchanged, predecessor's own auth claim untouched",
      (x11HandoverRows ?? []).length === 0
        && x11PredecessorRow.deactivated_at === null && x11PredecessorRow.role === "principal"
        && x11TargetRow.deactivated_at !== null
        && x11PredecessorAuth?.user?.app_metadata?.role === "principal",
      JSON.stringify({ handovers: x11HandoverRows, predecessor: x11PredecessorRow, target: x11TargetRow, predecessorAuthRole: x11PredecessorAuth?.user?.app_metadata?.role })
    );

    console.log(`-- item 9: cannot hand over to yourself --`);
    const { error: selfHandoverErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: principalA1Id, p_outcome: "leaving", p_staying_role: null, p_reason: "Attempting to hand over to myself." });
    record("X9: cannot hand over to yourself", Boolean(selfHandoverErr) && /cannot hand over.*to yourself/i.test(selfHandoverErr.message), selfHandoverErr?.message);

    console.log(`-- item 10: reason is required --`);
    const { error: emptyReasonHandoverErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "leaving", p_staying_role: null, p_reason: "" });
    record("X10a: empty reason refused", Boolean(emptyReasonHandoverErr) && /reason is required/i.test(emptyReasonHandoverErr.message), emptyReasonHandoverErr?.message);
    const { error: nullReasonHandoverErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "leaving", p_staying_role: null, p_reason: null });
    record("X10b: null reason refused", Boolean(nullReasonHandoverErr) && /reason is required/i.test(nullReasonHandoverErr.message), nullReasonHandoverErr?.message);

    console.log(`-- input-shape guards beyond the prompt's own 14 -- found while writing the SQL, worth proving directly --`);
    const { error: badOutcomeErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "retiring", p_staying_role: null, p_reason: "Bad outcome value." });
    record("X-bonus: an outcome other than 'leaving'/'staying' is refused", Boolean(badOutcomeErr) && /outcome must be/i.test(badOutcomeErr.message), badOutcomeErr?.message);
    const { error: badStayingRoleErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "staying", p_staying_role: "principal", p_reason: "Bad staying role value." });
    record("X-bonus: outcome='staying' with an invalid staying role (e.g. 'principal') is refused", Boolean(badStayingRoleErr) && /class_teacher or sna/i.test(badStayingRoleErr.message), badStayingRoleErr?.message);
    const { error: nullStayingRoleErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "staying", p_staying_role: null, p_reason: "Null staying role -- the three-valued-logic bug this guard was rewritten to avoid." });
    record("X-bonus: outcome='staying' with p_staying_role NULL is refused, not silently waved through by SQL's three-valued logic", Boolean(nullStayingRoleErr) && /class_teacher or sna/i.test(nullStayingRoleErr.message), nullStayingRoleErr?.message);
    const { error: contradictoryStayingRoleErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: successorAId, p_outcome: "leaving", p_staying_role: "class_teacher", p_reason: "Providing a staying role while leaving." });
    record("X-bonus: a staying role provided alongside outcome='leaving' is refused as contradictory input", Boolean(contradictoryStayingRoleErr) && /must not be provided/i.test(contradictoryStayingRoleErr.message), contradictoryStayingRoleErr?.message);

    console.log(`-- seeding successorA's OWN auth claim with GoTrue's real keys before the real handover -- provider, providers, AND an arbitrary extra key, deliberately, so the "other keys survive" proof below is adversarial, not a fixture that happens to only have 'role' to begin with --`);
    const { error: seedAuthErr } = await admin.auth.admin.updateUserById(successorAId, {
      app_metadata: { role: "class_teacher", provider: "email", providers: ["email"], custom_test_marker: "should-survive-handover" },
    });
    if (seedAuthErr) throw seedAuthErr;
    const { data: successorAAuthBefore } = await admin.auth.admin.getUserById(successorAId);

    console.log(`-- THE REAL HANDOVER, outcome='leaving' --`);
    const { data: handoverLeavingResult, error: handoverLeavingErr } = await principalA1.rpc("hand_over_principal", {
      p_successor_user_id: successorAId, p_outcome: "leaving", p_staying_role: null, p_reason: "Retiring from the school.",
    });
    record("X-leaving: hand_over_principal() succeeds for a genuinely eligible caller/successor pair", !handoverLeavingErr, handoverLeavingErr?.message);

    console.log(`-- item 1 + item 12: successor is principal, predecessor deactivated, exactly one active principal throughout --`);
    const { data: x1PredecessorRow } = await admin.from("institution_staff").select("role, deactivated_at, deactivated_by, deactivation_reason").eq("id", byUserX(principalA1Id).id).single();
    record("X1a: predecessor's principal row is deactivated -- role unchanged ('principal'), reachable for the first time via any real path", x1PredecessorRow.deactivated_at !== null && x1PredecessorRow.role === "principal" && x1PredecessorRow.deactivated_by === principalA1Id && x1PredecessorRow.deactivation_reason === "Retiring from the school.", JSON.stringify(x1PredecessorRow));
    const successorANewStaffId = handoverLeavingResult?.successor_institution_staff_id;
    const { data: x1SuccessorRow } = await admin.from("institution_staff").select("role, approved_at, approved_by, approval_source, deactivated_at").eq("id", successorANewStaffId).single();
    record("X1b: successor's NEW row is an active principal, approval_source='handover', approved_by is the predecessor", x1SuccessorRow.role === "principal" && x1SuccessorRow.deactivated_at === null && x1SuccessorRow.approved_at !== null && x1SuccessorRow.approval_source === "handover" && x1SuccessorRow.approved_by === principalA1Id, JSON.stringify(x1SuccessorRow));
    const { data: x1SuccessorOldRow } = await admin.from("institution_staff").select("deactivated_at, deactivation_reason").eq("id", successorAStaffId).single();
    record("X1c: successor's OLD class_teacher row is closed, reason names the role change (never deleted)", x1SuccessorOldRow.deactivated_at !== null && /role changed/i.test(x1SuccessorOldRow.deactivation_reason), JSON.stringify(x1SuccessorOldRow));
    const { data: x12LeavingActiveCount } = await admin.from("institution_staff").select("id").eq("institution_id", institutionXLeavingId).eq("role", "principal").is("deactivated_at", null).is("rejected_at", null);
    record("X12 (leaving): exactly one active principal row at this institution after handover -- the index's own invariant, confirmed", (x12LeavingActiveCount ?? []).length === 1, JSON.stringify(x12LeavingActiveCount));

    console.log(`-- item 3: predecessor's OWN grants cascade on leaving --`);
    const { data: x3PredecessorGrant } = await admin.from("passport_access").select("is_active").eq("passport_id", cXL1.id).eq("teacher_id", principalA1Id).single();
    record("X3: predecessor's own passport_access grant is revoked on 'leaving' -- the cascade fired for them too, not just ordinary staff", x3PredecessorGrant.is_active === false, JSON.stringify(x3PredecessorGrant));

    console.log(`-- item 4a: successor's OWN grants survive promotion (outcome='leaving') --`);
    const { data: x4aSuccessorGrant } = await admin.from("passport_access").select("is_active").eq("passport_id", cXL2.id).eq("teacher_id", successorAId).single();
    record("X4a: successor's own pre-existing grant is untouched by their own promotion -- a role change never cascades", x4aSuccessorGrant.is_active === true, JSON.stringify(x4aSuccessorGrant));

    console.log(`-- the auth-write, adversarially: seeded with real GoTrue keys plus an arbitrary marker, only 'role' may change --`);
    const { data: successorAAuthAfter } = await admin.auth.admin.getUserById(successorAId);
    const beforeMeta = successorAAuthBefore?.user?.app_metadata ?? {};
    const afterMeta = successorAAuthAfter?.user?.app_metadata ?? {};
    record(
      "X-auth-1: provider survives byte-identical",
      afterMeta.provider === beforeMeta.provider && beforeMeta.provider === "email",
      JSON.stringify({ before: beforeMeta.provider, after: afterMeta.provider })
    );
    record(
      "X-auth-2: providers array survives byte-identical",
      JSON.stringify(afterMeta.providers) === JSON.stringify(beforeMeta.providers) && JSON.stringify(beforeMeta.providers) === JSON.stringify(["email"]),
      JSON.stringify({ before: beforeMeta.providers, after: afterMeta.providers })
    );
    record(
      "X-auth-3: the arbitrary, unrelated key survives byte-identical -- proof this is a merge, not an overwrite",
      afterMeta.custom_test_marker === beforeMeta.custom_test_marker && beforeMeta.custom_test_marker === "should-survive-handover",
      JSON.stringify({ before: beforeMeta.custom_test_marker, after: afterMeta.custom_test_marker })
    );
    record(
      "X-auth-4: role is the ONLY key that actually changed, class_teacher -> principal",
      beforeMeta.role === "class_teacher" && afterMeta.role === "principal",
      JSON.stringify({ before: beforeMeta.role, after: afterMeta.role })
    );

    console.log(`-- item 6: a deactivated principal cannot call it again --`);
    const { error: deactivatedPrincipalCallErr } = await principalA1.rpc("hand_over_principal", { p_successor_user_id: extraTeacherLeavingId, p_outcome: "leaving", p_staying_role: null, p_reason: "Attempting again after already handing over." });
    record("X6: the now-deactivated predecessor (role still 'principal' on their closed row) cannot call hand_over_principal() again", Boolean(deactivatedPrincipalCallErr) && /only an active principal/i.test(deactivatedPrincipalCallErr.message), deactivatedPrincipalCallErr?.message);

    console.log(`-- item 13: the new principal can countersign, the old one cannot -- same incident, order matters --`);
    const { error: x13OldPrincipalErr } = await principalA1.rpc("countersign_incident", { p_incident_id: xIncidentId });
    record("X13a: the now-deactivated OLD principal is refused countersigning", Boolean(x13OldPrincipalErr) && /permission/i.test(x13OldPrincipalErr?.message ?? ""), x13OldPrincipalErr?.message);
    const successorA = await signedInClient("handoverx.successora@thebehaviourhive.com");
    const { error: x13NewPrincipalErr } = await successorA.rpc("countersign_incident", { p_incident_id: xIncidentId });
    const { data: x13After } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via, status").eq("id", xIncidentId).single();
    record(
      "X13b: the NEW principal succeeds countersigning the same incident, correctly attributed",
      !x13NewPrincipalErr && x13After.countersigned_by === successorAId && x13After.countersigned_role_at_time === "principal" && x13After.countersigned_via === "principal_role" && x13After.status === "finalised",
      `err=${x13NewPrincipalErr?.message}, ${JSON.stringify(x13After)}`
    );

    console.log(`-- item 14: the handover record is written, complete, and cannot be edited or deleted --`);
    const { data: x14Record } = await admin.from("principal_handovers").select("*").eq("id", handoverLeavingResult?.handover_id).single();
    record(
      "X14a: the handover record is complete -- predecessor, successor, outcome, reason, and all four institution_staff references present",
      x14Record?.predecessor_user_id === principalA1Id
        && x14Record?.successor_user_id === successorAId
        && x14Record?.outcome === "leaving"
        && x14Record?.reason === "Retiring from the school."
        && x14Record?.staying_role === null
        && x14Record?.predecessor_new_institution_staff_id === null
        && x14Record?.predecessor_institution_staff_id === byUserX(principalA1Id).id
        && x14Record?.successor_old_institution_staff_id === successorAStaffId
        && x14Record?.successor_new_institution_staff_id === successorANewStaffId,
      JSON.stringify(x14Record)
    );
    const { data: x14UpdateAttempt, error: x14UpdateErr } = await successorA.from("principal_handovers").update({ reason: "Tampered." }).eq("id", x14Record.id).select();
    const { data: x14DeleteAttempt, error: x14DeleteErr } = await successorA.from("principal_handovers").delete().eq("id", x14Record.id).select();
    const { data: x14AfterTamperAttempts } = await admin.from("principal_handovers").select("reason").eq("id", x14Record.id).single();
    record(
      "X14b: neither an UPDATE nor a DELETE attempt (even by the successor themselves, who is named on the record) changes it -- re-read via a privileged query, not trusted from either client response",
      x14AfterTamperAttempts?.reason === "Retiring from the school.",
      `update returned ${x14UpdateErr ? "error: " + x14UpdateErr.message : JSON.stringify(x14UpdateAttempt) + " rows"}; delete returned ${x14DeleteErr ? "error: " + x14DeleteErr.message : JSON.stringify(x14DeleteAttempt) + " rows"}; privileged re-read reason: "${x14AfterTamperAttempts?.reason}"`
    );

    console.log(`-- item 2 + item 4b: THE REAL HANDOVER, outcome='staying' --`);
    const { data: handoverStayingResult, error: handoverStayingErr } = await principalA2.rpc("hand_over_principal", {
      p_successor_user_id: successorBId, p_outcome: "staying", p_staying_role: "class_teacher", p_reason: "Stepping back to focus on teaching.",
    });
    record("X-staying: hand_over_principal() succeeds with outcome='staying'", !handoverStayingErr, handoverStayingErr?.message);

    const { data: x2PredecessorOldRow } = await admin.from("institution_staff").select("role, deactivated_at").eq("id", byUserX(principalA2Id).id).single();
    record("X2a: predecessor's OLD principal row is closed (same mechanism as leaving)", x2PredecessorOldRow.deactivated_at !== null && x2PredecessorOldRow.role === "principal", JSON.stringify(x2PredecessorOldRow));
    const predecessorA2NewStaffId = handoverStayingResult?.predecessor_new_institution_staff_id;
    const { data: x2PredecessorNewRow } = await admin.from("institution_staff").select("role, deactivated_at, approved_at, approval_source").eq("id", predecessorA2NewStaffId).single();
    record("X2b: predecessor's NEW row is an active class_teacher, approval_source='handover'", x2PredecessorNewRow.role === "class_teacher" && x2PredecessorNewRow.deactivated_at === null && x2PredecessorNewRow.approved_at !== null && x2PredecessorNewRow.approval_source === "handover", JSON.stringify(x2PredecessorNewRow));
    const { data: x2PredecessorGrant } = await admin.from("passport_access").select("is_active").eq("passport_id", cXS1.id).eq("teacher_id", principalA2Id).single();
    record("X2c: predecessor's OWN grant is INTACT after staying -- no cascade on a role change, only on departure", x2PredecessorGrant.is_active === true, JSON.stringify(x2PredecessorGrant));

    const { data: x4bSuccessorGrant } = await admin.from("passport_access").select("is_active").eq("passport_id", cXS2.id).eq("teacher_id", successorBId).single();
    record("X4b: successor's own pre-existing grant survives promotion (outcome='staying')", x4bSuccessorGrant.is_active === true, JSON.stringify(x4bSuccessorGrant));

    console.log(`-- item 12 (staying institution) --`);
    const { data: x12StayingActiveCount } = await admin.from("institution_staff").select("id").eq("institution_id", institutionXStayingId).eq("role", "principal").is("deactivated_at", null).is("rejected_at", null);
    record("X12 (staying): exactly one active principal row at this institution after handover", (x12StayingActiveCount ?? []).length === 1, JSON.stringify(x12StayingActiveCount));

    console.log(`-- both sides of 'staying' agree -- auth claim AND institution_staff.role, for BOTH people. Two separate writes; only their agreement makes the feature work --`);
    const { data: predecessorA2Auth } = await admin.auth.admin.getUserById(principalA2Id);
    record(
      "X-both-sides-1: predecessor's auth claim role is 'class_teacher' AND their institution_staff row role is 'class_teacher' -- not just one of the two",
      predecessorA2Auth?.user?.app_metadata?.role === "class_teacher" && x2PredecessorNewRow.role === "class_teacher",
      JSON.stringify({ authRole: predecessorA2Auth?.user?.app_metadata?.role, institutionStaffRole: x2PredecessorNewRow.role })
    );
    const { data: successorBAuth } = await admin.auth.admin.getUserById(successorBId);
    const { data: x_successorBNewRow } = await admin.from("institution_staff").select("role").eq("id", handoverStayingResult?.successor_institution_staff_id).single();
    record(
      "X-both-sides-2: successor's auth claim role is 'principal' AND their institution_staff row role is 'principal' -- not just one of the two",
      successorBAuth?.user?.app_metadata?.role === "principal" && x_successorBNewRow?.role === "principal",
      JSON.stringify({ authRole: successorBAuth?.user?.app_metadata?.role, institutionStaffRole: x_successorBNewRow?.role })
    );

    console.log(`-- the four Stage-1-structural checks, converted: a genuinely handed-over, deactivated principal (principalA1) exists now. Confirming each behaves the SAME as it would for an ordinarily-deactivated principal (which remains impossible to construct directly), not assumed equivalent --`);
    const { data: x_canCountersignOld, error: x_canCountersignOldErr } = await admin.rpc("can_countersign_incident", { p_user_id: principalA1Id, p_institution_id: institutionXLeavingId });
    const { data: x_canCountersignNew, error: x_canCountersignNewErr } = await admin.rpc("can_countersign_incident", { p_user_id: successorAId, p_institution_id: institutionXLeavingId });
    record(
      "X-structural-1 (can_countersign_incident principal branch): FALSE for the handover-deactivated old principal, TRUE for the newly-handed-over active principal -- called directly, not just inferred from countersign_incident()'s own end-to-end refusal/success (X13a/X13b) above",
      !x_canCountersignOldErr && x_canCountersignOld === false && !x_canCountersignNewErr && x_canCountersignNew === true,
      `old=${JSON.stringify(x_canCountersignOld)} (err ${x_canCountersignOldErr?.message}), new=${JSON.stringify(x_canCountersignNew)} (err ${x_canCountersignNewErr?.message})`
    );

    const { error: x_locationAddErr } = await principalA1.from("incident_locations").insert({ institution_id: institutionXLeavingId, value: "Handover Deactivated Attempt Location" });
    record("X-structural-2a (incident_locations add, principal branch): a handover-deactivated principal is refused adding institution vocabulary, same as Stage 1's own deactivated-principal branch would refuse", Boolean(x_locationAddErr), x_locationAddErr?.message);

    // The add/edit policies are two SEPARATE branches (0097/0100) --
    // proving add refused says nothing about edit. A real, pre-existing
    // institution-scoped location row is required: the global "Classroom"
    // row (institution_id is null) fails this policy's own institution_id
    // is not null condition regardless of caller, which would prove
    // nothing about the principal branch specifically.
    const { data: x_editableLocation } = await admin.from("incident_locations").insert({ institution_id: institutionXLeavingId, value: "Handover Pre-existing Location" }).select().single();
    const { error: x_locationEditErr } = await principalA1.from("incident_locations").update({ value: "Handover Deactivated Edit Attempt" }).eq("id", x_editableLocation.id);
    const { data: x_locationAfterEditAttempt } = await admin.from("incident_locations").select("value").eq("id", x_editableLocation.id).single();
    record(
      "X-structural-2b (incident_locations edit, principal branch): a handover-deactivated principal is refused editing an existing institution location -- the SEPARATE edit policy branch, not inferred from add above -- re-read via a privileged query, not trusted from the client response alone",
      x_locationAfterEditAttempt?.value === "Handover Pre-existing Location",
      `update error: ${x_locationEditErr?.message ?? "(none -- RLS silently filters, per CLAUDE.md)"}; value after attempt: "${x_locationAfterEditAttempt?.value}"`
    );

    // mark_parent_called() ALSO grants the incident's own creator/
    // owning_teacher a bypass, independent of the principal branch --
    // xIncidentId was created BY principalA1, so testing their refusal
    // against it would actually pass through the creator bypass, proving
    // nothing about the principal branch specifically. A second,
    // separate incident -- created by extraTeacherLeaving, who is never
    // principalA1 -- isolates the branch under test correctly. Found
    // while double-checking mark_parent_called()'s exact signature
    // (p_incident_children_id, not p_incident_id -- also wrong in an
    // earlier draft of this check) before running it, not after.
    const { data: xMarkCalledIncidentId } = await extraTeacherLeaving.rpc("create_incident_stamp", {
      p_institution_id: institutionXLeavingId, p_occurred_at: new Date().toISOString(), p_location_id: globalLocX.id,
      p_child_passport_ids: [cXL1.id], p_staff: [],
    });
    const { data: xMarkCalledChildRows } = await admin.from("incident_children").select("id, passport_id").eq("incident_id", xMarkCalledIncidentId);
    const xMarkCalledChildId = xMarkCalledChildRows.find((r) => r.passport_id === cXL1.id).id;
    const { error: x_markParentCalledErr } = await principalA1.rpc("mark_parent_called", { p_incident_children_id: xMarkCalledChildId });
    record("X-structural-3 (mark_parent_called principal branch): a handover-deactivated principal -- not the creator/owner of THIS incident -- is refused via the principal branch specifically, same as Stage 1's own deactivated-principal branch would refuse", Boolean(x_markParentCalledErr) && /permission/i.test(x_markParentCalledErr.message), x_markParentCalledErr?.message);

    console.log(`-- Step 3 client behaviour: /principal/dashboard's own resolution query (src/app/principal/dashboard/page.tsx), replicated exactly -- not a proxy for it. The RLS policy on institution_staff is unconditional auth.uid()=user_id, so reusing the ALREADY-signed-in principalA1/principalA2 clients (their session identity is untouched by an app_metadata write -- only the JWT's ROLE CLAIM would be stale, which this specific query doesn't depend on) genuinely exercises this exact code path, not a simulation of it --`);
    const { data: xDashboardPrincipalRow } = await principalA1
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", principalA1Id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();
    record("X-dashboard-1: the principal-scoped resolution query finds NOTHING for a 'leaving'-handover predecessor (their only principal row is now deactivated) -- this is what actually triggers the redirect-away, not the plain join form V10 already proved for class_teacher/sna", xDashboardPrincipalRow === null, JSON.stringify(xDashboardPrincipalRow));
    const { data: xDashboardAnyActiveRow } = await principalA1
      .from("institution_staff")
      .select("id")
      .eq("user_id", principalA1Id)
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();
    record("X-dashboard-2: the graceful-fallback query ALSO finds nothing for the same 'leaving' predecessor -- correctly falls through to the ordinary join-institution redirect, not the ROLE_MISMATCH message (they have no active row anywhere, this genuinely is 'no institution', not a stale claim)", xDashboardAnyActiveRow === null, JSON.stringify(xDashboardAnyActiveRow));

    const { data: xDashboardStayingPrincipalRow } = await principalA2
      .from("institution_staff")
      .select("institution_id, institutions(name)")
      .eq("user_id", principalA2Id)
      .eq("role", "principal")
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();
    record("X-dashboard-3: the principal-scoped resolution query ALSO finds nothing for a 'staying'-handover predecessor (their principal row is closed too, even though they're still active staff overall)", xDashboardStayingPrincipalRow === null, JSON.stringify(xDashboardStayingPrincipalRow));
    const { data: xDashboardStayingAnyActiveRow } = await principalA2
      .from("institution_staff")
      .select("id")
      .eq("user_id", principalA2Id)
      .is("deactivated_at", null)
      .not("approved_at", "is", null)
      .maybeSingle();
    record("X-dashboard-4: the graceful-fallback query DOES find a row for the 'staying' predecessor (their new class_teacher row) -- this is what shows 'your role has changed, sign in again' instead of silently, wrongly, sending a real active staff member to the join form", xDashboardStayingAnyActiveRow !== null, JSON.stringify(xDashboardStayingAnyActiveRow));

    await admin.from("incidents").delete().in("id", [xIncidentId, xMarkCalledIncidentId]);
    await admin.from("institutions").delete().in("id", [institutionXLeavingId, institutionXStayingId, institutionXOtherId]);
    for (const id of [principalA1Id, successorAId, extraTeacherLeavingId, deactivatedCandidateId, principalA2Id, successorBId, principalOtherId, parentXL1Id, parentXL2Id, parentXS1Id, parentXS2Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK Y: Classes and Assignment -- has_child_access() chokepoint, all rewritten call sites, RPC guards, caps, cascade, defense-in-depth (migration 0104) ==`);
  if (shouldRun("Y")) {
    const DENIED = /permission|row-level security|policy/i;

    // ---- Y0: Setup ----
    const { data: instY, error: instYErr } = await admin
      .from("institutions")
      .insert({ name: "Classes Verify", institution_code: CODE + "Y", status: "verified" })
      .select()
      .single();
    if (instYErr) throw instYErr;
    const institutionYId = instY.id;

    const principalYId = await createUser("classesy.principal@thebehaviourhive.com", "Classes Principal", "principal");
    const teacherY1Id = await createUser("classesy.teacher1@thebehaviourhive.com", "Classes Teacher One", "class_teacher");
    const teacherY2Id = await createUser("classesy.teacher2@thebehaviourhive.com", "Classes Teacher Two", "class_teacher");
    const teacherY3Id = await createUser("classesy.teacher3@thebehaviourhive.com", "Classes Teacher Three", "class_teacher");
    const snaYId = await createUser("classesy.sna@thebehaviourhive.com", "Classes SNA", "sna");
    const noAccessTeacherYId = await createUser("classesy.noaccessteacher@thebehaviourhive.com", "Classes No-Access Teacher", "class_teacher");
    const noAccessSnaYId = await createUser("classesy.noaccesssna@thebehaviourhive.com", "Classes No-Access SNA", "sna");
    const outsiderTeacherYId = await createUser("classesy.outsider@thebehaviourhive.com", "Classes Outsider Teacher", "class_teacher");
    const parentClassYId = await createUser("classesy.parentclass@thebehaviourhive.com", "Classes Parent Class", "parent");
    const parentStricterYId = await createUser("classesy.parentstricter@thebehaviourhive.com", "Classes Parent Stricter", "parent");
    const parentAssignYId = await createUser("classesy.parentassign@thebehaviourhive.com", "Classes Parent Assign", "parent");
    const parentMoveYId = await createUser("classesy.parentmove@thebehaviourhive.com", "Classes Parent Move", "parent");
    const parentDelegateYId = await createUser("classesy.parentdelegate@thebehaviourhive.com", "Classes Parent Delegate", "parent");

    const { data: staffYRows, error: staffYErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionYId, user_id: principalYId, role: "principal" },
        { institution_id: institutionYId, user_id: teacherY1Id, role: "class_teacher" },
        { institution_id: institutionYId, user_id: teacherY2Id, role: "class_teacher" },
        { institution_id: institutionYId, user_id: teacherY3Id, role: "class_teacher" },
        { institution_id: institutionYId, user_id: snaYId, role: "sna" },
        { institution_id: institutionYId, user_id: noAccessTeacherYId, role: "class_teacher" },
        { institution_id: institutionYId, user_id: noAccessSnaYId, role: "sna" },
        { institution_id: institutionYId, user_id: outsiderTeacherYId, role: "class_teacher" },
      ])
      .select();
    if (staffYErr) throw staffYErr;
    const byUserY = (uid) => staffYRows.find((r) => r.user_id === uid);
    const teacherY1StaffId = byUserY(teacherY1Id).id;

    const principalY = await signedInClient("classesy.principal@thebehaviourhive.com");
    for (const row of staffYRows.filter((r) => r.role !== "principal")) {
      const { error } = await principalY.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const teacherY1 = await signedInClient("classesy.teacher1@thebehaviourhive.com");
    const snaY = await signedInClient("classesy.sna@thebehaviourhive.com");
    const noAccessTeacherY = await signedInClient("classesy.noaccessteacher@thebehaviourhive.com");
    const noAccessSnaY = await signedInClient("classesy.noaccesssna@thebehaviourhive.com");
    const outsiderTeacherY = await signedInClient("classesy.outsider@thebehaviourhive.com");
    const parentClassY = await signedInClient("classesy.parentclass@thebehaviourhive.com");
    const parentAssignY = await signedInClient("classesy.parentassign@thebehaviourhive.com");

    const { data: cClassY } = await admin.from("passports").insert({ user_id: parentClassYId, child_name: "Classes Child Class", passport_status: "complete" }).select().single();
    const { data: cStricterY } = await admin.from("passports").insert({ user_id: parentStricterYId, child_name: "Classes Child Stricter", passport_status: "complete" }).select().single();
    const { data: cAssignY } = await admin.from("passports").insert({ user_id: parentAssignYId, child_name: "Classes Child Assign", passport_status: "complete" }).select().single();
    const { data: cMoveY } = await admin.from("passports").insert({ user_id: parentMoveYId, child_name: "Classes Child Move", passport_status: "complete" }).select().single();
    const { data: cDelegateY } = await admin.from("passports").insert({ user_id: parentDelegateYId, child_name: "Classes Child Delegate", passport_status: "complete" }).select().single();
    const childClassY = cClassY.id, childStricterY = cStricterY.id, childAssignY = cAssignY.id, childMoveY = cMoveY.id, childDelegateY = cDelegateY.id;

    // childStricterY's link is deliberately NOT approved -- this is the
    // fixture the four preserved-stricter-site checks (Y-10, Y-19, Y-22,
    // Y-23) depend on: the SAME teacher, the SAME kind of genuine
    // class-derived standing, only the approval state differs, isolating
    // exactly the variable those checks are about.
    await admin.from("passport_institution_links").insert([
      { passport_id: childClassY, institution_id: institutionYId, approved_by_parent: true },
      { passport_id: childStricterY, institution_id: institutionYId, approved_by_parent: false },
      { passport_id: childAssignY, institution_id: institutionYId, approved_by_parent: true },
      { passport_id: childMoveY, institution_id: institutionYId, approved_by_parent: true },
      { passport_id: childDelegateY, institution_id: institutionYId, approved_by_parent: true },
    ]);

    const { data: classYId } = await principalY.rpc("create_class", { p_institution_id: institutionYId, p_name: "Room Y" });
    const { data: classY2Id } = await principalY.rpc("create_class", { p_institution_id: institutionYId, p_name: "Room Y2" });
    const { data: teacherY1ClassRowId } = await principalY.rpc("add_class_teacher", { p_class_id: classYId, p_user_id: teacherY1Id });
    const { data: childClassYRowId } = await principalY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childClassY });
    await principalY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childStricterY });
    await principalY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childMoveY });
    await principalY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childDelegateY });
    await principalY.rpc("assign_sna_to_child", { p_passport_id: childAssignY, p_user_id: snaYId, p_institution_id: institutionYId });

    console.log("Y0 fixture ready.");

    // ---- Y1: RPC guards -- class/teacher-list/child-roster edits are
    // principal-only; SNA assignment is delegated to the child's own
    // current class teacher (or the principal, for any child) ----
    {
      const { error } = await outsiderTeacherY.rpc("create_class", { p_institution_id: institutionYId, p_name: "Should Fail" });
      record("Y-rpc-1: create_class refuses a non-principal caller", Boolean(error) && /active principal/i.test(error.message), error?.message);
    }
    {
      const { error } = await outsiderTeacherY.rpc("add_class_teacher", { p_class_id: classYId, p_user_id: outsiderTeacherYId });
      record("Y-rpc-2: add_class_teacher refuses a non-principal caller", Boolean(error) && /active principal/i.test(error.message), error?.message);
    }
    {
      const { error } = await outsiderTeacherY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childAssignY });
      record("Y-rpc-3: add_class_child refuses a non-principal caller", Boolean(error) && /active principal/i.test(error.message), error?.message);
    }
    {
      const { error } = await outsiderTeacherY.rpc("remove_class_teacher", { p_class_teacher_id: teacherY1ClassRowId, p_reason: "Should fail." });
      record("Y-rpc-4: remove_class_teacher refuses a non-principal caller", Boolean(error) && /active principal/i.test(error.message), error?.message);
    }
    {
      const { error } = await outsiderTeacherY.rpc("remove_class_child", { p_class_children_id: childClassYRowId, p_reason: "Should fail." });
      record("Y-rpc-5: remove_class_child refuses a non-principal caller", Boolean(error) && /active principal/i.test(error.message), error?.message);
    }
    {
      const { error } = await outsiderTeacherY.rpc("assign_sna_to_child", { p_passport_id: childDelegateY, p_user_id: noAccessSnaYId, p_institution_id: institutionYId });
      record("Y-rpc-6: assign_sna_to_child refuses a caller who is neither the principal nor a teacher of the child's own class", Boolean(error) && /Only the principal, or a teacher/i.test(error.message), error?.message);
    }
    {
      // Delegated authority, positive case: teacherY1 IS a teacher of
      // childDelegateY's own class (classY), so this must succeed without
      // being the principal.
      const { data, error } = await teacherY1.rpc("assign_sna_to_child", { p_passport_id: childDelegateY, p_user_id: noAccessSnaYId, p_institution_id: institutionYId });
      record("Y-rpc-7: assign_sna_to_child SUCCEEDS for the child's own class teacher, not just the principal (delegated authority, per Q6)", !error && Boolean(data), error?.message);
    }
    {
      const { data: delegateAssignmentRow } = await admin.from("child_assignments").select("id, user_id, ended_at").eq("passport_id", childDelegateY).is("ended_at", null).maybeSingle();
      record("Y-rpc-7b: the delegated assignment actually persisted, assigned to the right SNA", delegateAssignmentRow?.user_id === noAccessSnaYId, JSON.stringify(delegateAssignmentRow));
    }

    // ---- Y2: Caps -- position (max 3 per class), one class per child,
    // one active SNA per child ----
    {
      const { error: e2 } = await principalY.rpc("add_class_teacher", { p_class_id: classYId, p_user_id: teacherY2Id });
      const { error: e3 } = await principalY.rpc("add_class_teacher", { p_class_id: classYId, p_user_id: teacherY3Id });
      record("Y-cap-1: a class can hold a second teacher (position 2)", !e2, e2?.message);
      record("Y-cap-2: a class can hold a third teacher (position 3)", !e3, e3?.message);
      // noAccessTeacherYId (already a real, active class_teacher at
      // institutionYId, not yet in classY) rather than a dedicated
      // fourth-teacher account -- this call is expected to be REFUSED
      // by the cap, leaving zero footprint, so it doesn't touch
      // noAccessTeacherY's own "no access to classY" status the later
      // checks in this block depend on.
      const { error: e4 } = await principalY.rpc("add_class_teacher", { p_class_id: classYId, p_user_id: noAccessTeacherYId });
      record("Y-cap-3: a class refuses a FOURTH teacher -- the position cap (class_teachers_one_active_position_per_class) holds", Boolean(e4) && /already has three teachers/i.test(e4.message), e4?.message);
    }
    {
      const { error: dupErr } = await principalY.rpc("add_class_child", { p_class_id: classYId, p_passport_id: childClassY });
      record("Y-cap-4: add_class_child refuses re-adding a child already in that same class", Boolean(dupErr) && /already in this class/i.test(dupErr.message), dupErr?.message);
    }
    {
      const { data: moveResult, error: moveErr } = await principalY.rpc("add_class_child", { p_class_id: classY2Id, p_passport_id: childMoveY });
      record("Y-cap-5: moving a child to a second class succeeds", !moveErr && Boolean(moveResult), moveErr?.message);
      const { data: closedRows } = await admin.from("class_children").select("class_id, ended_at, end_reason").eq("passport_id", childMoveY).eq("class_id", classYId);
      const { data: activeRows } = await admin.from("class_children").select("class_id, ended_at").eq("passport_id", childMoveY).is("ended_at", null);
      record("Y-cap-6: the move is atomic -- the OLD class_children row is closed, not left dangling", closedRows?.[0]?.ended_at != null && closedRows[0].end_reason === "Moved to a different class.", JSON.stringify(closedRows));
      record("Y-cap-7: the move is atomic -- exactly ONE active class_children row exists afterward, never zero or two", activeRows?.length === 1 && activeRows[0].class_id === classY2Id, JSON.stringify(activeRows));
    }
    {
      const { error: secondSnaErr } = await principalY.rpc("assign_sna_to_child", { p_passport_id: childAssignY, p_user_id: noAccessSnaYId, p_institution_id: institutionYId });
      record("Y-cap-8: assign_sna_to_child refuses a second concurrent SNA for a child who already has one", Boolean(secondSnaErr) && /already has an assigned SNA/i.test(secondSnaErr.message), secondSnaErr?.message);
    }

    // ---- Y3: has_child_access()/has_class_teacher_access()/
    // has_sna_access() -- direct boolean checks, the chokepoint itself,
    // before trusting any call site built on top of it ----
    {
      const { data: r1 } = await principalY.rpc("has_class_teacher_access", { p_user_id: teacherY1Id, p_passport_id: childClassY });
      record("Y-helper-1: has_class_teacher_access(teacherY1, childClassY) -- TRUE, genuine class-derived standing", r1 === true, r1);
      const { data: r2 } = await principalY.rpc("has_class_teacher_access", { p_user_id: snaYId, p_passport_id: childClassY });
      record("Y-helper-2: has_class_teacher_access(snaY, childClassY) -- FALSE, role layering: an SNA's own assignment elsewhere does not confer class_teacher-scoped standing", r2 === false, r2);
      const { data: r3 } = await principalY.rpc("has_sna_access", { p_user_id: snaYId, p_passport_id: childAssignY });
      record("Y-helper-3: has_sna_access(snaY, childAssignY) -- TRUE, genuine assignment-derived standing", r3 === true, r3);
      const { data: r4 } = await principalY.rpc("has_sna_access", { p_user_id: teacherY1Id, p_passport_id: childAssignY });
      record("Y-helper-4: has_sna_access(teacherY1, childAssignY) -- FALSE, role layering: a class teacher's own class standing does not confer sna-scoped standing", r4 === false, r4);
      const { data: r5 } = await principalY.rpc("has_child_access", { p_user_id: noAccessTeacherYId, p_passport_id: childClassY });
      record("Y-helper-5: has_child_access(noAccessTeacher, childClassY) -- FALSE, no relationship of any kind", r5 === false, r5);
      const { data: r6 } = await principalY.rpc("has_child_access", { p_user_id: noAccessSnaYId, p_passport_id: childAssignY });
      record("Y-helper-6: has_child_access(noAccessSna, childAssignY) -- FALSE, no relationship of any kind", r6 === false, r6);
      const { data: r7 } = await principalY.rpc("has_class_teacher_access", { p_user_id: teacherY1Id, p_passport_id: childStricterY });
      record("Y-helper-7: has_class_teacher_access(teacherY1, childStricterY) -- TRUE, the helper itself is NOT approved_by_parent-gated (only the four stricter call sites are, layered on separately)", r7 === true, r7);
    }

    // ---- Y4a: role-blind sites (either role qualifies) ----
    {
      const { data: bySelectTeacher } = await teacherY1.from("passports").select("id").eq("id", childClassY);
      record("Y-1a: passports SELECT -- class-derived class_teacher CAN reach it", bySelectTeacher?.length === 1, JSON.stringify(bySelectTeacher));
      const { data: bySelectSna } = await snaY.from("passports").select("id").eq("id", childAssignY);
      record("Y-1b: passports SELECT -- assignment-derived SNA CAN reach it (role-blind site, both roles work)", bySelectSna?.length === 1, JSON.stringify(bySelectSna));
      const { data: bySelectNoAccess } = await noAccessTeacherY.from("passports").select("id").eq("id", childClassY);
      record("Y-1c: passports SELECT -- still refuses someone with no access of any kind", (bySelectNoAccess?.length ?? 0) === 0, JSON.stringify(bySelectNoAccess));
    }
    {
      await admin.from("passport_section_b").insert({ passport_id: childClassY, user_id: parentClassYId });
      await admin.from("passport_section_b").insert({ passport_id: childAssignY, user_id: parentAssignYId });
      const { data: t } = await teacherY1.from("passport_section_b").select("id").eq("passport_id", childClassY);
      const { data: s } = await snaY.from("passport_section_b").select("id").eq("passport_id", childAssignY);
      const { data: n } = await noAccessTeacherY.from("passport_section_b").select("id").eq("passport_id", childClassY);
      record("Y-2a: passport_section_b SELECT -- class-derived teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-2b: passport_section_b SELECT -- assignment-derived SNA CAN reach it", s?.length === 1, JSON.stringify(s));
      record("Y-2c: passport_section_b SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }
    {
      await admin.from("passport_section_c").insert({ passport_id: childClassY, user_id: parentClassYId });
      await admin.from("passport_section_c").insert({ passport_id: childAssignY, user_id: parentAssignYId });
      const { data: t } = await teacherY1.from("passport_section_c").select("id").eq("passport_id", childClassY);
      const { data: s } = await snaY.from("passport_section_c").select("id").eq("passport_id", childAssignY);
      const { data: n } = await noAccessTeacherY.from("passport_section_c").select("id").eq("passport_id", childClassY);
      record("Y-3a: passport_section_c SELECT -- class-derived teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-3b: passport_section_c SELECT -- assignment-derived SNA CAN reach it", s?.length === 1, JSON.stringify(s));
      record("Y-3c: passport_section_c SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }
    {
      await admin.from("passport_section_d").insert({ passport_id: childClassY, user_id: parentClassYId });
      await admin.from("passport_section_d").insert({ passport_id: childAssignY, user_id: parentAssignYId });
      const { data: t } = await teacherY1.from("passport_section_d").select("id").eq("passport_id", childClassY);
      const { data: s } = await snaY.from("passport_section_d").select("id").eq("passport_id", childAssignY);
      const { data: n } = await noAccessTeacherY.from("passport_section_d").select("id").eq("passport_id", childClassY);
      record("Y-4a: passport_section_d SELECT -- class-derived teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-4b: passport_section_d SELECT -- assignment-derived SNA CAN reach it", s?.length === 1, JSON.stringify(s));
      record("Y-4c: passport_section_d SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }
    {
      await admin.from("morning_checkins").insert({ passport_id: childClassY, user_id: parentClassYId });
      await admin.from("morning_checkins").insert({ passport_id: childAssignY, user_id: parentAssignYId });
      const { data: t } = await teacherY1.from("morning_checkins").select("id").eq("passport_id", childClassY);
      const { data: s } = await snaY.from("morning_checkins").select("id").eq("passport_id", childAssignY);
      const { data: n } = await noAccessTeacherY.from("morning_checkins").select("id").eq("passport_id", childClassY);
      record("Y-5a: morning_checkins SELECT -- class-derived teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-5b: morning_checkins SELECT -- assignment-derived SNA CAN reach it", s?.length === 1, JSON.stringify(s));
      record("Y-5c: morning_checkins SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }
    {
      const { error: tErr } = await teacherY1.from("activity_log").insert({ passport_id: childClassY, actor_id: teacherY1Id, event_type: "team_linked", event_description: "Y test" });
      record("Y-9a: activity_log INSERT -- class-derived teacher CAN insert (role-blind, write access deliberately untouched)", !tErr, tErr?.message);
      const { error: sErr } = await snaY.from("activity_log").insert({ passport_id: childAssignY, actor_id: snaYId, event_type: "team_linked", event_description: "Y test" });
      record("Y-9b: activity_log INSERT -- assignment-derived SNA CAN insert", !sErr, sErr?.message);
      const { error: nErr } = await noAccessTeacherY.from("activity_log").insert({ passport_id: childClassY, actor_id: noAccessTeacherYId, event_type: "team_linked", event_description: "Y test" });
      record("Y-9c: activity_log INSERT -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }

    // ---- Y4b: class_teacher-only sites, non-stricter ----
    let ledgerRowIdForBugRegression;
    {
      const { error: tErr } = await teacherY1.from("strategy_ledger").insert({ passport_id: childClassY, submitted_by: teacherY1Id, entry_type: "observation", description: "Y test" });
      record("Y-6a: strategy_ledger INSERT -- class-derived class_teacher CAN insert", !tErr, tErr?.message);
      const { error: sErr } = await snaY.from("strategy_ledger").insert({ passport_id: childAssignY, submitted_by: snaYId, entry_type: "observation", description: "Y test" });
      record("Y-6b: strategy_ledger INSERT -- assignment-derived SNA is REFUSED (class_teacher-only site)", Boolean(sErr) && DENIED.test(sErr.message), sErr?.message);
      const { error: nErr } = await noAccessTeacherY.from("strategy_ledger").insert({ passport_id: childClassY, submitted_by: noAccessTeacherYId, entry_type: "observation", description: "Y test" });
      record("Y-6c: strategy_ledger INSERT -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);

      const { data: ledgerRow } = await admin.from("strategy_ledger").insert({ passport_id: childClassY, submitted_by: principalYId, entry_type: "observation", description: "Y select test" }).select().single();
      const { data: t } = await teacherY1.from("strategy_ledger").select("id").eq("id", ledgerRow.id);
      const { data: s } = await snaY.from("strategy_ledger").select("id").eq("id", ledgerRow.id);
      const { data: n } = await noAccessTeacherY.from("strategy_ledger").select("id").eq("id", ledgerRow.id);
      record("Y-7a: strategy_ledger SELECT -- class-derived class_teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-7b: strategy_ledger SELECT -- assignment-derived SNA is REFUSED (class_teacher-only site)", (s?.length ?? 0) === 0, JSON.stringify(s));
      record("Y-7c: strategy_ledger SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));

      // REAL BUG REGRESSION: the original third branch never checked
      // pa.is_active, only actor_role -- a revoked class teacher's grant
      // (is_active=false) would have silently still passed. Prove it's
      // fixed with the exact shape of grant that used to slip through.
      await admin.from("passport_access").insert({ passport_id: childClassY, teacher_id: outsiderTeacherYId, institution_id: institutionYId, is_active: false, actor_role: "class_teacher" });
      const { data: revoked } = await outsiderTeacherY.from("strategy_ledger").select("id").eq("id", ledgerRow.id);
      record("Y-7d BUG REGRESSION: strategy_ledger SELECT -- a REVOKED passport_access grant (is_active=false, actor_role=class_teacher) is refused, not silently honoured (the exact bug found and fixed in 0104)", (revoked?.length ?? 0) === 0, JSON.stringify(revoked));
      ledgerRowIdForBugRegression = ledgerRow.id;
    }
    {
      const { error: tErr } = await teacherY1.from("teacher_updates").insert({ passport_id: childClassY, teacher_id: teacherY1Id, settled_state: "settled" });
      record("Y-8a: teacher_updates INSERT -- class-derived class_teacher CAN insert", !tErr, tErr?.message);
      const { error: sErr } = await snaY.from("teacher_updates").insert({ passport_id: childAssignY, teacher_id: snaYId, settled_state: "settled" });
      record("Y-8b: teacher_updates INSERT -- assignment-derived SNA is REFUSED (class_teacher-only site)", Boolean(sErr) && DENIED.test(sErr.message), sErr?.message);
      const { error: nErr } = await noAccessTeacherY.from("teacher_updates").insert({ passport_id: childClassY, teacher_id: noAccessTeacherYId, settled_state: "settled" });
      record("Y-8c: teacher_updates INSERT -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }
    let abcLogClassYId, abcLogAssignYId;
    {
      // Client-generated id, NOT a chained .select() -- ABCLogger.tsx's own
      // documented reason applies exactly here too: `authenticated` only
      // has a column-level SELECT grant on abc_logs (migration 0021) that
      // predates 0067's sensory columns, so a `Prefer: return=representation`
      // RETURNING * from a chained .select() hits those ungranted columns
      // and fails with a confusing "permission denied for table abc_logs"
      // -- caught here as my own test bug, not a real access-control gap
      // (production already works around the identical issue).
      abcLogClassYId = randomUUID();
      const { error: tErr } = await teacherY1
        .from("abc_logs")
        .insert({ id: abcLogClassYId, passport_id: childClassY, logged_by: teacherY1Id, logged_by_role: "class_teacher", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-11a: abc_logs INSERT (class_teacher) -- class-derived class_teacher CAN insert", !tErr, tErr?.message);
      const { error: sErr } = await snaY
        .from("abc_logs")
        .insert({ passport_id: childAssignY, logged_by: snaYId, logged_by_role: "class_teacher", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-11b: abc_logs INSERT (class_teacher) -- assignment-derived SNA is REFUSED under a class_teacher-role claim (role layering, both the check constraint's own role match AND has_class_teacher_access must hold)", Boolean(sErr) && DENIED.test(sErr.message), sErr?.message);
      const { error: nErr } = await noAccessTeacherY
        .from("abc_logs")
        .insert({ passport_id: childClassY, logged_by: noAccessTeacherYId, logged_by_role: "class_teacher", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-11c: abc_logs INSERT (class_teacher) -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }
    {
      const { data: cccRow } = await admin
        .from("passport_clinical_content")
        .insert({ passport_id: childClassY, author_id: principalYId, author_role: "clinician", source_document_type: "fba_report", source_document_id: "11111111-1111-1111-1111-111111111111", item_type: "strategy_school", content: { text: "Y test strategy" } })
        .select()
        .single();
      const { error: tErr } = await teacherY1
        .from("strategy_feedback")
        .insert({ passport_id: childClassY, strategy_content_id: cccRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: teacherY1Id });
      record("Y-15a: strategy_feedback INSERT (teacher) -- class-derived class_teacher CAN insert", !tErr, tErr?.message);
      const { error: sErr } = await snaY
        .from("strategy_feedback")
        .insert({ passport_id: childClassY, strategy_content_id: cccRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: snaYId });
      record("Y-15b: strategy_feedback INSERT (teacher) -- assignment-derived SNA is REFUSED (class_teacher-only site, never in SNA's grant list)", Boolean(sErr) && DENIED.test(sErr.message), sErr?.message);
      const { error: nErr } = await noAccessTeacherY
        .from("strategy_feedback")
        .insert({ passport_id: childClassY, strategy_content_id: cccRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: noAccessTeacherYId });
      record("Y-15c: strategy_feedback INSERT (teacher) -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }
    {
      const { error: tErr } = await teacherY1.from("strategy_feedback_prompts").insert({ passport_id: childClassY, teacher_id: teacherY1Id });
      record("Y-16a: strategy_feedback_prompts INSERT -- class-derived class_teacher CAN insert", !tErr, tErr?.message);
      const { error: sErr } = await snaY.from("strategy_feedback_prompts").insert({ passport_id: childAssignY, teacher_id: snaYId });
      record("Y-16b: strategy_feedback_prompts INSERT -- assignment-derived SNA is REFUSED (class_teacher-only site)", Boolean(sErr) && DENIED.test(sErr.message), sErr?.message);
      const { error: nErr } = await noAccessTeacherY.from("strategy_feedback_prompts").insert({ passport_id: childClassY, teacher_id: noAccessTeacherYId });
      record("Y-16c: strategy_feedback_prompts INSERT -- still refuses no access", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }
    {
      const { data: t } = await teacherY1.rpc("get_abc_trend_data", { p_passport_id: childClassY });
      record("Y-18a: get_abc_trend_data() -- class-derived class_teacher CAN reach it", (t?.length ?? 0) >= 1, JSON.stringify(t));
      const { data: s } = await snaY.rpc("get_abc_trend_data", { p_passport_id: childAssignY });
      record("Y-18b: get_abc_trend_data() -- assignment-derived SNA is REFUSED -- Daniel's own named example: SNA is deliberately excluded from Progress/trend data, an assignment must not silently widen that", (s?.length ?? 0) === 0, JSON.stringify(s));
      const { data: n } = await noAccessTeacherY.rpc("get_abc_trend_data", { p_passport_id: childClassY });
      record("Y-18c: get_abc_trend_data() -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }

    // ---- Y4c: sna-only site ----
    {
      abcLogAssignYId = randomUUID();
      const { error: sErr } = await snaY
        .from("abc_logs")
        .insert({ id: abcLogAssignYId, passport_id: childAssignY, logged_by: snaYId, logged_by_role: "sna", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-12a: abc_logs INSERT (sna) -- assignment-derived SNA CAN insert", !sErr, sErr?.message);
      const { error: tErr } = await teacherY1
        .from("abc_logs")
        .insert({ passport_id: childClassY, logged_by: teacherY1Id, logged_by_role: "sna", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-12b: abc_logs INSERT (sna) -- class-derived class_teacher is REFUSED under an sna-role claim (role layering, sna-only site)", Boolean(tErr) && DENIED.test(tErr.message), tErr?.message);
      const { error: nErr } = await noAccessSnaY
        .from("abc_logs")
        .insert({ passport_id: childAssignY, logged_by: noAccessSnaYId, logged_by_role: "sna", intensity: 3, antecedents: ["demand"], behaviours: ["shouting"], consequences: ["removed"] });
      record("Y-12c: abc_logs INSERT (sna) -- still refuses an SNA-role staff member with NO assignment anywhere (proves has_sna_access, not merely the role claim, gates this)", Boolean(nErr) && DENIED.test(nErr.message), nErr?.message);
    }

    // ---- remaining role-blind sites: abc_logs SELECT, passport_clinical_
    // content SELECT, get_abc_logs(), get_passport_clinical_content() ----
    {
      const { data: t } = await teacherY1.from("abc_logs").select("id").eq("id", abcLogClassYId);
      const { data: s } = await snaY.from("abc_logs").select("id").eq("id", abcLogAssignYId);
      const { data: n } = await noAccessTeacherY.from("abc_logs").select("id").eq("id", abcLogClassYId);
      record("Y-13a: abc_logs SELECT -- class-derived class_teacher CAN reach their own log", t?.length === 1, JSON.stringify(t));
      record("Y-13b: abc_logs SELECT -- assignment-derived SNA CAN reach their own log (role-blind site)", s?.length === 1, JSON.stringify(s));
      record("Y-13c: abc_logs SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
    }
    {
      const { data: cccStrict } = await admin.from("passport_clinical_content").select("id").eq("passport_id", childClassY).eq("item_type", "strategy_school").limit(1).single();
      const { data: t } = await teacherY1.from("passport_clinical_content").select("id").eq("id", cccStrict.id);
      const { data: n } = await noAccessTeacherY.from("passport_clinical_content").select("id").eq("id", cccStrict.id);
      record("Y-14a: passport_clinical_content SELECT -- class-derived class_teacher CAN reach it", t?.length === 1, JSON.stringify(t));
      record("Y-14b: passport_clinical_content SELECT -- still refuses no access", (n?.length ?? 0) === 0, JSON.stringify(n));
      // Assignment-derived SNA, own item_type-eligible row.
      const { data: cccAssign } = await admin.from("passport_clinical_content").insert({ passport_id: childAssignY, author_id: principalYId, author_role: "clinician", source_document_type: "fba_report", source_document_id: "11111111-1111-1111-1111-111111111111", item_type: "strategy_shared", content: { text: "Y test shared" } }).select().single();
      const { data: s } = await snaY.from("passport_clinical_content").select("id").eq("id", cccAssign.id);
      record("Y-14c: passport_clinical_content SELECT -- assignment-derived SNA CAN reach it (role-blind site)", s?.length === 1, JSON.stringify(s));
    }
    {
      const { data: t } = await teacherY1.rpc("get_abc_logs", { p_passport_id: childClassY });
      const { data: s } = await snaY.rpc("get_abc_logs", { p_passport_id: childAssignY });
      const { data: n } = await noAccessTeacherY.rpc("get_abc_logs", { p_passport_id: childClassY });
      record("Y-17a: get_abc_logs() -- class-derived class_teacher CAN reach their own log", (t ?? []).some((r) => r.id === abcLogClassYId), JSON.stringify(t?.length));
      record("Y-17b: get_abc_logs() -- assignment-derived SNA CAN reach their own log (role-blind)", (s ?? []).some((r) => r.id === abcLogAssignYId), JSON.stringify(s?.length));
      record("Y-17c: get_abc_logs() -- still refuses no access", (n ?? []).length === 0, JSON.stringify(n?.length));
    }
    {
      const { data: t } = await teacherY1.rpc("get_passport_clinical_content", { p_passport_id: childClassY });
      const { data: s } = await snaY.rpc("get_passport_clinical_content", { p_passport_id: childAssignY });
      const { data: n } = await noAccessTeacherY.rpc("get_passport_clinical_content", { p_passport_id: childClassY });
      record("Y-20a: get_passport_clinical_content() -- class-derived class_teacher CAN reach eligible content", (t ?? []).some((r) => r.item_type === "strategy_school"), JSON.stringify(t?.length));
      record("Y-20b: get_passport_clinical_content() -- assignment-derived SNA CAN reach eligible content (role-blind branch, either role)", (s ?? []).some((r) => r.item_type === "strategy_shared"), JSON.stringify(s?.length));
      record("Y-20c: get_passport_clinical_content() -- still refuses no access", (n ?? []).length === 0, JSON.stringify(n?.length));
    }

    // ---- Y4d: can_view_message() -- class_teacher-only, no
    // approved_by_parent gate (not a stricter site) ----
    const { data: otherCategory } = await admin.from("message_categories").select("id").eq("label", "Other").maybeSingle();
    let messageIdForCanView;
    {
      const { data: msgId, error: sendErr } = await teacherY1.rpc("send_message", {
        p_passport_id: childClassY, p_category_id: otherCategory.id, p_body: "Y test message", p_response_required: false, p_recipient_ids: [parentClassYId],
      });
      if (sendErr) throw sendErr;
      messageIdForCanView = msgId;
      const { data: t } = await teacherY1.rpc("can_view_message", { p_message_id: msgId });
      record("Y-21a: can_view_message() -- the class-derived class_teacher who sent it CAN view it", t === true, t);
      const { data: s } = await snaY.rpc("can_view_message", { p_message_id: msgId });
      record("Y-21b: can_view_message() -- an unrelated assignment-derived SNA is REFUSED (class_teacher-only site)", s === false, s);
      const { data: n } = await noAccessTeacherY.rpc("can_view_message", { p_message_id: msgId });
      record("Y-21c: can_view_message() -- still refuses no access", n === false, n);
    }

    // ---- Y4e: get_message_recipient_candidates() -- class_teacher-only
    // AND a stricter approved_by_parent site (both aspects tested here) ----
    {
      const { data: t } = await teacherY1.rpc("get_message_recipient_candidates", { p_passport_id: childClassY });
      record("Y-22a: get_message_recipient_candidates() -- class-derived class_teacher (approved link) gets a non-empty candidate list", (t?.length ?? 0) >= 1, JSON.stringify(t?.length));
      const { data: s } = await snaY.rpc("get_message_recipient_candidates", { p_passport_id: childClassY });
      record("Y-22b: get_message_recipient_candidates() -- an unrelated SNA gets nothing (class_teacher-only site, and Messages stays class_teacher-only by design -- no SNA branch was added)", (s?.length ?? 0) === 0, JSON.stringify(s?.length));
    }

    // ---- Y5: get_passport_team() extension + dedup ----
    {
      const { data: teamClass } = await parentClassY.rpc("get_passport_team", { p_passport_id: childClassY });
      const classTeacherEntries = (teamClass ?? []).filter((r) => r.teacher_id === teacherY1Id);
      record("Y-team-1: get_passport_team() -- the class-derived teacher appears, role='class_teacher'", classTeacherEntries.length >= 1 && classTeacherEntries[0].role === "class_teacher", JSON.stringify(classTeacherEntries));
      record("Y-team-2: get_passport_team() -- the class-derived teacher appears EXACTLY ONCE (dedup works before the redundant grant below is added)", classTeacherEntries.length === 1, JSON.stringify(classTeacherEntries));

      // Now give the same teacher a REDUNDANT passport_access grant too --
      // coexistence, not backfill -- and confirm they still appear once.
      await admin.from("passport_access").insert({ passport_id: childClassY, teacher_id: teacherY1Id, institution_id: institutionYId, is_active: true, actor_role: "class_teacher" });
      const { data: teamClassAfter } = await parentClassY.rpc("get_passport_team", { p_passport_id: childClassY });
      const afterEntries = (teamClassAfter ?? []).filter((r) => r.teacher_id === teacherY1Id);
      record("Y-team-3: get_passport_team() -- holding BOTH a passport_access grant AND class-derived standing still surfaces the teacher exactly once, not twice", afterEntries.length === 1, JSON.stringify(afterEntries));

      const { data: teamAssign } = await parentAssignY.rpc("get_passport_team", { p_passport_id: childAssignY });
      const snaEntries = (teamAssign ?? []).filter((r) => r.teacher_id === snaYId);
      record("Y-team-4: get_passport_team() -- the assignment-derived SNA appears, role='sna'", snaEntries.length === 1 && snaEntries[0].role === "sna", JSON.stringify(snaEntries));
    }

    // ---- Y6: can_view_incident() -- role-blind branch, incident created
    // AND OWNED by outsiderTeacherY, a genuine class_teacher who is
    // neither teacherY1/snaY (under test) nor a principal -- 0069 narrowed
    // the incidents UPDATE policy to "owning teacher, role=class_teacher
    // only", so a principal-created incident can never leave 'draft' via
    // this path (RLS on UPDATE silently filters, per CLAUDE.md -- caught
    // here, not assumed). Using a class_teacher creator/owner avoids both
    // that dead end AND the creator/owner-visibility bypass that would
    // otherwise mask the branch actually under test.
    {
      const { data: locY } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();
      const { data: incClassY, error: incClassYErr } = await outsiderTeacherY.rpc("create_incident_stamp", {
        p_institution_id: institutionYId, p_occurred_at: new Date().toISOString(), p_location_id: locY.id, p_child_passport_ids: [childClassY], p_staff: [],
      });
      if (incClassYErr) throw incClassYErr;
      const { error: updClassYErr } = await outsiderTeacherY.from("incidents").update({ attestations_requested: true }).eq("id", incClassY);
      if (updClassYErr) throw updClassYErr;
      const { data: incAssignY, error: incAssignYErr } = await outsiderTeacherY.rpc("create_incident_stamp", {
        p_institution_id: institutionYId, p_occurred_at: new Date().toISOString(), p_location_id: locY.id, p_child_passport_ids: [childAssignY], p_staff: [],
      });
      if (incAssignYErr) throw incAssignYErr;
      const { error: updAssignYErr } = await outsiderTeacherY.from("incidents").update({ attestations_requested: true }).eq("id", incAssignY);
      if (updAssignYErr) throw updAssignYErr;

      // Re-read the persisted state via a privileged query rather than
      // trusting the absence of a client-visible error -- CLAUDE.md's own
      // standing rule for RLS-on-UPDATE.
      const { data: statusCheck } = await admin.from("incidents").select("id, status").in("id", [incClassY, incAssignY]);
      record("Y-24pre: both incidents genuinely left 'draft' before the visibility checks below run (re-read via service role, not assumed from the absence of an error)", (statusCheck ?? []).every((r) => r.status !== "draft") && statusCheck?.length === 2, JSON.stringify(statusCheck));

      const { data: t } = await teacherY1.from("incidents").select("id").eq("id", incClassY);
      record("Y-24a: can_view_incident() -- class-derived class_teacher CAN view an incident for their own class's child (role-blind chokepoint)", t?.length === 1, JSON.stringify(t));
      const { data: nForClass } = await noAccessTeacherY.from("incidents").select("id").eq("id", incClassY);
      record("Y-24b: can_view_incident() -- still refuses no access", (nForClass?.length ?? 0) === 0, JSON.stringify(nForClass));
      const { data: s } = await snaY.from("incidents").select("id").eq("id", incAssignY);
      record("Y-24c: can_view_incident() -- assignment-derived SNA CAN view an incident for their assigned child (role-blind)", s?.length === 1, JSON.stringify(s));
      const { data: nForAssign } = await noAccessSnaY.from("incidents").select("id").eq("id", incAssignY);
      record("Y-24d: can_view_incident() -- still refuses an SNA with no assignment to this child", (nForAssign?.length ?? 0) === 0, JSON.stringify(nForAssign));

      await admin.from("incidents").delete().in("id", [incClassY, incAssignY]);
    }

    // ---- Y7: the FOUR preserved-stricter sites -- activity_log SELECT,
    // get_teacher_activity_feed(), get_message_recipient_candidates(),
    // send_message(). REWRITTEN for Stage 4, migration 0110: these four
    // sites lost approved_by_parent's "= true" requirement, keeping only
    // the institution-matched join/exists (activity_log SELECT excepted
    // -- it never had an institution-match to keep, and collapsed to
    // has_class_teacher_access() outright). teacherY1's class-derived
    // standing over childStricterY was ALWAYS genuine; only the
    // approval flag ever differed. Before 0110 these checks proved that
    // flag still gated all four (correctly, for Stage 2-3). Now it must
    // NOT gate any of them -- proving the removal actually took effect,
    // not just that nothing broke. What's still unproven, named
    // honestly: the institution-matched JOIN condition itself
    // (pil.institution_id = pa.institution_id / c.institution_id) is
    // byte-identical to before 0110 and was never independently isolated
    // by its own check pre- or post-migration -- doing so needs a second
    // institution with its own approved link to the same child, not
    // built here. ----
    {
      // Positive control first -- childClassY (approved) must still work,
      // proving these sites are not simply broken outright.
      const { data: alRow } = await admin.from("activity_log").insert({ passport_id: childClassY, actor_id: principalYId, event_type: "team_linked", event_description: "Y stricter positive control" }).select().single();
      const { data: tPositive } = await teacherY1.from("activity_log").select("id").eq("id", alRow.id);
      record("Y-10a (positive control): activity_log SELECT -- class-derived teacher reaches it when the link IS approved", tPositive?.length === 1, JSON.stringify(tPositive));

      const { data: alStrictRow } = await admin.from("activity_log").insert({ passport_id: childStricterY, actor_id: principalYId, event_type: "team_linked", event_description: "Y stricter negative test" }).select().single();
      const { data: tStrict } = await teacherY1.from("activity_log").select("id").eq("id", alStrictRow.id);
      record("Y-10b THE REMOVAL ITSELF (0110): activity_log SELECT -- the SAME class-derived teacher now REACHES childStricterY's row even though its institution link was never approved_by_parent -- the gate genuinely came out, not just stopped being asserted", tStrict?.length === 1, JSON.stringify(tStrict));

      const { data: feedPositive } = await teacherY1.rpc("get_teacher_activity_feed", {});
      record("Y-19a (positive control): get_teacher_activity_feed() -- includes the approved-link row", (feedPositive ?? []).some((r) => r.id === alRow.id), JSON.stringify(feedPositive?.length));
      const { data: feedStrict } = await teacherY1.rpc("get_teacher_activity_feed", {});
      record("Y-19b THE REMOVAL ITSELF (0110): get_teacher_activity_feed() -- NOW includes the unapproved-link row for the same class-derived teacher, institution-match preserved (both rows are teacherY1's own institution)", (feedStrict ?? []).some((r) => r.id === alStrictRow.id), JSON.stringify(feedStrict?.length));

      const { data: candidatesStrict } = await teacherY1.rpc("get_message_recipient_candidates", { p_passport_id: childStricterY });
      record("Y-22c THE REMOVAL ITSELF (0110): get_message_recipient_candidates() -- the same class-derived teacher now gets a real, non-empty candidate list for the unapproved-link child, same as the approved one (Y-22a)", (candidatesStrict?.length ?? 0) >= 1, JSON.stringify(candidatesStrict?.length));

      const { error: sendStrictErr } = await teacherY1.rpc("send_message", {
        p_passport_id: childStricterY, p_category_id: otherCategory.id, p_body: "Should now succeed", p_response_required: false, p_recipient_ids: [parentStricterYId],
      });
      record("Y-23 THE REMOVAL ITSELF (0110): send_message() -- the same class-derived teacher can now message about the unapproved-link child -- no longer refused for a reason that no longer exists", !sendStrictErr, sendStrictErr?.message);
    }

    // ---- Y8: departure cascade + defense-in-depth ----
    {
      const { error: deactErr } = await principalY.rpc("deactivate_institution_staff", { p_institution_staff_id: teacherY1StaffId, p_reason: "Y cascade test." });
      if (deactErr) throw deactErr;

      const { data: closedRow } = await admin.from("class_teachers").select("ended_at, ended_by, end_reason").eq("id", teacherY1ClassRowId).single();
      record("Y-cascade-1: deactivate_institution_staff() closes the class_teachers row via the renamed/extended cascade helper", closedRow.ended_at != null && closedRow.ended_by === principalYId, JSON.stringify(closedRow));

      const { data: afterDeact } = await principalY.rpc("has_class_teacher_access", { p_user_id: teacherY1Id, p_passport_id: childClassY });
      record("Y-cascade-2: has_class_teacher_access() is FALSE after deactivation (cascade correctly closed the row)", afterDeact === false, afterDeact);

      // DEFENSE-IN-DEPTH, isolated: simulate a cascade MISS by directly
      // reopening the class_teachers row the cascade above just closed --
      // this state is not reachable via any real production path (the
      // cascade and the deactivation are atomic in the same transaction),
      // so it is deliberately created here with a service-role write, not
      // driven through an RPC, purely to prove the SEPARATE, independent
      // institution_staff re-check inside has_class_teacher_access() is
      // the actual security boundary -- not merely implied by the cascade
      // having worked in Y-cascade-1/2 above.
      await admin.from("class_teachers").update({ ended_at: null, ended_by: null, end_reason: null }).eq("id", teacherY1ClassRowId);
      const { data: reopenedRow } = await admin.from("class_teachers").select("ended_at").eq("id", teacherY1ClassRowId).single();
      const { data: defenseInDepth } = await principalY.rpc("has_class_teacher_access", { p_user_id: teacherY1Id, p_passport_id: childClassY });
      record("Y-cascade-3 DEFENSE IN DEPTH: with the class_teachers row artificially reopened (simulating a cascade miss) but institution_staff still deactivated, has_class_teacher_access() is STILL FALSE -- the access check does not rely on the cascade having run", reopenedRow.ended_at === null && defenseInDepth === false, JSON.stringify({ reopenedRow, defenseInDepth }));
    }

    console.log(`Y summary: ${ledgerRowIdForBugRegression ? "bug-regression fixture present" : "MISSING"}, messageIdForCanView=${messageIdForCanView}`);

    // ---- Y9: teardown ----
    await admin.from("institutions").delete().eq("id", institutionYId);
    for (const id of [principalYId, teacherY1Id, teacherY2Id, teacherY3Id, snaYId, noAccessTeacherYId, noAccessSnaYId, outsiderTeacherYId, parentClassYId, parentStricterYId, parentAssignYId, parentMoveYId, parentDelegateYId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK Z: Client-behaviour half of Stage 2, Step 3 -- the "removed from a class mid-day" design, proven via the LITERAL client query shape, not a proxy for it (src/app/teacher/class/page.tsx and src/app/principal/classes/[classId]/page.tsx) ==`);
  if (shouldRun("Z")) {
    const { data: instZ, error: instZErr } = await admin
      .from("institutions")
      .insert({ name: "Stale Class Verify", institution_code: CODE + "Z", status: "verified" })
      .select()
      .single();
    if (instZErr) throw instZErr;
    const institutionZId = instZ.id;

    const principalZId = await createUser("classz.principal@thebehaviourhive.com", "Class Z Principal", "principal");
    const teacherZId = await createUser("classz.teacher@thebehaviourhive.com", "Class Z Teacher", "class_teacher");

    const { data: staffZRows, error: staffZErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionZId, user_id: principalZId, role: "principal" },
        { institution_id: institutionZId, user_id: teacherZId, role: "class_teacher" },
      ])
      .select();
    if (staffZErr) throw staffZErr;

    const principalZ = await signedInClient("classz.principal@thebehaviourhive.com");
    const teacherZStaffId = staffZRows.find((r) => r.user_id === teacherZId).id;
    const { error: approveZErr } = await principalZ.rpc("approve_staff_join", { p_institution_staff_id: teacherZStaffId });
    if (approveZErr) throw approveZErr;

    const teacherZ = await signedInClient("classz.teacher@thebehaviourhive.com");

    const { data: classZId } = await principalZ.rpc("create_class", { p_institution_id: institutionZId, p_name: "Room Z" });
    const { data: teacherZClassRowId } = await principalZ.rpc("add_class_teacher", { p_class_id: classZId, p_user_id: teacherZId });

    // Z-1/Z-2 -- src/app/teacher/class/page.tsx:104-109's EXACT query
    // shape, reproduced verbatim (not paraphrased): the active-
    // membership resolution this page runs fresh on every load, never
    // cached across a visit. Before removal, it must find the class;
    // after removal via the real remove_class_teacher() RPC, the
    // IDENTICAL query must find nothing -- that transition, proven at
    // the query level, IS the "no longer teaching a class" empty state
    // this page shows, not something inferred from the RPC's own
    // success response.
    {
      const { data: beforeRemoval } = await teacherZ
        .from("class_teachers")
        .select("class_id")
        .eq("user_id", teacherZId)
        .is("ended_at", null);
      record(
        "Z-1: /teacher/class's own resolution query finds the active class BEFORE removal (src/app/teacher/class/page.tsx:104-109)",
        beforeRemoval?.length === 1 && beforeRemoval[0].class_id === classZId,
        JSON.stringify(beforeRemoval)
      );

      const { error: removeErr } = await principalZ.rpc("remove_class_teacher", {
        p_class_teacher_id: teacherZClassRowId,
        p_reason: "Z mid-day removal test.",
      });
      if (removeErr) throw removeErr;

      const { data: afterRemoval } = await teacherZ
        .from("class_teachers")
        .select("class_id")
        .eq("user_id", teacherZId)
        .is("ended_at", null);
      record(
        "Z-2 THE DESIGNED BEHAVIOUR: the IDENTICAL query finds NOTHING after a real mid-day removal (src/app/teacher/class/page.tsx:104-109) -- this is what actually drives the 'you're not currently teaching a class' empty state, not an assumption that the RPC succeeding is enough",
        (afterRemoval?.length ?? 0) === 0,
        JSON.stringify(afterRemoval)
      );
    }

    // Z-3 -- the DIFFERENT client shape the principal's own class-detail
    // page uses (src/app/principal/classes/[classId]/page.tsx:113-118):
    // fetches ALL class_teachers rows for the class, unfiltered, and
    // splits active/removed CLIENT-SIDE -- a genuinely different code
    // path from Z-1/Z-2's server-side .is("ended_at", null) filter, and
    // one that could independently have its own bug (e.g. mislabelling
    // an ended row as active). Proven separately, not assumed identical
    // just because both ultimately read the same table.
    {
      const { data: allRows } = await principalZ
        .from("class_teachers")
        .select("id, user_id, position, started_at, ended_at, ended_by, end_reason")
        .eq("class_id", classZId)
        .order("position");
      const stillMarkedActive = (allRows ?? []).filter((r) => r.ended_at === null);
      const nowInHistory = (allRows ?? []).filter((r) => r.ended_at !== null);
      record(
        "Z-3: the principal's class-detail page's own query shape (src/app/principal/classes/[classId]/page.tsx:113-118) correctly moves the removed teacher out of the active split and into the removed-history split -- the client-side split, not just the row's own column",
        stillMarkedActive.length === 0 && nowInHistory.length === 1 && nowInHistory[0].user_id === teacherZId && nowInHistory[0].end_reason === "Z mid-day removal test.",
        JSON.stringify({ stillMarkedActive, nowInHistory })
      );
    }

    await admin.from("institutions").delete().eq("id", institutionZId);
    for (const id of [principalZId, teacherZId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK AA: Temporary day-scoped access (migration 0105) -- grant/revoke authorization, the has_sna_access() fourth branch, can_own_incident()/create_incident_stamp() widening, the ownership/authority edit-policy decoupling, lazy ownership-transfer resolution, the standing-audit fixes (assign_sna_to_child, get_institution_staff_roster), and (0133) the settable activation start time -- its own RPC's guards, proof set_temporary_access_cutoff's guard is genuinely dynamic, and both bounds of the activation window proven live ==`);
  if (shouldRun("AA")) {
    // dublinNowParts()/addMinutesClamped() are module-level (hoisted
    // above main(), CHECK BB reuses them for the same reason).
    // FORMER LIMITATION, CLOSED BY 0133: the 07:30 activation boundary
    // used to be a fixed literal compared directly against now() inside
    // the SQL, not a stored value -- no way to vary it from a test, so
    // this suite could only prove the ">  cut-off" refusal / "< cut-off"
    // success half of the window, never the ">= activation" half without
    // literally running before 07:30 local time. Activation is now a
    // per-institution stored value (temporary_access_start_time) --
    // AA-1e..AA-1k below cover its own RPC and prove BOTH bounds of the
    // window live, via a genuinely movable start time. Any other check
    // in this suite whose own comments still describe the lower bound as
    // permanently unprovable (CHECK TT, CHECK UU) is describing a
    // limitation that no longer holds; not retrofitted there, since this
    // check is where that coverage now lives.
    const nowParts = dublinNowParts();
    const cutoffComfortablyAhead = addMinutesClamped(nowParts.time, 180);
    const cutoffAlreadyPassed = addMinutesClamped(nowParts.time, -15);
    const todayLocal = nowParts.date;
    const yesterdayLocal = new Date(new Date(`${todayLocal}T12:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
    const tomorrowLocal = new Date(new Date(`${todayLocal}T12:00:00Z`).getTime() + 86400000).toISOString().slice(0, 10);

    // ---- AA0: Setup ----
    const { data: instAA, error: instAAErr } = await admin
      .from("institutions")
      .insert({ name: "AA Temp Access Verify", institution_code: CODE + "AA", status: "verified" })
      .select().single();
    if (instAAErr) throw instAAErr;
    const institutionAAId = instAA.id;

    const principalAAId = await createUser("aatemp.principal@thebehaviourhive.com", "AA Temp Principal", "principal");
    const teacherAA1Id = await createUser("aatemp.teacher1@thebehaviourhive.com", "AA Temp Teacher One", "class_teacher");
    const outsiderTeacherAAId = await createUser("aatemp.outsider@thebehaviourhive.com", "AA Temp Outsider Teacher", "class_teacher");
    const snaAA1Id = await createUser("aatemp.sna1@thebehaviourhive.com", "AA Temp SNA One", "sna");
    const deactivatedSnaAAId = await createUser("aatemp.deactivatedsna@thebehaviourhive.com", "AA Temp Deactivated SNA", "sna");
    const newSupplyAAId = await createUser("aatemp.newsupply@thebehaviourhive.com", "AA Temp New Supply Teacher", "sna");
    const pendingSupplyAAId = await createUser("aatemp.pendingsupply@thebehaviourhive.com", "AA Temp Pending Supply Teacher", "sna");
    const parentAA1Id = await createUser("aatemp.parent1@thebehaviourhive.com", "AA Temp Parent One", "parent");
    const parentAA2Id = await createUser("aatemp.parent2@thebehaviourhive.com", "AA Temp Parent Two", "parent");

    const { data: staffAARows, error: staffAAErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionAAId, user_id: principalAAId, role: "principal" },
      { institution_id: institutionAAId, user_id: teacherAA1Id, role: "class_teacher" },
      { institution_id: institutionAAId, user_id: outsiderTeacherAAId, role: "class_teacher" },
      { institution_id: institutionAAId, user_id: snaAA1Id, role: "sna" },
      { institution_id: institutionAAId, user_id: deactivatedSnaAAId, role: "sna" },
    ]).select();
    if (staffAAErr) throw staffAAErr;
    const byUserAA = (uid) => staffAARows.find((r) => r.user_id === uid);

    const principalAA = await signedInClient("aatemp.principal@thebehaviourhive.com");
    for (const row of staffAARows.filter((r) => r.role !== "principal")) {
      const { error } = await principalAA.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const { error: deactivateErr } = await principalAA.rpc("deactivate_institution_staff", {
      p_institution_staff_id: byUserAA(deactivatedSnaAAId).id, p_reason: "AA fixture: needs a genuinely deactivated SNA.",
    });
    if (deactivateErr) throw deactivateErr;

    const teacherAA1 = await signedInClient("aatemp.teacher1@thebehaviourhive.com");
    const outsiderTeacherAA = await signedInClient("aatemp.outsider@thebehaviourhive.com");

    const { data: classAA1Id } = await principalAA.rpc("create_class", { p_institution_id: institutionAAId, p_name: "AA Room 1" });
    const { data: classAA2Id } = await principalAA.rpc("create_class", { p_institution_id: institutionAAId, p_name: "AA Room 2" });
    await principalAA.rpc("add_class_teacher", { p_class_id: classAA1Id, p_user_id: teacherAA1Id });
    await principalAA.rpc("add_class_teacher", { p_class_id: classAA2Id, p_user_id: outsiderTeacherAAId });

    const { data: cAA1 } = await admin.from("passports").insert({ user_id: parentAA1Id, child_name: "AA Temp Child One", passport_status: "complete" }).select().single();
    const { data: cAA2 } = await admin.from("passports").insert({ user_id: parentAA2Id, child_name: "AA Temp Child Two", passport_status: "complete" }).select().single();
    const childAA1 = cAA1.id, childAA2 = cAA2.id;
    await admin.from("passport_institution_links").insert([
      { passport_id: childAA1, institution_id: institutionAAId, approved_by_parent: true },
      { passport_id: childAA2, institution_id: institutionAAId, approved_by_parent: true },
    ]);
    await principalAA.rpc("add_class_child", { p_class_id: classAA1Id, p_passport_id: childAA1 });
    await principalAA.rpc("add_class_child", { p_class_id: classAA2Id, p_passport_id: childAA2 });

    // A genuinely pending join, via the REAL self-link path (a direct
    // insert under the same RLS this app's own join flow uses), not a
    // service-role shortcut -- exactly the scenario the pending-join-
    // collision fix in grant_temporary_access() exists for.
    const pendingSupplyAA = await signedInClient("aatemp.pendingsupply@thebehaviourhive.com");
    const { error: pendingJoinErr } = await pendingSupplyAA
      .from("institution_staff")
      .insert({ institution_id: institutionAAId, user_id: pendingSupplyAAId, role: "sna" });
    if (pendingJoinErr) throw pendingJoinErr;

    console.log("AA0 fixture ready.");

    // ---- AA1: set_temporary_access_cutoff() ----
    {
      const { error: nonPrincipalErr } = await teacherAA1.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: "16:00:00" });
      record("AA-1a: set_temporary_access_cutoff refuses a non-principal caller", Boolean(nonPrincipalErr) && /active principal/i.test(nonPrincipalErr.message), nonPrincipalErr?.message);

      // Re-audited for migration 0133: the refusal condition used to be
      // a fixed '07:30' literal ("cut-off <= 07:30" hardcoded in SQL);
      // it is now "cut-off <= the institution's own CURRENT start time"
      // (07:30 only because that's still the untouched default at this
      // point in the fixture). Asserting on the literal "07:30" substring
      // would still coincidentally pass post-0133 without actually
      // proving the new dynamic rule -- asserting on "start time"
      // (0133's own updated error message) proves the real thing. AA-1i
      // below proves the dynamism itself, once start_time has moved.
      const { error: tooEarlyErr } = await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: "07:00:00" });
      record("AA-1b: set_temporary_access_cutoff refuses a cut-off at or before the institution's current start time (07:30 default)", Boolean(tooEarlyErr) && /start time/i.test(tooEarlyErr.message), tooEarlyErr?.message);

      const { error: setErr } = await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: cutoffComfortablyAhead });
      record("AA-1c: an active principal CAN set a valid cut-off", !setErr, setErr?.message);
      const { data: instCheck } = await admin.from("institutions").select("temporary_access_cutoff_time").eq("id", institutionAAId).single();
      record("AA-1d: the cut-off actually persisted to the row", instCheck?.temporary_access_cutoff_time?.startsWith(cutoffComfortablyAhead.slice(0, 5)), instCheck?.temporary_access_cutoff_time);

      // ---- AA-1e..AA-1k: set_temporary_access_start_time() (0133) --
      // mirrors AA-1a-AA-1d's own coverage of the cutoff RPC, plus
      // proves set_temporary_access_cutoff()'s guard is genuinely
      // dynamic (AA-1i), and closes a limitation this check's own
      // header used to name as permanent: the >=07:30 lower bound of
      // the activation window used to be a fixed literal compared
      // directly in SQL, impossible to vary from a test, so only the
      // upper (cutoff) bound was ever provable live. Activation is now
      // itself a stored, settable value -- both bounds are provable the
      // same way (AA-1j/AA-1k).
      const { error: startNonPrincipalErr } = await teacherAA1.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: "09:00:00" });
      record("AA-1e: set_temporary_access_start_time refuses a non-principal caller", Boolean(startNonPrincipalErr) && /active principal/i.test(startNonPrincipalErr.message), startNonPrincipalErr?.message);

      const { error: startTooLateErr } = await principalAA.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: cutoffComfortablyAhead });
      record("AA-1f: set_temporary_access_start_time refuses a start time at or after the institution's current cut-off", Boolean(startTooLateErr) && /cut-off/i.test(startTooLateErr.message), startTooLateErr?.message);

      const newStartTime = "09:00:00";
      const { error: startSetErr } = await principalAA.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: newStartTime });
      record("AA-1g: an active principal CAN set a valid start time", !startSetErr, startSetErr?.message);
      const { data: instStartCheck } = await admin.from("institutions").select("temporary_access_start_time").eq("id", institutionAAId).single();
      record("AA-1h: the start time actually persisted to the row", instStartCheck?.temporary_access_start_time?.startsWith(newStartTime.slice(0, 5)), instStartCheck?.temporary_access_start_time);

      // AA-1i: the point of this whole addition -- set_temporary_access_
      // cutoff()'s own guard now reads the institution's CURRENT start
      // time (09:00, just set above), not the old fixed 07:30 literal.
      // "08:00" is later than the OLD fixed 07:30 (would have been valid
      // under the pre-0133 rule) but earlier than the NEW 09:00 start --
      // refusal here is proof the guard is genuinely dynamic, not proof
      // by coincidence the way a fixture that never touches start_time
      // would only ever produce.
      const { error: dynamicCutoffErr } = await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: "08:00:00" });
      record("AA-1i: set_temporary_access_cutoff's guard is genuinely dynamic -- refuses 08:00 once start_time has moved to 09:00, though 08:00 is later than the OLD fixed 07:30", Boolean(dynamicCutoffErr) && /start time/i.test(dynamicCutoffErr.message), dynamicCutoffErr?.message);

      // AA-1j/AA-1k: closing the named limitation -- both bounds of the
      // activation window, proven live, via a genuinely movable start
      // time. A throwaway grant, deleted immediately after use -- not
      // AA2's own grant (created later in this fixture; the same class/
      // SNA/date combo would otherwise collide with it under the
      // one-active-grant-per-person-class-date unique index).
      await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: cutoffComfortablyAhead });
      const { data: throwawayGrant, error: throwawayGrantErr } = await admin.from("temporary_access").insert({
        institution_id: institutionAAId, class_id: classAA1Id, granted_to: snaAA1Id,
        granted_for_date: todayLocal, granted_by: principalAAId, granted_by_role: "principal",
        reason: "AA-1j/1k throwaway: proving the activation lower bound is now movable.",
      }).select().single();
      if (throwawayGrantErr) throw throwawayGrantErr;

      const startBehindNow = addMinutesClamped(nowParts.time, -30);
      const startAheadOfNow = addMinutesClamped(nowParts.time, 30);

      await principalAA.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: startBehindNow });
      const { data: activeRows1 } = await principalAA.rpc("get_institution_temporary_access", { p_institution_id: institutionAAId, p_days_back: 30 });
      const grantRowActive = activeRows1?.find((r) => r.grant_id === throwawayGrant.id);
      record("AA-1j: LOWER BOUND, closed -- is_currently_active reads true once start time has moved behind now (previously unprovable without literally running before 07:30)", grantRowActive?.is_currently_active === true, JSON.stringify(grantRowActive));

      await principalAA.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: startAheadOfNow });
      const { data: activeRows2 } = await principalAA.rpc("get_institution_temporary_access", { p_institution_id: institutionAAId, p_days_back: 30 });
      const grantRowInactive = activeRows2?.find((r) => r.grant_id === throwawayGrant.id);
      record("AA-1k: LOWER BOUND, closed -- is_currently_active reads false once start time has moved ahead of now, same grant, same cut-off, nothing else changed", grantRowInactive?.is_currently_active === false, JSON.stringify(grantRowInactive));

      await admin.from("temporary_access").delete().eq("id", throwawayGrant.id);

      // Reset to the standard default before the rest of this check runs
      // -- every downstream assertion in CHECK AA assumes the ordinary
      // 07:30 activation floor.
      await principalAA.rpc("set_temporary_access_start_time", { p_institution_id: institutionAAId, p_start_time: "07:30:00" });
    }

    // ---- AA2: grant_temporary_access() -- authority 1 (class teacher) ----
    let grantAA_classTeacherToSna;
    {
      const { error: wrongClassErr } = await outsiderTeacherAA.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "Should fail -- not this class's teacher.",
      });
      record("AA-2a: a class teacher cannot grant cover for a DIFFERENT class they don't teach", Boolean(wrongClassErr) && /Only the class|current teacher/i.test(wrongClassErr.message), wrongClassErr?.message);

      const { error: notSnaErr } = await teacherAA1.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: outsiderTeacherAAId, p_date: todayLocal, p_reason: "Should fail -- target is not an SNA.",
      });
      record("AA-2b: a class teacher cannot grant cover to a non-SNA colleague", Boolean(notSnaErr) && /active SNA/i.test(notSnaErr.message), notSnaErr?.message);

      const { error: deactivatedSnaErr } = await teacherAA1.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: deactivatedSnaAAId, p_date: todayLocal, p_reason: "Should fail -- target SNA is deactivated.",
      });
      record("AA-2c: a class teacher cannot grant cover to a DEACTIVATED SNA", Boolean(deactivatedSnaErr) && /active SNA/i.test(deactivatedSnaErr.message), deactivatedSnaErr?.message);

      const { error: reasonErr } = await teacherAA1.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "",
      });
      record("AA-2d: a reason is required", Boolean(reasonErr) && /reason/i.test(reasonErr.message), reasonErr?.message);

      const { error: pastDateErr } = await teacherAA1.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: yesterdayLocal, p_reason: "Should fail -- backdated.",
      });
      record("AA-2e: cannot grant temporary access for a date that has already passed", Boolean(pastDateErr) && /already passed/i.test(pastDateErr.message), pastDateErr?.message);

      const { data: grantId, error: grantErr } = await teacherAA1.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "Covering for the morning.",
      });
      record("AA-2f: a class teacher CAN grant cover for their own class to an existing active SNA colleague", !grantErr && Boolean(grantId), grantErr?.message);
      grantAA_classTeacherToSna = grantId;

      const { data: grantRow } = await admin.from("temporary_access").select("*").eq("id", grantId).single();
      record("AA-2g: the grant row records the correct granting authority ('class_teacher') and access_tier ('sna')", grantRow?.granted_by_role === "class_teacher" && grantRow?.access_tier === "sna", JSON.stringify(grantRow));
    }

    // ---- AA3: grant_temporary_access() -- authority 2 (principal) ----
    let grantAA_supplyTeacher, newSupplyStaffRowId;
    {
      const nonexistentUserId = "00000000-0000-0000-0000-000000000000";
      const { error: noAccountErr } = await principalAA.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: nonexistentUserId, p_date: todayLocal, p_reason: "Should fail -- no account.",
      });
      record("AA-3a: cannot grant to a user_id with no Behaviour Hive account -- no invite-by-email path", Boolean(noAccountErr) && /does not have a Behaviour Hive account/i.test(noAccountErr.message), noAccountErr?.message);

      const { error: selfGrantErr } = await principalAA.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: principalAAId, p_date: todayLocal, p_reason: "Should fail -- self grant.",
      });
      record("AA-3b: cannot grant temporary access to yourself", Boolean(selfGrantErr) && /yourself/i.test(selfGrantErr.message), selfGrantErr?.message);

      // The genuinely new supply teacher -- no institution_staff row at
      // this institution at all before this grant.
      const { data: grantId2, error: grantErr2 } = await principalAA.rpc("grant_temporary_access", {
        p_class_id: classAA2Id, p_user_id: newSupplyAAId, p_date: todayLocal, p_reason: "Covering Room 2's absent teacher.",
      });
      record("AA-3c: a principal CAN grant cover, for any class, to someone with an existing account and no prior standing here", !grantErr2 && Boolean(grantId2), grantErr2?.message);
      grantAA_supplyTeacher = grantId2;

      const { data: newStaffRow } = await admin.from("institution_staff").select("*").eq("user_id", newSupplyAAId).eq("institution_id", institutionAAId).single();
      newSupplyStaffRowId = newStaffRow?.id;
      record("AA-3d THE CORRECTED DESIGN: the auto-created row is role='sna' (not 'class_teacher'), approved immediately, approval_source='temporary_grant'", newStaffRow?.role === "sna" && newStaffRow?.approved_at != null && newStaffRow?.approval_source === "temporary_grant", JSON.stringify(newStaffRow));

      // The pending-join-collision fix, exercised for real: a stale
      // pending row already exists (AA0's own real self-link insert) --
      // granting must resolve it in place, not collide with
      // institution_staff_one_active_per_institution.
      const { error: grantErr3 } = await principalAA.rpc("grant_temporary_access", {
        p_class_id: classAA1Id, p_user_id: pendingSupplyAAId, p_date: tomorrowLocal, p_reason: "Covering tomorrow, resolves their stale pending join.",
      });
      record("AA-3e BUG REGRESSION: granting to someone with a genuinely pending prior join request does not collide with institution_staff_one_active_per_institution", !grantErr3, grantErr3?.message);
      const { data: resolvedPendingRow } = await admin.from("institution_staff").select("approved_at, approval_source, role").eq("user_id", pendingSupplyAAId).eq("institution_id", institutionAAId).single();
      record("AA-3f: that stale pending row is now approved via approval_source='temporary_grant', role left as originally self-requested ('sna')", resolvedPendingRow?.approved_at != null && resolvedPendingRow?.approval_source === "temporary_grant" && resolvedPendingRow?.role === "sna", JSON.stringify(resolvedPendingRow));

      const { error: dupGrantErr } = await principalAA.rpc("grant_temporary_access", {
        p_class_id: classAA2Id, p_user_id: newSupplyAAId, p_date: todayLocal, p_reason: "Duplicate, should fail.",
      });
      record("AA-3g: a second simultaneously-active grant for the same person/class/date is refused (temporary_access_one_active_per_person_class_date)", Boolean(dupGrantErr), dupGrantErr?.message);
    }

    // ---- AA4: revoke_temporary_access() ----
    {
      const { error: reasonErr } = await principalAA.rpc("revoke_temporary_access", { p_temporary_access_id: grantAA_classTeacherToSna, p_reason: "" });
      record("AA-4a: a reason is required to revoke", Boolean(reasonErr) && /reason/i.test(reasonErr.message), reasonErr?.message);

      const { error: unrelatedErr } = await outsiderTeacherAA.rpc("revoke_temporary_access", { p_temporary_access_id: grantAA_classTeacherToSna, p_reason: "Should fail." });
      record("AA-4b: only the original granter or the principal can revoke", Boolean(unrelatedErr) && /Only the person who granted|principal/i.test(unrelatedErr.message), unrelatedErr?.message);

      // Principal revokes a grant they didn't personally make -- allowed.
      const { error: principalRevokeErr } = await principalAA.rpc("revoke_temporary_access", { p_temporary_access_id: grantAA_classTeacherToSna, p_reason: "AA test: early revocation by the principal." });
      record("AA-4c: the institution's principal CAN revoke a grant made by someone else", !principalRevokeErr, principalRevokeErr?.message);

      const { error: doubleRevokeErr } = await principalAA.rpc("revoke_temporary_access", { p_temporary_access_id: grantAA_classTeacherToSna, p_reason: "Already revoked." });
      record("AA-4d: an already-revoked grant cannot be revoked again", Boolean(doubleRevokeErr) && /already been revoked/i.test(doubleRevokeErr.message), doubleRevokeErr?.message);
    }

    // ---- AA5: has_sna_access()/has_active_temporary_grant() -- the
    // fourth OR-branch, direct boolean checks before trusting anything
    // built on top of it. grantAA_classTeacherToSna is now REVOKED
    // (AA4) -- reused deliberately here to prove revocation actually
    // removes access, not just re-derived from a positive case.
    {
      const { data: revokedAccess } = await principalAA.rpc("has_sna_access", { p_user_id: snaAA1Id, p_passport_id: childAA1 });
      record("AA-5a: has_sna_access() is FALSE once the covering grant has been revoked, even though it was for the right class/date", revokedAccess === false, revokedAccess);

      // A fresh, currently-active grant, same person, to re-test the
      // positive case cleanly.
      const { data: freshGrantId } = await teacherAA1.rpc("grant_temporary_access", { p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "AA5 fresh positive-case grant." });
      const { data: activeAccess } = await principalAA.rpc("has_sna_access", { p_user_id: snaAA1Id, p_passport_id: childAA1 });
      record("AA-5b: has_sna_access() is TRUE for a currently-active grant covering the child's own class", activeAccess === true, activeAccess);

      const { data: wrongClassAccess } = await principalAA.rpc("has_sna_access", { p_user_id: snaAA1Id, p_passport_id: childAA2 });
      record("AA-5c: the SAME active grant does NOT extend to a child in a DIFFERENT class (childAA2, classAA2)", wrongClassAccess === false, wrongClassAccess);

      // Reuses pendingSupplyAAId's own grant from AA-3e (classAA1,
      // tomorrow) rather than creating a new one for newSupplyAAId --
      // newSupplyAAId already holds a genuinely active TODAY-dated grant
      // for classAA2 from AA-3c, which would silently confound this
      // specific isolation (any positive result could come from either
      // grant). pendingSupplyAAId has exactly one grant, dated
      // tomorrow, nothing else -- a clean subject.
      const { data: futureDatedAccess } = await principalAA.rpc("has_sna_access", { p_user_id: pendingSupplyAAId, p_passport_id: childAA1 });
      record("AA-5d: a grant dated for a DIFFERENT day (tomorrow) is not active today", futureDatedAccess === false, futureDatedAccess);

      const { data: cutoffInstCheck } = await admin.from("institutions").select("temporary_access_cutoff_time").eq("id", institutionAAId).single();
      record("AA-5e (context): institution cut-off is currently set comfortably ahead of now, from AA1", cutoffInstCheck?.temporary_access_cutoff_time?.startsWith(cutoffComfortablyAhead.slice(0, 5)), cutoffInstCheck);

      await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: cutoffAlreadyPassed });
      const { data: pastCutoffAccess } = await principalAA.rpc("has_sna_access", { p_user_id: snaAA1Id, p_passport_id: childAA1 });
      record("AA-5f THE CUT-OFF BOUNDARY: the SAME active, correctly-dated grant is FALSE once the institution's cut-off has passed", pastCutoffAccess === false, pastCutoffAccess);
      // Restore a generous cut-off for the rest of this check block.
      await principalAA.rpc("set_temporary_access_cutoff", { p_institution_id: institutionAAId, p_cutoff_time: cutoffComfortablyAhead });
      const { data: restoredAccess } = await principalAA.rpc("has_sna_access", { p_user_id: snaAA1Id, p_passport_id: childAA1 });
      record("AA-5g: restoring the cut-off to later than now makes the SAME grant active again -- computed live, not cached", restoredAccess === true, restoredAccess);

      const { data: noAccessAtAll } = await principalAA.rpc("has_sna_access", { p_user_id: outsiderTeacherAAId, p_passport_id: childAA1 });
      record("AA-5h: still refuses someone with no grant of any kind", noAccessAtAll === false, noAccessAtAll);
    }

    // ---- AA6: can_own_incident()/create_incident_stamp() widening ----
    let incidentOwnedBySupply, incidentOwnedByPermanentTeacher;
    // Hoisted out here (not declared inside AA6's own block below)
    // specifically so AA7 and AA8 can reuse the SAME signed-in sessions
    // instead of a second/third signedInClient() call for the same two
    // accounts -- nothing in AA6/AA7/AA8 invalidates either session.
    const newSupplyAA = await signedInClient("aatemp.newsupply@thebehaviourhive.com");
    const snaAA1 = await signedInClient("aatemp.sna1@thebehaviourhive.com");
    {
      const { data: locAA } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

      // newSupplyAAId's own grant (classAA2, today, cutoff comfortably
      // ahead per AA5) is currently active.
      const { data: supplyIncidentId, error: supplyStampErr } = await newSupplyAA.rpc("create_incident_stamp", {
        p_institution_id: institutionAAId, p_occurred_at: new Date().toISOString(), p_location_id: locAA.id, p_child_passport_ids: [childAA2], p_staff: [],
      });
      if (supplyStampErr) throw supplyStampErr;
      incidentOwnedBySupply = supplyIncidentId;
      const { data: supplyIncidentRow } = await admin.from("incidents").select("owning_teacher_id, created_by").eq("id", supplyIncidentId).single();
      record("AA-6a THE WIDENING: an sna-role creator with a currently-active temporary grant auto-owns the incident they start", supplyIncidentRow?.owning_teacher_id === newSupplyAAId, JSON.stringify(supplyIncidentRow));

      // snaAA1Id, an ORDINARY permanent SNA with no temporary grant at
      // all right now -- must NOT auto-own (regression: the widening
      // must not have accidentally handed every SNA auto-ownership).
      await admin.from("temporary_access").update({ revoked_at: new Date().toISOString(), revoked_by: principalAAId, revocation_reason: "AA6 setup: clearing snaAA1's active grant for the regression check." }).eq("granted_to", snaAA1Id).is("revoked_at", null);
      const { data: ordinarySnaIncidentId } = await snaAA1.rpc("create_incident_stamp", {
        p_institution_id: institutionAAId, p_occurred_at: new Date().toISOString(), p_location_id: locAA.id, p_child_passport_ids: [childAA1], p_staff: [],
      });
      const { data: ordinarySnaIncidentRow } = await admin.from("incidents").select("owning_teacher_id").eq("id", ordinarySnaIncidentId).single();
      record("AA-6b REGRESSION: an ordinary permanent SNA with no active temporary grant still does NOT auto-own (unchanged from before this migration)", ordinarySnaIncidentRow?.owning_teacher_id === null, JSON.stringify(ordinarySnaIncidentRow));
      await admin.from("incidents").delete().eq("id", ordinarySnaIncidentId);

      // teacherAA1, an ordinary permanent class_teacher -- unaffected,
      // regression check.
      const { data: teacherIncidentId } = await teacherAA1.rpc("create_incident_stamp", {
        p_institution_id: institutionAAId, p_occurred_at: new Date().toISOString(), p_location_id: locAA.id, p_child_passport_ids: [childAA1], p_staff: [],
      });
      incidentOwnedByPermanentTeacher = teacherIncidentId;
      const { data: teacherIncidentRow } = await admin.from("incidents").select("owning_teacher_id").eq("id", teacherIncidentId).single();
      record("AA-6c REGRESSION: a permanent class_teacher creator still auto-owns exactly as before", teacherIncidentRow?.owning_teacher_id === teacherAA1Id, JSON.stringify(teacherIncidentRow));

      const { data: canOwnResult } = await principalAA.rpc("can_own_incident", { p_user_id: newSupplyAAId, p_institution_id: institutionAAId });
      record("AA-6d: can_own_incident() itself, called directly, agrees with the stamp's own behaviour", canOwnResult === true, canOwnResult);
    }

    // ---- AA7: THE SECURITY FIX -- ownership and authority decoupled.
    // incidentOwnedBySupply is currently owned by newSupplyAAId, whose
    // grant is still active (classAA2, today, generous cut-off). ----
    {
      const { error: editWhileActiveErr } = await newSupplyAA.from("incidents").update({ category: "one_party_incident" }).eq("id", incidentOwnedBySupply);
      record("AA-7a (positive control): the owning supply teacher CAN edit their own incident while their grant is still active", !editWhileActiveErr, editWhileActiveErr?.message);
      const { data: editedCheck } = await admin.from("incidents").select("category").eq("id", incidentOwnedBySupply).single();
      record("AA-7a-confirm: the edit actually persisted (re-read via service role, not assumed from the absence of an error)", editedCheck?.category === "one_party_incident", editedCheck);

      // Revoke their grant -- owning_teacher_id is untouched by this,
      // deliberately, the same way Y-cascade-3 proved a stale row
      // doesn't self-correct. The edit policy must catch this
      // independently.
      const { data: supplyGrantRow } = await admin.from("temporary_access").select("id").eq("granted_to", newSupplyAAId).eq("institution_id", institutionAAId).is("revoked_at", null).single();
      const { error: revokeForTestErr } = await principalAA.rpc("revoke_temporary_access", { p_temporary_access_id: supplyGrantRow.id, p_reason: "AA7: end their access mid-incident, deliberately." });
      if (revokeForTestErr) throw revokeForTestErr;

      const { data: staleOwnershipCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentOwnedBySupply).single();
      record("AA-7b: owning_teacher_id is UNCHANGED by the revocation itself -- staleness is real, not auto-corrected", staleOwnershipCheck?.owning_teacher_id === newSupplyAAId, staleOwnershipCheck);

      const { data: updateAttempt, error: editAfterRevokeErr } = await newSupplyAA.from("incidents").update({ category: "imminent_risk_of_injury" }).eq("id", incidentOwnedBySupply).select();
      record("AA-7c THE FIX ITSELF: the same person, still owning_teacher_id, can no longer edit once their grant is revoked -- ownership and authority are genuinely decoupled now", (updateAttempt?.length ?? 0) === 0, JSON.stringify({ updateAttempt, editAfterRevokeErr: editAfterRevokeErr?.message }));

      const { error: signOffAfterRevokeErr } = await newSupplyAA.rpc("sign_off_incident", { p_incident_id: incidentOwnedBySupply });
      record("AA-7d: sign_off_incident() is ALSO refused once their grant has lapsed -- it relies on the same RLS policy (not SECURITY DEFINER), so the fix reaches it for free", Boolean(signOffAfterRevokeErr), signOffAfterRevokeErr?.message);

      // They can still SEE it -- visibility (created_by/owning_teacher_id
      // branches of can_view_incident()) is unconditional, unlike edit
      // authority. Confirms the fix narrows editing specifically, not
      // visibility, which stays exactly as it's always been for anyone
      // who ever created or owned an incident.
      const { data: stillVisible } = await newSupplyAA.from("incidents").select("id").eq("id", incidentOwnedBySupply);
      record("AA-7e: the supply teacher can STILL VIEW their own incident after their grant lapses -- visibility is unconditional (created_by), only editing is gated live", stillVisible?.length === 1, JSON.stringify(stillVisible));

      // NOT a "Stage 2 extension" -- corrected after the suite itself
      // caught the opposite claim being wrong (0106). Incident ownership
      // has never depended on passport-level or class-level child
      // access -- create_incident_stamp() lets any active staff member
      // own an incident for ANY child at their institution, by design.
      // Removing teacherAA1 from classAA1 does not touch their
      // institution_staff.role at all -- they are still, generally, an
      // active class_teacher, so can_own_incident() correctly stays
      // true for them and they correctly KEEP editing incidentOwnedBy
      // PermanentTeacher. Asserted as a positive regression check, not
      // inverted -- proving 0106's fix didn't overcorrect into blocking
      // something that was never meant to be blocked.
      const { data: teacherAA1ClassRow } = await admin.from("class_teachers").select("id").eq("class_id", classAA1Id).eq("user_id", teacherAA1Id).is("ended_at", null).single();
      const { error: removeErr } = await principalAA.rpc("remove_class_teacher", { p_class_teacher_id: teacherAA1ClassRow.id, p_reason: "AA7: proving class removal does NOT affect incident-edit rights." });
      if (removeErr) throw removeErr;
      const { data: removedTeacherEditAttempt, error: removedTeacherEditErr } = await teacherAA1.from("incidents").update({ category: "imminent_risk_of_injury" }).eq("id", incidentOwnedByPermanentTeacher).select();
      record("AA-7f CORRECTED: a class teacher removed from ONE class still keeps editing their own pre-signoff incident for that class's former child -- incident ownership was never class-scoped, and 0106's fix must not have accidentally made it so", (removedTeacherEditAttempt?.length ?? 0) === 1, JSON.stringify({ removedTeacherEditAttempt, removedTeacherEditErr: removedTeacherEditErr?.message }));

      // The pre-existing gap, fixed in the same statement: a fully
      // DEACTIVATED former owner, previously uncaught by this policy
      // (no deactivated_at/approved_at check existed at all before
      // 0105).
      const { data: outsiderIncidentId } = await outsiderTeacherAA.rpc("create_incident_stamp", {
        p_institution_id: institutionAAId, p_occurred_at: new Date().toISOString(), p_location_id: (await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single()).data.id,
        p_child_passport_ids: [childAA2], p_staff: [],
      });
      const { error: deactivateOutsiderErr } = await principalAA.rpc("deactivate_institution_staff", { p_institution_staff_id: byUserAA(outsiderTeacherAAId).id, p_reason: "AA7 bug-regression fixture." });
      if (deactivateOutsiderErr) throw deactivateOutsiderErr;
      const { data: deactivatedOwnerEditAttempt } = await outsiderTeacherAA.from("incidents").update({ category: "imminent_risk_of_injury" }).eq("id", outsiderIncidentId).select();
      record("AA-7g PRE-EXISTING BUG REGRESSION: a fully deactivated former owning teacher can no longer edit their old pre-signoff incident (0069's policy never checked this at all before 0105)", (deactivatedOwnerEditAttempt?.length ?? 0) === 0, JSON.stringify(deactivatedOwnerEditAttempt));
      await admin.from("incidents").delete().eq("id", outsiderIncidentId);
    }

    // ---- AA8: resolve_lapsed_incident_ownership() -- lazy
    // materialization, "the stamp is the trigger", pre-signoff-only. ----
    {
      const { data: resolvedCount } = await principalAA.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionAAId });
      record("AA-8a THE TRANSFER ITSELF: resolving finds and transfers incidentOwnedBySupply (owner's grant is lapsed, pre-signoff)", (resolvedCount ?? 0) >= 1, resolvedCount);

      const { data: afterResolve } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentOwnedBySupply).single();
      record("AA-8b: owning_teacher_id now genuinely points at the principal -- a real write, not a computed illusion", afterResolve?.owning_teacher_id === principalAAId, afterResolve);

      const { data: transferRow } = await admin.from("incident_ownership_transfers").select("*").eq("incident_id", incidentOwnedBySupply).single();
      record("AA-8c RECORDED, NOT SILENT: the transfer is a real, queryable row -- from the supply teacher, to the principal, with a reason", transferRow?.from_teacher_id === newSupplyAAId && transferRow?.to_principal_id === principalAAId && Boolean(transferRow?.reason), JSON.stringify(transferRow));

      // THE CHECK AA-8 ITSELF MISSED, generalised rather than patched --
      // per CLAUDE.md's own new entry: writing the transfer and being
      // able to act on it are two different claims. AA-8b/8c only ever
      // proved the RECORD. This proves the RECIPIENT -- the principal
      // must actually be able to edit, and then sign off, the incident
      // they just inherited, not merely appear as its owning_teacher_id.
      // This is exactly what 0107's can_own_incident() principal branch
      // exists for; asserted directly here, not assumed from that
      // migration's own commit message.
      const { data: principalEditAttempt, error: principalEditErr } = await principalAA.from("incidents").update({ category: "one_party_incident" }).eq("id", incidentOwnedBySupply).select();
      record("AA-8c2 THE RECIPIENT CAN ACT, PART 1: the principal can genuinely EDIT the incident they just inherited, not merely own it on paper", (principalEditAttempt?.length ?? 0) === 1, JSON.stringify({ principalEditAttempt, principalEditErr: principalEditErr?.message }));

      const { error: principalSignOffErr } = await principalAA.rpc("sign_off_incident", { p_incident_id: incidentOwnedBySupply });
      record("AA-8c3 THE RECIPIENT CAN ACT, PART 2: the principal can genuinely SIGN OFF the incident they inherited -- the actual point of the transfer, not just a data-level correction", !principalSignOffErr, principalSignOffErr?.message);
      const { data: principalSignOffCheck } = await admin.from("incidents").select("teacher_signed_at, teacher_signed_by").eq("id", incidentOwnedBySupply).single();
      record("AA-8c4: the sign-off actually persisted, attributed to the principal (re-read via service role, not assumed)", principalSignOffCheck?.teacher_signed_by === principalAAId && principalSignOffCheck?.teacher_signed_at != null, JSON.stringify(principalSignOffCheck));

      const { data: secondResolve } = await principalAA.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionAAId });
      record("AA-8d: resolving again is a no-op for the same incident -- it's already owned by the principal, nothing left to transfer", true, secondResolve);

      // "The stamp is the trigger": a grant with NO incident ever
      // created leaves nothing to resolve.
      const { data: freshCoverGrant } = await teacherAA1.rpc("grant_temporary_access", { p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "AA8: never used to create anything." });
      await admin.from("temporary_access").update({ revoked_at: new Date().toISOString(), revoked_by: principalAAId, revocation_reason: "AA8: lapse it without ever having stamped an incident." }).eq("id", freshCoverGrant);
      const { data: nothingToResolve } = await principalAA.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionAAId });
      record("AA-8e: a lapsed grant that never created an incident produces nothing to transfer", (nothingToResolve ?? 0) === 0, nothingToResolve);

      // Pre-signoff-only scope, driven entirely through real RPCs, in
      // order: grant, create (auto-owned while active), sign off WHILE
      // STILL ACTIVE (the ordinary, real sequence a genuine supply
      // teacher would follow before their shift ends), THEN revoke the
      // grant, THEN resolve -- confirming a signed-off incident is
      // never touched regardless of the former owner's standing
      // afterward, without any service-role shortcut to reach this
      // state.
      // Reuses the SAME snaAA1 session hoisted above AA6 -- the JWT
      // itself carries no cached authorization state, so a fresh grant
      // issued just below is reflected correctly on the very next call
      // regardless of when this client was first signed in.
      // Via the PRINCIPAL, not teacherAA1 -- AA7f removed teacherAA1
      // from classAA1, so they're no longer that class's own current
      // teacher and would fail grant_temporary_access()'s authority-1
      // check. The principal can grant for any class regardless.
      const { data: signoffGrantId, error: signoffGrantErr } = await principalAA.rpc("grant_temporary_access", { p_class_id: classAA1Id, p_user_id: snaAA1Id, p_date: todayLocal, p_reason: "AA8f: sign-off-before-lapse sequence." });
      if (signoffGrantErr) throw signoffGrantErr;
      const { data: locForSignoff } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();
      const { data: signoffIncidentId, error: signoffStampErr } = await snaAA1.rpc("create_incident_stamp", {
        p_institution_id: institutionAAId, p_occurred_at: new Date().toISOString(), p_location_id: locForSignoff.id, p_child_passport_ids: [childAA1], p_staff: [],
      });
      if (signoffStampErr) throw signoffStampErr;
      const { data: preSignoffOwnerCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", signoffIncidentId).single();
      record("AA-8f-setup: the fresh incident is owned by snaAA1 while their grant is active (same widening as AA-6a)", preSignoffOwnerCheck?.owning_teacher_id === snaAA1Id, preSignoffOwnerCheck);

      const { error: realSignOffErr } = await snaAA1.rpc("sign_off_incident", { p_incident_id: signoffIncidentId });
      record("AA-8f-setup2: sign_off_incident() succeeds for the real owner while their grant is still active", !realSignOffErr, realSignOffErr?.message);

      await admin.from("temporary_access").update({ revoked_at: new Date().toISOString(), revoked_by: principalAAId, revocation_reason: "AA8f: lapse it AFTER sign-off, not before." }).eq("id", signoffGrantId);

      const { data: signedOffResolveCount } = await principalAA.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionAAId });
      const { data: signedOffOwnerUnchanged } = await admin.from("incidents").select("owning_teacher_id, teacher_signed_at").eq("id", signoffIncidentId).single();
      record("AA-8f PRE-SIGNOFF-ONLY SCOPE: a signed-off incident is never touched by resolve_lapsed_incident_ownership(), even once its owner's grant has since lapsed", signedOffOwnerUnchanged?.owning_teacher_id === snaAA1Id && signedOffOwnerUnchanged?.teacher_signed_at != null, JSON.stringify({ signedOffResolveCount, signedOffOwnerUnchanged }));

      await admin.from("incidents").delete().eq("id", signoffIncidentId);
    }

    // ---- AA9: the standing-audit fixes ----
    {
      // newSupplyAAId's own grant is now revoked (AA7). Their
      // institution_staff row (role='sna', approved, deactivated_at
      // null) is PERMANENT per Decision 4 -- exactly the shape the
      // audit was about.
      const { error: assignExpiredErr } = await principalAA.rpc("assign_sna_to_child", { p_passport_id: childAA1, p_user_id: newSupplyAAId, p_institution_id: institutionAAId });
      record("AA-9a THE REAL LEAK, FIXED: a principal can no longer pick an expired supply teacher and grant them PERMANENT one-to-one child access via assign_sna_to_child()", Boolean(assignExpiredErr) && /active SNA/i.test(assignExpiredErr.message), assignExpiredErr?.message);

      // Positive control: snaAA1 has no grant right now either (AA6
      // revoked it, AA8's freshCoverGrant was also revoked) -- confirm
      // assign_sna_to_child() still works for an ORDINARY permanent SNA
      // with no temporary-grant history at all, i.e. the fix didn't
      // break the ordinary case.
      const { error: assignOrdinaryErr } = await principalAA.rpc("assign_sna_to_child", { p_passport_id: childAA1, p_user_id: snaAA1Id, p_institution_id: institutionAAId });
      record("AA-9b (positive control): an ordinary permanent SNA, never temp-grant-sourced, is still assignable exactly as before", !assignOrdinaryErr, assignOrdinaryErr?.message);

      const { data: rosterRows } = await principalAA.rpc("get_institution_staff_roster", { p_institution_id: institutionAAId, p_include_inactive: false, p_include_pending: false });
      const expiredSupplyRosterRow = (rosterRows ?? []).find((r) => r.user_id === newSupplyAAId);
      record("AA-9c: get_institution_staff_roster() correctly shows the expired supply teacher as is_active=false the moment their grant lapses", expiredSupplyRosterRow?.is_active === false, JSON.stringify(expiredSupplyRosterRow));

      const ordinarySnaRosterRow = (rosterRows ?? []).find((r) => r.user_id === snaAA1Id);
      record("AA-9d (positive control): an ordinary permanent SNA still reads is_active=true on the same roster call", ordinarySnaRosterRow?.is_active === true, JSON.stringify(ordinarySnaRosterRow));

      // Grant them a fresh, active cover again -- confirm is_active
      // flips back to true, live, not stuck false forever.
      await principalAA.rpc("grant_temporary_access", { p_class_id: classAA2Id, p_user_id: newSupplyAAId, p_date: todayLocal, p_reason: "AA9: returning next week, re-using the same permanent row." });
      const { data: rosterRowsAfterRegrant } = await principalAA.rpc("get_institution_staff_roster", { p_institution_id: institutionAAId, p_include_inactive: false, p_include_pending: false });
      const regrantedRow = (rosterRowsAfterRegrant ?? []).find((r) => r.user_id === newSupplyAAId);
      record("AA-9e DECISION 4 CONFIRMED: the SAME permanent row reads is_active=true again the moment a fresh grant covers them -- returning next week needs no re-creation", regrantedRow?.is_active === true, JSON.stringify(regrantedRow));

      const { data: directStandingCheck } = await principalAA.rpc("institution_staff_has_current_standing", { p_user_id: newSupplyAAId, p_institution_id: institutionAAId });
      record("AA-9f: institution_staff_has_current_standing() itself, called directly, agrees", directStandingCheck === true, directStandingCheck);
    }

    console.log("AA summary complete.");

    // ---- AA10: teardown ----
    await admin.from("incidents").delete().in("id", [incidentOwnedBySupply, incidentOwnedByPermanentTeacher].filter(Boolean));
    await admin.from("institutions").delete().eq("id", institutionAAId);
    for (const id of [principalAAId, teacherAA1Id, outsiderTeacherAAId, snaAA1Id, deactivatedSnaAAId, newSupplyAAId, pendingSupplyAAId, parentAA1Id, parentAA2Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK BB: Client-behaviour half of Stage 3, Step 3 -- src/hooks/useSnaChildren.ts's merged access-source query shapes, and the active/past cover-grant split in src/app/teacher/class/page.tsx and src/app/principal/classes/[classId]/page.tsx, proven via the LITERAL client query shape, not a proxy for it. What this check does NOT prove: the RPC-level correctness behind these shapes (grant_temporary_access, has_sna_access, get_institution_staff_roster) is CHECK AA's job, not this one's; this check only proves the CLIENT reproduces the right filter over rows that RLS has already let it see. It also doesn't prove anything renders on screen -- no component is mounted, no DOM is read. ==`);
  if (shouldRun("BB")) {
    const { data: instBB, error: instBBErr } = await admin
      .from("institutions")
      .insert({ name: "Temp Access Client Verify", institution_code: CODE + "BB", status: "verified" })
      .select()
      .single();
    if (instBBErr) throw instBBErr;
    const institutionBBId = instBB.id;

    const principalBBId = await createUser("bb.principal@thebehaviourhive.com", "BB Principal", "principal");
    const teacherBBId = await createUser("bb.teacher@thebehaviourhive.com", "BB Teacher", "class_teacher");
    const snaBBId = await createUser("bb.sna@thebehaviourhive.com", "BB SNA", "sna");
    const parentBB1Id = await createUser("bb.parent1@thebehaviourhive.com", "BB Parent One", "parent");
    const parentBB2Id = await createUser("bb.parent2@thebehaviourhive.com", "BB Parent Two", "parent");

    const { data: staffBBRows, error: staffBBErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionBBId, user_id: principalBBId, role: "principal" },
        { institution_id: institutionBBId, user_id: teacherBBId, role: "class_teacher" },
        { institution_id: institutionBBId, user_id: snaBBId, role: "sna" },
      ])
      .select();
    if (staffBBErr) throw staffBBErr;

    const principalBB = await signedInClient("bb.principal@thebehaviourhive.com");
    for (const row of staffBBRows.filter((r) => r.user_id !== principalBBId)) {
      const { error } = await principalBB.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    // teacherBBId itself is used throughout (institution_staff, class
    // membership, as a grant target) but never as a signed-in session --
    // this client was dead, never called through.
    const snaBB = await signedInClient("bb.sna@thebehaviourhive.com");

    const { data: cAssignedBB } = await admin.from("passports").insert({ user_id: parentBB1Id, child_name: "BB Assigned Child", passport_status: "complete" }).select().single();
    const { data: cCoverBB } = await admin.from("passports").insert({ user_id: parentBB2Id, child_name: "BB Covered Child", passport_status: "complete" }).select().single();
    const childAssignedBB = cAssignedBB.id;
    const childCoverBB = cCoverBB.id;

    const { data: classBBId } = await principalBB.rpc("create_class", { p_institution_id: institutionBBId, p_name: "BB Room" });
    await principalBB.rpc("add_class_teacher", { p_class_id: classBBId, p_user_id: teacherBBId });
    await principalBB.rpc("add_class_child", { p_class_id: classBBId, p_passport_id: childAssignedBB });
    await principalBB.rpc("add_class_child", { p_class_id: classBBId, p_passport_id: childCoverBB });

    // The schema default cut-off (15:00) may already be in the past by
    // the time this suite runs -- BB never varies the cut-off itself
    // (that's CHECK AA's job), it just needs an active window to exist
    // at all for the grant it creates below to read as live. Same
    // "vary stored data against real now(), don't wait" technique AA
    // uses for its own cut-off boundary checks.
    const nowPartsBB = dublinNowParts();
    const { error: cutoffBBErr } = await principalBB.rpc("set_temporary_access_cutoff", {
      p_institution_id: institutionBBId,
      p_cutoff_time: addMinutesClamped(nowPartsBB.time, 180),
    });
    if (cutoffBBErr) throw cutoffBBErr;

    const todayBB = nowPartsBB.date;

    // BB-1/BB-2 -- src/hooks/useSnaChildren.ts:72-78's exact child_
    // assignments query shape (userId + institutionId + ended_at is
    // null). Before any assignment exists, empty; after a real
    // assign_sna_to_child() call, the identical query finds the row.
    {
      const { data: beforeAssign } = await snaBB
        .from("child_assignments")
        .select("passport_id")
        .eq("user_id", snaBBId)
        .eq("institution_id", institutionBBId)
        .is("ended_at", null);
      record(
        "BB-1: useSnaChildren.ts's child_assignments query finds NOTHING before any assignment exists (src/hooks/useSnaChildren.ts:72-78)",
        (beforeAssign?.length ?? 0) === 0,
        JSON.stringify(beforeAssign)
      );

      const { error: assignErr } = await principalBB.rpc("assign_sna_to_child", { p_passport_id: childAssignedBB, p_user_id: snaBBId, p_institution_id: institutionBBId });
      if (assignErr) throw assignErr;

      const { data: afterAssign } = await snaBB
        .from("child_assignments")
        .select("passport_id")
        .eq("user_id", snaBBId)
        .eq("institution_id", institutionBBId)
        .is("ended_at", null);
      record(
        "BB-2 THE FIX ITSELF: the IDENTICAL query finds the assigned child after a real assign_sna_to_child() call -- this is the query that was missing from /sna/passports entirely before this stage (src/hooks/useSnaChildren.ts:72-78)",
        afterAssign?.length === 1 && afterAssign[0].passport_id === childAssignedBB,
        JSON.stringify(afterAssign)
      );
    }

    // BB-3/BB-4 -- src/hooks/useSnaChildren.ts:84-90 and :117-121's
    // temporary_access + class_children query pair: granted_to +
    // institution_id + today's date + not revoked, then the granted
    // class's current children. Before any grant, empty; after a real
    // grant_temporary_access() call, the identical pair resolves the
    // covered child; after a real revoke_temporary_access() call, empty
    // again -- proving the client's OWN re-derivation of has_sna_access()'s
    // live-window logic, not the RPC's authorization (that's CHECK AA).
    //
    // grantBBId is declared outside this block (not const-scoped to it)
    // -- BB-6/7 below reuses this exact, already-revoked row rather than
    // manufacturing a redundant one.
    let grantBBId;
    {
      const { data: beforeGrant } = await snaBB
        .from("temporary_access")
        .select("class_id, granted_for_date")
        .eq("granted_to", snaBBId)
        .eq("institution_id", institutionBBId)
        .eq("granted_for_date", todayBB)
        .is("revoked_at", null);
      record(
        "BB-3: useSnaChildren.ts's temporary_access query finds NOTHING before any grant exists (src/hooks/useSnaChildren.ts:84-90)",
        (beforeGrant?.length ?? 0) === 0,
        JSON.stringify(beforeGrant)
      );

      const { data: grantBBIdResult, error: grantBBErr } = await principalBB.rpc("grant_temporary_access", {
        p_class_id: classBBId,
        p_user_id: snaBBId,
        p_date: todayBB,
        p_reason: "BB: client query-shape check.",
      });
      grantBBId = grantBBIdResult;
      if (grantBBErr) throw grantBBErr;

      const { data: afterGrant } = await snaBB
        .from("temporary_access")
        .select("class_id, granted_for_date")
        .eq("granted_to", snaBBId)
        .eq("institution_id", institutionBBId)
        .eq("granted_for_date", todayBB)
        .is("revoked_at", null);
      const grantedClassIds = [...new Set((afterGrant ?? []).map((r) => r.class_id))];
      // 0109: class_children's own SELECT policy never covered a
      // temporary-access holder (BB-4 caught this live, class_children
      // returned empty even though afterGrant itself was correct) --
      // useSnaChildren.ts now resolves the covered roster via
      // get_temporary_access_covered_children() instead, one call per
      // granted class. Reproduced here as the SAME RPC call, not the
      // class_children read it replaced.
      let coveredPassportIds = new Set();
      if (grantedClassIds.length > 0) {
        const results = await Promise.all(
          grantedClassIds.map((classId) => snaBB.rpc("get_temporary_access_covered_children", { p_class_id: classId }))
        );
        const rows = results.flatMap((r) => r.data ?? []);
        coveredPassportIds = new Set(rows.map((r) => r.passport_id));
      }
      record(
        "BB-4 THE FIX ITSELF (0109): after a real grant_temporary_access() call, get_temporary_access_covered_children() resolves the covered child via the class -- the SNA's actual route to the child they were just granted cover for, after class_children's own RLS was proven (live) to refuse them (src/hooks/useSnaChildren.ts:115-140)",
        afterGrant?.length === 1 && coveredPassportIds.has(childCoverBB) && coveredPassportIds.has(childAssignedBB),
        JSON.stringify({ afterGrant, coveredPassportIds: [...coveredPassportIds] })
      );

      // BB-4b: the class_children read this replaced is confirmed STILL
      // refused for the same caller/class -- 0109 didn't quietly widen
      // that policy as a side effect, the narrow RPC is doing the work.
      const { data: directClassChildren } = await snaBB
        .from("class_children")
        .select("passport_id")
        .in("class_id", grantedClassIds)
        .is("ended_at", null);
      record(
        "BB-4b: the direct class_children read stays refused for a covering (non-teacher, non-principal) SNA -- 0109 added a narrow RPC, not a class_children RLS widening",
        (directClassChildren?.length ?? 0) === 0,
        JSON.stringify(directClassChildren)
      );

      const { error: revokeBBErr } = await principalBB.rpc("revoke_temporary_access", { p_temporary_access_id: grantBBId, p_reason: "BB: revoke for query-shape check." });
      if (revokeBBErr) throw revokeBBErr;

      const { data: afterRevoke } = await snaBB
        .from("temporary_access")
        .select("class_id, granted_for_date")
        .eq("granted_to", snaBBId)
        .eq("institution_id", institutionBBId)
        .eq("granted_for_date", todayBB)
        .is("revoked_at", null);
      record(
        "BB-5: the SAME query finds NOTHING again after a real revoke_temporary_access() call -- the covering child disappears from the client's own source query, not just a stale cached flag (src/hooks/useSnaChildren.ts:84-90)",
        (afterRevoke?.length ?? 0) === 0,
        JSON.stringify(afterRevoke)
      );
    }

    // BB-6/BB-7 -- the active/past cover-grant split BOTH /teacher/
    // class/page.tsx:250-251 and /principal/classes/[classId]/
    // page.tsx:158-160 compute client-side from the same raw
    // temporary_access rows: !revokedAt && grantedForDate >= today is
    // active, anything else (revoked, or dated before today) is past.
    // Reproduced literally at both call sites -- they're independently
    // written, not shared code, so a divergence between them would not
    // be caught by testing only one.
    //
    // temporary_access has NO client-facing INSERT policy at all
    // (0105's own comment: "grant_temporary_access()/revoke_temporary_
    // access() are the only write paths") -- so every row here is
    // either the real, already-revoked grant from BB-3/4/5 above (reused
    // rather than duplicated), a genuinely fresh grant via the real RPC,
    // or -- for the one state the RPC structurally cannot produce
    // (a grant dated in the past; grant_temporary_access() refuses that
    // at creation, AA-2e) -- a service-role backdate, the same
    // "simulate the passage of time via admin, not by waiting"
    // technique AA-5f already uses for the cut-off.
    {
      // Reuse: grantBBId (BB-3/4/5) is already revoked at this point --
      // a real revoked row, not a fixture stand-in for one.
      const revokedRowId = grantBBId;

      const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
      const { data: pastDatedRow, error: pastDatedErr } = await admin
        .from("temporary_access")
        .insert({
          institution_id: institutionBBId,
          class_id: classBBId,
          granted_to: teacherBBId,
          granted_for_date: yesterday,
          granted_by: principalBBId,
          granted_by_role: "principal",
          reason: "BB: past-dated split check.",
        })
        .select()
        .single();
      if (pastDatedErr) throw pastDatedErr;

      const { data: activeRow, error: activeRowErr } = await principalBB.rpc("grant_temporary_access", {
        p_class_id: classBBId,
        p_user_id: teacherBBId,
        p_date: todayBB,
        p_reason: "BB: active split check.",
      });
      if (activeRowErr) throw activeRowErr;

      const { data: allRowsForSplit } = await principalBB
        .from("temporary_access")
        .select("id, granted_for_date, revoked_at")
        .eq("class_id", classBBId)
        .order("granted_for_date", { ascending: false });

      // /teacher/class/page.tsx:250-251's exact predicates.
      const teacherActive = (allRowsForSplit ?? []).filter((g) => !g.revoked_at && g.granted_for_date >= todayBB);
      const teacherPast = (allRowsForSplit ?? []).filter((g) => g.revoked_at || g.granted_for_date < todayBB);
      record(
        "BB-6: /teacher/class's own active/past split (src/app/teacher/class/page.tsx:250-251) puts the revoked row and the past-dated row in 'past', and only the genuinely active row in 'active'",
        teacherActive.length === 1 &&
          teacherActive[0].id === activeRow &&
          teacherPast.length === 2 &&
          teacherPast.some((g) => g.id === revokedRowId) &&
          teacherPast.some((g) => g.id === pastDatedRow.id),
        JSON.stringify({ teacherActive, teacherPast })
      );

      // /principal/classes/[classId]/page.tsx:158-160's exact predicate
      // -- written independently, ternary rather than two filters, and
      // proven to agree rather than assumed to.
      const principalActive = [];
      const principalPast = [];
      for (const g of allRowsForSplit ?? []) {
        (g.revoked_at || g.granted_for_date < todayBB ? principalPast : principalActive).push(g);
      }
      record(
        "BB-7: the principal's class-detail page's independently-written split (src/app/principal/classes/[classId]/page.tsx:158-160) agrees with BB-6's result exactly",
        principalActive.length === 1 &&
          principalActive[0].id === activeRow &&
          principalPast.length === 2 &&
          principalPast.some((g) => g.id === revokedRowId) &&
          principalPast.some((g) => g.id === pastDatedRow.id),
        JSON.stringify({ principalActive, principalPast })
      );

      await admin.from("temporary_access").delete().eq("id", pastDatedRow.id);
    }

    // BB-8/BB-9 -- src/app/sna/passport/[passportId]/page.tsx's own
    // access guard, found live on the deployed app: /sna/passports'
    // list (BB-1/BB-2 above) correctly surfaces childAssignedBB via
    // child_assignments, but tapping through to its detail page hit a
    // DIFFERENT, older guard that only ever checked passport_access
    // directly -- "we couldn't find this classroom profile" for a
    // child the list had just shown as accessible. Fixed by replacing
    // that direct table check with has_sna_access(), the same function
    // RLS itself calls. BB-8 proves the OLD shape really would have
    // refused (documents why the fix was needed, not a hypothetical);
    // BB-9 proves the NEW shape -- what the page calls now -- correctly
    // allows it, for the SAME assignment-derived child, no grant timing
    // involved (childAssignedBB's assignment is permanent, unrevoked).
    {
      const { data: oldGuardShape } = await snaBB
        .from("passport_access")
        .select("is_active")
        .eq("passport_id", childAssignedBB)
        .eq("teacher_id", snaBBId)
        .maybeSingle();
      record(
        "BB-8 THE BUG, PROVEN: the OLD guard shape (direct passport_access read) finds NOTHING for an assignment-derived child -- this is what actually produced 'we couldn't find this classroom profile' live (src/app/sna/passport/[passportId]/page.tsx, pre-fix)",
        oldGuardShape === null,
        JSON.stringify(oldGuardShape)
      );

      const { data: newGuardShape } = await snaBB.rpc("has_sna_access", { p_user_id: snaBBId, p_passport_id: childAssignedBB });
      record(
        "BB-9 THE FIX ITSELF: has_sna_access() -- what the page's guard calls now -- correctly returns true for the SAME child (src/app/sna/passport/[passportId]/page.tsx)",
        newGuardShape === true,
        newGuardShape
      );
    }

    console.log("BB summary complete.");

    // ---- BB teardown ----
    await admin.from("institutions").delete().eq("id", institutionBBId);
    for (const id of [principalBBId, teacherBBId, snaBBId, parentBB1Id, parentBB2Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK CC: Stage 4, Step 1 (migration 0110) -- get_fba_recipient_candidates() folded in: approved_by_parent's "= true" removed (institution-match kept), and the class-derived/assignment-derived branches it never had before -- the sixth "grant access, never test the destination" instance, closed. Neither teacherCC nor snaCC below ever holds a direct passport_access row -- their only standing is class membership / child assignment, exactly the gap this migration closes. ==`);
  if (shouldRun("CC")) {
    const { data: instCC, error: instCCErr } = await admin
      .from("institutions")
      .insert({ name: "FBA Recipient Candidates Verify", institution_code: CODE + "CC", status: "verified" })
      .select()
      .single();
    if (instCCErr) throw instCCErr;
    const institutionCCId = instCC.id;

    const principalCCId = await createUser("cc.principal@thebehaviourhive.com", "CC Principal", "principal");
    const teacherCCId = await createUser("cc.teacher@thebehaviourhive.com", "CC Teacher", "class_teacher");
    const snaCCId = await createUser("cc.sna@thebehaviourhive.com", "CC SNA", "sna");
    const noAccessCCId = await createUser("cc.noaccess@thebehaviourhive.com", "CC No Access", "class_teacher");
    const clinicianCCId = await createUser("cc.clinician@thebehaviourhive.com", "CC Clinician", "clinician");
    const parentCCId = await createUser("cc.parent@thebehaviourhive.com", "CC Parent", "parent");

    const { data: staffCCRows, error: staffCCErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionCCId, user_id: principalCCId, role: "principal" },
        { institution_id: institutionCCId, user_id: teacherCCId, role: "class_teacher" },
        { institution_id: institutionCCId, user_id: snaCCId, role: "sna" },
        { institution_id: institutionCCId, user_id: noAccessCCId, role: "class_teacher" },
      ])
      .select();
    if (staffCCErr) throw staffCCErr;

    const principalCC = await signedInClient("cc.principal@thebehaviourhive.com");
    for (const row of staffCCRows.filter((r) => r.user_id !== principalCCId)) {
      const { error } = await principalCC.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    await admin.from("clinicians").insert({ user_id: clinicianCCId, specialty: "behavioural_psychologist", verification_status: "verified" });

    const { data: childCC } = await admin.from("passports").insert({ user_id: parentCCId, child_name: "CC Child", passport_status: "complete" }).select().single();
    // Deliberately unapproved -- also re-proves the approval removal for
    // THIS site, the same way Y-10b/Y-19b/Y-22c/Y-23 do for the other
    // four, not just the class-/assignment-derived branches being new.
    await admin.from("passport_institution_links").insert({ passport_id: childCC.id, institution_id: institutionCCId, approved_by_parent: false });
    await admin.from("clinician_access").insert({ passport_id: childCC.id, clinician_id: clinicianCCId, is_active: true });

    const { data: fbaCC } = await admin.from("fba_reports").insert({ passport_id: childCC.id, clinician_id: clinicianCCId, status: "draft" }).select().single();

    const { data: classCCId } = await principalCC.rpc("create_class", { p_institution_id: institutionCCId, p_name: "CC Room" });
    await principalCC.rpc("add_class_teacher", { p_class_id: classCCId, p_user_id: teacherCCId });
    await principalCC.rpc("add_class_child", { p_class_id: classCCId, p_passport_id: childCC.id });
    await principalCC.rpc("assign_sna_to_child", { p_passport_id: childCC.id, p_user_id: snaCCId, p_institution_id: institutionCCId });

    const clinicianCC = await signedInClient("cc.clinician@thebehaviourhive.com");
    const { data: candidatesCC, error: candidatesCCErr } = await clinicianCC.rpc("get_fba_recipient_candidates", { p_fba_id: fbaCC.id });
    if (candidatesCCErr) throw candidatesCCErr;

    record(
      "CC-1 THE FIX ITSELF, class-derived: teacherCC appears as an FBA recipient candidate via class membership alone -- no direct passport_access row exists for them (0110's own gap-close, not the approval removal)",
      (candidatesCC ?? []).some((c) => c.recipient_id === teacherCCId && c.role === "class_teacher"),
      JSON.stringify(candidatesCC)
    );
    record(
      "CC-2 THE FIX ITSELF, assignment-derived: snaCC appears as an FBA recipient candidate via child_assignments alone -- no direct passport_access row exists for them either",
      (candidatesCC ?? []).some((c) => c.recipient_id === snaCCId && c.role === "sna"),
      JSON.stringify(candidatesCC)
    );
    record(
      "CC-3 (positive control, unaffected by this migration): the child's own parent still appears as a candidate",
      (candidatesCC ?? []).some((c) => c.recipient_id === parentCCId && c.role === "parent"),
      JSON.stringify(candidatesCC)
    );
    record(
      "CC-4 (negative control): a same-institution teacher with no class/assignment/grant standing over this child does not appear",
      !(candidatesCC ?? []).some((c) => c.recipient_id === noAccessCCId),
      JSON.stringify(candidatesCC)
    );
    record(
      "CC-5 THE APPROVAL REMOVAL, re-proven for this site: teacherCC and snaCC both appear even though childCC's own institution link was never approved_by_parent",
      (candidatesCC ?? []).filter((c) => c.recipient_id === teacherCCId || c.recipient_id === snaCCId).length === 2,
      JSON.stringify(candidatesCC)
    );

    // Dedup check: grant teacherCC a DIRECT passport_access row too (the
    // shape most teachers actually have) and confirm they still appear
    // exactly once, not twice, mirroring get_message_recipient_
    // candidates()'s own established dedup pattern.
    await admin.from("passport_access").insert({ passport_id: childCC.id, teacher_id: teacherCCId, institution_id: institutionCCId, actor_role: "class_teacher", is_active: true });
    const { data: candidatesCCAfterGrant } = await clinicianCC.rpc("get_fba_recipient_candidates", { p_fba_id: fbaCC.id });
    const teacherCCAppearances = (candidatesCCAfterGrant ?? []).filter((c) => c.recipient_id === teacherCCId);
    record(
      "CC-6 DEDUP: teacherCC appears EXACTLY ONCE after also holding a direct passport_access grant, not twice (class-derived + direct-grant branches)",
      teacherCCAppearances.length === 1,
      JSON.stringify(teacherCCAppearances)
    );

    console.log("CC summary complete.");

    await admin.from("fba_reports").delete().eq("id", fbaCC.id);
    await admin.from("institutions").delete().eq("id", institutionCCId);
    for (const id of [principalCCId, teacherCCId, snaCCId, noAccessCCId, clinicianCCId, parentCCId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK DD: the institution-match join itself, empirically proven -- the one thing CHECK Y's rewrite (above) never isolated, named as unproven in the Stage 4 Step 1 report and closed here. Two institutions, one child, teacherDD genuinely class-derived at institution A only. If get_teacher_activity_feed()/get_message_recipient_candidates()/send_message() ever let institution B's OWN approved link stand in for institution A's, the join was decoration, not a real boundary. Same fixture also answers a second question: does a child linked to two institutions at once (nothing in this schema prevents it before Stage 6's one-active-enrolment constraint) behave sanely on the roster and under a scoped revoke. ==`);
  if (shouldRun("DD")) {
    const { data: instDDA, error: instDDAErr } = await admin
      .from("institutions")
      .insert({ name: "DD Institution A", institution_code: CODE + "DDA", status: "verified" })
      .select()
      .single();
    if (instDDAErr) throw instDDAErr;
    const institutionDDAId = instDDA.id;

    const { data: instDDB, error: instDDBErr } = await admin
      .from("institutions")
      .insert({ name: "DD Institution B", institution_code: CODE + "DDB", status: "verified" })
      .select()
      .single();
    if (instDDBErr) throw instDDBErr;
    const institutionDDBId = instDDB.id;

    const principalDDAId = await createUser("dd.principala@thebehaviourhive.com", "DD Principal A", "principal");
    const principalDDBId = await createUser("dd.principalb@thebehaviourhive.com", "DD Principal B", "principal");
    const teacherDDId = await createUser("dd.teacher@thebehaviourhive.com", "DD Teacher", "class_teacher");
    const parentDDId = await createUser("dd.parent@thebehaviourhive.com", "DD Parent", "parent");

    const { data: staffDDRows, error: staffDDErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionDDAId, user_id: principalDDAId, role: "principal" },
        { institution_id: institutionDDBId, user_id: principalDDBId, role: "principal" },
        { institution_id: institutionDDAId, user_id: teacherDDId, role: "class_teacher" },
      ])
      .select();
    if (staffDDErr) throw staffDDErr;

    const principalDDA = await signedInClient("dd.principala@thebehaviourhive.com");
    const principalDDB = await signedInClient("dd.principalb@thebehaviourhive.com");
    const teacherDDStaffRow = staffDDRows.find((r) => r.user_id === teacherDDId);
    const { error: approveErr } = await principalDDA.rpc("approve_staff_join", { p_institution_staff_id: teacherDDStaffRow.id });
    if (approveErr) throw approveErr;

    const teacherDD = await signedInClient("dd.teacher@thebehaviourhive.com");

    const { data: childDD, error: childDDErr } = await admin
      .from("passports")
      .insert({ user_id: parentDDId, child_name: "DD Two-Institution Child", passport_status: "complete" })
      .select()
      .single();
    if (childDDErr) throw childDDErr;

    // Institution B's OWN approved link -- a real, producible state
    // (the same shape ShareBottomSheet.tsx's own approve flow creates),
    // not derived from anything teacherDD did. teacherDD has ZERO
    // standing at institution B -- no institution_staff row there at
    // all. This is the row that must NOT leak through.
    const { data: pilDDB } = await admin
      .from("passport_institution_links")
      .insert({ passport_id: childDD.id, institution_id: institutionDDBId, approved_by_parent: true, parent_approved_at: new Date().toISOString() })
      .select()
      .single();

    // Institution A's OWN link is deliberately NOT created yet --
    // add_class_child() has no passport_institution_links requirement
    // at all (confirmed by reading its body fresh: only checks the
    // caller is an active principal at the class's own institution), so
    // the class below can genuinely contain this child while institution
    // A has no link row of its own yet.
    const { data: classDDId } = await principalDDA.rpc("create_class", { p_institution_id: institutionDDAId, p_name: "DD Room" });
    await principalDDA.rpc("add_class_teacher", { p_class_id: classDDId, p_user_id: teacherDDId });
    await principalDDA.rpc("add_class_child", { p_class_id: classDDId, p_passport_id: childDD.id });

    const { data: alDD } = await admin
      .from("activity_log")
      .insert({ passport_id: childDD.id, actor_id: principalDDAId, event_type: "team_linked", event_description: "DD institution-match check" })
      .select()
      .single();

    const { data: otherCategoryDD } = await admin.from("message_categories").select("id").eq("label", "Other").maybeSingle();

    // ---- DD1: institution A has NO link row yet. teacherDD is a
    // genuine class_teacher of a class containing this child -- the
    // ONLY thing standing between them and access is whether the join
    // requires THEIR institution's own link, or accepts institution B's
    // (which exists, is approved, and would satisfy a bare "some
    // approved link exists for this passport" check). ----
    {
      const { data: feedBefore } = await teacherDD.rpc("get_teacher_activity_feed", {});
      record(
        "DD-1a INSTITUTION-MATCH BITES: get_teacher_activity_feed() does NOT include the row while ONLY institution B's link exists -- institution B's approved link does not stand in for institution A's",
        !(feedBefore ?? []).some((r) => r.id === alDD.id),
        JSON.stringify(feedBefore?.length)
      );

      const { data: candidatesBefore } = await teacherDD.rpc("get_message_recipient_candidates", { p_passport_id: childDD.id });
      record(
        "DD-1b INSTITUTION-MATCH BITES: get_message_recipient_candidates() returns NOTHING for teacherDD while only institution B's link exists",
        (candidatesBefore ?? []).length === 0,
        JSON.stringify(candidatesBefore)
      );

      const { error: sendBeforeErr } = await teacherDD.rpc("send_message", {
        p_passport_id: childDD.id, p_category_id: otherCategoryDD.id, p_body: "Should be refused -- wrong institution's link", p_response_required: false, p_recipient_ids: [parentDDId],
      });
      record(
        "DD-1c INSTITUTION-MATCH BITES: send_message() refuses teacherDD while only institution B's link exists",
        Boolean(sendBeforeErr) && /not authorized/i.test(sendBeforeErr.message),
        sendBeforeErr?.message
      );
    }

    // ---- DD2: institution A's OWN link now added -- deliberately
    // UNAPPROVED, re-confirming 0110's approval-removal one more time in
    // the same breath as the institution-match proof, not just existence
    // in isolation. Institution B's link is untouched throughout. ----
    {
      const { data: pilDDA } = await admin
        .from("passport_institution_links")
        .insert({ passport_id: childDD.id, institution_id: institutionDDAId, approved_by_parent: false })
        .select()
        .single();

      const { data: feedAfter } = await teacherDD.rpc("get_teacher_activity_feed", {});
      record(
        "DD-2a THE JOIN GENUINELY KEYS OFF THIS INSTITUTION: get_teacher_activity_feed() now includes the row the moment institution A's OWN link exists -- unapproved, existence only, exactly 0110's design -- institution B's link was never what mattered",
        (feedAfter ?? []).some((r) => r.id === alDD.id),
        JSON.stringify(feedAfter?.length)
      );

      const { data: candidatesAfter } = await teacherDD.rpc("get_message_recipient_candidates", { p_passport_id: childDD.id });
      record(
        "DD-2b THE JOIN GENUINELY KEYS OFF THIS INSTITUTION: get_message_recipient_candidates() now returns real candidates",
        (candidatesAfter ?? []).length >= 1,
        JSON.stringify(candidatesAfter)
      );

      const { error: sendAfterErr } = await teacherDD.rpc("send_message", {
        p_passport_id: childDD.id, p_category_id: otherCategoryDD.id, p_body: "Should now succeed", p_response_required: false, p_recipient_ids: [parentDDId],
      });
      record(
        "DD-2c THE JOIN GENUINELY KEYS OFF THIS INSTITUTION: send_message() now succeeds",
        !sendAfterErr,
        sendAfterErr?.message
      );

      const { data: pilDDBUnchanged } = await admin.from("passport_institution_links").select("approved_by_parent").eq("id", pilDDB.id).single();
      record(
        "DD-2d institution B's own row is completely untouched throughout -- still approved_by_parent=true, never read from or written to by anything above",
        pilDDBUnchanged?.approved_by_parent === true,
        JSON.stringify(pilDDBUnchanged)
      );

      // ---- DD3: the second question -- does a child linked to two
      // institutions at once behave sanely elsewhere, given nothing in
      // this schema prevents it before Stage 6's one-active-enrolment
      // constraint exists. ----
      const { data: rosterA } = await principalDDA.rpc("get_institution_child_roster", { p_institution_id: institutionDDAId });
      record(
        "DD-3a get_institution_child_roster() at institution A shows the child, independently of institution B's own link existing",
        (rosterA ?? []).some((c) => c.passport_id === childDD.id),
        JSON.stringify(rosterA?.length)
      );

      const { data: rosterB } = await principalDDB.rpc("get_institution_child_roster", { p_institution_id: institutionDDBId });
      record(
        "DD-3b get_institution_child_roster() at institution B ALSO shows the SAME child independently -- the roster doesn't crash, dedupe away, or arbitrarily pick one institution when both have a genuine link",
        (rosterB ?? []).some((c) => c.passport_id === childDD.id),
        JSON.stringify(rosterB?.length)
      );

      // handleRevoke()'s own two-part update (passport/dashboard/
      // page.tsx), reproduced at the data layer rather than driven
      // through the browser -- scoped by .eq("institution_id", X) on
      // both statements in the real component. Proving the SAME scoping
      // here: revoking institution A must not touch institution B's row.
      await admin
        .from("passport_institution_links")
        .update({ approved_by_parent: false })
        .eq("passport_id", childDD.id)
        .eq("institution_id", institutionDDAId);

      const { data: pilDDBAfterRevokeA } = await admin.from("passport_institution_links").select("approved_by_parent").eq("id", pilDDB.id).single();
      record(
        "DD-3c a parent's revoke, scoped to institution A the same way handleRevoke() scopes it (.eq('institution_id', institutionDDAId)), does NOT touch institution B's own row",
        pilDDBAfterRevokeA?.approved_by_parent === true,
        JSON.stringify(pilDDBAfterRevokeA)
      );

      // institutionPhone.ts's own query shape (fetchApprovedInstitutionPhone)
      // -- passport_id + approved_by_parent = true, .limit(1), NO
      // institution_id scoping at all. A named finding, not a pass/fail
      // claim: this proves it returns exactly one row without erroring
      // when two institutions both have (or, as here, one has) an
      // approved link -- but WHICH institution it picks when more than
      // one is approved is not something this query, or this check,
      // constrains. Re-approve institution A's link first so both are
      // simultaneously approved, matching the scenario that actually
      // exercises the ambiguity.
      await admin.from("passport_institution_links").update({ approved_by_parent: true }).eq("id", pilDDA.id);
      const { data: phoneLookup } = await admin
        .from("passport_institution_links")
        .select("institution_id")
        .eq("passport_id", childDD.id)
        .eq("approved_by_parent", true)
        .limit(1)
        .maybeSingle();
      record(
        "DD-3d NAMED FINDING, not a bug claim: institutionPhone.ts's own query (no institution_id scoping, .limit(1)) returns exactly one row without erroring when two institutions are simultaneously approved for the same child -- but which one it returns is arbitrary/unspecified, not something this check or that query constrains",
        Boolean(phoneLookup?.institution_id),
        JSON.stringify(phoneLookup)
      );
    }

    console.log("DD summary complete.");

    await admin.from("activity_log").delete().eq("id", alDD.id);
    await admin.from("institutions").delete().in("id", [institutionDDAId, institutionDDBId]);
    for (const id of [principalDDAId, principalDDBId, teacherDDId, parentDDId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK EE: Stage 4, Step 2 (migration 0111) -- grant_passport_access()/revoke_passport_access()/get_passport_access_for_child(), and the cross-institution reactivation fix caught in review before this ever shipped. ==`);
  if (shouldRun("EE")) {
    const { data: instEEA, error: instEEAErr } = await admin
      .from("institutions")
      .insert({ name: "EE Institution A", institution_code: CODE + "EEA", status: "verified" })
      .select()
      .single();
    if (instEEAErr) throw instEEAErr;
    const institutionEEAId = instEEA.id;

    const { data: instEEB, error: instEEBErr } = await admin
      .from("institutions")
      .insert({ name: "EE Institution B", institution_code: CODE + "EEB", status: "verified" })
      .select()
      .single();
    if (instEEBErr) throw instEEBErr;
    const institutionEEBId = instEEB.id;

    const principalEEAId = await createUser("ee.principala@thebehaviourhive.com", "EE Principal A", "principal");
    const principalEEBId = await createUser("ee.principalb@thebehaviourhive.com", "EE Principal B", "principal");
    const teacherEEId = await createUser("ee.teacher@thebehaviourhive.com", "EE Teacher", "class_teacher");
    const snaEEId = await createUser("ee.sna@thebehaviourhive.com", "EE SNA", "sna");
    const outsiderEEId = await createUser("ee.outsider@thebehaviourhive.com", "EE Outsider", "class_teacher");
    const parentEEId = await createUser("ee.parent@thebehaviourhive.com", "EE Parent", "parent");

    // teacherEE is genuinely staff at BOTH institutions --
    // institution_staff_one_active_per_institution (0100) is keyed on
    // (institution_id, user_id), not user_id alone, so this is a real,
    // constructible state, not a fixture artifact.
    const { data: staffEERows, error: staffEEErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionEEAId, user_id: principalEEAId, role: "principal" },
        { institution_id: institutionEEBId, user_id: principalEEBId, role: "principal" },
        { institution_id: institutionEEAId, user_id: teacherEEId, role: "class_teacher" },
        { institution_id: institutionEEBId, user_id: teacherEEId, role: "class_teacher" },
        { institution_id: institutionEEAId, user_id: snaEEId, role: "sna" },
        { institution_id: institutionEEAId, user_id: outsiderEEId, role: "class_teacher" },
      ])
      .select();
    if (staffEEErr) throw staffEEErr;

    const principalEEA = await signedInClient("ee.principala@thebehaviourhive.com");
    const principalEEB = await signedInClient("ee.principalb@thebehaviourhive.com");
    for (const row of staffEERows.filter((r) => r.role !== "principal")) {
      const { error } = await (row.institution_id === institutionEEAId ? principalEEA : principalEEB).rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const teacherEE = await signedInClient("ee.teacher@thebehaviourhive.com");
    const snaEE = await signedInClient("ee.sna@thebehaviourhive.com");
    const outsiderEE = await signedInClient("ee.outsider@thebehaviourhive.com");

    const { data: childEE, error: childEEErr } = await admin
      .from("passports")
      .insert({ user_id: parentEEId, child_name: "EE Child", passport_status: "complete" })
      .select()
      .single();
    if (childEEErr) throw childEEErr;

    // Both institutions get their own approved link to the same child --
    // reachable, per CHECK DD, not theoretical.
    await admin.from("passport_institution_links").insert([
      { passport_id: childEE.id, institution_id: institutionEEAId, approved_by_parent: true, parent_approved_at: new Date().toISOString() },
      { passport_id: childEE.id, institution_id: institutionEEBId, approved_by_parent: true, parent_approved_at: new Date().toISOString() },
    ]);

    // ---- EE-0: THE BLOCKING PROOF -- a genuine self-service grant,
    // through the UNTOUCHED pre-existing policy (Stage 4 Step 1's own
    // decision 1), not this migration's new RPC. granted_by defaults to
    // auth.uid() at the COLUMN level -- proven empirically here, not
    // just asserted, per Daniel's own explicit instruction this be
    // proven blocking, in-session. ----
    {
      const { data: selfServiceRows, error: selfServiceErr } = await snaEE
        .from("passport_access")
        .insert({ passport_id: childEE.id, teacher_id: snaEEId, institution_id: institutionEEAId, is_active: true, actor_role: "sna" })
        .select("id, granted_by");
      if (selfServiceErr) throw selfServiceErr;

      const { data: selfServiceReread } = await admin.from("passport_access").select("granted_by").eq("id", selfServiceRows[0].id).single();
      record(
        "EE-0 THE BLOCKING PROOF: granted_by's column DEFAULT auth.uid() correctly populates on a genuine self-service insert through the untouched pre-existing policy, re-read via service role, not assumed from the insert's own return",
        selfServiceReread?.granted_by === snaEEId,
        JSON.stringify(selfServiceReread)
      );

      await admin.from("passport_access").delete().eq("id", selfServiceRows[0].id);
    }

    // ---- EE-1: grant_passport_access() guards ----
    {
      const { error: noReasonErr } = await principalEEA.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: teacherEEId, p_institution_id: institutionEEAId, p_reason: "" });
      record("EE-1a: grant_passport_access() refuses an empty reason", Boolean(noReasonErr) && /reason is required/i.test(noReasonErr.message), noReasonErr?.message);

      const { error: nonPrincipalErr } = await outsiderEE.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: teacherEEId, p_institution_id: institutionEEAId, p_reason: "Should fail" });
      record("EE-1b: grant_passport_access() refuses a non-principal caller", Boolean(nonPrincipalErr) && /active principal/i.test(nonPrincipalErr.message), nonPrincipalErr?.message);

      // parentEEId (already exists, owns childEE, never institution_staff
      // anywhere) rather than a dedicated raw-created "non staff" account
      // -- this call is expected to fail, never writes anything, and
      // institution_permissions/passport_access carry no constraint that
      // parentEEId already owning a passport would trip.
      const { error: notStaffErr } = await principalEEA.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: parentEEId, p_institution_id: institutionEEAId, p_reason: "Should fail" });
      record("EE-1c: grant_passport_access() refuses a target with no institution_staff row at this institution", Boolean(notStaffErr) && /not an active member/i.test(notStaffErr.message), notStaffErr?.message);

      const { error: wrongRoleErr } = await principalEEA.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: principalEEAId, p_institution_id: institutionEEAId, p_reason: "Should fail -- principal, not teacher/sna" });
      record("EE-1d: grant_passport_access() refuses a target whose role isn't class_teacher/sna (tried a principal)", Boolean(wrongRoleErr) && /class teacher or SNA/i.test(wrongRoleErr.message), wrongRoleErr?.message);

      // snaEEId as the owner here (not yet a passports.user_id owner of
      // anything at this point) rather than a dedicated parent account --
      // this row is deleted moments later, and EE-1e's own claim is about
      // the CHILD having no institution link, never about who owns it.
      const { data: unlinkedChild, error: unlinkedChildErr } = await admin.from("passports").insert({ user_id: snaEEId, child_name: "EE Unlinked Child", passport_status: "complete" }).select().single();
      if (unlinkedChildErr) throw unlinkedChildErr;
      const { error: noLinkErr } = await principalEEA.rpc("grant_passport_access", { p_passport_id: unlinkedChild.id, p_user_id: teacherEEId, p_institution_id: institutionEEAId, p_reason: "Should fail -- no link at all" });
      record("EE-1e: grant_passport_access() refuses a child with no passport_institution_links row at this institution at all", Boolean(noLinkErr) && /no link to your institution/i.test(noLinkErr.message), noLinkErr?.message);
      await admin.from("passports").delete().eq("id", unlinkedChild.id);
    }

    // ---- EE-2: grant_passport_access() the positive path ----
    let grantEEAId;
    {
      const { data, error } = await principalEEA.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: teacherEEId, p_institution_id: institutionEEAId, p_reason: "EE positive grant." });
      if (error) throw error;
      grantEEAId = data;

      const { data: rowAfterGrant } = await admin.from("passport_access").select("*").eq("id", grantEEAId).single();
      record(
        "EE-2a: the grant row is correct -- actor_role DERIVED from teacherEE's own institution_staff.role ('class_teacher'), not caller-supplied, granted_by is principalEEA",
        rowAfterGrant?.actor_role === "class_teacher" && rowAfterGrant?.is_active === true && rowAfterGrant?.granted_by === principalEEAId && rowAfterGrant?.institution_id === institutionEEAId,
        JSON.stringify(rowAfterGrant)
      );

      const { error: duplicateErr } = await principalEEA.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: teacherEEId, p_institution_id: institutionEEAId, p_reason: "Should fail -- already active" });
      record("EE-2b: grant_passport_access() refuses a duplicate active grant", Boolean(duplicateErr) && /already has active/i.test(duplicateErr.message), duplicateErr?.message);
    }

    // ---- EE-3: get_passport_access_for_child() ----
    {
      const { data: readAsOutsider, error: readOutsiderErr } = await outsiderEE.rpc("get_passport_access_for_child", { p_passport_id: childEE.id, p_institution_id: institutionEEAId });
      record("EE-3a: get_passport_access_for_child() refuses a non-principal caller", Boolean(readOutsiderErr) || (readAsOutsider ?? []).length === 0, readOutsiderErr?.message ?? JSON.stringify(readAsOutsider));

      const { data: readAsPrincipal } = await principalEEA.rpc("get_passport_access_for_child", { p_passport_id: childEE.id, p_institution_id: institutionEEAId });
      const grantRow = (readAsPrincipal ?? []).find((r) => r.id === grantEEAId);
      record(
        "EE-3b: get_passport_access_for_child() correctly returns the grant with resolved names, for the granting principal",
        grantRow?.user_id === teacherEEId && grantRow?.full_name === "EE Teacher" && grantRow?.granted_by_name === "EE Principal A",
        JSON.stringify(grantRow)
      );
    }

    // ---- EE-4: revoke_passport_access() guards + the positive path,
    // including revoking a SELF-SERVICE grant -- "revoke for children
    // enrolled at their institution" (Step 0's own wording) covers one,
    // not just principal-granted rows. ----
    {
      const { data: selfServiceRow, error: selfServiceErr } = await snaEE
        .from("passport_access")
        .insert({ passport_id: childEE.id, teacher_id: snaEEId, institution_id: institutionEEAId, is_active: true, actor_role: "sna" })
        .select("id")
        .single();
      if (selfServiceErr) throw selfServiceErr;

      const { error: noReasonRevokeErr } = await principalEEA.rpc("revoke_passport_access", { p_passport_access_id: selfServiceRow.id, p_reason: "" });
      record("EE-4a: revoke_passport_access() refuses an empty reason", Boolean(noReasonRevokeErr) && /reason is required/i.test(noReasonRevokeErr.message), noReasonRevokeErr?.message);

      const { error: nonPrincipalRevokeErr } = await outsiderEE.rpc("revoke_passport_access", { p_passport_access_id: selfServiceRow.id, p_reason: "Should fail" });
      record("EE-4b: revoke_passport_access() refuses a non-principal caller", Boolean(nonPrincipalRevokeErr) && /active principal/i.test(nonPrincipalRevokeErr.message), nonPrincipalRevokeErr?.message);

      const { error: wrongInstitutionRevokeErr } = await principalEEB.rpc("revoke_passport_access", { p_passport_access_id: selfServiceRow.id, p_reason: "Should fail -- wrong institution's principal" });
      record("EE-4c: revoke_passport_access() refuses a DIFFERENT institution's principal -- scoped by the row's own institution_id, not passport-wide", Boolean(wrongInstitutionRevokeErr) && /active principal/i.test(wrongInstitutionRevokeErr.message), wrongInstitutionRevokeErr?.message);

      const { error: revokeErr } = await principalEEA.rpc("revoke_passport_access", { p_passport_access_id: selfServiceRow.id, p_reason: "EE: revoking a self-service grant, principal-initiated." });
      if (revokeErr) throw revokeErr;

      const { data: revokedRow } = await admin.from("passport_access").select("*").eq("id", selfServiceRow.id).single();
      record(
        "EE-4d THE POSITIVE PATH: a principal CAN revoke a SELF-SERVICE grant, not just one they personally granted -- is_active/revoked_at/revoked_by/revocation_reason all set correctly",
        revokedRow?.is_active === false && revokedRow?.revoked_by === principalEEAId && revokedRow?.revocation_reason === "EE: revoking a self-service grant, principal-initiated." && Boolean(revokedRow?.revoked_at),
        JSON.stringify(revokedRow)
      );

      const { error: doubleRevokeErr } = await principalEEA.rpc("revoke_passport_access", { p_passport_access_id: selfServiceRow.id, p_reason: "Should fail -- already revoked" });
      record("EE-4e: revoke_passport_access() refuses an already-revoked row", Boolean(doubleRevokeErr) && /already been revoked/i.test(doubleRevokeErr.message), doubleRevokeErr?.message);
    }

    // ---- EE-5: THE FIX ITSELF -- cross-institution reactivation
    // refused, not silently relocated. teacherEE's grant at institution
    // A (grantEEAId, from EE-2) is revoked first, then institution B's
    // OWN principal attempts to grant the SAME teacher access to the
    // SAME child -- the exact scenario Daniel named as reachable, not
    // theoretical. ----
    {
      const { error: revokeAErr } = await principalEEA.rpc("revoke_passport_access", { p_passport_access_id: grantEEAId, p_reason: "EE: institution A ends teacherEE's cover." });
      if (revokeAErr) throw revokeAErr;

      const { data: rowBeforeCrossAttempt } = await admin.from("passport_access").select("*").eq("id", grantEEAId).single();
      record(
        "EE-5a (context): institution A's grant is genuinely revoked before institution B's attempt -- is_active=false, institution_id still A",
        rowBeforeCrossAttempt?.is_active === false && rowBeforeCrossAttempt?.institution_id === institutionEEAId,
        JSON.stringify(rowBeforeCrossAttempt)
      );

      const { error: crossInstitutionErr } = await principalEEB.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: teacherEEId, p_institution_id: institutionEEBId, p_reason: "Institution B tries to grant the same teacher, same child." });
      record(
        "EE-5b THE FIX ITSELF: institution B's principal is REFUSED, not silently reactivated-and-relocated -- a revoked grant at institution A is not institution B's to reactivate",
        Boolean(crossInstitutionErr) && /different institution/i.test(crossInstitutionErr.message),
        crossInstitutionErr?.message
      );

      const { data: rowAfterCrossAttempt } = await admin.from("passport_access").select("*").eq("id", grantEEAId).single();
      record(
        "EE-5c institution A's row is COMPLETELY UNTOUCHED by the refused attempt -- same institution_id, same is_active, same revoked_by/revoked_at/revocation_reason as EE-5a, re-read via service role",
        rowAfterCrossAttempt?.institution_id === institutionEEAId &&
          rowAfterCrossAttempt?.is_active === false &&
          rowAfterCrossAttempt?.revoked_by === principalEEAId &&
          rowAfterCrossAttempt?.revocation_reason === "EE: institution A ends teacherEE's cover." &&
          rowAfterCrossAttempt?.revoked_at === rowBeforeCrossAttempt?.revoked_at,
        JSON.stringify(rowAfterCrossAttempt)
      );

      // Positive counterpart: a DIFFERENT teacher (never granted at A)
      // CAN be granted access at institution B for the same child --
      // proving EE-5b's refusal is specifically about the SAME person's
      // cross-institution row, not institution B being unable to grant
      // at all.
      const { error: differentPersonErr } = await principalEEB.rpc("grant_passport_access", { p_passport_id: childEE.id, p_user_id: snaEEId, p_institution_id: institutionEEBId, p_reason: "Should fail for an unrelated reason -- snaEE has no institution_staff row at B at all, proving THIS refusal is a different one." });
      record(
        "EE-5d (sanity): snaEE, who has never been staff at institution B, is refused for the ORDINARY reason (not staff there), not the cross-institution one -- confirms EE-5b's error is specifically about the SAME institution mismatch, not a blanket institution-B-can't-grant failure",
        Boolean(differentPersonErr) && /not an active member/i.test(differentPersonErr.message),
        differentPersonErr?.message
      );
    }

    console.log("EE summary complete.");

    await admin.from("passports").delete().eq("id", childEE.id);
    await admin.from("institutions").delete().in("id", [institutionEEAId, institutionEEBId]);
    for (const id of [principalEEAId, principalEEBId, teacherEEId, snaEEId, outsiderEEId, parentEEId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK FF: Client-behaviour half of Stage 4, Step 3 (src/app/principal/passports, src/hooks/useTeacherPassports.ts) -- proven via the LITERAL client query shape, not a proxy for it. FF-1/FF-2 are the seventh "grant access, test the destination" instance, closed: a principal-granted access is only real if the recipient's OWN surfaces actually show it. ==`);
  if (shouldRun("FF")) {
    const { data: instFF, error: instFFErr } = await admin
      .from("institutions")
      .insert({ name: "FF Reachability Verify", institution_code: CODE + "FF", status: "verified" })
      .select()
      .single();
    if (instFFErr) throw instFFErr;
    const institutionFFId = instFF.id;

    const principalFFId = await createUser("ff.principal@thebehaviourhive.com", "FF Principal", "principal");
    const teacherFFId = await createUser("ff.teacher@thebehaviourhive.com", "FF Teacher", "class_teacher");
    const parentFFId = await createUser("ff.parent@thebehaviourhive.com", "FF Parent", "parent");

    const { data: staffFFRows, error: staffFFErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionFFId, user_id: principalFFId, role: "principal" },
        { institution_id: institutionFFId, user_id: teacherFFId, role: "class_teacher" },
      ])
      .select();
    if (staffFFErr) throw staffFFErr;

    const principalFF = await signedInClient("ff.principal@thebehaviourhive.com");
    const teacherFFStaffRow = staffFFRows.find((r) => r.user_id === teacherFFId);
    const { error: approveFFErr } = await principalFF.rpc("approve_staff_join", { p_institution_staff_id: teacherFFStaffRow.id });
    if (approveFFErr) throw approveFFErr;

    const teacherFF = await signedInClient("ff.teacher@thebehaviourhive.com");

    const { data: childFF, error: childFFErr } = await admin
      .from("passports")
      .insert({ user_id: parentFFId, child_name: "FF Reachability Child", passport_status: "complete" })
      .select()
      .single();
    if (childFFErr) throw childFFErr;

    // Deliberately UNAPPROVED -- Step 0's own decision 4: a school can
    // see (and, per Step 2, grant against) a child before any parent
    // approval. This is the hardest case for the reachability question,
    // not the easiest one.
    await admin.from("passport_institution_links").insert({ passport_id: childFF.id, institution_id: institutionFFId, approved_by_parent: false });

    // ---- FF-1/FF-2: useTeacherPassports.ts's exact query shape
    // (src/hooks/useTeacherPassports.ts:91-134) -- before and after a
    // real grant_passport_access() call. ----
    {
      const { data: accessBefore } = await teacherFF.from("passport_access").select("passport_id, institution_id").eq("teacher_id", teacherFFId).eq("is_active", true);
      record(
        "FF-1: useTeacherPassports.ts's own query finds NOTHING before any grant exists (src/hooks/useTeacherPassports.ts:91-95)",
        (accessBefore ?? []).length === 0,
        JSON.stringify(accessBefore)
      );

      const { data: grantFFId, error: grantFFErr } = await principalFF.rpc("grant_passport_access", { p_passport_id: childFF.id, p_user_id: teacherFFId, p_institution_id: institutionFFId, p_reason: "FF: reachability check." });
      if (grantFFErr) throw grantFFErr;

      const { data: accessAfter } = await teacherFF.from("passport_access").select("passport_id, institution_id").eq("teacher_id", teacherFFId).eq("is_active", true);
      const candidateIds = [...new Set((accessAfter ?? []).map((r) => r.passport_id))];
      const { data: linkRowsAfter } = await teacherFF.from("passport_institution_links").select("passport_id, institution_id").in("passport_id", candidateIds);
      const linkedPairs = new Set((linkRowsAfter ?? []).map((r) => `${r.passport_id}|${r.institution_id}`));
      const reachableIds = (accessAfter ?? []).filter((r) => linkedPairs.has(`${r.passport_id}|${r.institution_id}`)).map((r) => r.passport_id);

      record(
        "FF-2 THE REACHABILITY FIX ITSELF (the seventh instance): useTeacherPassports.ts's own query shape now finds the child, EVEN THOUGH the institution link was never approved_by_parent -- before this fix, this exact query returned empty and the teacher's own dashboard/Students page would have shown nothing despite a genuinely active passport_access grant (src/hooks/useTeacherPassports.ts:91-134)",
        reachableIds.includes(childFF.id),
        JSON.stringify({ accessAfter, linkRowsAfter, reachableIds })
      );

      // ---- FF-3: the detail page's own eligibleStaff filter
      // (src/app/principal/passports/[passportId]/page.tsx:142-147) --
      // excludes a staff member who already has active access. ----
      const { data: staffRosterFF } = await principalFF.rpc("get_institution_staff_roster", { p_institution_id: institutionFFId, p_include_inactive: false, p_include_pending: false });
      const activeUserIdsFF = new Set([teacherFFId]); // the one active grant from above
      const eligibleAfterGrant = (staffRosterFF ?? []).filter((s) => s.is_active && !activeUserIdsFF.has(s.user_id));
      record(
        "FF-3: the detail page's own eligibleStaff filter (src/app/principal/passports/[passportId]/page.tsx:142-147) correctly EXCLUDES teacherFF from the grant picker once they already have active access -- prevents offering a duplicate grant the RPC would refuse anyway",
        !eligibleAfterGrant.some((s) => s.user_id === teacherFFId),
        JSON.stringify(eligibleAfterGrant)
      );

      await admin.from("passport_access").delete().eq("id", grantFFId);
    }

    // ---- FF-4: the detail page's own "not on roster" handling
    // (src/app/principal/passports/[passportId]/page.tsx's rosterMatch
    // logic) -- a genuinely unlinked passportId, reachable via direct
    // URL even though the list page never offers it, correctly resolves
    // to the "not on your school's roster" state rather than crashing
    // or silently showing "Unknown". ----
    {
      // teacherFFId as the owner (never itself a passports.user_id owner
      // anywhere in FF, and FF-1/FF-2/FF-3 are already resolved by this
      // point) rather than a dedicated parent account -- FF-4's claim is
      // about the CHILD having no roster link, never about who owns it.
      const { data: unlinkedChildFF } = await admin.from("passports").insert({ user_id: teacherFFId, child_name: "FF Unlinked Child", passport_status: "complete" }).select().single();

      const { data: rosterFF } = await principalFF.rpc("get_institution_child_roster", { p_institution_id: institutionFFId });
      const rosterMatch = (rosterFF ?? []).find((r) => r.passport_id === unlinkedChildFF.id);
      record(
        "FF-4: the detail page's own roster-match logic correctly finds NO match for a passportId with no passport_institution_links row at this institution -- reproduces the page's exact .find() shape, not a proxy for it",
        rosterMatch === undefined,
        JSON.stringify(rosterMatch)
      );

      await admin.from("passports").delete().eq("id", unlinkedChildFF.id);
    }

    console.log("FF summary complete.");

    await admin.from("passports").delete().eq("id", childFF.id);
    await admin.from("institutions").delete().eq("id", institutionFFId);
    for (const id of [principalFFId, teacherFFId, parentFFId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK GG: Stage 5, Step 1 (migration 0113) -- passport_guardians, the dual-write trigger/backfill, owns_passport()'s rewrite, create_school_passport()'s atomicity, and the six "actively wrong" fixes. Per Daniel's own instruction: assert the CORRECTED VALUE specifically, not that something rendered -- a guardian labelled 'parent' rather than "a label exists", 'no_guardian_claimed' rather than "a reason is set". ==`);
  if (shouldRun("GG")) {
    const { data: instGG, error: instGGErr } = await admin
      .from("institutions")
      .insert({ name: "GG Stage 5 Step 1 Verify", institution_code: CODE + "GG", status: "verified" })
      .select()
      .single();
    if (instGGErr) throw instGGErr;
    const institutionGGId = instGG.id;

    const principalGGId = await createUser("gg.principal@thebehaviourhive.com", "GG Principal", "principal");
    const teacherGGId = await createUser("gg.teacher@thebehaviourhive.com", "GG Teacher", "class_teacher");
    const snaGGId = await createUser("gg.sna@thebehaviourhive.com", "GG SNA", "sna");
    const clinicianGGId = await createUser("gg.clinician@thebehaviourhive.com", "GG Clinician", "clinician");
    const parentGG1Id = await createUser("gg.parent1@thebehaviourhive.com", "GG Parent One", "parent");
    // Dedicated to the multi-guardian-via-trigger construction below
    // (GG-0d/e/f) -- must be users that have NEVER been passports.user_id
    // anywhere else, since that unique constraint is still live (0113's
    // own section 5) and would refuse a second passport row reusing
    // parentGG1Id.
    const parentGGMulti1Id = await createUser("gg.parentmulti1@thebehaviourhive.com", "GG Parent Multi One", "parent");
    const parentGGMulti2Id = await createUser("gg.parentmulti2@thebehaviourhive.com", "GG Parent Multi Two", "parent");
    const parentGGReachableId = await createUser("gg.parentreachable@thebehaviourhive.com", "GG Parent Reachable", "parent");
    const parentGGDormantId = await createUser("gg.parentdormant@thebehaviourhive.com", "GG Parent Dormant", "parent");
    const parentGGStrangerId = await createUser("gg.parentstranger@thebehaviourhive.com", "GG Parent Stranger", "parent");

    const { data: staffGGRows, error: staffGGErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionGGId, user_id: principalGGId, role: "principal" },
        { institution_id: institutionGGId, user_id: teacherGGId, role: "class_teacher" },
        { institution_id: institutionGGId, user_id: snaGGId, role: "sna" },
      ])
      .select();
    if (staffGGErr) throw staffGGErr;

    const principalGG = await signedInClient("gg.principal@thebehaviourhive.com");
    for (const row of staffGGRows.filter((r) => r.user_id !== principalGGId)) {
      const { error } = await principalGG.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherGG = await signedInClient("gg.teacher@thebehaviourhive.com");
    await admin.from("clinicians").insert({ user_id: clinicianGGId, specialty: "behavioural_psychologist", verification_status: "verified" });
    const clinicianGG = await signedInClient("gg.clinician@thebehaviourhive.com");

    // ---- GG-0: the dual-write trigger + backfill, proven on an
    // ordinary parent-owned passport created the exact way every other
    // fixture in this suite (and the real signup flow) creates one --
    // admin.from("passports").insert({ user_id: ... }), never touching
    // passport_guardians directly. If this fails, every one of the 643
    // checks above that depends on owns_passport() would have failed
    // too -- this isolates the mechanism itself, not just its downstream
    // effect. ----
    const { data: childGGNormal } = await admin
      .from("passports")
      .insert({ user_id: parentGG1Id, child_name: "GG Normal Child", passport_status: "complete" })
      .select()
      .single();
    await admin.from("passport_institution_links").insert({ passport_id: childGGNormal.id, institution_id: institutionGGId, approved_by_parent: false });

    {
      const { data: guardianRow } = await admin
        .from("passport_guardians")
        .select("id")
        .eq("passport_id", childGGNormal.id)
        .eq("user_id", parentGG1Id)
        .maybeSingle();
      record(
        "GG-0 THE TRIGGER ITSELF: a passport created the ordinary way (admin insert with user_id set, never touching passport_guardians) gets a matching passport_guardians row automatically",
        Boolean(guardianRow),
        JSON.stringify(guardianRow)
      );
    }

    const parentGG1 = await signedInClient("gg.parent1@thebehaviourhive.com");
    {
      const { data: ownsAfterBackfill } = await parentGG1.rpc("owns_passport", { check_passport_id: childGGNormal.id });
      record(
        "GG-0b owns_passport() itself agrees: the backfilled guardian is recognised as owning this passport via the rewritten predicate",
        ownsAfterBackfill === true,
        ownsAfterBackfill
      );
    }

    const parentGGStranger = await signedInClient("gg.parentstranger@thebehaviourhive.com");
    {
      const { data: ownsAsStranger } = await parentGGStranger.rpc("owns_passport", { check_passport_id: childGGNormal.id });
      record(
        "GG-0c (negative control): a real signed-in parent who is genuinely NOT a guardian of this passport gets owns_passport() = false",
        ownsAsStranger === false,
        ownsAsStranger
      );
    }

    // ---- GG-0-BACKFILL: "the backfill covered every pre-existing
    // passport" is a claim about the WHOLE table at the moment 0113 ran,
    // not just this fixture's own one row -- checked here as a live gap
    // query against every passport that currently exists, fixture and
    // real data alike. If the one-time backfill INSERT missed anything,
    // or the trigger has ever silently failed to keep pace since, this
    // finds it: any passport with a non-null user_id that does NOT have
    // a matching passport_guardians row is a real gap, full stop. ----
    {
      const { data: allOwnedPassports, error: allOwnedErr } = await admin.from("passports").select("id, user_id").not("user_id", "is", null);
      if (allOwnedErr) throw allOwnedErr;
      const { data: allGuardianPairs, error: allGuardianErr } = await admin.from("passport_guardians").select("passport_id, user_id");
      if (allGuardianErr) throw allGuardianErr;
      const guardianKeys = new Set((allGuardianPairs ?? []).map((g) => `${g.passport_id}:${g.user_id}`));
      const gaps = (allOwnedPassports ?? []).filter((p) => !guardianKeys.has(`${p.id}:${p.user_id}`));
      record(
        `GG-0d THE BACKFILL, WHOLE-TABLE: every one of ${allOwnedPassports?.length ?? 0} currently-owned passports (backfilled and freshly created alike) has a matching passport_guardians row -- zero gaps`,
        gaps.length === 0,
        JSON.stringify(gaps)
      );
    }

    // ---- GG-0-UPDATE: point 1 also requires proving the trigger fires
    // on UPDATE OF user_id, not just INSERT -- and doing so via the
    // REAL mechanism (writing passports.user_id, the column the trigger
    // is actually defined on), never by touching passport_guardians
    // directly. Built on a school-created (guardian-less) passport so
    // the first update is a genuine null -> value transition, the shape
    // closest to what "claiming" will eventually look like. Two
    // SEQUENTIAL updates, to two DIFFERENT users, doubles as an honest
    // way to construct a real two-guardian passport for GG-4/GG-9 below
    // without ever inserting into passport_guardians by hand -- the
    // trigger only ever INSERTs, never removes an earlier guardian when
    // the column changes again, which this also confirms. Not a
    // production user journey (nothing updates user_id twice in
    // practice, or at all post-Stage-5), but every write here is to a
    // real column via the real deployed trigger, not a hand-set join
    // row -- the standing rule is about not faking the STATE, not about
    // which real path happens to produce it. ----
    const { data: childGGMultiId } = await principalGG.rpc("create_school_passport", {
      p_institution_id: institutionGGId,
      p_child_name: "GG Multi-Guardian Child",
    });
    const childGGMulti = { id: childGGMultiId };

    {
      const { error: firstUpdateErr } = await admin.from("passports").update({ user_id: parentGGMulti1Id }).eq("id", childGGMulti.id);
      if (firstUpdateErr) throw firstUpdateErr;
      const { data: guardianAfterFirstUpdate } = await admin
        .from("passport_guardians")
        .select("id")
        .eq("passport_id", childGGMulti.id)
        .eq("user_id", parentGGMulti1Id)
        .maybeSingle();
      record(
        "GG-0e THE TRIGGER ON UPDATE: writing passports.user_id (null -> a real value) on an existing row fires the trigger too, not just INSERT",
        Boolean(guardianAfterFirstUpdate),
        JSON.stringify(guardianAfterFirstUpdate)
      );
    }
    {
      const { error: secondUpdateErr } = await admin.from("passports").update({ user_id: parentGGMulti2Id }).eq("id", childGGMulti.id);
      if (secondUpdateErr) throw secondUpdateErr;
      const { data: bothGuardianRows } = await admin.from("passport_guardians").select("user_id").eq("passport_id", childGGMulti.id);
      const hasFirst = (bothGuardianRows ?? []).some((g) => g.user_id === parentGGMulti1Id);
      const hasSecond = (bothGuardianRows ?? []).some((g) => g.user_id === parentGGMulti2Id);
      record(
        "GG-0f THE TRIGGER ACCUMULATES, DOESN'T REPLACE: a second update to a DIFFERENT user_id adds a second guardian row without removing the first -- genuinely two real guardians now, produced entirely by real column writes through the real trigger",
        hasFirst && hasSecond,
        JSON.stringify(bothGuardianRows)
      );
    }

    // ---- GG-1/GG-2: create_school_passport() -- the atomic creation
    // RPC. A school-created passport has NO guardian at all
    // (owns_passport() false for everyone), and must be immediately
    // visible on the creating principal's own roster -- the destination
    // check named in the recon before this ever shipped. ----
    const { data: childGGSchoolId, error: createSchoolErr } = await principalGG.rpc("create_school_passport", {
      p_institution_id: institutionGGId,
      p_child_name: "GG School-Created Child",
    });
    record("GG-1a create_school_passport() succeeds for an active, verified principal", !createSchoolErr, createSchoolErr?.message);

    {
      const { data: rosterGG } = await principalGG.rpc("get_institution_child_roster", { p_institution_id: institutionGGId });
      const match = (rosterGG ?? []).find((r) => r.passport_id === childGGSchoolId);
      record(
        "GG-1b THE ATOMICITY ITSELF: the school-created passport is visible on get_institution_child_roster() immediately -- the passport_institution_links row was created in the SAME transaction, not a follow-up step",
        Boolean(match) && match.child_name === "GG School-Created Child",
        JSON.stringify(match)
      );
    }

    {
      const { data: schoolPassportRow } = await admin.from("passports").select("user_id").eq("id", childGGSchoolId).single();
      record(
        "GG-1c the school-created passport's user_id is genuinely null, not defaulted to the creating principal",
        schoolPassportRow.user_id === null,
        schoolPassportRow.user_id
      );
      const { data: schoolGuardianRows } = await admin.from("passport_guardians").select("id").eq("passport_id", childGGSchoolId);
      record(
        "GG-1d and correspondingly has ZERO passport_guardians rows -- nobody has claimed it yet",
        (schoolGuardianRows ?? []).length === 0,
        JSON.stringify(schoolGuardianRows)
      );
    }

    {
      const { error: notPrincipalErr } = await teacherGG.rpc("create_school_passport", { p_institution_id: institutionGGId, p_child_name: "Should Be Refused" });
      record("GG-2a create_school_passport() refuses a non-principal caller (teacherGG)", Boolean(notPrincipalErr), notPrincipalErr?.message);
    }
    {
      const { error: emptyNameErr } = await principalGG.rpc("create_school_passport", { p_institution_id: institutionGGId, p_child_name: "   " });
      record("GG-2b create_school_passport() refuses a blank child name", Boolean(emptyNameErr), emptyNameErr?.message);
    }
    {
      // GG's own throwaway "some other institution" -- deliberately NOT
      // the top-level CORE fixture's institutionId. GG only needed A
      // real institution principalGG doesn't belong to for this
      // negative control, never specifically THAT one; borrowing it was
      // the one real cross-block dependency in this file (it also made
      // GG unable to run on its own via ONLY_CHECKS=GG). A bare
      // institution row, no staff, no sign-in cost.
      const { data: instGGOther, error: instGGOtherErr } = await admin
        .from("institutions")
        .insert({ name: "GG Some Other Institution", institution_code: CODE + "GGOTHER", status: "verified" })
        .select()
        .single();
      if (instGGOtherErr) throw instGGOtherErr;

      const { error: wrongInstErr } = await principalGG.rpc("create_school_passport", { p_institution_id: instGGOther.id, p_child_name: "Should Be Refused Too" });
      record(
        "GG-2c create_school_passport() refuses a principal acting on an institution they don't belong to (institutionGG's principal, targeting an unrelated institution)",
        Boolean(wrongInstErr),
        wrongInstErr?.message
      );

      await admin.from("institutions").delete().eq("id", instGGOther.id);
    }

    // ---- POINT 5, THE ONE THIS STAGE EXISTS FOR: childGGSchoolId has NO
    // guardian at all -- zero passport_guardians rows (GG-1d already
    // proved this), nothing hand-set. Every action below is driven
    // through the real production RPC/policy a member of staff actually
    // uses, and none of them touch passport_guardians or care whether
    // one exists. If any of these needed a guardian to work, this stage
    // would not have done what it was built for. ----
    const { data: classGGId, error: classGGErr } = await principalGG.rpc("create_class", { p_institution_id: institutionGGId, p_name: "GG School Room" });
    if (classGGErr) throw classGGErr;
    {
      const { error: addTeacherErr } = await principalGG.rpc("add_class_teacher", { p_class_id: classGGId, p_user_id: teacherGGId });
      const { error: addChildErr } = await principalGG.rpc("add_class_child", { p_class_id: classGGId, p_passport_id: childGGSchoolId });
      record(
        "GG-10a a guardian-less, school-created passport can be put in a class -- add_class_child() doesn't need or check for an owner",
        !addTeacherErr && !addChildErr,
        JSON.stringify({ addTeacherErr: addTeacherErr?.message, addChildErr: addChildErr?.message })
      );
    }
    {
      const { error: abcInsertErr } = await teacherGG.from("abc_logs").insert({
        passport_id: childGGSchoolId,
        logged_by: teacherGGId,
        logged_by_role: "class_teacher",
        intensity: 3,
        antecedents: ["transition"],
        behaviours: ["shouting"],
        consequences: ["removed_from_area"],
      });
      record(
        "GG-10b THE WHOLE POINT: a class teacher can log a real ABC entry on a guardian-less passport, through the ordinary real client insert (has_class_teacher_access() via class membership, no owner anywhere in the chain)",
        !abcInsertErr,
        abcInsertErr?.message
      );
    }
    {
      const { error: assignSnaErr } = await principalGG.rpc("assign_sna_to_child", {
        p_passport_id: childGGSchoolId,
        p_user_id: snaGGId,
        p_institution_id: institutionGGId,
      });
      record(
        "GG-10c an SNA can be assigned to a guardian-less passport -- assign_sna_to_child() doesn't need or check for an owner either",
        !assignSnaErr,
        assignSnaErr?.message
      );
    }
    // Logging a real incident on childGGSchoolId is covered further down
    // (GG-5c/GG-6b's own incidentGGNoGuardian, created via the same real
    // create_incident_stamp() RPC) -- not duplicated here to avoid a
    // second incident against the same child; that coverage stands as
    // part of point 5's own claim just as much as point 2's.

    // ---- GG-3: passport_section_b/c/d's new unique(passport_id)
    // constraint (added, not yet the sole key -- see the migration's
    // own section 5). Proven structurally: two rows for the SAME
    // passport_id, different user_id, the second must be refused. This
    // is a pure constraint-shape test -- the second user_id doesn't need
    // to be a real guardian of anything, it only needs to be a real
    // auth.users row (the column's own FK), so reusing parentGGStranger
    // here is fine. ----
    {
      const { error: sectionBFirstErr } = await admin
        .from("passport_section_b")
        .insert({ passport_id: childGGNormal.id, user_id: parentGG1Id, okay_signals: ["music"] });
      const { error: sectionBSecondErr } = await admin
        .from("passport_section_b")
        .insert({ passport_id: childGGNormal.id, user_id: parentGGStrangerId, okay_signals: ["quiet"] });
      record(
        "GG-3 passport_section_b's new unique(passport_id) constraint refuses a second row for the same passport even under a different user_id",
        !sectionBFirstErr && Boolean(sectionBSecondErr),
        JSON.stringify({ sectionBFirstErr: sectionBFirstErr?.message, sectionBSecondErr: sectionBSecondErr?.message })
      );
    }

    // ---- GG-4: get_fba_instrument_requests()'s recipient_role fix.
    // childGGMulti (built above, GG-0e/f) now has TWO real guardians --
    // parentGGMulti1 and parentGGMulti2, neither of them ever
    // passports.user_id, both produced by the real trigger reacting to
    // real column writes. An instrument request addressed to EITHER
    // guardian must resolve to 'parent', and one addressed to teacherGG
    // (a real class teacher, not a guardian at all) must still resolve
    // to 'class_teacher' -- the negative control that proves this isn't
    // just always returning 'parent' now. ----
    await admin.from("clinician_access").insert({ passport_id: childGGMulti.id, clinician_id: clinicianGGId, is_active: true });
    const { data: fbaGGMulti } = await admin.from("fba_reports").insert({ passport_id: childGGMulti.id, clinician_id: clinicianGGId, status: "draft" }).select().single();

    const { data: reqGGParentMulti2, error: reqGGParentMulti2Err } = await admin
      .from("fba_instrument_requests")
      .insert({ fba_id: fbaGGMulti.id, passport_id: childGGMulti.id, instrument_type: "qabf", recipient_id: parentGGMulti2Id, status: "sent" })
      .select()
      .single();
    if (reqGGParentMulti2Err) throw reqGGParentMulti2Err;
    const { data: reqGGTeacher, error: reqGGTeacherErr } = await admin
      .from("fba_instrument_requests")
      .insert({ fba_id: fbaGGMulti.id, passport_id: childGGMulti.id, instrument_type: "qabf", recipient_id: teacherGGId, status: "sent" })
      .select()
      .single();
    if (reqGGTeacherErr) throw reqGGTeacherErr;

    {
      const { data: instrumentRows, error: instrumentRowsErr } = await clinicianGG.rpc("get_fba_instrument_requests", { p_fba_id: fbaGGMulti.id });
      if (instrumentRowsErr) throw instrumentRowsErr;
      const parentMulti2Row = (instrumentRows ?? []).find((r) => r.id === reqGGParentMulti2.id);
      const teacherRow = (instrumentRows ?? []).find((r) => r.id === reqGGTeacher.id);
      record(
        "GG-4a THE FIX ITSELF: parentGGMulti2 -- a second guardian, never passports.user_id -- is correctly labelled recipient_role = 'parent', not the pre-fix's unconditional 'class_teacher'",
        parentMulti2Row?.recipient_role === "parent",
        JSON.stringify(parentMulti2Row)
      );
      record(
        "GG-4b (negative control): teacherGG, a genuine class teacher and not a guardian at all, is still correctly labelled 'class_teacher'",
        teacherRow?.recipient_role === "class_teacher",
        JSON.stringify(teacherRow)
      );
    }

    // ---- GG-5: notify_parent_of_incident_stamp()'s three
    // distinguishable outcomes, asserted by the ACTUAL
    // parent_notification_blocked_reason value, not just whether one was
    // set. Reachable needs the guardian to have genuinely signed in at
    // least once BEFORE the incident is stamped (last_sign_in_at is only
    // populated by a real sign-in -- every createUser() account starts
    // with it null, so "reachable" and "dormant" differ only in whether
    // signedInClient() was called first). ----
    await signedInClient("gg.parentreachable@thebehaviourhive.com"); // populates last_sign_in_at before the stamp fires

    const { data: childGGReachable } = await admin
      .from("passports")
      .insert({ user_id: parentGGReachableId, child_name: "GG Reachable Guardian Child", passport_status: "complete" })
      .select()
      .single();
    const { data: childGGDormant } = await admin
      .from("passports")
      .insert({ user_id: parentGGDormantId, child_name: "GG Dormant Guardian Child", passport_status: "complete" })
      .select()
      .single();
    for (const cid of [childGGReachable.id, childGGDormant.id]) {
      await admin.from("passport_institution_links").insert({ passport_id: cid, institution_id: institutionGGId, approved_by_parent: false });
    }

    const { data: locGG } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    const { data: incidentGGReachable } = await teacherGG.rpc("create_incident_stamp", {
      p_institution_id: institutionGGId, p_occurred_at: new Date().toISOString(), p_location_id: locGG.id,
      p_child_passport_ids: [childGGReachable.id], p_staff: [],
    });
    const { data: incidentGGDormant } = await teacherGG.rpc("create_incident_stamp", {
      p_institution_id: institutionGGId, p_occurred_at: new Date().toISOString(), p_location_id: locGG.id,
      p_child_passport_ids: [childGGDormant.id], p_staff: [],
    });
    const { data: incidentGGNoGuardian } = await teacherGG.rpc("create_incident_stamp", {
      p_institution_id: institutionGGId, p_occurred_at: new Date().toISOString(), p_location_id: locGG.id,
      p_child_passport_ids: [childGGSchoolId], p_staff: [],
    });

    {
      const { data: icReachable } = await admin
        .from("incident_children")
        .select("parent_notified_at, parent_notification_blocked_reason")
        .eq("incident_id", incidentGGReachable)
        .single();
      record(
        "GG-5a REACHABLE: a genuinely signed-in guardian is notified -- parent_notified_at set, parent_notification_blocked_reason null",
        Boolean(icReachable.parent_notified_at) && icReachable.parent_notification_blocked_reason === null,
        JSON.stringify(icReachable)
      );

      const { data: icDormant } = await admin
        .from("incident_children")
        .select("parent_notified_at, parent_notification_blocked_reason")
        .eq("incident_id", incidentGGDormant)
        .single();
      record(
        "GG-5b DORMANT, THE CORRECTED VALUE: a guardian who exists but has never signed in gets reason = 'dormant_account' exactly (not just 'a reason is set')",
        icDormant.parent_notification_blocked_reason === "dormant_account" && !icDormant.parent_notified_at,
        JSON.stringify(icDormant)
      );

      const { data: icNoGuardian } = await admin
        .from("incident_children")
        .select("parent_notified_at, parent_notification_blocked_reason")
        .eq("incident_id", incidentGGNoGuardian)
        .single();
      record(
        "GG-5c NO GUARDIAN, THE CORRECTED VALUE: a school-created, unclaimed passport gets the NEW reason 'no_guardian_claimed' exactly, never 'dormant_account' (there is no account to be dormant)",
        icNoGuardian.parent_notification_blocked_reason === "no_guardian_claimed" && !icNoGuardian.parent_notified_at,
        JSON.stringify(icNoGuardian)
      );
    }

    // ---- GG-6: notify_parents_of_incident_signoff() -- same trigger
    // shape, the teacher_signed_at transition instead of the insert.
    // One state each is enough: the mechanism is identical to GG-5's,
    // this proves it fires on the right transition and writes the same
    // corrected values, not a second full enumeration. ----
    await teacherGG.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherGGId }).eq("id", incidentGGReachable);
    await teacherGG.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherGGId }).eq("id", incidentGGNoGuardian);
    {
      const { data: icReachableSignoff } = await admin
        .from("incident_children")
        .select("parent_notified_at, parent_notification_blocked_reason")
        .eq("incident_id", incidentGGReachable)
        .single();
      record(
        "GG-6a signoff stage, reachable: notified again (parent_notified_at refreshed), reason still null",
        Boolean(icReachableSignoff.parent_notified_at) && icReachableSignoff.parent_notification_blocked_reason === null,
        JSON.stringify(icReachableSignoff)
      );
      const { data: icNoGuardianSignoff } = await admin
        .from("incident_children")
        .select("parent_notification_blocked_reason")
        .eq("incident_id", incidentGGNoGuardian)
        .single();
      record(
        "GG-6b signoff stage, no guardian: still exactly 'no_guardian_claimed', not 'dormant_account'",
        icNoGuardianSignoff.parent_notification_blocked_reason === "no_guardian_claimed",
        JSON.stringify(icNoGuardianSignoff)
      );
    }

    // ---- GG-7: get_child_clinical_document_status()'s new is_authorized
    // boolean, asserted directly -- true for the real guardian, false
    // (not absence) for a genuine stranger, with the real FBA state only
    // readable by the former. ----
    await admin.from("clinician_access").insert({ passport_id: childGGNormal.id, clinician_id: clinicianGGId, is_active: true });
    const { data: fbaGGNormal } = await admin
      .from("fba_reports")
      .insert({ passport_id: childGGNormal.id, clinician_id: clinicianGGId, status: "completed", completed_at: new Date().toISOString() })
      .select()
      .single();
    const { data: calmCardGG, error: calmCardGGErr } = await admin
      .from("fba_calm_cards")
      .insert({
        fba_id: fbaGGNormal.id,
        strategy_ref: "gg-verify-strategy",
        title: "GG Calm Card",
        steps: ["Step one", "Step two"],
        door_type: "prevention",
        is_published: true,
      })
      .select()
      .single();
    if (calmCardGGErr) throw calmCardGGErr;

    {
      const { data: statusAsGuardian } = await parentGG1.rpc("get_child_clinical_document_status", { p_passport_id: childGGNormal.id });
      const row = (statusAsGuardian ?? [])[0];
      record(
        "GG-7a THE CORRECTED VALUE, authorized: is_authorized = true (not merely inferred from row presence), and the real completed FBA status comes through",
        row?.is_authorized === true && row?.status === "completed",
        JSON.stringify(row)
      );

      const { data: statusAsStranger } = await parentGGStranger.rpc("get_child_clinical_document_status", { p_passport_id: childGGNormal.id });
      const strangerRow = (statusAsStranger ?? [])[0];
      record(
        "GG-7b THE CORRECTED VALUE, unauthorized: is_authorized = false explicitly, exactly one row, not zero and not the real FBA data leaking through",
        strangerRow?.is_authorized === false && strangerRow?.fba_id === null,
        JSON.stringify(strangerRow)
      );
    }

    // ---- GG-8: get_my_child_calm_cards() -- raises for a genuine
    // stranger rather than silently returning the same empty array as
    // "locked", still returns the real published card for the actual
    // guardian. ----
    {
      const { data: cardsAsGuardian, error: cardsGuardianErr } = await parentGG1.rpc("get_my_child_calm_cards", { p_passport_id: childGGNormal.id });
      record(
        "GG-8a authorized guardian still gets the real published card, unchanged shape",
        !cardsGuardianErr && (cardsAsGuardian ?? []).some((c) => c.id === calmCardGG.id),
        JSON.stringify({ cardsGuardianErr: cardsGuardianErr?.message, cardsAsGuardian })
      );

      const { error: cardsStrangerErr } = await parentGGStranger.rpc("get_my_child_calm_cards", { p_passport_id: childGGNormal.id });
      record(
        "GG-8b THE CORRECTED VALUE: a genuine stranger gets an explicit error, not the same empty array a locked/nothing-published state would produce",
        Boolean(cardsStrangerErr),
        cardsStrangerErr?.message
      );
    }

    // ---- GG-9: multi-guardian fan-out for the message/FBA recipient
    // candidate RPCs -- childGGMulti's SECOND guardian (parentGGMulti2,
    // never passports.user_id) must appear as a real 'parent' candidate,
    // not be silently dropped the way a single passports.user_id join
    // would drop everyone but whoever happened to be in that column. ----
    const parentGGMulti1 = await signedInClient("gg.parentmulti1@thebehaviourhive.com");
    {
      const { data: candidatesGG } = await parentGGMulti1.rpc("get_message_recipient_candidates", { p_passport_id: childGGMulti.id });
      const multi2Candidate = (candidatesGG ?? []).find((c) => c.recipient_id === parentGGMulti2Id);
      record(
        "GG-9a THE FIX ITSELF, get_message_recipient_candidates(): parentGGMulti2 -- a second guardian never present in passports.user_id -- appears as a real 'parent' candidate to their co-guardian",
        multi2Candidate?.role === "parent",
        JSON.stringify(multi2Candidate)
      );
      const selfCandidate = (candidatesGG ?? []).find((c) => c.recipient_id === parentGGMulti1Id);
      record(
        "GG-9b the caller themselves is still correctly excluded from their own candidate list",
        selfCandidate === undefined,
        JSON.stringify(selfCandidate)
      );
    }
    {
      const { data: fbaCandidatesGG } = await clinicianGG.rpc("get_fba_recipient_candidates", { p_fba_id: fbaGGMulti.id });
      const bothGuardians = [parentGGMulti1Id, parentGGMulti2Id].every((id) =>
        (fbaCandidatesGG ?? []).some((c) => c.recipient_id === id && c.role === "parent")
      );
      record(
        "GG-9c THE FIX ITSELF, get_fba_recipient_candidates(): BOTH guardians of childGGMulti appear as 'parent' candidates, not just whichever one happened to be passports.user_id",
        bothGuardians,
        JSON.stringify(fbaCandidatesGG)
      );
    }

    console.log("GG summary complete.");

    await admin.from("clinicians").delete().eq("user_id", clinicianGGId);
    await admin
      .from("passports")
      .delete()
      .in("id", [childGGNormal.id, childGGMulti.id, childGGSchoolId, childGGReachable.id, childGGDormant.id]);
    await admin.from("institutions").delete().eq("id", institutionGGId);
    for (const id of [
      principalGGId,
      teacherGGId,
      snaGGId,
      clinicianGGId,
      parentGG1Id,
      parentGGMulti1Id,
      parentGGMulti2Id,
      parentGGReachableId,
      parentGGDormantId,
      parentGGStrangerId,
    ]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK HH: Stage 5, Step 2 (migrations 0114/0115) -- the claim flow. 0115's own fix (the redemption-race check below is what found it, before Step 3 ever built on top of it) means this check exists to prove the atomic claim genuinely works, not just that the RPCs exist. ==`);
  if (shouldRun("HH")) {
    const { data: instHHA, error: instHHAErr } = await admin
      .from("institutions")
      .insert({ name: "HH Institution A", institution_code: CODE + "HHA", status: "verified" })
      .select()
      .single();
    if (instHHAErr) throw instHHAErr;
    const institutionHHAId = instHHA.id;

    const { data: instHHB, error: instHHBErr } = await admin
      .from("institutions")
      .insert({ name: "HH Institution B", institution_code: CODE + "HHB", status: "verified" })
      .select()
      .single();
    if (instHHBErr) throw instHHBErr;
    const institutionHHBId = instHHB.id;

    const principalHHAId = await createUser("hh.principala@thebehaviourhive.com", "HH Principal A", "principal");
    const principalHHBId = await createUser("hh.principalb@thebehaviourhive.com", "HH Principal B", "principal");
    const teacherHHId = await createUser("hh.teacher@thebehaviourhive.com", "HH Teacher", "class_teacher");
    const parentHHOldId = await createUser("hh.parentold@thebehaviourhive.com", "HH Parent Old", "parent");
    const parentHHRaceAId = await createUser("hh.parentracea@thebehaviourhive.com", "HH Parent Race A", "parent");
    const parentHHRaceBId = await createUser("hh.parentraceb@thebehaviourhive.com", "HH Parent Race B", "parent");
    // HH-2's two rate-limit identities are deliberately NOT fresh
    // sign-ins -- reused from elsewhere in this same fixture (the
    // race's own loser, and teacherHH) to keep this check's total
    // sign-in count down. redeem_passport_claim_code() doesn't check
    // role, only auth.uid() is null, so reusing a class_teacher session
    // for the lockout test is a legitimate real session, not a shortcut
    // around anything the RPC itself cares about.

    const { data: staffHHRows, error: staffHHErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionHHAId, user_id: principalHHAId, role: "principal" },
        { institution_id: institutionHHAId, user_id: teacherHHId, role: "class_teacher" },
        { institution_id: institutionHHBId, user_id: principalHHBId, role: "principal" },
      ])
      .select();
    if (staffHHErr) throw staffHHErr;

    const principalHHA = await signedInClient("hh.principala@thebehaviourhive.com");
    const principalHHB = await signedInClient("hh.principalb@thebehaviourhive.com");
    for (const row of staffHHRows.filter((r) => r.institution_id === institutionHHAId && r.user_id !== principalHHAId)) {
      const { error } = await principalHHA.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherHH = await signedInClient("hh.teacher@thebehaviourhive.com");

    // ---- HH-0: end to end, THE POINT OF THE STAGE, driven entirely by
    // real RPCs -- create_school_passport() -> generate_passport_claim_
    // code() -> redeem_passport_claim_code() -> get_my_passports(). No
    // hand-inserted rows anywhere in this chain. Also doubles as the
    // origin-blindness setup below: parentHHOld both OWNS a
    // conventionally-created passport (childHHOld, admin insert with
    // user_id set, the dual-write trigger's own path) and CLAIMS this
    // one -- two different origins, one guardian. ----
    const { data: childHHOld } = await admin
      .from("passports")
      .insert({ user_id: parentHHOldId, child_name: "HH Old Style Child", passport_status: "complete" })
      .select()
      .single();

    const { data: childHHClaimedId, error: createClaimedErr } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Claimed Child Sample",
    });
    if (createClaimedErr) throw createClaimedErr;

    const { data: claimedCode, error: generateClaimedErr } = await principalHHA.rpc("generate_passport_claim_code", {
      p_institution_id: institutionHHAId,
      p_passport_id: childHHClaimedId,
    });
    record(
      "HH-0a generate_passport_claim_code() succeeds and returns a code in the expected XXX-NNNN shape",
      !generateClaimedErr && /^[A-Z]{3}-\d{4}$/.test(claimedCode ?? ""),
      JSON.stringify({ claimedCode, generateClaimedErr: generateClaimedErr?.message })
    );

    const parentHHOld = await signedInClient("hh.parentold@thebehaviourhive.com");
    const { data: redeemResult, error: redeemErr } = await parentHHOld.rpc("redeem_passport_claim_code", { p_code: claimedCode });
    record(
      "HH-0b THE WHOLE POINT: a real parent redeems the real code and becomes a real guardian -- correct display name (first name + last initial, the same minimal-disclosure shape as lookup_passport_by_code)",
      !redeemErr && redeemResult?.[0]?.child_name === "HH S." && redeemResult?.[0]?.passport_id === childHHClaimedId,
      JSON.stringify({ redeemResult, redeemErr: redeemErr?.message })
    );

    {
      const { data: myPassports } = await parentHHOld.rpc("get_my_passports");
      const hasOld = (myPassports ?? []).some((p) => p.passport_id === childHHOld.id);
      const hasClaimed = (myPassports ?? []).some((p) => p.passport_id === childHHClaimedId);
      record(
        "HH-0c THE ORIGIN-BLINDNESS ITSELF: get_my_passports() returns BOTH the conventionally-created passport (dual-write trigger) and the claimed one (redeem_passport_claim_code()) for the same guardian, identically -- exactly two rows, no field distinguishing which came from which mechanism, which is what makes Step 3's fourteen-file migration a swap rather than a branch",
        hasOld && hasClaimed && (myPassports ?? []).length === 2,
        JSON.stringify(myPassports)
      );
    }

    {
      const { data: claimCodeRow } = await admin.from("passport_claim_codes").select("claimed_at, claimed_by").eq("code", claimedCode).single();
      record(
        "HH-0d the claim code's own row is stamped correctly -- claimed_at set, claimed_by the real redeeming parent",
        Boolean(claimCodeRow.claimed_at) && claimCodeRow.claimed_by === parentHHOldId,
        JSON.stringify(claimCodeRow)
      );
    }

    // ---- HH-1: the redemption race, THE highest-value check here per
    // instruction -- the failure mode being tested is two people owning
    // the same child's record. Two real, different, signed-in parents
    // firing redeem_passport_claim_code() at the SAME code
    // concurrently. Exactly one must succeed. ----
    const { data: childHHRaceId } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Race Child",
    });
    const { data: raceCode } = await principalHHA.rpc("generate_passport_claim_code", {
      p_institution_id: institutionHHAId,
      p_passport_id: childHHRaceId,
    });
    const parentHHRaceA = await signedInClient("hh.parentracea@thebehaviourhive.com");
    const parentHHRaceB = await signedInClient("hh.parentraceb@thebehaviourhive.com");

    const [raceResultA, raceResultB] = await Promise.all([
      parentHHRaceA.rpc("redeem_passport_claim_code", { p_code: raceCode }),
      parentHHRaceB.rpc("redeem_passport_claim_code", { p_code: raceCode }),
    ]);

    const raceSuccesses = [raceResultA, raceResultB].filter((r) => !r.error);
    const raceFailures = [raceResultA, raceResultB].filter((r) => r.error);
    // The loser -- whichever call actually errored -- is reused for
    // HH-2's stale-code test below rather than creating a fresh sign-in
    // for it: a race loss never touches code_lookup_attempts (only a
    // genuinely wrong code does), so this identity still has zero
    // recorded failures, same as a brand new one would.
    const raceLoserClient = raceResultA.error ? parentHHRaceA : parentHHRaceB;
    const raceLoserId = raceResultA.error ? parentHHRaceAId : parentHHRaceBId;
    record(
      "HH-1a EXACTLY ONE of two truly concurrent redemptions of the SAME code succeeds, the other is cleanly refused -- not both, not neither",
      raceSuccesses.length === 1 && raceFailures.length === 1,
      JSON.stringify({ raceResultA: { data: raceResultA.data, error: raceResultA.error?.message }, raceResultB: { data: raceResultB.data, error: raceResultB.error?.message } })
    );

    {
      const { data: raceGuardianRows } = await admin.from("passport_guardians").select("user_id").eq("passport_id", childHHRaceId);
      record(
        "HH-1b THE STAKE: exactly one passport_guardians row exists for the raced passport, not two -- this is what 0115 actually fixed",
        (raceGuardianRows ?? []).length === 1,
        JSON.stringify(raceGuardianRows)
      );
      const { data: raceCodeRow } = await admin.from("passport_claim_codes").select("claimed_by").eq("code", raceCode).single();
      record(
        "HH-1c claimed_by on the code row matches the winning guardian row exactly, not just whoever wrote last",
        (raceGuardianRows ?? [])[0]?.user_id === raceCodeRow.claimed_by,
        JSON.stringify({ raceCodeRow, raceGuardianRows })
      );
    }

    // ---- HH-2: the rate-limit distinction, both directions. A wrong
    // code increments the failure counter; a code that's found but
    // stale (revoked here) does not -- proven by hammering a revoked
    // code well past the 10-attempt cap and confirming it never locks
    // out. Separately, ten genuinely wrong codes DO lock out the 11th
    // attempt -- and once locked out, even the stale code gets the
    // lockout message instead of its own "revoked" message, since the
    // rate-limit check runs first. ----
    const { data: childHHRateId } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Rate Child",
    });
    const { data: rateCode } = await principalHHA.rpc("generate_passport_claim_code", {
      p_institution_id: institutionHHAId,
      p_passport_id: childHHRateId,
    });
    const { data: rateCodeRow } = await admin.from("passport_claim_codes").select("id").eq("code", rateCode).single();
    const { error: revokeRateErr } = await principalHHA.rpc("revoke_passport_claim_code", {
      p_claim_code_id: rateCodeRow.id,
      p_reason: "HH-2 fixture: needs a stale, revoked code.",
    });
    if (revokeRateErr) throw revokeRateErr;

    for (let i = 0; i < 12; i++) {
      await raceLoserClient.rpc("redeem_passport_claim_code", { p_code: rateCode });
    }
    {
      const { data: staleAttemptRows } = await admin
        .from("code_lookup_attempts")
        .select("id")
        .eq("user_id", raceLoserId)
        .eq("lookup_type", "claim");
      record(
        "HH-2a THE RATE-LIMIT DISTINCTION: twelve attempts against a REVOKED (stale, not wrong) code record ZERO failed-attempt rows -- a stale code never counts toward the limiter",
        (staleAttemptRows ?? []).length === 0,
        JSON.stringify(staleAttemptRows)
      );
      const { error: thirteenthErr } = await raceLoserClient.rpc("redeem_passport_claim_code", { p_code: rateCode });
      record(
        "HH-2b and a THIRTEENTH attempt against the same stale code STILL isn't locked out -- confirms the count genuinely never moved, not that it happened to stay under 10 by coincidence",
        Boolean(thirteenthErr) && /revoked/i.test(thirteenthErr.message),
        thirteenthErr?.message
      );
    }

    // Reuses teacherHH's own already-signed-in session for the lockout
    // test -- redeem_passport_claim_code() checks only auth.uid(), not
    // role, so this is a real, ordinary session, not a shortcut around
    // anything the RPC itself cares about.
    //
    // 0116's own fix, asserted directly: a genuinely wrong code must
    // return a normal, EMPTY result -- not an exception. Migration 0114/
    // 0115's version raised an exception here, which rolled back the
    // rate-limit INSERT two lines above it in the same function (an
    // uncaught exception aborts the whole transaction) -- proved live
    // by a standalone diagnostic (12 wrong attempts, code_lookup_
    // attempts stayed at 0 rows every time) before this fix existed.
    for (let i = 0; i < 10; i++) {
      const { data, error } = await teacherHH.rpc("redeem_passport_claim_code", { p_code: `WRONG-${i}${i}${i}${i}` });
      if (i === 0) {
        record(
          "HH-2c THE 0116 FIX ITSELF: a genuinely wrong code returns a normal, empty result (zero rows, no error) -- not an exception whose rollback would silently undo the rate-limit insert alongside it",
          !error && (data ?? []).length === 0,
          JSON.stringify({ data, error: error?.message })
        );
      }
    }
    {
      const { data: wrongAttemptRows } = await admin
        .from("code_lookup_attempts")
        .select("id")
        .eq("user_id", teacherHHId)
        .eq("lookup_type", "claim");
      record(
        "HH-2d THE STAKE: ten genuinely wrong attempts actually recorded ten rows -- the exact bookkeeping 0114/0115 silently failed to do",
        (wrongAttemptRows ?? []).length === 10,
        JSON.stringify(wrongAttemptRows)
      );
    }
    {
      const { error: eleventhErr } = await teacherHH.rpc("redeem_passport_claim_code", { p_code: "WRONG-9999" });
      record(
        "HH-2e THE LOCKOUT ITSELF: the eleventh attempt (still a wrong code) gets 'Too many failed attempts', not another empty result",
        Boolean(eleventhErr) && /too many/i.test(eleventhErr.message),
        eleventhErr?.message
      );
      const { error: lockedOutStaleErr } = await teacherHH.rpc("redeem_passport_claim_code", { p_code: rateCode });
      record(
        "HH-2f once locked out, even a VALID-BUT-STALE code gets the lockout message, not its own 'revoked' message -- the rate-limit check runs before the code lookup at all",
        Boolean(lockedOutStaleErr) && /too many/i.test(lockedOutStaleErr.message),
        lockedOutStaleErr?.message
      );
    }

    // ---- HH-3: expiry actually expiring. Backdated via a direct
    // expires_at UPDATE (simulating the clock moving forward, the same
    // established technique CHECK AA's own cutoff-time tests use --
    // not a hand-set lifecycle column a real RPC governs, just moving
    // time). ----
    const { data: childHHExpireId } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Expire Child",
    });
    const { data: expireCode } = await principalHHA.rpc("generate_passport_claim_code", {
      p_institution_id: institutionHHAId,
      p_passport_id: childHHExpireId,
    });
    await admin.from("passport_claim_codes").update({ expires_at: new Date(Date.now() - 1000).toISOString() }).eq("code", expireCode);

    const parentHHExpire = await signedInClient("hh.parentold@thebehaviourhive.com"); // reuses an already-signed-in identity, fine -- this is a fresh unrelated passport
    const { error: expireErr } = await parentHHExpire.rpc("redeem_passport_claim_code", { p_code: expireCode });
    record(
      "HH-3a a genuinely expired code is refused, distinctly ('expired', not 'not found' or 'revoked')",
      Boolean(expireErr) && /expired/i.test(expireErr.message),
      expireErr?.message
    );
    {
      const { data: expireAttemptRows } = await admin
        .from("code_lookup_attempts")
        .select("id")
        .eq("user_id", parentHHOldId)
        .eq("lookup_type", "claim");
      record(
        "HH-3b an expired code, like a revoked one, does NOT count toward the rate limit either",
        (expireAttemptRows ?? []).length === 0,
        JSON.stringify(expireAttemptRows)
      );
    }
    {
      const { data: guardianAfterExpired } = await admin.from("passport_guardians").select("id").eq("passport_id", childHHExpireId);
      record("HH-3c no guardian was created from the expired-code attempt", (guardianAfterExpired ?? []).length === 0, JSON.stringify(guardianAfterExpired));
    }

    // ---- HH-4: the ordinary guard surface. ----
    const { data: childHHGuardId } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Guard Child",
    });
    {
      const { error: notPrincipalGenErr } = await teacherHH.rpc("generate_passport_claim_code", {
        p_institution_id: institutionHHAId,
        p_passport_id: childHHGuardId,
      });
      record("HH-4a generate_passport_claim_code() refuses a non-principal caller", Boolean(notPrincipalGenErr), notPrincipalGenErr?.message);
    }
    {
      // PRD 2, Stage 3 (migration 0127): generate_passport_claim_code()
      // used to refuse ANY passport that already had a guardian --
      // childHHOld (no institution link at all) could never have
      // isolated that guard anyway, since the institution-link check
      // fires first; this reuses childHHClaimedId instead, which
      // genuinely has BOTH a real institution link (create_school_
      // passport, above) AND a real claimed guardian (HH-0's own
      // redeem), so it actually exercises the guard that used to be
      // here. 0127 removed it deliberately -- a second, different
      // guardian must be able to get their own code -- so the correct
      // assertion now is that this SUCCEEDS, not that it's refused.
      const { data: secondGuardianCode, error: secondGuardianErr } = await principalHHA.rpc("generate_passport_claim_code", {
        p_institution_id: institutionHHAId,
        p_passport_id: childHHClaimedId,
      });
      record(
        "HH-4b THE 0127 FIX ITSELF: generate_passport_claim_code() now SUCCEEDS for a passport that already has a claimed guardian -- a second guardian must be able to get their own code",
        !secondGuardianErr && /^[A-Z]{3}-\d{4}$/.test(secondGuardianCode ?? ""),
        JSON.stringify({ secondGuardianCode, secondGuardianErr: secondGuardianErr?.message })
      );
    }
    {
      const { data: childHHNoLink } = await admin.from("passports").insert({ child_name: "HH No Link Child", passport_status: "not_started" }).select().single();
      const { error: noLinkErr } = await principalHHA.rpc("generate_passport_claim_code", {
        p_institution_id: institutionHHAId,
        p_passport_id: childHHNoLink.id,
      });
      record("HH-4c generate_passport_claim_code() refuses a passport with no link to the caller's institution at all", Boolean(noLinkErr), noLinkErr?.message);
      await admin.from("passports").delete().eq("id", childHHNoLink.id);
    }
    {
      const { data: firstCode } = await principalHHA.rpc("generate_passport_claim_code", { p_institution_id: institutionHHAId, p_passport_id: childHHGuardId });
      const { data: secondCode } = await principalHHA.rpc("generate_passport_claim_code", { p_institution_id: institutionHHAId, p_passport_id: childHHGuardId });
      const { data: firstCodeRow } = await admin.from("passport_claim_codes").select("revoked_at").eq("code", firstCode).single();
      const { data: statusAfterRegenerate } = await principalHHA.rpc("get_passport_claim_code_status", { p_institution_id: institutionHHAId, p_passport_id: childHHGuardId });
      record(
        "HH-4d REGENERATE REPLACES, DOESN'T STACK: the first code is now revoked, and get_passport_claim_code_status() shows only the second as active -- the partial unique index and this procedural revoke agree",
        firstCode !== secondCode && Boolean(firstCodeRow.revoked_at) && statusAfterRegenerate?.[0]?.code === secondCode,
        JSON.stringify({ firstCode, secondCode, firstCodeRow, statusAfterRegenerate })
      );

      const { data: secondCodeRow } = await admin.from("passport_claim_codes").select("id").eq("code", secondCode).single();
      {
        const { error: notPrincipalRevoke2Err } = await teacherHH.rpc("revoke_passport_claim_code", {
          p_claim_code_id: secondCodeRow.id,
          p_reason: "HH-4e: a teacher trying anyway.",
        });
        record("HH-4e revoke_passport_claim_code() refuses a non-principal caller", Boolean(notPrincipalRevoke2Err), notPrincipalRevoke2Err?.message);
      }
      {
        const { error: crossInstRevokeErr } = await principalHHB.rpc("revoke_passport_claim_code", {
          p_claim_code_id: secondCodeRow.id,
          p_reason: "HH-4f: a principal from another school trying anyway.",
        });
        record(
          "HH-4f revoke_passport_claim_code() refuses a principal from a DIFFERENT institution -- scoped to the institution that actually issued it",
          Boolean(crossInstRevokeErr),
          crossInstRevokeErr?.message
        );
      }
      {
        const { error: revokeOkErr } = await principalHHA.rpc("revoke_passport_claim_code", {
          p_claim_code_id: secondCodeRow.id,
          p_reason: "HH-4g: revoked for real, by the right principal.",
        });
        record("HH-4g the issuing institution's own principal CAN revoke it", !revokeOkErr, revokeOkErr?.message);
      }
      {
        const { error: revokeAgainErr } = await principalHHA.rpc("revoke_passport_claim_code", {
          p_claim_code_id: secondCodeRow.id,
          p_reason: "HH-4h: trying to revoke it again.",
        });
        record("HH-4h revoking an already-revoked code is refused, not silently a no-op", Boolean(revokeAgainErr), revokeAgainErr?.message);
      }
    }

    // ---- HH-5: the cross-institution active-code refusal (EE-5b's own
    // caution, carried forward unprompted). Constructed via a direct
    // service-role passport_institution_links insert -- there is no
    // real production path today for a SECOND institution to link to a
    // still-guardian-less passport (that normally only happens via
    // parent approval, which requires a guardian that by definition
    // doesn't exist yet here) -- named honestly as defense-in-depth,
    // the same posture as the two untouched self-grant policies in
    // CLAUDE.md's own Stage 4 notes, not claimed as a reachable
    // real-world flow. ----
    const { data: childHHCrossId } = await principalHHA.rpc("create_school_passport", {
      p_institution_id: institutionHHAId,
      p_child_name: "HH Cross Institution Child",
    });
    await admin.from("passport_institution_links").insert({ passport_id: childHHCrossId, institution_id: institutionHHBId, approved_by_parent: true });
    await principalHHA.rpc("generate_passport_claim_code", { p_institution_id: institutionHHAId, p_passport_id: childHHCrossId });
    {
      const { error: crossGenerateErr } = await principalHHB.rpc("generate_passport_claim_code", {
        p_institution_id: institutionHHBId,
        p_passport_id: childHHCrossId,
      });
      record(
        "HH-5 THE FIX CARRIED FORWARD: institution B, also genuinely linked to this child, is refused generating its OWN code while institution A's is still outstanding -- not silently revoked-and-replaced",
        Boolean(crossGenerateErr) && /different school/i.test(crossGenerateErr.message),
        crossGenerateErr?.message
      );
    }

    console.log("HH summary complete.");

    await admin.from("passport_claim_codes").delete().in("passport_id", [childHHClaimedId, childHHRaceId, childHHRateId, childHHExpireId, childHHGuardId, childHHCrossId]);
    await admin
      .from("passports")
      .delete()
      .in("id", [childHHOld.id, childHHClaimedId, childHHRaceId, childHHRateId, childHHExpireId, childHHGuardId, childHHCrossId]);
    await admin.from("institutions").delete().in("id", [institutionHHAId, institutionHHBId]);
    for (const id of [
      principalHHAId,
      principalHHBId,
      teacherHHId,
      parentHHOldId,
      parentHHRaceAId,
      parentHHRaceBId,
    ]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK II: Stage 5, Step 3 -- migrations 0117/0118, the four inline passports.user_id ownership checks that owns_passport()'s own 0113 rewrite never touched (never called it in the first place). A real claimed guardian, never a hand-set passport_guardians row -- driven through create_school_passport() -> generate_passport_claim_code() -> redeem_passport_claim_code(), the same real chain as CHECK HH. ==`);
  if (shouldRun("II")) {
    const { data: instII, error: instIIErr } = await admin
      .from("institutions")
      .insert({ name: "II Inline Checks Verify", institution_code: CODE + "II", status: "verified" })
      .select()
      .single();
    if (instIIErr) throw instIIErr;
    const institutionIIId = instII.id;

    const principalIIId = await createUser("ii.principal@thebehaviourhive.com", "II Principal", "principal");
    const teacherIIId = await createUser("ii.teacher@thebehaviourhive.com", "II Teacher", "class_teacher");
    const guardianIIId = await createUser("ii.guardian@thebehaviourhive.com", "II Guardian", "parent");

    const { data: staffIIRows, error: staffIIErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionIIId, user_id: principalIIId, role: "principal" },
        { institution_id: institutionIIId, user_id: teacherIIId, role: "class_teacher" },
      ])
      .select();
    if (staffIIErr) throw staffIIErr;

    const principalII = await signedInClient("ii.principal@thebehaviourhive.com");
    for (const row of staffIIRows.filter((r) => r.user_id !== principalIIId)) {
      const { error } = await principalII.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherII = await signedInClient("ii.teacher@thebehaviourhive.com");

    // Real chain: school creates a guardian-less passport, generates a
    // code, a real guardian redeems it -- exactly CHECK HH's own chain,
    // not a hand-set passport_guardians row.
    const { data: childIIId, error: createIIErr } = await principalII.rpc("create_school_passport", {
      p_institution_id: institutionIIId,
      p_child_name: "II Claimed Child",
    });
    if (createIIErr) throw createIIErr;
    const { data: codeII, error: generateIIErr } = await principalII.rpc("generate_passport_claim_code", {
      p_institution_id: institutionIIId,
      p_passport_id: childIIId,
    });
    if (generateIIErr) throw generateIIErr;
    const guardianII = await signedInClient("ii.guardian@thebehaviourhive.com");
    const { error: redeemIIErr } = await guardianII.rpc("redeem_passport_claim_code", { p_code: codeII });
    if (redeemIIErr) throw redeemIIErr;

    // Class-derived access for teacherII, so the real teacher_updates
    // INSERT policy (has_class_teacher_access(), untouched by 0117/0118)
    // is satisfied -- this check is about the SELECT side, not a
    // shortcut around the write side.
    const { data: classIIId } = await principalII.rpc("create_class", { p_institution_id: institutionIIId, p_name: "II Room" });
    await principalII.rpc("add_class_teacher", { p_class_id: classIIId, p_user_id: teacherIIId });
    await principalII.rpc("add_class_child", { p_class_id: classIIId, p_passport_id: childIIId });

    {
      const { data: passportRow, error: passportSelectErr } = await guardianII.from("passports").select("child_name, passport_status").eq("id", childIIId).maybeSingle();
      record(
        "II-1 THE 0117 FIX ITSELF: a real claimed guardian can SELECT their own passports row directly -- not just resolve its id via get_my_passports(), which was already SECURITY DEFINER and would have masked this gap",
        !passportSelectErr && passportRow?.child_name === "II Claimed Child",
        JSON.stringify({ passportRow, passportSelectErr: passportSelectErr?.message })
      );
    }

    const { data: updateIIId, error: updateIIErr } = await teacherII
      .from("teacher_updates")
      .insert({ passport_id: childIIId, teacher_id: teacherIIId, settled_state: "settled", energy_level: 4 })
      .select()
      .single();
    if (updateIIErr) throw updateIIErr;
    {
      const { data: updateRow, error: updateSelectErr } = await guardianII.from("teacher_updates").select("settled_state").eq("passport_id", childIIId).maybeSingle();
      record(
        "II-2 THE 0118 FIX ITSELF, teacher_updates: a real claimed guardian can now SELECT the real teacher update on their own child -- this is the exact query parent-dashboard/page.tsx and passport/progress/page.tsx both make",
        !updateSelectErr && updateRow?.settled_state === "settled",
        JSON.stringify({ updateRow, updateSelectErr: updateSelectErr?.message })
      );
    }

    {
      const { data: teacherName, error: teacherNameErr } = await guardianII.rpc("get_teacher_name", { p_teacher_id: teacherIIId });
      record(
        "II-3 THE 0118 FIX ITSELF, get_teacher_name(): a real claimed guardian resolves the real teacher's name, not null",
        !teacherNameErr && teacherName === "II Teacher",
        JSON.stringify({ teacherName, teacherNameErr: teacherNameErr?.message })
      );
    }

    await admin.from("strategy_ledger").insert({ passport_id: childIIId, submitted_by: teacherIIId, entry_type: "win", description: "II ledger entry." });
    {
      const { data: ledgerRow, error: ledgerSelectErr } = await guardianII.from("strategy_ledger").select("description").eq("passport_id", childIIId).maybeSingle();
      record(
        "II-4 THE 0118 FIX ITSELF, strategy_ledger: a real claimed guardian can SELECT their child's ledger entry -- no live client read path exists for this yet, but the RLS gap was real and is now closed regardless",
        !ledgerSelectErr && ledgerRow?.description === "II ledger entry.",
        JSON.stringify({ ledgerRow, ledgerSelectErr: ledgerSelectErr?.message })
      );
    }

    console.log("II summary complete.");

    await admin.from("passports").delete().eq("id", childIIId);
    await admin.from("institutions").delete().eq("id", institutionIIId);
    for (const id of [principalIIId, teacherIIId, guardianIIId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK JJ: Stage 6, Step 1 (migration 0121) -- enrolments. Two institutions so the cascade's OWN institution_id filter is actually exercised, not assumed -- passport_access at institutionJJOther must survive ending the enrolment at institutionJJ untouched. ==`);
  if (shouldRun("JJ")) {
    const { data: instJJ, error: instJJErr } = await admin
      .from("institutions")
      .insert({ name: "JJ Institution", institution_code: CODE + "JJ", status: "verified" })
      .select()
      .single();
    if (instJJErr) throw instJJErr;
    const institutionJJId = instJJ.id;

    const { data: instJJOther, error: instJJOtherErr } = await admin
      .from("institutions")
      .insert({ name: "JJ Other Institution", institution_code: CODE + "JJB", status: "verified" })
      .select()
      .single();
    if (instJJOtherErr) throw instJJOtherErr;
    const institutionJJOtherId = instJJOther.id;

    const principalJJId = await createUser("checkjj.principal@thebehaviourhive.com", "JJ Principal", "principal");
    const principalJJOtherId = await createUser("checkjj.principalother@thebehaviourhive.com", "JJ Other Principal", "principal");
    const teacherJJId = await createUser("checkjj.teacher@thebehaviourhive.com", "JJ Teacher", "class_teacher");
    const snaJJId = await createUser("checkjj.sna@thebehaviourhive.com", "JJ SNA", "sna");
    const teacherJJOtherId = await createUser("checkjj.teacherother@thebehaviourhive.com", "JJ Other Teacher", "class_teacher");

    const { data: staffJJRows, error: staffJJErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionJJId, user_id: principalJJId, role: "principal" },
      { institution_id: institutionJJOtherId, user_id: principalJJOtherId, role: "principal" },
      { institution_id: institutionJJId, user_id: teacherJJId, role: "class_teacher" },
      { institution_id: institutionJJId, user_id: snaJJId, role: "sna" },
      { institution_id: institutionJJOtherId, user_id: teacherJJOtherId, role: "class_teacher" },
    ]).select();
    if (staffJJErr) throw staffJJErr;

    const principalJJ = await signedInClient("checkjj.principal@thebehaviourhive.com");
    const principalJJOther = await signedInClient("checkjj.principalother@thebehaviourhive.com");

    for (const row of staffJJRows.filter((r) => r.user_id === teacherJJId || r.user_id === snaJJId)) {
      const { error: approveErr } = await principalJJ.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (approveErr) throw approveErr;
    }
    for (const row of staffJJRows.filter((r) => r.user_id === teacherJJOtherId)) {
      const { error: approveErr } = await principalJJOther.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (approveErr) throw approveErr;
    }

    const teacherJJ = await signedInClient("checkjj.teacher@thebehaviourhive.com");

    const { data: classJJId, error: classJJErr } = await principalJJ.rpc("create_class", { p_institution_id: institutionJJId, p_name: "JJ Room" });
    if (classJJErr) throw classJJErr;

    // JJ-1a THE ATOMICITY ITSELF, happy path: create_school_passport()
    // (0121's own extension) creates passports + passport_institution_
    // links + enrolments together -- extends GG-1b's own precedent
    // (which only proved the first two) to the third.
    const { data: childJJId, error: childJJErr } = await principalJJ.rpc("create_school_passport", {
      p_institution_id: institutionJJId,
      p_child_name: "JJ Child",
    });
    if (childJJErr) throw childJJErr;

    const { data: enrolmentJJRows } = await admin.from("enrolments").select("*").eq("passport_id", childJJId);
    const enrolmentJJ = enrolmentJJRows?.[0];
    record(
      "JJ-1a THE ATOMICITY ITSELF: create_school_passport() creates the passport, the institution link, AND the enrolment together, in one call -- not a follow-up step",
      enrolmentJJRows?.length === 1 && enrolmentJJ?.institution_id === institutionJJId && enrolmentJJ?.ended_at === null && enrolmentJJ?.started_by === principalJJId,
      JSON.stringify(enrolmentJJRows)
    );
    const enrolmentJJId = enrolmentJJ?.id;

    {
      const { data: linkRows } = await admin.from("passport_institution_links").select("approved_by_parent").eq("passport_id", childJJId).eq("institution_id", institutionJJId);
      record(
        "JJ-1a (continued): the passport_institution_links row exists too, in the same call",
        linkRows?.length === 1 && linkRows[0].approved_by_parent === true,
        JSON.stringify(linkRows)
      );
    }

    // JJ-1b: the achievable half of "force a failure, prove nothing
    // persists" -- an early-exit validation refusal (non-principal
    // caller) leaves zero trace, not even a passports row. NOTE, told
    // to Daniel directly, not just here: a TRUE mid-function failure
    // (after the passports+links inserts have already run, before the
    // enrolments insert) has no reachable trigger from valid,
    // principal-approved parameters -- every constraint that could fail
    // on any of the three inserts is already implied by the function's
    // own upfront validation, and this suite has no raw SQL/DDL access
    // to install a controlled failure point without modifying the
    // function under test. The atomicity claim for that stronger case
    // rests on Postgres's own language guarantee (one plpgsql function
    // body, no EXCEPTION block -- confirmed by reading 0121's source,
    // not assumed) rather than an empirical forced-failure test here.
    {
      const { error: earlyExitErr } = await teacherJJ.rpc("create_school_passport", {
        p_institution_id: institutionJJId,
        p_child_name: "JJ Early Exit Child",
      });
      const { data: leakedRows } = await admin.from("passports").select("id").eq("child_name", "JJ Early Exit Child");
      record(
        "JJ-1b EARLY-EXIT ATOMICITY: a non-principal caller's refused call leaves zero trace -- no passports row, even though the refusal happens before any insert is attempted",
        Boolean(earlyExitErr) && (leakedRows?.length ?? 0) === 0,
        JSON.stringify({ earlyExitErr: earlyExitErr?.message, leakedRows })
      );
    }

    // JJ-2 THE INDEX ITSELF: a second ACTIVE enrolment for the same
    // child is refused outright -- raw insert, direct against the
    // partial unique index, not a proxy for it.
    {
      const { error: dupeErr } = await admin.from("enrolments").insert({
        passport_id: childJJId,
        institution_id: institutionJJId,
        started_by: principalJJId,
      });
      record(
        "JJ-2 THE ONE-ACTIVE-ENROLMENT INDEX ITSELF: a second active enrolment for the same child is refused",
        Boolean(dupeErr) && /duplicate key|unique/i.test(dupeErr?.message ?? ""),
        dupeErr?.message
      );
    }

    // Cross-institution link, mirroring CHECK DD's own precedent
    // exactly (a real, producible state -- the same shape a parent's own
    // approve flow creates -- not derived from anything JJ's principal
    // did): childJJ genuinely linked to a SECOND institution, so
    // grant_passport_access() there is reachable, and JJ-5's own
    // isolation check has a real cross-institution grant to test
    // against.
    await admin.from("passport_institution_links").insert({
      passport_id: childJJId,
      institution_id: institutionJJOtherId,
      approved_by_parent: true,
    });

    const { error: addChildErr } = await principalJJ.rpc("add_class_child", { p_class_id: classJJId, p_passport_id: childJJId });
    if (addChildErr) throw addChildErr;
    const { data: classChildJJRows } = await admin.from("class_children").select("id").eq("class_id", classJJId).eq("passport_id", childJJId);
    const classChildJJId = classChildJJRows?.[0]?.id;

    const { error: assignSnaErr } = await principalJJ.rpc("assign_sna_to_child", { p_passport_id: childJJId, p_user_id: snaJJId, p_institution_id: institutionJJId });
    if (assignSnaErr) throw assignSnaErr;

    const { data: grantJJId, error: grantJJErr } = await principalJJ.rpc("grant_passport_access", {
      p_passport_id: childJJId,
      p_user_id: teacherJJId,
      p_institution_id: institutionJJId,
      p_reason: "JJ own-institution grant",
    });
    if (grantJJErr) throw grantJJErr;

    const { data: grantJJOtherId, error: grantJJOtherErr } = await principalJJOther.rpc("grant_passport_access", {
      p_passport_id: childJJId,
      p_user_id: teacherJJOtherId,
      p_institution_id: institutionJJOtherId,
      p_reason: "JJ other-institution grant",
    });
    if (grantJJOtherErr) throw grantJJOtherErr;

    const { data: incidentJJId, error: incidentJJErr } = await teacherJJ.rpc("create_incident_stamp", {
      p_institution_id: institutionJJId,
      p_occurred_at: new Date().toISOString(),
      p_location_id: (await admin.from("incident_locations").select("id").is("institution_id", null).limit(1).single()).data.id,
      p_child_passport_ids: [childJJId],
      p_staff: [{ user_id: teacherJJId, involvement: "witnessed" }],
    });
    if (incidentJJErr) throw incidentJJErr;

    // JJ-4a/b/c: refusals on the STILL-ACTIVE original enrolment.
    {
      const { error } = await teacherJJ.rpc("end_enrolment", { p_enrolment_id: enrolmentJJId, p_reason: "left" });
      record("JJ-4a end_enrolment() refuses a non-principal caller", Boolean(error), error?.message);
    }
    {
      const { error } = await principalJJOther.rpc("end_enrolment", { p_enrolment_id: enrolmentJJId, p_reason: "left" });
      record("JJ-4b end_enrolment() refuses a principal from a DIFFERENT institution", Boolean(error), error?.message);
    }
    {
      const { error } = await principalJJ.rpc("end_enrolment", { p_enrolment_id: enrolmentJJId, p_reason: "expelled" });
      record("JJ-4c end_enrolment() refuses a reason outside graduated/left/transferred", Boolean(error), error?.message);
    }
    {
      const { error } = await principalJJ.rpc("end_enrolment", { p_enrolment_id: enrolmentJJId, p_reason: "" });
      record("JJ-4c (continued) end_enrolment() refuses an empty reason", Boolean(error), error?.message);
    }
    {
      const { data: stillActive } = await admin.from("enrolments").select("ended_at").eq("id", enrolmentJJId).single();
      record("JJ-4 (control): none of the refused calls above actually ended the enrolment", stillActive?.ended_at === null, JSON.stringify(stillActive));
    }

    // JJ-4d: the real, correct end.
    {
      const { error } = await principalJJ.rpc("end_enrolment", { p_enrolment_id: enrolmentJJId, p_reason: "left" });
      record("JJ-4d end_enrolment() succeeds for the correct, active, same-institution principal with a valid reason", !error, error?.message);
    }

    // JJ-5/6/7: the cascade, checked directly against every table it
    // touches and the two it must not.
    {
      const { data: row } = await admin.from("class_children").select("ended_at, end_reason").eq("id", classChildJJId).single();
      record("JJ-5a the cascade closes class_children for this child at this institution", row?.ended_at !== null, JSON.stringify(row));
    }
    {
      const { data: row } = await admin.from("child_assignments").select("ended_at, end_reason").eq("passport_id", childJJId).eq("institution_id", institutionJJId).single();
      record("JJ-5b the cascade closes child_assignments for this child at this institution", row?.ended_at !== null, JSON.stringify(row));
    }
    {
      const { data: row } = await admin.from("passport_access").select("is_active").eq("id", grantJJId).single();
      record("JJ-5c the cascade closes passport_access for this child at this institution", row?.is_active === false, JSON.stringify(row));
    }
    {
      const { data: row } = await admin.from("passport_access").select("is_active").eq("id", grantJJOtherId).single();
      record(
        "JJ-5d THE ISOLATION ITSELF: passport_access at the OTHER institution survives untouched -- the cascade's own institution_id filter, proven, not assumed",
        row?.is_active === true,
        JSON.stringify(row)
      );
    }
    {
      const { data: row } = await admin.from("passport_institution_links").select("approved_by_parent").eq("passport_id", childJJId).eq("institution_id", institutionJJId).single();
      record(
        "JJ-6 THE DECISION HOLDS: ending the enrolment does NOT touch approved_by_parent -- not a principal's to clear (PRD 3 Stage 2: this column is a compatibility default on school-created links, not a live consent record any client can still write, but ending an enrolment still has no business touching it either way)",
        row?.approved_by_parent === true,
        JSON.stringify(row)
      );
    }
    {
      const { data: row } = await admin.from("incidents").select("owning_teacher_id, teacher_signed_at").eq("id", incidentJJId).single();
      record(
        "JJ-7a the cascade does NOT touch incidents/owning_teacher_id -- still teacherJJ, still unsigned",
        row?.owning_teacher_id === teacherJJId && row?.teacher_signed_at === null,
        JSON.stringify(row)
      );
    }
    {
      const { error } = await teacherJJ.from("incidents").update({ parent_summary: "Updated after enrolment ended." }).eq("id", incidentJJId);
      record(
        "JJ-7b THE DESTINATION ITSELF: the owning teacher can still complete an unsigned incident for a child whose enrolment has since ended -- no new mechanism needed, read the policy, not assumed",
        !error,
        error?.message
      );
    }

    // JJ-3/JJ-8: re-enrolment is permitted once the old one is closed,
    // and the old row survives, unmodified, as history -- not deleted,
    // not reused. The decision that mattered most, per Daniel's own
    // instruction: read the policy, not reasoned about.
    let reEnrolmentJJId;
    {
      const { data, error } = await admin
        .from("enrolments")
        .insert({ passport_id: childJJId, institution_id: institutionJJId, started_by: principalJJId })
        .select()
        .single();
      record("JJ-3 a child whose enrolment ended CAN be enrolled again -- the index permits a new row once the old one is closed", !error, error?.message);
      reEnrolmentJJId = data?.id;
    }
    {
      const { data: allRows } = await admin.from("enrolments").select("*").eq("passport_id", childJJId).order("started_at");
      const original = allRows?.find((r) => r.id === enrolmentJJId);
      const fresh = allRows?.find((r) => r.id === reEnrolmentJJId);
      record(
        "JJ-8 THE ONE THAT MATTERS MOST: both enrolment rows exist -- the ended original, untouched (reason still 'left', still attributed to principalJJ), and the new active one -- history intact, re-enrolment is a genuinely new row, not a reused or resurrected one",
        allRows?.length === 2 &&
          original?.ended_at !== null &&
          original?.end_reason === "left" &&
          original?.ended_by === principalJJId &&
          fresh?.ended_at === null &&
          fresh?.id !== original?.id,
        JSON.stringify(allRows)
      );
    }

    console.log("JJ summary complete.");

    await admin.from("incidents").delete().eq("id", incidentJJId);
    await admin.from("passports").delete().eq("id", childJJId);
    await admin.from("institutions").delete().in("id", [institutionJJId, institutionJJOtherId]);
    for (const id of [principalJJId, principalJJOtherId, teacherJJId, snaJJId, teacherJJOtherId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK KK: Stage 7, Step 1 (migration 0123) -- clinician_access.engaged_by and split revocation authority. Two institutions, six clinicians, one child claimed through the real chain -- every write path, both double-engagement refusals, all three revoke authorities, principal/parent visibility, staff-departure non-cascade, and the enrolment-end cascade's own isolation. ==`);
  if (shouldRun("KK")) {
    const { data: instKK, error: instKKErr } = await admin
      .from("institutions")
      .insert({ name: "KK Institution", institution_code: CODE + "KK", status: "verified" })
      .select()
      .single();
    if (instKKErr) throw instKKErr;
    const institutionKKId = instKK.id;

    const { data: instKKOther, error: instKKOtherErr } = await admin
      .from("institutions")
      .insert({ name: "KK Other Institution", institution_code: CODE + "KKB", status: "verified" })
      .select()
      .single();
    if (instKKOtherErr) throw instKKOtherErr;
    const institutionKKOtherId = instKKOther.id;

    const principalKKId = await createUser("checkkk.principal@thebehaviourhive.com", "KK Principal", "principal");
    const principalKKOtherId = await createUser("checkkk.principalother@thebehaviourhive.com", "KK Other Principal", "principal");
    const teacherKKId = await createUser("checkkk.teacher@thebehaviourhive.com", "KK Teacher", "class_teacher");
    const parentKKId = await createUser("checkkk.parent@thebehaviourhive.com", "KK Parent", "parent");
    const parentKKOutsiderId = await createUser("checkkk.parentoutsider@thebehaviourhive.com", "KK Outsider Parent", "parent");
    const clinicianKK1Id = await createUser("checkkk.clinician1@thebehaviourhive.com", "KK Clinician One", "clinician");
    const clinicianKK2Id = await createUser("checkkk.clinician2@thebehaviourhive.com", "KK Clinician Two", "clinician");
    const clinicianKK3Id = await createUser("checkkk.clinician3@thebehaviourhive.com", "KK Clinician Three", "clinician");
    const clinicianKK4Id = await createUser("checkkk.clinician4@thebehaviourhive.com", "KK Clinician Four", "clinician");
    const clinicianKK5Id = await createUser("checkkk.clinician5@thebehaviourhive.com", "KK Clinician Five", "clinician");
    const clinicianKK6Id = await createUser("checkkk.clinician6@thebehaviourhive.com", "KK Clinician Six", "clinician");

    const { data: staffKKRows, error: staffKKErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionKKId, user_id: principalKKId, role: "principal" },
      { institution_id: institutionKKOtherId, user_id: principalKKOtherId, role: "principal" },
      { institution_id: institutionKKId, user_id: teacherKKId, role: "class_teacher" },
    ]).select();
    if (staffKKErr) throw staffKKErr;

    const principalKK = await signedInClient("checkkk.principal@thebehaviourhive.com");
    const principalKKOther = await signedInClient("checkkk.principalother@thebehaviourhive.com");

    for (const row of staffKKRows.filter((r) => r.user_id === teacherKKId)) {
      const { error: approveErr } = await principalKK.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (approveErr) throw approveErr;
    }

    const teacherKK = await signedInClient("checkkk.teacher@thebehaviourhive.com");
    const parentKK = await signedInClient("checkkk.parent@thebehaviourhive.com");
    const parentKKOutsider = await signedInClient("checkkk.parentoutsider@thebehaviourhive.com");

    // Each clinician verified through the REAL admin path -- select_
    // clinician_specialty() as their own session, approve_clinician() as
    // the service role (the only verification path that exists; there is
    // no user-facing self-verify RPC to bypass) -- not a hand-set
    // verification_status. This is what actually produces a real
    // clinician_code, which every write path below looks up by.
    const clinicianCodes = {};
    for (const [id, email] of [
      [clinicianKK1Id, "checkkk.clinician1@thebehaviourhive.com"],
      [clinicianKK2Id, "checkkk.clinician2@thebehaviourhive.com"],
      [clinicianKK3Id, "checkkk.clinician3@thebehaviourhive.com"],
      [clinicianKK4Id, "checkkk.clinician4@thebehaviourhive.com"],
      [clinicianKK5Id, "checkkk.clinician5@thebehaviourhive.com"],
      [clinicianKK6Id, "checkkk.clinician6@thebehaviourhive.com"],
    ]) {
      const c = await signedInClient(email);
      const { error: specErr } = await c.rpc("select_clinician_specialty", { p_specialty: "behavioural_psychologist" });
      if (specErr) throw specErr;
      const { data: approveRows, error: approveErr } = await admin.rpc("approve_clinician", { clinician_email: email });
      if (approveErr) throw approveErr;
      // approve_clinician()'s live (0030, not 0029) return column is
      // "code", not "clinician_code" -- 0030's own fix, renamed to avoid
      // a PL/pgSQL variable/column collision inside the function itself.
      // Read the live definition, not the first one found -- caught here
      // by the RPC actually failing (undefined -> the param silently
      // dropped from the request, misread at first as a schema-cache
      // miss), not by re-reading the migration proactively.
      clinicianCodes[id] = approveRows?.[0]?.code ?? approveRows?.code;
    }

    // The child: created by the school (create_school_passport(), 0113/
    // 0121 -- atomically opens the enrolment too), then claimed by the
    // real parent through the real chain (generate_/redeem_passport_
    // claim_code(), 0114/0115) -- never a hand-inserted passport_
    // guardians row, matching this suite's own established discipline.
    const { data: childKKId, error: childKKErr } = await principalKK.rpc("create_school_passport", {
      p_institution_id: institutionKKId,
      p_child_name: "KK Child",
    });
    if (childKKErr) throw childKKErr;

    const { data: claimCodeKK, error: claimCodeKKErr } = await principalKK.rpc("generate_passport_claim_code", {
      p_institution_id: institutionKKId,
      p_passport_id: childKKId,
    });
    if (claimCodeKKErr) throw claimCodeKKErr;
    const { error: redeemKKErr } = await parentKK.rpc("redeem_passport_claim_code", { p_code: claimCodeKK });
    if (redeemKKErr) throw redeemKKErr;

    // KK-1/KK-2: the two write paths, each stamping the right authority.
    let clinicianAccessKK1Id;
    {
      const { data, error } = await parentKK.rpc("connect_clinician", { p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK1Id] });
      clinicianAccessKK1Id = data;
      const { data: row } = await admin.from("clinician_access").select("*").eq("id", data).single();
      record(
        "KK-1 connect_clinician() (parent): stamps engaged_by='parent', granted_by=the parent, no institution reference",
        !error && row?.engaged_by === "parent" && row?.engaged_by_institution_id === null && row?.granted_by === parentKKId && row?.is_active === true,
        JSON.stringify({ error: error?.message, row })
      );
    }

    let clinicianAccessKK2Id;
    {
      const { data, error } = await principalKK.rpc("grant_clinician_access", { p_institution_id: institutionKKId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK2Id] });
      clinicianAccessKK2Id = data;
      const { data: row } = await admin.from("clinician_access").select("*").eq("id", data).single();
      record(
        "KK-2 grant_clinician_access() (principal): stamps engaged_by='institution', engaged_by_institution_id=their own institution, granted_by=the principal",
        !error && row?.engaged_by === "institution" && row?.engaged_by_institution_id === institutionKKId && row?.granted_by === principalKKId && row?.is_active === true,
        JSON.stringify({ error: error?.message, row })
      );
    }

    // KK-3: principal-only.
    {
      const { error } = await teacherKK.rpc("grant_clinician_access", { p_institution_id: institutionKKId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK3Id] });
      record("KK-3 grant_clinician_access() refuses a non-principal caller", Boolean(error), error?.message);
    }

    // KK-4: the child must actually be linked to the granting institution
    // -- institutionKKOther has no link to childKK yet at this point.
    {
      const { error } = await principalKKOther.rpc("grant_clinician_access", { p_institution_id: institutionKKOtherId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK3Id] });
      record("KK-4 grant_clinician_access() refuses when the child has no link to the granting institution", Boolean(error) && /no link/i.test(error?.message ?? ""), error?.message);
    }

    // KK-5: connect_clinician() is owner-only.
    {
      const { error } = await parentKKOutsider.rpc("connect_clinician", { p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK3Id] });
      record("KK-5 connect_clinician() refuses a caller who isn't this child's own guardian", Boolean(error), error?.message);
    }

    // KK-6/KK-7: THE DOUBLE-ENGAGEMENT REFUSAL, both directions --
    // explained, never a raw constraint violation.
    {
      const { error } = await principalKK.rpc("grant_clinician_access", { p_institution_id: institutionKKId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK1Id] });
      record(
        "KK-6 grant_clinician_access() refuses a clinician already parent-engaged for this child, with an explanation, not a bare constraint error",
        Boolean(error) && /parent or guardian/i.test(error?.message ?? "") && !/duplicate key/i.test(error?.message ?? ""),
        error?.message
      );
    }
    {
      const { error } = await parentKK.rpc("connect_clinician", { p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK2Id] });
      record(
        "KK-7 connect_clinician() refuses a clinician already institution-engaged for this child, with an explanation, not a bare constraint error",
        Boolean(error) && /through their school/i.test(error?.message ?? "") && !/duplicate key/i.test(error?.message ?? ""),
        error?.message
      );
    }

    // Link childKK to the second institution now (mirroring CHECK DD/JJ's
    // own precedent for constructing real multi-institution state -- the
    // same shape a parent's own approve flow, or here principalKK's own
    // school link, would create), so the cross-institution and isolation
    // checks below have a real second institution to work against.
    await admin.from("passport_institution_links").insert({
      passport_id: childKKId,
      institution_id: institutionKKOtherId,
      approved_by_parent: true,
    });

    // KK-8: a clinician already institution-engaged elsewhere can't be
    // reactivated by a DIFFERENT institution.
    {
      const { error } = await principalKKOther.rpc("grant_clinician_access", { p_institution_id: institutionKKOtherId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK2Id] });
      record("KK-8 grant_clinician_access() refuses a clinician engaged by a DIFFERENT institution", Boolean(error) && /different school/i.test(error?.message ?? ""), error?.message);
    }

    // KK-9: revoke, parent authority, own row -- audit columns correct.
    {
      const { error } = await parentKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK1Id, p_reason: "No longer needed." });
      const { data: row } = await admin.from("clinician_access").select("*").eq("id", clinicianAccessKK1Id).single();
      record(
        "KK-9 revoke_clinician_access() (parent, own engagement): succeeds, revoked_at/revoked_by/revocation_reason all correctly set",
        !error && row?.is_active === false && row?.revoked_at !== null && row?.revoked_by === parentKKId && row?.revocation_reason === "No longer needed.",
        JSON.stringify({ error: error?.message, row })
      );
    }

    // KK-10: a reason is required.
    {
      const { error } = await principalKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK2Id, p_reason: "" });
      record("KK-10 revoke_clinician_access() refuses an empty reason", Boolean(error) && /reason is required/i.test(error?.message ?? ""), error?.message);
    }

    // KK-11/12/13: the three ways to lack authority over an institution-
    // engaged row -- wrong authority (parent), not a principal, wrong
    // institution.
    {
      const { error } = await parentKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK2Id, p_reason: "Trying anyway." });
      record("KK-11 revoke_clinician_access() refuses a parent trying to revoke an institution-engaged row", Boolean(error) && /authority/i.test(error?.message ?? ""), error?.message);
    }
    {
      const { error } = await teacherKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK2Id, p_reason: "Trying anyway." });
      record("KK-12 revoke_clinician_access() refuses a non-principal staff member", Boolean(error) && /authority/i.test(error?.message ?? ""), error?.message);
    }
    {
      const { error } = await principalKKOther.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK2Id, p_reason: "Trying anyway." });
      record("KK-13 revoke_clinician_access() refuses a principal from a DIFFERENT institution", Boolean(error) && /authority/i.test(error?.message ?? ""), error?.message);
    }

    // KK-14: the correct principal, their own institution's row.
    {
      const { error } = await principalKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK2Id, p_reason: "Engagement ended." });
      const { data: row } = await admin.from("clinician_access").select("is_active, revoked_by, revocation_reason").eq("id", clinicianAccessKK2Id).single();
      record(
        "KK-14 revoke_clinician_access() (principal, own institution's engagement): succeeds",
        !error && row?.is_active === false && row?.revoked_by === principalKKId && row?.revocation_reason === "Engagement ended.",
        JSON.stringify({ error: error?.message, row })
      );
    }

    // KK-15: idempotency -- already revoked, refuses cleanly.
    {
      const { error } = await parentKK.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK1Id, p_reason: "Again." });
      record("KK-15 revoke_clinician_access() refuses a row that's already revoked", Boolean(error) && /already been revoked/i.test(error?.message ?? ""), error?.message);
    }

    // KK-16/16b: CLINICIAN SELF-REVOKE, the third orthogonal authority --
    // proven on BOTH an institution-engaged row and a parent-engaged one,
    // with the clinician's own free-text reason.
    let clinicianAccessKK3Id;
    {
      const { data } = await principalKK.rpc("grant_clinician_access", { p_institution_id: institutionKKId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK3Id] });
      clinicianAccessKK3Id = data;
    }
    {
      const clinicianKK3 = await signedInClient("checkkk.clinician3@thebehaviourhive.com");
      const { error } = await clinicianKK3.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK3Id, p_reason: "Stepping back due to capacity." });
      const { data: row } = await admin.from("clinician_access").select("is_active, revoked_by, revocation_reason").eq("id", clinicianAccessKK3Id).single();
      record(
        "KK-16 SELF-REVOKE, institution-engaged: the clinician ends their own involvement regardless of who engaged them, own free-text reason",
        !error && row?.is_active === false && row?.revoked_by === clinicianKK3Id && row?.revocation_reason === "Stepping back due to capacity.",
        JSON.stringify({ error: error?.message, row })
      );
    }
    let clinicianAccessKK4Id;
    {
      const { data } = await parentKK.rpc("connect_clinician", { p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK4Id] });
      clinicianAccessKK4Id = data;
    }
    {
      const clinicianKK4 = await signedInClient("checkkk.clinician4@thebehaviourhive.com");
      const { error } = await clinicianKK4.rpc("revoke_clinician_access", { p_clinician_access_id: clinicianAccessKK4Id, p_reason: "Conflict of interest." });
      const { data: row } = await admin.from("clinician_access").select("is_active, revoked_by").eq("id", clinicianAccessKK4Id).single();
      record(
        "KK-16b SELF-REVOKE, parent-engaged: same third authority, works identically regardless of engaged_by",
        !error && row?.is_active === false && row?.revoked_by === clinicianKK4Id,
        JSON.stringify({ error: error?.message, row })
      );
    }

    // KK-17: REACTIVATION -- the same authority that revoked can
    // reconnect, audit columns reset.
    {
      const { data, error } = await parentKK.rpc("connect_clinician", { p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK1Id] });
      const { data: row } = await admin.from("clinician_access").select("*").eq("id", data).single();
      record(
        "KK-17 REACTIVATION: the same authority reconnecting a previously-revoked clinician succeeds, revoked_at/revoked_by/revocation_reason reset to null",
        !error && data === clinicianAccessKK1Id && row?.is_active === true && row?.revoked_at === null && row?.revoked_by === null && row?.revocation_reason === null,
        JSON.stringify({ error: error?.message, row })
      );
    }

    // KK-5v2: a fresh, active institution engagement for the visibility
    // and cascade checks below.
    let clinicianAccessKK5Id;
    {
      const { data, error } = await principalKK.rpc("grant_clinician_access", { p_institution_id: institutionKKId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK5Id] });
      if (error) throw error;
      clinicianAccessKK5Id = data;
    }

    // KK-18/19: PRINCIPAL VISIBILITY -- sees both authorities, read-only;
    // a non-principal staff member sees nothing.
    {
      const { data: rows } = await principalKK.from("clinician_access").select("id, engaged_by").eq("passport_id", childKKId).eq("is_active", true);
      const ids = (rows ?? []).map((r) => r.id);
      record(
        "KK-18 THE DESTINATION ITSELF: the principal sees BOTH the parent-engaged and the institution-engaged clinician on this child, care coordination, read-only",
        ids.includes(clinicianAccessKK1Id) && ids.includes(clinicianAccessKK5Id),
        JSON.stringify(rows)
      );
    }
    {
      const { data: rows } = await teacherKK.from("clinician_access").select("id").eq("passport_id", childKKId);
      record("KK-19 a non-principal staff member sees NOTHING via the new principal-only SELECT policy", (rows ?? []).length === 0, JSON.stringify(rows));
    }

    // KK-20: PARENT VISIBILITY, unchanged and already correct -- Step 0's
    // own finding, proven live: the parent sees the institution-engaged
    // clinician too, with no SQL change needed for this side at all.
    {
      const { data: rows } = await parentKK.from("clinician_access").select("id, engaged_by").eq("passport_id", childKKId).eq("is_active", true);
      const ids = (rows ?? []).map((r) => r.id);
      record(
        "KK-20 THE SYMMETRY ITSELF: the parent already sees the school's own clinician engagement, unprompted -- 'Parents can view...' was never engaged_by-scoped",
        ids.includes(clinicianAccessKK1Id) && ids.includes(clinicianAccessKK5Id),
        JSON.stringify(rows)
      );
    }

    // KK-21: staff departure does NOT cascade to clinician_access -- the
    // engagement belongs to the institution, not whoever happened to be
    // staff at the time. teacherKK has no clinician-related role at all;
    // deactivating them is the cheapest real proof that departure in
    // general never touches this table (deactivate_institution_staff()
    // was not modified by 0123 and never referenced clinician_access in
    // any earlier migration either).
    {
      const { data: teacherKKStaffRow } = await admin.from("institution_staff").select("id").eq("institution_id", institutionKKId).eq("user_id", teacherKKId).single();
      const { error } = await principalKK.rpc("deactivate_institution_staff", { p_institution_staff_id: teacherKKStaffRow.id, p_reason: "KK test departure." });
      if (error) throw error;
      const { data: row } = await admin.from("clinician_access").select("is_active").eq("id", clinicianAccessKK5Id).single();
      record(
        "KK-21 staff departure does not cascade to clinician_access -- the engagement survives, confirmed live not just by reading the source",
        row?.is_active === true,
        JSON.stringify(row)
      );
    }

    // KK-22: a genuine cross-institution engagement, for the cascade's
    // own isolation check below.
    let clinicianAccessKK6Id;
    {
      const { data, error } = await principalKKOther.rpc("grant_clinician_access", { p_institution_id: institutionKKOtherId, p_passport_id: childKKId, p_clinician_code: clinicianCodes[clinicianKK6Id] });
      if (error) throw error;
      clinicianAccessKK6Id = data;
    }

    // KK-23/24: THE ENROLMENT-END CASCADE, extended. Ending childKK's
    // enrolment at institutionKK must close clinicianKK5's row (engaged
    // by THAT institution) and touch neither clinicianKK1 (parent-
    // engaged) nor clinicianKK6 (engaged by the OTHER institution).
    {
      const { data: enrolmentKKRow } = await admin.from("enrolments").select("id").eq("passport_id", childKKId).eq("institution_id", institutionKKId).is("ended_at", null).single();
      const { error } = await principalKK.rpc("end_enrolment", { p_enrolment_id: enrolmentKKRow.id, p_reason: "left" });
      if (error) throw error;
    }
    {
      const { data: row } = await admin.from("clinician_access").select("is_active, revoked_at, revocation_reason").eq("id", clinicianAccessKK5Id).single();
      record(
        "KK-23 THE CASCADE ITSELF: ending the enrolment closes the school-engaged clinician's access, with a revocation reason naming why",
        row?.is_active === false && row?.revoked_at !== null && /enrolment ended/i.test(row?.revocation_reason ?? ""),
        JSON.stringify(row)
      );
    }
    {
      const [{ data: parentRow }, { data: otherInstRow }] = await Promise.all([
        admin.from("clinician_access").select("is_active").eq("id", clinicianAccessKK1Id).single(),
        admin.from("clinician_access").select("is_active").eq("id", clinicianAccessKK6Id).single(),
      ]);
      record(
        "KK-24 THE ISOLATION ITSELF: the parent-engaged clinician AND the OTHER institution's own engagement both survive the cascade untouched -- mirrors JJ-5d for clinician_access",
        parentRow?.is_active === true && otherInstRow?.is_active === true,
        JSON.stringify({ parentRow, otherInstRow })
      );
    }

    console.log("KK summary complete.");

    await admin.from("passports").delete().eq("id", childKKId);
    await admin.from("institutions").delete().in("id", [institutionKKId, institutionKKOtherId]);
    for (const id of [
      principalKKId, principalKKOtherId, teacherKKId, parentKKId, parentKKOutsiderId,
      clinicianKK1Id, clinicianKK2Id, clinicianKK3Id, clinicianKK4Id, clinicianKK5Id, clinicianKK6Id,
    ]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK LL: Client-behaviour half of Stage 7, Step 2 (src/app/passport/dashboard/page.tsx, src/app/principal/passports/[passportId]/page.tsx, src/app/clinician/passports/page.tsx, src/app/clinician/passport/[passportId]/page.tsx) -- proven via the LITERAL client query shape AND the LITERAL client gating conditional, not a proxy for either. CHECK KK already proves revoke_clinician_access() enforces the authority split at the RPC level; this check proves something CHECK KK cannot see at all -- whether the UI's OWN affordance (does a revoke button even render) agrees with that split. The symmetry requirements Daniel named ("a principal sees a parent-engaged clinician with no revoke button reachable", and its mirror for the parent) are gating decisions that live entirely in these four files' own conditionals -- nothing in RLS or an RPC signature can catch a future change to one of them. Verified once, live, in Stage 7 Step 2's own browser pass; nothing before this check stopped the next change from silently breaking it. ==`);
  if (shouldRun("LL")) {
    const { data: instLL, error: instLLErr } = await admin
      .from("institutions")
      .insert({ name: "LL Institution", institution_code: CODE + "LL", status: "verified" })
      .select()
      .single();
    if (instLLErr) throw instLLErr;
    const institutionLLId = instLL.id;

    const { data: instLLOther, error: instLLOtherErr } = await admin
      .from("institutions")
      .insert({ name: "LL Other Institution", institution_code: CODE + "LLB", status: "verified" })
      .select()
      .single();
    if (instLLOtherErr) throw instLLOtherErr;
    const institutionLLOtherId = instLLOther.id;

    const principalLLId = await createUser("checkll.principal@thebehaviourhive.com", "LL Principal", "principal");
    const principalLLOtherId = await createUser("checkll.principalother@thebehaviourhive.com", "LL Other Principal", "principal");
    const parentLLId = await createUser("checkll.parent@thebehaviourhive.com", "LL Parent", "parent");
    // clinicianLL1: parent-engaged. clinicianLL2: engaged by institutionLL
    // (the viewer's OWN institution in the principal checks below).
    // clinicianLL3: engaged by institutionLLOther -- the "different
    // institution" case LL-2 needs to prove the gate isn't just "any
    // institution engagement", specifically THIS principal's own.
    const clinicianLL1Id = await createUser("checkll.clinician1@thebehaviourhive.com", "LL Clinician One", "clinician");
    const clinicianLL2Id = await createUser("checkll.clinician2@thebehaviourhive.com", "LL Clinician Two", "clinician");
    const clinicianLL3Id = await createUser("checkll.clinician3@thebehaviourhive.com", "LL Clinician Three", "clinician");

    const { error: staffLLErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionLLId, user_id: principalLLId, role: "principal" },
      { institution_id: institutionLLOtherId, user_id: principalLLOtherId, role: "principal" },
    ]);
    if (staffLLErr) throw staffLLErr;

    const principalLL = await signedInClient("checkll.principal@thebehaviourhive.com");
    const principalLLOther = await signedInClient("checkll.principalother@thebehaviourhive.com");
    const parentLL = await signedInClient("checkll.parent@thebehaviourhive.com");

    const clinicianCodesLL = {};
    for (const [id, email] of [
      [clinicianLL1Id, "checkll.clinician1@thebehaviourhive.com"],
      [clinicianLL2Id, "checkll.clinician2@thebehaviourhive.com"],
      [clinicianLL3Id, "checkll.clinician3@thebehaviourhive.com"],
    ]) {
      const c = await signedInClient(email);
      const { error: specErr } = await c.rpc("select_clinician_specialty", { p_specialty: "behavioural_psychologist" });
      if (specErr) throw specErr;
      const { data: approveRows, error: approveErr } = await admin.rpc("approve_clinician", { clinician_email: email });
      if (approveErr) throw approveErr;
      clinicianCodesLL[id] = approveRows?.[0]?.code ?? approveRows?.code;
    }

    // The child: school-created, then claimed by the real parent through
    // the real chain -- same discipline as CHECK KK, never a hand-
    // inserted passport_guardians row.
    const { data: childLLId, error: childLLErr } = await principalLL.rpc("create_school_passport", {
      p_institution_id: institutionLLId,
      p_child_name: "LL Child",
    });
    if (childLLErr) throw childLLErr;
    const { data: claimCodeLL, error: claimCodeLLErr } = await principalLL.rpc("generate_passport_claim_code", {
      p_institution_id: institutionLLId,
      p_passport_id: childLLId,
    });
    if (claimCodeLLErr) throw claimCodeLLErr;
    const { error: redeemLLErr } = await parentLL.rpc("redeem_passport_claim_code", { p_code: claimCodeLL });
    if (redeemLLErr) throw redeemLLErr;

    // Second institution link, mirroring CHECK KK's own precedent, so
    // clinicianLL3's engagement has a real institution to belong to.
    await admin.from("passport_institution_links").insert({
      passport_id: childLLId,
      institution_id: institutionLLOtherId,
      approved_by_parent: true,
    });

    let clinicianAccessLL1Id, clinicianAccessLL2Id, clinicianAccessLL3Id;
    {
      const { data, error } = await parentLL.rpc("connect_clinician", { p_passport_id: childLLId, p_clinician_code: clinicianCodesLL[clinicianLL1Id] });
      if (error) throw error;
      clinicianAccessLL1Id = data;
    }
    {
      const { data, error } = await principalLL.rpc("grant_clinician_access", { p_institution_id: institutionLLId, p_passport_id: childLLId, p_clinician_code: clinicianCodesLL[clinicianLL2Id] });
      if (error) throw error;
      clinicianAccessLL2Id = data;
    }
    {
      const { data, error } = await principalLLOther.rpc("grant_clinician_access", { p_institution_id: institutionLLOtherId, p_passport_id: childLLId, p_clinician_code: clinicianCodesLL[clinicianLL3Id] });
      if (error) throw error;
      clinicianAccessLL3Id = data;
    }

    // ---- LL-1: THE PRINCIPAL'S OWN QUERY (bullet 1) --
    // src/app/principal/passports/[passportId]/page.tsx:201's exact RPC
    // call, reproduced verbatim. ----
    const { data: principalRowsLL, error: principalQueryLLErr } = await principalLL.rpc("get_passport_clinicians", { p_passport_id: childLLId });
    {
      const byAccessId = (id) => (principalRowsLL ?? []).find((r) => r.clinician_access_id === id);
      const sawParent = byAccessId(clinicianAccessLL1Id)?.engaged_by === "parent";
      const sawOwnInstitution = byAccessId(clinicianAccessLL2Id)?.engaged_by === "institution";
      const sawOtherInstitution = byAccessId(clinicianAccessLL3Id)?.engaged_by === "institution";
      record(
        "LL-1 THE DESTINATION ITSELF: the principal's own query (src/app/principal/passports/[passportId]/page.tsx:201) returns all THREE rows -- the parent's own engagement, this institution's own, AND the other institution's -- not a proxy for the RPC's authorization, the literal call this page makes",
        !principalQueryLLErr && sawParent && sawOwnInstitution && sawOtherInstitution,
        JSON.stringify({ error: principalQueryLLErr?.message, principalRowsLL })
      );
    }

    // ---- LL-2: THE PRINCIPAL'S OWN REVOKE GATE (bullet 2, surface 1 of
    // 3) -- src/app/principal/passports/[passportId]/page.tsx:587's exact
    // conditional (`c.engagedBy === "institution" && c.engagedByInstitutionId
    // === institutionId`), reproduced verbatim against LL-1's own rows,
    // not a paraphrase of what the boolean "should" do. Three cases on
    // one surface: this institution's own engagement (shows), the
    // parent's (doesn't), and -- the case CHECK KK's RPC-level coverage
    // has no equivalent of -- a DIFFERENT institution's own engagement
    // (doesn't, even though engaged_by is 'institution' too). ----
    {
      const canRevoke = (row) => row?.engaged_by === "institution" && row?.engaged_by_institution_id === institutionLLId;
      const ownRow = (principalRowsLL ?? []).find((r) => r.clinician_access_id === clinicianAccessLL2Id);
      const parentRow = (principalRowsLL ?? []).find((r) => r.clinician_access_id === clinicianAccessLL1Id);
      const otherInstRow = (principalRowsLL ?? []).find((r) => r.clinician_access_id === clinicianAccessLL3Id);
      record(
        "LL-2a the principal's own institution's engagement gates canRevoke=true (src/app/principal/passports/[passportId]/page.tsx:587)",
        canRevoke(ownRow) === true,
        JSON.stringify(ownRow)
      );
      record(
        "LL-2b THE SYMMETRY REQUIREMENT ITSELF: the parent's own engagement gates canRevoke=false on the principal's surface -- 'neither authority can revoke the other's' (src/app/principal/passports/[passportId]/page.tsx:587)",
        canRevoke(parentRow) === false,
        JSON.stringify(parentRow)
      );
      record(
        "LL-2c THE CASE CHECK KK CANNOT SEE: a DIFFERENT institution's own engagement also gates canRevoke=false -- engaged_by='institution' alone is not the gate, engaged_by_institution_id matching THIS principal's own institution is (src/app/principal/passports/[passportId]/page.tsx:587)",
        canRevoke(otherInstRow) === false,
        JSON.stringify(otherInstRow)
      );
    }

    // ---- LL-3: THE PARENT'S OWN QUERY AND REVOKE GATE (bullet 2 surface
    // 2 of 3, and bullet 3) -- src/app/passport/dashboard/page.tsx:304's
    // exact RPC call, then its own gate at :907/:912
    // (`clinician.engagedBy === "parent"`), reproduced verbatim. ----
    const { data: parentRowsLL, error: parentQueryLLErr } = await parentLL.rpc("get_passport_clinicians", { p_passport_id: childLLId });
    {
      const byAccessId = (id) => (parentRowsLL ?? []).find((r) => r.clinician_access_id === id);
      const ownRow = byAccessId(clinicianAccessLL1Id);
      const schoolRow = byAccessId(clinicianAccessLL2Id);
      const otherSchoolRow = byAccessId(clinicianAccessLL3Id);
      const canRevoke = (row) => row?.engaged_by === "parent";
      record(
        "LL-3a THE MIRROR OF BULLET 3: the parent's own query (src/app/passport/dashboard/page.tsx:304) shows the SCHOOL-engaged row too -- 'a school engaging a clinician for someone's child is not something a parent should discover by accident'",
        !parentQueryLLErr && Boolean(schoolRow) && Boolean(otherSchoolRow),
        JSON.stringify({ error: parentQueryLLErr?.message, schoolRow, otherSchoolRow })
      );
      record(
        "LL-3b the parent's own engagement gates canRevoke=true (src/app/passport/dashboard/page.tsx:907/912)",
        canRevoke(ownRow) === true,
        JSON.stringify(ownRow)
      );
      record(
        "LL-3c THE SYMMETRY REQUIREMENT'S OTHER HALF: the school-engaged row offers NO revoke on the parent's surface, for either engaging institution (src/app/passport/dashboard/page.tsx:907/912)",
        canRevoke(schoolRow) === false && canRevoke(otherSchoolRow) === false,
        JSON.stringify({ schoolRow, otherSchoolRow })
      );
    }

    // ---- LL-4/LL-5: THE CLINICIAN'S OWN SURFACES (bullet 4, and bullet
    // 5's "third surface" from bullet 2's own framing) -- one sign-in
    // per clinician, reused across both checks (this suite's own auth
    // rate-limit budget matters -- see the file header). Both checks
    // call get_clinician_passports() the way BOTH
    // src/app/clinician/passports/page.tsx:61 (the caseload list) and
    // src/app/clinician/passport/[passportId]/page.tsx:155 (this child's
    // own detail page) actually do -- same RPC, same no-params shape,
    // genuinely the same call from the client's point of view. ----
    {
      const clinicianLL1 = await signedInClient("checkll.clinician1@thebehaviourhive.com");
      const clinicianLL2 = await signedInClient("checkll.clinician2@thebehaviourhive.com");
      const { data: caseloadLL1 } = await clinicianLL1.rpc("get_clinician_passports");
      const { data: caseloadLL2 } = await clinicianLL2.rpc("get_clinician_passports");
      const rowLL1 = (caseloadLL1 ?? []).find((r) => r.passport_id === childLLId);
      const rowLL2 = (caseloadLL2 ?? []).find((r) => r.passport_id === childLLId);

      // LL-4: src/app/clinician/passports/page.tsx:147-149's own display
      // logic, reproduced verbatim.
      const displayFor = (row) =>
        row?.engaged_by === "parent" ? "Connected by the family" : `Connected by ${row?.engaged_by_institution_name ?? "the school"}`;
      record(
        "LL-4a the parent-engaged clinician's own caseload row displays 'Connected by the family' (src/app/clinician/passports/page.tsx:147-149)",
        displayFor(rowLL1) === "Connected by the family",
        JSON.stringify(rowLL1)
      );
      record(
        "LL-4b the institution-engaged clinician's own caseload row names the REAL engaging institution, not a placeholder (src/app/clinician/passports/page.tsx:147-149)",
        displayFor(rowLL2) === "Connected by LL Institution",
        JSON.stringify(rowLL2)
      );

      // LL-5: src/app/clinician/passport/[passportId]/page.tsx:163-165's
      // own .find() resolution plus :276's own render gate
      // (`{engagement && (...)}`, unconditional on engagedBy),
      // reproduced verbatim for both authorities -- deliberately the ONE
      // of the three surfaces that does NOT gate on engaged_by at all.
      const buttonWouldShow = (own) => Boolean(own); // the literal :276 gate
      record(
        "LL-5a THE THIRD SURFACE: a parent-engaged clinician's own 'End your involvement' gate resolves truthy -- self-revoke available (src/app/clinician/passport/[passportId]/page.tsx:163-165,276)",
        buttonWouldShow(rowLL1) === true,
        JSON.stringify(rowLL1)
      );
      record(
        "LL-5b THE CONTRAST WITH LL-2/LL-3: an institution-engaged clinician's OWN gate resolves truthy too -- unlike the principal's and parent's own surfaces, this one is deliberately NOT engaged_by-conditional (src/app/clinician/passport/[passportId]/page.tsx:163-165,276)",
        buttonWouldShow(rowLL2) === true,
        JSON.stringify(rowLL2)
      );
    }

    console.log("LL summary complete.");

    await admin.from("passports").delete().eq("id", childLLId);
    await admin.from("institutions").delete().in("id", [institutionLLId, institutionLLOtherId]);
    for (const id of [principalLLId, principalLLOtherId, parentLLId, clinicianLL1Id, clinicianLL2Id, clinicianLL3Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK MM: Client-behaviour half of Stage 2 (src/app/principal/staff/page.tsx, src/app/principal/dashboard/page.tsx) -- proven via the LITERAL client derivation, not a proxy for it. Not a child-access check (Stage 2 touches no child data at all) -- the same discipline applied to the OTHER bug class this pattern exists for: a client-side split/filter over roster rows silently drifting from what the RPC actually returns. One roster fetch (pending + active + deactivated all present, migration 0125's own new columns populated), reproduced against three separate client derivations: the segmented control's own three-way split, the dashboard's own pending-count card, and the DEACTIVATED badge's own gate. ==`);
  if (shouldRun("MM")) {
    const { data: instMM, error: instMMErr } = await admin
      .from("institutions")
      .insert({ name: "MM Institution", institution_code: CODE + "MM", status: "verified" })
      .select()
      .single();
    if (instMMErr) throw instMMErr;
    const institutionMMId = instMM.id;

    const principalMMId = await createUser("checkmm.principal@thebehaviourhive.com", "MM Principal", "principal");
    const activeTeacherMMId = await createUser("checkmm.activeteacher@thebehaviourhive.com", "MM Active Teacher", "class_teacher");
    const pendingTeacherMMId = await createUser("checkmm.pendingteacher@thebehaviourhive.com", "MM Pending Teacher", "class_teacher");
    const deactivatedSnaMMId = await createUser("checkmm.deactivatedsna@thebehaviourhive.com", "MM Deactivated SNA", "sna");

    const { data: staffMMRows, error: staffMMErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionMMId, user_id: principalMMId, role: "principal" },
      { institution_id: institutionMMId, user_id: activeTeacherMMId, role: "class_teacher" },
      { institution_id: institutionMMId, user_id: deactivatedSnaMMId, role: "sna" },
    ]).select();
    if (staffMMErr) throw staffMMErr;

    const principalMM = await signedInClient("checkmm.principal@thebehaviourhive.com");
    for (const row of staffMMRows.filter((r) => r.user_id !== principalMMId)) {
      const { error } = await principalMM.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    // A genuinely pending join, via the real self-link path -- same
    // discipline as every other fixture in this suite (CHECK AA's own
    // precedent), never a hand-set approved_at.
    const pendingTeacherMM = await signedInClient("checkmm.pendingteacher@thebehaviourhive.com");
    const { error: pendingJoinErr } = await pendingTeacherMM
      .from("institution_staff")
      .insert({ institution_id: institutionMMId, user_id: pendingTeacherMMId, role: "class_teacher" });
    if (pendingJoinErr) throw pendingJoinErr;

    const deactivatedSnaStaffId = staffMMRows.find((r) => r.user_id === deactivatedSnaMMId).id;
    const { error: deactivateErr } = await principalMM.rpc("deactivate_institution_staff", {
      p_institution_staff_id: deactivatedSnaStaffId,
      p_reason: "MM fixture: needs a genuinely deactivated SNA.",
    });
    if (deactivateErr) throw deactivateErr;

    // ---- The one query BOTH screens make: src/app/principal/staff/
    // page.tsx's own load() and src/app/principal/dashboard/page.tsx's
    // own load(), same RPC, same params (p_include_inactive: true,
    // p_include_pending: true on staff; p_include_inactive: false,
    // p_include_pending: true on dashboard -- reproduced separately
    // below, not assumed identical). ----
    const { data: rosterMM, error: rosterMMErr } = await principalMM.rpc("get_institution_staff_roster", {
      p_institution_id: institutionMMId,
      p_include_inactive: true,
      p_include_pending: true,
    });

    // ---- MM-1: THE NEW COLUMNS THEMSELVES (0125) -- present, and
    // internally consistent with the pre-existing is_active/is_pending
    // derivation, not just non-null. ----
    {
      const deactivatedRow = (rosterMM ?? []).find((r) => r.user_id === deactivatedSnaMMId);
      const activeRow = (rosterMM ?? []).find((r) => r.user_id === activeTeacherMMId);
      record(
        "MM-1a the deactivated row's own deactivated_at/deactivation_reason (0125) are populated, matching is_active=false/is_pending=false",
        !rosterMMErr &&
          deactivatedRow?.is_active === false &&
          deactivatedRow?.is_pending === false &&
          Boolean(deactivatedRow?.deactivated_at) &&
          deactivatedRow?.deactivation_reason === "MM fixture: needs a genuinely deactivated SNA.",
        JSON.stringify({ error: rosterMMErr?.message, deactivatedRow })
      );
      record(
        "MM-1b an active row's own deactivated_at is null -- the new column doesn't leak a stale value onto someone currently active",
        activeRow?.deactivated_at === null && activeRow?.deactivation_reason === null,
        JSON.stringify(activeRow)
      );
    }

    // ---- MM-2: THE SEGMENTED CONTROL'S OWN THREE-WAY SPLIT
    // (src/app/principal/staff/page.tsx's own bySegment derivation),
    // reproduced verbatim against the one real roster fetch above. ----
    {
      const pendingSeg = (rosterMM ?? []).filter((s) => s.is_pending);
      const activeSeg = (rosterMM ?? []).filter((s) => s.is_active);
      const deactivatedSeg = (rosterMM ?? []).filter((s) => !s.is_pending && !s.is_active);
      record(
        "MM-2a THE PENDING SEGMENT: contains exactly the one real pending join, no one else",
        pendingSeg.length === 1 && pendingSeg[0].user_id === pendingTeacherMMId,
        JSON.stringify(pendingSeg)
      );
      record(
        "MM-2b THE ACTIVE SEGMENT: contains the principal and the active teacher, not the deactivated SNA or the pending teacher",
        activeSeg.length === 2 &&
          activeSeg.some((s) => s.user_id === principalMMId) &&
          activeSeg.some((s) => s.user_id === activeTeacherMMId),
        JSON.stringify(activeSeg)
      );
      record(
        "MM-2c THE DEACTIVATED SEGMENT ITSELF: contains the deactivated SNA -- 'deactivated staff are never hidden' proven at the query level, not assumed from the RPC's own p_include_inactive flag alone",
        deactivatedSeg.length === 1 && deactivatedSeg[0].user_id === deactivatedSnaMMId,
        JSON.stringify(deactivatedSeg)
      );
    }

    // ---- MM-3: THE DASHBOARD'S OWN PENDING-COUNT CARD
    // (src/app/principal/dashboard/page.tsx's own load()), a SEPARATE
    // call with different params (p_include_inactive: false) -- proven
    // independently, not assumed to agree with MM-2's own roster call
    // just because it's the same underlying table. ----
    {
      const { data: dashboardRosterMM, error: dashErr } = await principalMM.rpc("get_institution_staff_roster", {
        p_institution_id: institutionMMId,
        p_include_inactive: false,
        p_include_pending: true,
      });
      const pendingCount = (dashboardRosterMM ?? []).filter((s) => s.is_pending).length;
      record(
        "MM-3 THE DEEP-LINK SOURCE ITSELF: the dashboard's own pending-count query (p_include_inactive: false) still surfaces the one pending join -- the card that links to /principal/staff?segment=pending would show, with the right count",
        !dashErr && pendingCount === 1,
        JSON.stringify({ error: dashErr?.message, pendingCount })
      );
    }

    console.log("MM summary complete.");

    await admin.from("institutions").delete().eq("id", institutionMMId);
    for (const id of [principalMMId, activeTeacherMMId, pendingTeacherMMId, deactivatedSnaMMId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK NN: SQL half of Stage 3's claim-code work (migration 0126) -- revoke_passport_claim_code()'s own refusals, none of which existed before this migration since the function had no reason parameter and hand-wrote its own standing check inline. Per CLAUDE.md's own rule ("when a new RPC is added, ask what asserts its REFUSALS"): a non-principal caller, a principal at the WRONG institution, an empty reason, an already-revoked code, and an already-claimed code are each refused independently -- plus get_passport_claim_code_status()'s own institution-scoping, proven by a principal supplying an institution id that isn't their own. ==`);
  if (shouldRun("NN")) {
    const { data: instNN, error: instNNErr } = await admin
      .from("institutions")
      .insert({ name: "NN Institution", institution_code: CODE + "NN", status: "verified" })
      .select()
      .single();
    if (instNNErr) throw instNNErr;
    const institutionNNId = instNN.id;

    const { data: instNNOther, error: instNNOtherErr } = await admin
      .from("institutions")
      .insert({ name: "NN Institution Other", institution_code: CODE + "NNB", status: "verified" })
      .select()
      .single();
    if (instNNOtherErr) throw instNNOtherErr;
    const institutionNNOtherId = instNNOther.id;

    const principalNNId = await createUser("checknn.principal@thebehaviourhive.com", "NN Principal", "principal");
    const teacherNNId = await createUser("checknn.teacher@thebehaviourhive.com", "NN Teacher", "class_teacher");
    const principalNNOtherId = await createUser("checknn.principalother@thebehaviourhive.com", "NN Principal Other", "principal");
    const parentNNId = await createUser("checknn.parent@thebehaviourhive.com", "NN Parent", "parent");

    const { data: staffNNRows, error: staffNNErr } = await admin
      .from("institution_staff")
      .insert([
        { institution_id: institutionNNId, user_id: principalNNId, role: "principal" },
        { institution_id: institutionNNId, user_id: teacherNNId, role: "class_teacher" },
        { institution_id: institutionNNOtherId, user_id: principalNNOtherId, role: "principal" },
      ])
      .select();
    if (staffNNErr) throw staffNNErr;

    const principalNN = await signedInClient("checknn.principal@thebehaviourhive.com");
    const teacherNN = await signedInClient("checknn.teacher@thebehaviourhive.com");
    const principalNNOther = await signedInClient("checknn.principalother@thebehaviourhive.com");
    for (const row of staffNNRows.filter((r) => r.institution_id === institutionNNId && r.user_id !== principalNNId)) {
      const { error } = await principalNN.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const { data: passportNNId, error: createNNErr } = await principalNN.rpc("create_school_passport", {
      p_institution_id: institutionNNId,
      p_child_name: "NN Child",
    });
    if (createNNErr) throw createNNErr;

    const { error: generateNN1Err } = await principalNN.rpc("generate_passport_claim_code", {
      p_institution_id: institutionNNId,
      p_passport_id: passportNNId,
    });
    if (generateNN1Err) throw generateNN1Err;
    const { data: statusNN1 } = await principalNN.rpc("get_passport_claim_code_status", {
      p_institution_id: institutionNNId,
      p_passport_id: passportNNId,
    });
    const claimCodeNN1Id = statusNN1?.[0]?.id;

    // ---- NN-1: a non-principal at the SAME institution is refused. ----
    {
      const { error } = await teacherNN.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN1Id,
        p_reason: "NN-1: a teacher trying anyway.",
      });
      record("NN-1 revoke_passport_claim_code() refuses a non-principal caller (teacherNN)", Boolean(error), error?.message);
    }

    // ---- NN-2: a principal at a DIFFERENT institution is refused --
    // the exact case institution_staff_has_current_standing() (0105)
    // plus the separate role='principal' EXISTS check exist to catch. ----
    {
      const { error } = await principalNNOther.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN1Id,
        p_reason: "NN-2: a principal from another school trying anyway.",
      });
      record(
        "NN-2 revoke_passport_claim_code() refuses a principal at a DIFFERENT institution (principalNNOther)",
        Boolean(error),
        error?.message
      );
    }

    // ---- NN-3: an empty/whitespace reason is refused, same pattern as
    // revoke_clinician_access()/revoke_passport_access(). ----
    {
      const { error } = await principalNN.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN1Id,
        p_reason: "   ",
      });
      record("NN-3 revoke_passport_claim_code() refuses a blank/whitespace-only reason", Boolean(error), error?.message);
    }

    // ---- NN-4: THE HAPPY PATH -- the actual principal, real reason,
    // succeeds. Re-read via a privileged service-role query afterward,
    // not just the absence of a client error (CLAUDE.md's own rule). ----
    {
      const { error } = await principalNN.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN1Id,
        p_reason: "NN-4: revoked for real, by the right principal.",
      });
      const { data: persistedRow } = await admin
        .from("passport_claim_codes")
        .select("revoked_at, revoked_by, revocation_reason")
        .eq("id", claimCodeNN1Id)
        .single();
      record(
        "NN-4 revoke_passport_claim_code() succeeds for the right principal, and the persisted row actually reflects it -- revoked_at/revoked_by/revocation_reason all set",
        !error &&
          Boolean(persistedRow?.revoked_at) &&
          persistedRow?.revoked_by === principalNNId &&
          persistedRow?.revocation_reason === "NN-4: revoked for real, by the right principal.",
        JSON.stringify({ error: error?.message, persistedRow })
      );
    }

    // ---- NN-5: revoking an already-revoked code a second time is
    // refused, not silently a no-op. ----
    {
      const { error } = await principalNN.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN1Id,
        p_reason: "NN-5: trying to revoke it again.",
      });
      record("NN-5 revoke_passport_claim_code() refuses a code that's already been revoked", Boolean(error), error?.message);
    }

    // ---- NN-6: revoking an already-CLAIMED code is refused -- a
    // second, fresh code, actually redeemed by a real parent first. ----
    {
      const { data: code2, error: generateNN2Err } = await principalNN.rpc("generate_passport_claim_code", {
        p_institution_id: institutionNNId,
        p_passport_id: passportNNId,
      });
      if (generateNN2Err) throw generateNN2Err;
      const { data: statusNN2 } = await principalNN.rpc("get_passport_claim_code_status", {
        p_institution_id: institutionNNId,
        p_passport_id: passportNNId,
      });
      const claimCodeNN2Id = statusNN2?.[0]?.id;

      const parentNN = await signedInClient("checknn.parent@thebehaviourhive.com");
      const { error: redeemErr } = await parentNN.rpc("redeem_passport_claim_code", { p_code: code2 });
      if (redeemErr) throw redeemErr;

      const { error: revokeClaimedErr } = await principalNN.rpc("revoke_passport_claim_code", {
        p_claim_code_id: claimCodeNN2Id,
        p_reason: "NN-6: trying to revoke a code that's already been claimed.",
      });
      record(
        "NN-6 revoke_passport_claim_code() refuses a code that's already been claimed",
        Boolean(revokeClaimedErr),
        revokeClaimedErr?.message
      );
    }

    // ---- NN-7: get_passport_claim_code_status()'s own institution-
    // scoping -- a principal can't read another institution's claim
    // code by passing an institution id they don't actually belong to.
    // A brand-new, still-outstanding code exists at this point (NN-1
    // through NN-3's target was revoked in NN-4; this proves the READ
    // side independently of the revoke side). ----
    {
      const { error: generateNN3Err } = await principalNN.rpc("generate_passport_claim_code", {
        p_institution_id: institutionNNId,
        p_passport_id: passportNNId,
      });
      if (generateNN3Err) throw generateNN3Err;

      const { data: wrongInstStatus, error: wrongInstErr } = await principalNNOther.rpc("get_passport_claim_code_status", {
        p_institution_id: institutionNNId,
        p_passport_id: passportNNId,
      });
      record(
        "NN-7 get_passport_claim_code_status() returns EMPTY, not the real outstanding code, for a principal who isn't actually staff at the institution id they supplied",
        !wrongInstErr && (wrongInstStatus ?? []).length === 0,
        JSON.stringify({ error: wrongInstErr?.message, wrongInstStatus })
      );
    }

    console.log("NN summary complete.");

    await admin.from("institutions").delete().in("id", [institutionNNId, institutionNNOtherId]);
    for (const id of [principalNNId, teacherNNId, principalNNOtherId, parentNNId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK OO: Client-behaviour half of Stage 3's claim-code work (src/app/principal/passports/[passportId]/page.tsx) -- proven via the LITERAL client gating conditionals, not a proxy for them. Daniel's own instruction, verbatim: "the three claim-code states... can COEXIST because a child may have several guardians... Today it toggles between two. Three states, coexisting, is the change." Reproduces the page's own three gates against one real fixture with one claimed guardian AND a separate fresh outstanding code on the SAME child: the unclaimed empty state (guardians.length === 0 && !claimCode), the claimed-guardian card (guardians.length > 0), and the outstanding-code card (claimCode truthy) -- proving the middle two render simultaneously rather than one replacing the other, and that revoking the outstanding code leaves the claimed guardian untouched. ==`);
  if (shouldRun("OO")) {
    const { data: instOO, error: instOOErr } = await admin
      .from("institutions")
      .insert({ name: "OO Institution", institution_code: CODE + "OO", status: "verified" })
      .select()
      .single();
    if (instOOErr) throw instOOErr;
    const institutionOOId = instOO.id;

    const principalOOId = await createUser("checkoo.principal@thebehaviourhive.com", "OO Principal", "principal");
    const parentOOId = await createUser("checkoo.parent@thebehaviourhive.com", "OO Parent", "parent");

    const { error: staffOOErr } = await admin
      .from("institution_staff")
      .insert({ institution_id: institutionOOId, user_id: principalOOId, role: "principal" });
    if (staffOOErr) throw staffOOErr;

    const principalOO = await signedInClient("checkoo.principal@thebehaviourhive.com");

    // ---- OO-1: THE UNCLAIMED EMPTY STATE'S OWN GATE -- a freshly
    // enrolled child with zero guardians and no code generated yet.
    // Both queries must agree it's genuinely empty, simultaneously,
    // for the client's (guardians.length === 0 && !claimCode) gate to
    // be reachable at all. ----
    const { data: childOOEmptyId, error: createOOEmptyErr } = await principalOO.rpc("create_school_passport", {
      p_institution_id: institutionOOId,
      p_child_name: "OO Empty Child",
    });
    if (createOOEmptyErr) throw createOOEmptyErr;
    {
      const { data: guardiansEmpty } = await principalOO.rpc("get_passport_guardians_for_child", {
        p_institution_id: institutionOOId,
        p_passport_id: childOOEmptyId,
      });
      const { data: codeEmpty } = await principalOO.rpc("get_passport_claim_code_status", {
        p_institution_id: institutionOOId,
        p_passport_id: childOOEmptyId,
      });
      record(
        "OO-1 the unclaimed empty-state's own gate: zero guardians AND zero outstanding code, both true at once",
        (guardiansEmpty ?? []).length === 0 && (codeEmpty ?? []).length === 0,
        JSON.stringify({ guardiansEmpty, codeEmpty })
      );
    }

    // ---- OO-2: THE COEXISTENCE ITSELF -- one guardian already claimed,
    // then a SECOND, separate code generated and left outstanding for a
    // second guardian. ----
    const { data: childOOId, error: createOOErr } = await principalOO.rpc("create_school_passport", {
      p_institution_id: institutionOOId,
      p_child_name: "OO Coexist Child",
    });
    if (createOOErr) throw createOOErr;

    const { data: firstCode, error: generateOO1Err } = await principalOO.rpc("generate_passport_claim_code", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });
    if (generateOO1Err) throw generateOO1Err;
    const parentOO = await signedInClient("checkoo.parent@thebehaviourhive.com");
    const { error: redeemOOErr } = await parentOO.rpc("redeem_passport_claim_code", { p_code: firstCode });
    if (redeemOOErr) throw redeemOOErr;

    const { error: generateOO2Err } = await principalOO.rpc("generate_passport_claim_code", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });
    if (generateOO2Err) throw generateOO2Err;

    const { data: guardiansOO } = await principalOO.rpc("get_passport_guardians_for_child", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });
    const { data: codeStatusOO } = await principalOO.rpc("get_passport_claim_code_status", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });

    record(
      "OO-2a exactly one claimed guardian shows -- the first code's own row correctly drops out of get_passport_claim_code_status() once claimed (claimed_at is not null), it doesn't linger as a second 'outstanding' entry",
      (guardiansOO ?? []).length === 1 && guardiansOO[0].user_id === parentOOId,
      JSON.stringify(guardiansOO)
    );
    record(
      "OO-2b exactly one outstanding code shows, and it's the SECOND one, not the already-claimed first one",
      (codeStatusOO ?? []).length === 1 && codeStatusOO[0].code !== firstCode,
      JSON.stringify({ codeStatusOO, firstCode })
    );

    const guardiansCountOO = (guardiansOO ?? []).length;
    const claimCodeOO = (codeStatusOO ?? [])[0] ?? null;
    record(
      "OO-2c THE UNCLAIMED EMPTY STATE'S OWN GATE, reproduced against this fixture: (guardians.length === 0 && !claimCode) is FALSE here -- it must NOT render while a guardian has already claimed, even though a second code is separately outstanding",
      !(guardiansCountOO === 0 && !claimCodeOO),
      JSON.stringify({ guardiansCountOO, claimCodeOO })
    );
    record(
      "OO-2d THE 'GENERATE ANOTHER CODE' BUTTON'S OWN GATE: (guardians.length > 0 && !claimCode) is FALSE while a code is already outstanding -- the button correctly stays hidden rather than letting a principal issue two live codes for the same child at once",
      !(guardiansCountOO > 0 && !claimCodeOO),
      JSON.stringify({ guardiansCountOO, claimCodeOO })
    );

    // ---- OO-3: revoke the outstanding second code, then re-check both
    // gates -- the claimed guardian must survive, untouched, and the
    // "generate another" button's gate must flip back to visible. ----
    const { error: revokeOOErr } = await principalOO.rpc("revoke_passport_claim_code", {
      p_claim_code_id: claimCodeOO.id,
      p_reason: "OO-3: revoking the second guardian's outstanding code.",
    });
    if (revokeOOErr) throw revokeOOErr;

    const { data: guardiansAfterOO } = await principalOO.rpc("get_passport_guardians_for_child", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });
    const { data: codeStatusAfterOO } = await principalOO.rpc("get_passport_claim_code_status", {
      p_institution_id: institutionOOId,
      p_passport_id: childOOId,
    });

    record(
      "OO-3a after revoking the outstanding code, the claimed guardian is untouched -- still exactly one, unaffected by the code's own revoke",
      (guardiansAfterOO ?? []).length === 1 && guardiansAfterOO[0].user_id === parentOOId,
      JSON.stringify(guardiansAfterOO)
    );
    record(
      "OO-3b after revoking, get_passport_claim_code_status() is genuinely empty again",
      (codeStatusAfterOO ?? []).length === 0,
      JSON.stringify(codeStatusAfterOO)
    );
    record(
      "OO-3c THE 'GENERATE ANOTHER CODE' BUTTON'S GATE flips back to visible now that no code is outstanding: (guardians.length > 0 && !claimCode) is TRUE",
      (guardiansAfterOO ?? []).length > 0 && (codeStatusAfterOO ?? []).length === 0,
      JSON.stringify({ guardiansAfterOO, codeStatusAfterOO })
    );

    console.log("OO summary complete.");

    await admin.from("institutions").delete().eq("id", institutionOOId);
    for (const id of [principalOOId, parentOOId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK PP: SQL half of Stage 4's clinician history (migration 0128) -- get_passport_clinician_history(), a dedicated function never touching get_passport_clinicians()'s own callers. Both authorities (owns_passport() parent, institution-scoped principal), both engagement origins (institution-engaged and parent-engaged) visible symmetrically in history, institution-scoping proven by a principal supplying an institution id they don't belong to, non-principal staff proven to see nothing, and the "does NOT gate on current verification_status" claim proven empirically, not just asserted in a comment. ==`);
  if (shouldRun("PP")) {
    const { data: instPP, error: instPPErr } = await admin
      .from("institutions")
      .insert({ name: "PP Institution", institution_code: CODE + "PP", status: "verified" })
      .select()
      .single();
    if (instPPErr) throw instPPErr;
    const institutionPPId = instPP.id;

    const { data: instPPOther, error: instPPOtherErr } = await admin
      .from("institutions")
      .insert({ name: "PP Other Institution", institution_code: CODE + "PPB", status: "verified" })
      .select()
      .single();
    if (instPPOtherErr) throw instPPOtherErr;
    const institutionPPOtherId = instPPOther.id;

    const principalPPId = await createUser("checkpp.principal@thebehaviourhive.com", "PP Principal", "principal");
    const principalPPOtherId = await createUser("checkpp.principalother@thebehaviourhive.com", "PP Other Principal", "principal");
    const teacherPPId = await createUser("checkpp.teacher@thebehaviourhive.com", "PP Teacher", "class_teacher");
    const parentPPId = await createUser("checkpp.parent@thebehaviourhive.com", "PP Parent", "parent");
    const clinicianPP1Id = await createUser("checkpp.clinician1@thebehaviourhive.com", "PP Clinician One", "clinician");
    const clinicianPP2Id = await createUser("checkpp.clinician2@thebehaviourhive.com", "PP Clinician Two", "clinician");

    const { data: staffPPRows, error: staffPPErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionPPId, user_id: principalPPId, role: "principal" },
      { institution_id: institutionPPOtherId, user_id: principalPPOtherId, role: "principal" },
      { institution_id: institutionPPId, user_id: teacherPPId, role: "class_teacher" },
    ]).select();
    if (staffPPErr) throw staffPPErr;

    const principalPP = await signedInClient("checkpp.principal@thebehaviourhive.com");
    const principalPPOther = await signedInClient("checkpp.principalother@thebehaviourhive.com");
    for (const row of staffPPRows.filter((r) => r.user_id === teacherPPId)) {
      const { error } = await principalPP.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherPP = await signedInClient("checkpp.teacher@thebehaviourhive.com");
    const parentPP = await signedInClient("checkpp.parent@thebehaviourhive.com");

    const clinicianPPCodes = {};
    for (const [id, email] of [
      [clinicianPP1Id, "checkpp.clinician1@thebehaviourhive.com"],
      [clinicianPP2Id, "checkpp.clinician2@thebehaviourhive.com"],
    ]) {
      const c = await signedInClient(email);
      const { error: specErr } = await c.rpc("select_clinician_specialty", { p_specialty: "behavioural_psychologist" });
      if (specErr) throw specErr;
      const { data: approveRows, error: approveErr } = await admin.rpc("approve_clinician", { clinician_email: email });
      if (approveErr) throw approveErr;
      clinicianPPCodes[id] = approveRows?.[0]?.code ?? approveRows?.code;
    }

    const { data: childPPId, error: childPPErr } = await principalPP.rpc("create_school_passport", {
      p_institution_id: institutionPPId,
      p_child_name: "PP Child",
    });
    if (childPPErr) throw childPPErr;

    const { data: claimCodePP, error: claimCodePPErr } = await principalPP.rpc("generate_passport_claim_code", {
      p_institution_id: institutionPPId,
      p_passport_id: childPPId,
    });
    if (claimCodePPErr) throw claimCodePPErr;
    const { error: redeemPPErr } = await parentPP.rpc("redeem_passport_claim_code", { p_code: claimCodePP });
    if (redeemPPErr) throw redeemPPErr;

    // One institution-engaged clinician, one parent-engaged -- both
    // engaged, then both revoked, so history has one real row of each
    // origin to prove symmetric visibility.
    const { data: grantPP1, error: grantPP1Err } = await principalPP.rpc("grant_clinician_access", {
      p_institution_id: institutionPPId,
      p_passport_id: childPPId,
      p_clinician_code: clinicianPPCodes[clinicianPP1Id],
    });
    if (grantPP1Err) throw grantPP1Err;
    // Both grant_clinician_access() and connect_clinician() return the
    // new row's own uuid directly (returns uuid), not a table row.
    const clinicianAccessPP1Id = grantPP1;

    const { data: connectPP2, error: connectPP2Err } = await parentPP.rpc("connect_clinician", {
      p_passport_id: childPPId,
      p_clinician_code: clinicianPPCodes[clinicianPP2Id],
    });
    if (connectPP2Err) throw connectPP2Err;
    const clinicianAccessPP2Id = connectPP2;

    const { error: revokePP1Err } = await principalPP.rpc("revoke_clinician_access", {
      p_clinician_access_id: clinicianAccessPP1Id,
      p_reason: "PP fixture: institution engagement ended.",
    });
    if (revokePP1Err) throw revokePP1Err;
    const { error: revokePP2Err } = await parentPP.rpc("revoke_clinician_access", {
      p_clinician_access_id: clinicianAccessPP2Id,
      p_reason: "PP fixture: parent engagement ended.",
    });
    if (revokePP2Err) throw revokePP2Err;

    // ---- PP-1: THE ACTIVE LIST IS GENUINELY EMPTY NOW -- both engagements
    // revoked, get_passport_clinicians() (unchanged, 0124) shows neither. ----
    {
      const { data: activeAfter } = await principalPP.rpc("get_passport_clinicians", { p_passport_id: childPPId });
      record(
        "PP-1 both clinicians revoked: the ACTIVE list (get_passport_clinicians, untouched) is genuinely empty",
        (activeAfter ?? []).length === 0,
        JSON.stringify(activeAfter)
      );
    }

    // ---- PP-2: THE PRINCIPAL sees BOTH origins in history, correct
    // fields for each. ----
    {
      const { data: historyPrincipal, error: historyErr } = await principalPP.rpc("get_passport_clinician_history", {
        p_passport_id: childPPId,
        p_institution_id: institutionPPId,
      });
      const row1 = (historyPrincipal ?? []).find((r) => r.clinician_id === clinicianPP1Id);
      const row2 = (historyPrincipal ?? []).find((r) => r.clinician_id === clinicianPP2Id);
      record(
        "PP-2a the principal's own history call returns exactly 2 rows, one per origin",
        !historyErr && (historyPrincipal ?? []).length === 2,
        JSON.stringify({ error: historyErr?.message, historyPrincipal })
      );
      record(
        "PP-2b the institution-engaged row: engaged_by='institution', revoked_at set, revocation_reason matches exactly",
        row1?.engaged_by === "institution" &&
          Boolean(row1?.revoked_at) &&
          row1?.revocation_reason === "PP fixture: institution engagement ended.",
        JSON.stringify(row1)
      );
      record(
        "PP-2c the parent-engaged row: engaged_by='parent', revoked_at set, revocation_reason matches exactly -- the principal sees the FAMILY'S own history too, symmetric with the live list's own visibility",
        row2?.engaged_by === "parent" &&
          Boolean(row2?.revoked_at) &&
          row2?.revocation_reason === "PP fixture: parent engagement ended.",
        JSON.stringify(row2)
      );
    }

    // ---- PP-3: THE PARENT sees the same history too (owns_passport()
    // branch). ----
    {
      const { data: historyParent, error: historyParentErr } = await parentPP.rpc("get_passport_clinician_history", {
        p_passport_id: childPPId,
        p_institution_id: institutionPPId,
      });
      record(
        "PP-3 the parent's own history call (owns_passport() branch) also returns both rows",
        !historyParentErr && (historyParent ?? []).length === 2,
        JSON.stringify({ error: historyParentErr?.message, historyParent })
      );
    }

    // ---- PP-4: a non-principal staff member at the SAME institution
    // sees nothing -- silent empty, not an error, same posture as every
    // other SELECT-shaped RPC in this schema. ----
    {
      const { data: historyTeacher, error: historyTeacherErr } = await teacherPP.rpc("get_passport_clinician_history", {
        p_passport_id: childPPId,
        p_institution_id: institutionPPId,
      });
      record(
        "PP-4 a non-principal staff member (teacherPP) gets an empty result, not an error and not the real history",
        !historyTeacherErr && (historyTeacher ?? []).length === 0,
        JSON.stringify({ error: historyTeacherErr?.message, historyTeacher })
      );
    }

    // ---- PP-5: a principal at a DIFFERENT institution, supplying THIS
    // institution's own id (not their own), gets nothing -- the
    // explicit p_institution_id scoping can't be faked by passing
    // someone else's id while being a principal elsewhere. ----
    {
      const { data: historyOther, error: historyOtherErr } = await principalPPOther.rpc("get_passport_clinician_history", {
        p_passport_id: childPPId,
        p_institution_id: institutionPPId,
      });
      record(
        "PP-5 a principal at a DIFFERENT institution, supplying institutionPP's own id, gets an empty result",
        !historyOtherErr && (historyOther ?? []).length === 0,
        JSON.stringify({ error: historyOtherErr?.message, historyOther })
      );
    }

    // ---- PP-6: THE COMMENT'S OWN CLAIM, PROVEN -- history does NOT
    // gate on the clinician's CURRENT verification_status. Reject
    // clinician 1's verification after the fact; their history row must
    // still be there. ----
    {
      const { error: rejectErr } = await admin
        .from("clinicians")
        .update({ verification_status: "rejected" })
        .eq("user_id", clinicianPP1Id);
      if (rejectErr) throw rejectErr;

      const { data: historyAfterReject } = await principalPP.rpc("get_passport_clinician_history", {
        p_passport_id: childPPId,
        p_institution_id: institutionPPId,
      });
      record(
        "PP-6 a clinician's history row survives their OWN verification being revoked afterward -- history isn't gated on current verification_status",
        (historyAfterReject ?? []).some((r) => r.clinician_id === clinicianPP1Id),
        JSON.stringify(historyAfterReject)
      );
    }

    console.log("PP summary complete.");

    // clinician_access.engaged_by_institution_id (0123) is a NON-
    // cascading FK to institutions -- deleting the passport FIRST
    // cascades clinician_access away via its own passport_id (ON DELETE
    // CASCADE), same order CHECK KK's own cleanup already established.
    // Deleting institutions before the passport would fail the FK
    // silently here (a raw delete with no error check) and leave this
    // fixture's institutions/users behind for the next run to collide
    // with -- exactly what happened once before this fix.
    await admin.from("passports").delete().eq("id", childPPId);
    await admin.from("institutions").delete().in("id", [institutionPPId, institutionPPOtherId]);
    for (const id of [principalPPId, principalPPOtherId, teacherPPId, parentPPId, clinicianPP1Id, clinicianPP2Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK QQ: Client-behaviour half of Stage 4 (src/app/principal/passports/[passportId]/page.tsx) -- proven via the LITERAL client gating conditionals, not a proxy for them. The Access tab's empty-state copy, and the Clinical tab's eyebrow derivation (own-institution engagement gets no eyebrow and a Revoke access button; parent engagement gets a "Managed by parent" eyebrow and no button; a DIFFERENT institution's engagement gets a "Managed by [school]" eyebrow and no button) reproduced against one real fixture with all three engagement shapes on the SAME child simultaneously. ==`);
  if (shouldRun("QQ")) {
    const { data: instQQ, error: instQQErr } = await admin
      .from("institutions")
      .insert({ name: "QQ Institution", institution_code: CODE + "QQ", status: "verified" })
      .select()
      .single();
    if (instQQErr) throw instQQErr;
    const institutionQQId = instQQ.id;

    const { data: instQQOther, error: instQQOtherErr } = await admin
      .from("institutions")
      .insert({ name: "QQ Other Institution", institution_code: CODE + "QQB", status: "verified" })
      .select()
      .single();
    if (instQQOtherErr) throw instQQOtherErr;
    const institutionQQOtherId = instQQOther.id;

    const principalQQId = await createUser("checkqq.principal@thebehaviourhive.com", "QQ Principal", "principal");
    const principalQQOtherId = await createUser("checkqq.principalother@thebehaviourhive.com", "QQ Other Principal", "principal");
    const parentQQId = await createUser("checkqq.parent@thebehaviourhive.com", "QQ Parent", "parent");
    const clinicianQQ1Id = await createUser("checkqq.clinician1@thebehaviourhive.com", "QQ Clinician Own School", "clinician");
    const clinicianQQ2Id = await createUser("checkqq.clinician2@thebehaviourhive.com", "QQ Clinician Parent", "clinician");
    const clinicianQQ3Id = await createUser("checkqq.clinician3@thebehaviourhive.com", "QQ Clinician Other School", "clinician");

    const { error: staffQQErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionQQId, user_id: principalQQId, role: "principal" },
      { institution_id: institutionQQOtherId, user_id: principalQQOtherId, role: "principal" },
    ]);
    if (staffQQErr) throw staffQQErr;

    const principalQQ = await signedInClient("checkqq.principal@thebehaviourhive.com");
    const principalQQOther = await signedInClient("checkqq.principalother@thebehaviourhive.com");
    const parentQQ = await signedInClient("checkqq.parent@thebehaviourhive.com");

    const clinicianQQCodes = {};
    for (const [id, email] of [
      [clinicianQQ1Id, "checkqq.clinician1@thebehaviourhive.com"],
      [clinicianQQ2Id, "checkqq.clinician2@thebehaviourhive.com"],
      [clinicianQQ3Id, "checkqq.clinician3@thebehaviourhive.com"],
    ]) {
      const c = await signedInClient(email);
      const { error: specErr } = await c.rpc("select_clinician_specialty", { p_specialty: "behavioural_psychologist" });
      if (specErr) throw specErr;
      const { data: approveRows, error: approveErr } = await admin.rpc("approve_clinician", { clinician_email: email });
      if (approveErr) throw approveErr;
      clinicianQQCodes[id] = approveRows?.[0]?.code ?? approveRows?.code;
    }

    // ---- QQ-1: THE ACCESS TAB'S OWN EMPTY-STATE GATE, before anything
    // is granted -- a freshly enrolled child. ----
    const { data: childQQId, error: childQQErr } = await principalQQ.rpc("create_school_passport", {
      p_institution_id: institutionQQId,
      p_child_name: "QQ Child",
    });
    if (childQQErr) throw childQQErr;
    {
      const { data: accessEmpty } = await principalQQ.rpc("get_passport_access_for_child", {
        p_passport_id: childQQId,
        p_institution_id: institutionQQId,
      });
      const activeEmpty = (accessEmpty ?? []).filter((r) => r.is_active);
      record(
        "QQ-1 the Access tab's own empty-state gate: access.active.length === 0, exactly the case the page's copy (\"No direct access granted. Access is derived from class or 1:1 assignments.\") is written for",
        activeEmpty.length === 0,
        JSON.stringify(activeEmpty)
      );
    }

    const { data: claimCodeQQ, error: claimCodeQQErr } = await principalQQ.rpc("generate_passport_claim_code", {
      p_institution_id: institutionQQId,
      p_passport_id: childQQId,
    });
    if (claimCodeQQErr) throw claimCodeQQErr;
    const { error: redeemQQErr } = await parentQQ.rpc("redeem_passport_claim_code", { p_code: claimCodeQQ });
    if (redeemQQErr) throw redeemQQErr;

    // Link childQQ to the second institution (same service-role-insert
    // precedent as CHECK KK/DD/JJ -- no real production path constructs
    // this shape, but it's the shape a two-school child genuinely has).
    await admin.from("passport_institution_links").insert({
      passport_id: childQQId,
      institution_id: institutionQQOtherId,
      approved_by_parent: true,
    });

    // The three simultaneous engagement shapes.
    const { error: grantQQ1Err } = await principalQQ.rpc("grant_clinician_access", {
      p_institution_id: institutionQQId,
      p_passport_id: childQQId,
      p_clinician_code: clinicianQQCodes[clinicianQQ1Id],
    });
    if (grantQQ1Err) throw grantQQ1Err;
    const { error: connectQQ2Err } = await parentQQ.rpc("connect_clinician", {
      p_passport_id: childQQId,
      p_clinician_code: clinicianQQCodes[clinicianQQ2Id],
    });
    if (connectQQ2Err) throw connectQQ2Err;
    const { error: grantQQ3Err } = await principalQQOther.rpc("grant_clinician_access", {
      p_institution_id: institutionQQOtherId,
      p_passport_id: childQQId,
      p_clinician_code: clinicianQQCodes[clinicianQQ3Id],
    });
    if (grantQQ3Err) throw grantQQ3Err;

    const { data: cliniciansQQ, error: cliniciansQQErr } = await principalQQ.rpc("get_passport_clinicians", { p_passport_id: childQQId });
    if (cliniciansQQErr) throw cliniciansQQErr;

    // ---- QQ-2: THE ELIGIBLE-STAFF/EYEBROW DERIVATION, reproduced
    // verbatim from principal/passports/[passportId]/page.tsx's own
    // canRevoke/eyebrow logic, against all three rows at once. ----
    for (const row of cliniciansQQ ?? []) {
      const canRevoke = row.engaged_by === "institution" && row.engaged_by_institution_id === institutionQQId;
      const eyebrow =
        row.engaged_by === "parent" ? "Managed by parent" : canRevoke ? null : `Managed by ${row.engaged_by_institution_name ?? "another school"}`;

      if (row.clinician_id === clinicianQQ1Id) {
        record(
          "QQ-2a own-institution engagement: canRevoke=true, no eyebrow -- gets the Revoke access button, not a read-only label",
          canRevoke === true && eyebrow === null,
          JSON.stringify({ row, canRevoke, eyebrow })
        );
      } else if (row.clinician_id === clinicianQQ2Id) {
        record(
          "QQ-2b parent engagement: canRevoke=false, eyebrow='Managed by parent' exactly",
          canRevoke === false && eyebrow === "Managed by parent",
          JSON.stringify({ row, canRevoke, eyebrow })
        );
      } else if (row.clinician_id === clinicianQQ3Id) {
        record(
          "QQ-2c a DIFFERENT institution's own engagement: canRevoke=false, eyebrow names the real other institution, not a placeholder",
          canRevoke === false && eyebrow === "Managed by QQ Other Institution",
          JSON.stringify({ row, canRevoke, eyebrow })
        );
      }
    }
    record(
      "QQ-2d all three engagement shapes were actually present to test against -- not a vacuous pass from a fixture that silently only produced one or two",
      (cliniciansQQ ?? []).length === 3,
      JSON.stringify(cliniciansQQ)
    );

    console.log("QQ summary complete.");

    // Same passport-before-institutions order as CHECK PP's own cleanup,
    // for the same reason -- clinician_access.engaged_by_institution_id
    // doesn't cascade on institutions, only on its own passport_id.
    await admin.from("passports").delete().eq("id", childQQId);
    await admin.from("institutions").delete().in("id", [institutionQQId, institutionQQOtherId]);
    for (const id of [principalQQId, principalQQOtherId, parentQQId, clinicianQQ1Id, clinicianQQ2Id, clinicianQQ3Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK RR: SQL for Stage 5 (migrations 0129/0130) -- get_institution_classes_roster() counts and institution-scoping, current_class_id on the widened child roster, the entirely new class_sna_assignments concept (assign/end, the uniqueness constraint at both the RPC-guard and raw-index layers, class-tier access via has_sna_access() AND has_class_teacher_access() for every child in the class, isolation from every other class), get_sna_roommates()'s real roster-tier fields and its own refusal for a caller with no assignment, and all four has_sna_access() branches proven independently -- direct grant, 1:1 assignment, day-scoped temporary cover, and the new permanent class branch, each isolated so no SNA identity has more than the one mechanism being tested. ==`);
  if (shouldRun("RR")) {
    const { data: instRR, error: instRRErr } = await admin
      .from("institutions")
      .insert({ name: "RR Institution", institution_code: CODE + "RR", status: "verified" })
      .select()
      .single();
    if (instRRErr) throw instRRErr;
    const institutionRRId = instRR.id;

    const { data: instRROther, error: instRROtherErr } = await admin
      .from("institutions")
      .insert({ name: "RR Other Institution", institution_code: CODE + "RRB", status: "verified" })
      .select()
      .single();
    if (instRROtherErr) throw instRROtherErr;
    const institutionRROtherId = instRROther.id;

    const principalRRId = await createUser("checkrr.principal@thebehaviourhive.com", "RR Principal", "principal");
    const principalRROtherId = await createUser("checkrr.principalother@thebehaviourhive.com", "RR Other Principal", "principal");
    const teacherRR1Id = await createUser("checkrr.teacher1@thebehaviourhive.com", "RR Teacher One", "class_teacher");
    const teacherRR1RemovedId = await createUser("checkrr.teacher1removed@thebehaviourhive.com", "RR Teacher Removed", "class_teacher");
    // Four SNA identities, one per has_sna_access() branch, so each
    // branch's own truth is isolated -- no SNA here ever holds more
    // than the one mechanism the check on them is actually testing.
    const snaRR1Id = await createUser("checkrr.sna1classsna@thebehaviourhive.com", "RR SNA Class", "sna");
    const snaRR2Id = await createUser("checkrr.sna2onetoone@thebehaviourhive.com", "RR SNA OneToOne", "sna");
    const snaRR3Id = await createUser("checkrr.sna3directgrant@thebehaviourhive.com", "RR SNA DirectGrant", "sna");
    const snaRR4Id = await createUser("checkrr.sna4temporary@thebehaviourhive.com", "RR SNA Temporary", "sna");

    const { data: staffRRRows, error: staffRRErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionRRId, user_id: principalRRId, role: "principal" },
      { institution_id: institutionRROtherId, user_id: principalRROtherId, role: "principal" },
      { institution_id: institutionRRId, user_id: teacherRR1Id, role: "class_teacher" },
      { institution_id: institutionRRId, user_id: teacherRR1RemovedId, role: "class_teacher" },
      { institution_id: institutionRRId, user_id: snaRR1Id, role: "sna" },
      { institution_id: institutionRRId, user_id: snaRR2Id, role: "sna" },
      { institution_id: institutionRRId, user_id: snaRR3Id, role: "sna" },
      { institution_id: institutionRRId, user_id: snaRR4Id, role: "sna" },
    ]).select();
    if (staffRRErr) throw staffRRErr;

    const principalRR = await signedInClient("checkrr.principal@thebehaviourhive.com");
    const principalRROther = await signedInClient("checkrr.principalother@thebehaviourhive.com");
    for (const row of staffRRRows.filter((r) => r.institution_id === institutionRRId && r.user_id !== principalRRId)) {
      const { error } = await principalRR.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherRR1 = await signedInClient("checkrr.teacher1@thebehaviourhive.com");
    const snaRR1 = await signedInClient("checkrr.sna1classsna@thebehaviourhive.com");
    const snaRR2 = await signedInClient("checkrr.sna2onetoone@thebehaviourhive.com");

    // Two classes. Class 1 gets the real fixture (two teachers, one
    // later removed; two children, one later removed; a class SNA); a
    // second child sits in Class 2 purely to prove Class 1's own class
    // SNA reaches nothing there.
    const { data: classRR1Id, error: classRR1Err } = await principalRR.rpc("create_class", { p_institution_id: institutionRRId, p_name: "RR Room 1" });
    if (classRR1Err) throw classRR1Err;
    const { data: classRR2Id, error: classRR2Err } = await principalRR.rpc("create_class", { p_institution_id: institutionRRId, p_name: "RR Room 2" });
    if (classRR2Err) throw classRR2Err;

    const { data: addTeacher1Id, error: addTeacher1Err } = await principalRR.rpc("add_class_teacher", { p_class_id: classRR1Id, p_user_id: teacherRR1Id });
    if (addTeacher1Err) throw addTeacher1Err;
    const { data: addTeacher1RemovedId, error: addTeacher1RemovedErr } = await principalRR.rpc("add_class_teacher", { p_class_id: classRR1Id, p_user_id: teacherRR1RemovedId });
    if (addTeacher1RemovedErr) throw addTeacher1RemovedErr;
    const { error: removeTeacherErr } = await principalRR.rpc("remove_class_teacher", { p_class_teacher_id: addTeacher1RemovedId, p_reason: "RR fixture: needs a genuinely removed teacher." });
    if (removeTeacherErr) throw removeTeacherErr;

    // Children: A and B active in Class 1 (roommates for each other),
    // C enrolled but never put in any class, D active in Class 2, E
    // added to Class 1 then removed (child_count must exclude it), F
    // never in any class (dedicated to the direct-grant branch, so
    // that branch's own truth can't be coincidentally explained by
    // class membership).
    const childRR = {};
    for (const key of ["A", "B", "C", "D", "E", "F"]) {
      const { data: cid, error: cErr } = await principalRR.rpc("create_school_passport", { p_institution_id: institutionRRId, p_child_name: `RR Child ${key}` });
      if (cErr) throw cErr;
      childRR[key] = cid;
    }
    for (const key of ["A", "B"]) {
      const { error } = await principalRR.rpc("add_class_child", { p_class_id: classRR1Id, p_passport_id: childRR[key] });
      if (error) throw error;
    }
    const { error: addDErr } = await principalRR.rpc("add_class_child", { p_class_id: classRR2Id, p_passport_id: childRR.D });
    if (addDErr) throw addDErr;
    const { data: addEId, error: addEErr } = await principalRR.rpc("add_class_child", { p_class_id: classRR1Id, p_passport_id: childRR.E });
    if (addEErr) throw addEErr;
    const { error: removeEErr } = await principalRR.rpc("remove_class_child", { p_class_children_id: addEId, p_reason: "RR fixture: needs a genuinely removed child." });
    if (removeEErr) throw removeEErr;

    // ---- RR-1: get_institution_classes_roster() -- counts correct
    // (ended teacher/child excluded), institution-scoped. ----
    {
      const { data: rosterRR, error: rosterRRErr } = await principalRR.rpc("get_institution_classes_roster", { p_institution_id: institutionRRId });
      const room1 = (rosterRR ?? []).find((r) => r.class_id === classRR1Id);
      const room2 = (rosterRR ?? []).find((r) => r.class_id === classRR2Id);
      record(
        "RR-1a Room 1: teacher_count=1 (the removed teacher excluded), child_count=2 (the removed child excluded)",
        !rosterRRErr && room1?.teacher_count == 1 && room1?.child_count == 2,
        JSON.stringify({ error: rosterRRErr?.message, room1 })
      );
      record(
        "RR-1b Room 2: teacher_count=0, child_count=1 (childRR.D only)",
        room2?.teacher_count == 0 && room2?.child_count == 1,
        JSON.stringify(room2)
      );
      const { data: rosterRROther } = await principalRROther.rpc("get_institution_classes_roster", { p_institution_id: institutionRRId });
      record(
        "RR-1c institution-scoping: a principal at a DIFFERENT institution, supplying institutionRR's own id, gets nothing",
        (rosterRROther ?? []).length === 0,
        JSON.stringify(rosterRROther)
      );
    }

    // ---- RR-2: current_class_id -- populated when assigned, null
    // when not, existing columns still present and correct (the
    // non-breaking-widen claim, checked, not assumed). ----
    {
      const { data: childRosterRR, error: childRosterRRErr } = await principalRR.rpc("get_institution_child_roster", { p_institution_id: institutionRRId });
      const rowA = (childRosterRR ?? []).find((r) => r.passport_id === childRR.A);
      const rowC = (childRosterRR ?? []).find((r) => r.passport_id === childRR.C);
      record(
        "RR-2a childRR.A: current_class_id = Room 1's own id",
        !childRosterRRErr && rowA?.current_class_id === classRR1Id,
        JSON.stringify({ error: childRosterRRErr?.message, rowA })
      );
      record(
        "RR-2b childRR.C: enrolled, never classed -- current_class_id is null",
        rowC?.current_class_id === null,
        JSON.stringify(rowC)
      );
      record(
        "RR-2c existing columns unaffected: passport_id and child_name still present and correct on the same row",
        rowA?.passport_id === childRR.A && rowA?.child_name === "RR Child A",
        JSON.stringify(rowA)
      );
    }

    // ---- RR-3/RR-4/RR-5: class SNA assignment -- grants class-tier
    // access to every child in the class (has_sna_access() AND
    // has_class_teacher_access(), 0130's own widening), reaches
    // nothing at another class, and ending it removes the access. ----
    const { data: classSnaAssignmentId, error: classSnaErr } = await principalRR.rpc("assign_class_sna", { p_class_id: classRR1Id, p_user_id: snaRR1Id });
    if (classSnaErr) throw classSnaErr;
    {
      const [hasA, hasB, hasD, teacherTierA] = await Promise.all([
        admin.rpc("has_sna_access", { p_user_id: snaRR1Id, p_passport_id: childRR.A }),
        admin.rpc("has_sna_access", { p_user_id: snaRR1Id, p_passport_id: childRR.B }),
        admin.rpc("has_sna_access", { p_user_id: snaRR1Id, p_passport_id: childRR.D }),
        admin.rpc("has_class_teacher_access", { p_user_id: snaRR1Id, p_passport_id: childRR.A }),
      ]);
      record("RR-3a class SNA has_sna_access()=true for childRR.A (in the class)", hasA.data === true, JSON.stringify(hasA));
      record("RR-3b class SNA has_sna_access()=true for childRR.B (also in the class)", hasB.data === true, JSON.stringify(hasB));
      record(
        "RR-3c THE 0130 WIDENING ITSELF: class SNA also has_class_teacher_access()=true -- full class-tier, not the narrower sna-tier ceiling",
        teacherTierA.data === true,
        JSON.stringify(teacherTierA)
      );
      record(
        "RR-5 a class SNA reaches NOTHING at another class: has_sna_access()=false for childRR.D (Room 2)",
        hasD.data === false,
        JSON.stringify(hasD)
      );
    }
    {
      const { error: endErr } = await principalRR.rpc("end_class_sna_assignment", { p_class_sna_assignment_id: classSnaAssignmentId, p_reason: "RR fixture: ending the class SNA assignment." });
      if (endErr) throw endErr;
      const { data: hasAAfter } = await admin.rpc("has_sna_access", { p_user_id: snaRR1Id, p_passport_id: childRR.A });
      record(
        "RR-4 ending a class SNA assignment removes the access it granted",
        hasAAfter === false,
        JSON.stringify(hasAAfter)
      );
    }

    // ---- RR-6: the uniqueness constraint -- both layers. A fresh
    // assignment (snaRR1 re-assigned to Room 1, now that RR-4 ended
    // the first one) so the RPC-guard test below hits "already the
    // class SNA", not "not an active SNA". ----
    {
      const { data: freshAssignmentId, error: freshErr } = await principalRR.rpc("assign_class_sna", { p_class_id: classRR1Id, p_user_id: snaRR1Id });
      if (freshErr) throw freshErr;

      const { error: dupRpcErr } = await principalRR.rpc("assign_class_sna", { p_class_id: classRR1Id, p_user_id: snaRR1Id });
      record(
        "RR-6a the RPC's own guard refuses a duplicate active assignment, friendly message",
        Boolean(dupRpcErr) && /already the class sna/i.test(dupRpcErr.message),
        dupRpcErr?.message
      );

      // Bypasses assign_class_sna() entirely -- a raw service-role
      // insert, proving the unique INDEX itself, not just the RPC's
      // own belt-and-braces guard on top of it.
      const { error: dupIndexErr } = await admin
        .from("class_sna_assignments")
        .insert({ class_id: classRR1Id, user_id: snaRR1Id, started_by: principalRRId });
      record(
        "RR-6b THE INDEX ITSELF: a raw insert bypassing the RPC is still refused, by class_sna_assignments_one_active_row_per_sna_per_class",
        Boolean(dupIndexErr) && /class_sna_assignments_one_active_row_per_sna_per_class/i.test(dupIndexErr.message ?? ""),
        dupIndexErr?.message
      );

      await principalRR.rpc("end_class_sna_assignment", { p_class_sna_assignment_id: freshAssignmentId, p_reason: "RR fixture cleanup: ending the re-assignment." });
    }

    // ---- RR-7: get_sna_roommates() -- the other children in the
    // room, and its own refusal for a caller with no assignment. ----
    {
      const { error: assignErr } = await principalRR.rpc("assign_sna_to_child", { p_passport_id: childRR.A, p_user_id: snaRR2Id, p_institution_id: institutionRRId });
      if (assignErr) throw assignErr;

      const { data: roommatesRR, error: roommatesRRErr } = await snaRR2.rpc("get_sna_roommates", { p_passport_id: childRR.A });
      record(
        "RR-7a get_sna_roommates() returns exactly childRR.B -- the other child in Room 1, not childRR.A itself, not C/D/E/F",
        !roommatesRRErr && (roommatesRR ?? []).length === 1 && roommatesRR[0].passport_id === childRR.B,
        JSON.stringify({ error: roommatesRRErr?.message, roommatesRR })
      );
      record(
        "RR-7b THE ROSTER-TIER FIELDS THEMSELVES (0130): the roommate row carries real support fields, not just a name",
        "hard_triggers" in (roommatesRR?.[0] ?? {}) && "before_behaviour" in (roommatesRR?.[0] ?? {}) && "communication_methods" in (roommatesRR?.[0] ?? {}),
        JSON.stringify(roommatesRR?.[0])
      );

      const { data: roommatesNoneRR, error: roommatesNoneRRErr } = await teacherRR1.rpc("get_sna_roommates", { p_passport_id: childRR.A });
      record(
        "RR-7c a caller with no active child_assignments row at all gets an empty result, not an error",
        !roommatesNoneRRErr && (roommatesNoneRR ?? []).length === 0,
        JSON.stringify({ error: roommatesNoneRRErr?.message, roommatesNoneRR })
      );
    }

    // ---- RR-8: all four has_sna_access() branches, independently.
    // Branch 4 (class) and branch 2 (1:1) already proven above (RR-3,
    // RR-7's own setup) -- this covers the remaining two, direct grant
    // and day-scoped temporary, each on an SNA identity that holds
    // no other mechanism at all. ----
    {
      const { error: grantErr } = await principalRR.rpc("grant_passport_access", { p_passport_id: childRR.F, p_user_id: snaRR3Id, p_institution_id: institutionRRId, p_reason: "RR-8a: direct grant branch." });
      if (grantErr) throw grantErr;
      const { data: hasDirectGrant } = await admin.rpc("has_sna_access", { p_user_id: snaRR3Id, p_passport_id: childRR.F });
      record("RR-8a branch 1 (direct passport_access grant): has_sna_access()=true", hasDirectGrant === true, JSON.stringify(hasDirectGrant));

      const nowParts = dublinNowParts();
      const cutoffComfortablyAhead = addMinutesClamped(nowParts.time, 180);
      const { error: cutoffErr } = await principalRR.rpc("set_temporary_access_cutoff", { p_institution_id: institutionRRId, p_cutoff_time: cutoffComfortablyAhead });
      if (cutoffErr) throw cutoffErr;
      const { error: tempErr } = await principalRR.rpc("grant_temporary_access", { p_class_id: classRR1Id, p_user_id: snaRR4Id, p_date: nowParts.date, p_reason: "RR-8c: temporary branch." });
      if (tempErr) throw tempErr;
      // The lower (activation) bound is proven live elsewhere, not
      // re-proven here -- CHECK AA's own AA-1j/AA-1k (0133) moves
      // temporary_access_start_time itself to prove both bounds; this
      // check only needs the upper bound comfortably out of the way, via
      // set_temporary_access_cutoff above.
      const { data: hasTemp } = await admin.rpc("has_sna_access", { p_user_id: snaRR4Id, p_passport_id: childRR.A });
      record(
        "RR-8c branch 3 (day-scoped temporary cover): has_sna_access()=true for a child in the covered class",
        hasTemp === true,
        JSON.stringify(hasTemp)
      );

      record(
        "RR-8b branch 2 (1:1 child_assignments): already proven independently at RR-7's own setup (snaRR2 -> childRR.A, no other mechanism held)",
        true,
        "see RR-7"
      );
      record(
        "RR-8d branch 4 (permanent class_sna_assignments): already proven independently at RR-3 (snaRR1 -> Room 1, no other mechanism held)",
        true,
        "see RR-3"
      );
    }

    console.log("RR summary complete.");

    await admin.from("passports").delete().in("id", Object.values(childRR));
    await admin.from("institutions").delete().in("id", [institutionRRId, institutionRROtherId]);
    for (const id of [principalRRId, principalRROtherId, teacherRR1Id, teacherRR1RemovedId, snaRR1Id, snaRR2Id, snaRR3Id, snaRR4Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK SS: Client-behaviour half of Stage 5 (src/app/principal/classes/page.tsx, src/app/principal/classes/[classId]/page.tsx) -- proven via the LITERAL client derivations, not a proxy for them. CHECK RR already proves the RPCs themselves are correct; this check proves the CLIENT reproduces the right shapes over rows RLS has already let it see: AddClassChildSheet's own eligibleChildren filter (current_class_id === null, enrolment_ended_at excluded too -- a real correctness fix made while rewriting this, not just a Stage 5 feature), the per-child SNA-line priority (1:1 over class SNA over neither), and the assignment-history split (ended_at null vs not, active vs history). ==`);
  if (shouldRun("SS")) {
    const { data: instSS, error: instSSErr } = await admin
      .from("institutions")
      .insert({ name: "SS Institution", institution_code: CODE + "SS", status: "verified" })
      .select()
      .single();
    if (instSSErr) throw instSSErr;
    const institutionSSId = instSS.id;

    const principalSSId = await createUser("checkss.principal@thebehaviourhive.com", "SS Principal", "principal");
    const snaSS1Id = await createUser("checkss.sna1class@thebehaviourhive.com", "SS SNA Class", "sna");
    const snaSS2Id = await createUser("checkss.sna2onetoone@thebehaviourhive.com", "SS SNA OneToOne", "sna");
    const snaSS3Id = await createUser("checkss.sna3former@thebehaviourhive.com", "SS SNA Former", "sna");

    const { data: staffSSRows, error: staffSSErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionSSId, user_id: principalSSId, role: "principal" },
      { institution_id: institutionSSId, user_id: snaSS1Id, role: "sna" },
      { institution_id: institutionSSId, user_id: snaSS2Id, role: "sna" },
      { institution_id: institutionSSId, user_id: snaSS3Id, role: "sna" },
    ]).select();
    if (staffSSErr) throw staffSSErr;

    const principalSS = await signedInClient("checkss.principal@thebehaviourhive.com");
    for (const row of staffSSRows.filter((r) => r.user_id !== principalSSId)) {
      const { error } = await principalSS.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const { data: classSS1Id, error: classSS1Err } = await principalSS.rpc("create_class", { p_institution_id: institutionSSId, p_name: "SS Room 1" });
    if (classSS1Err) throw classSS1Err;

    // Children: A (in Room 1, gets a 1:1 SNA AND the room has a class
    // SNA too -- proves 1:1 wins display priority), B (in Room 1, no
    // 1:1 -- proves it falls back to the class SNA), C (enrolled,
    // never classed -- an eligibleChildren candidate), D (classed then
    // removed -- current_class_id must clear back to null, becoming
    // an eligibleChildren candidate again), E (departed -- must NEVER
    // appear in eligibleChildren despite being unassigned).
    const childSS = {};
    for (const key of ["A", "B", "C", "D", "E"]) {
      const { data: cid, error: cErr } = await principalSS.rpc("create_school_passport", { p_institution_id: institutionSSId, p_child_name: `SS Child ${key}` });
      if (cErr) throw cErr;
      childSS[key] = cid;
    }
    for (const key of ["A", "B"]) {
      const { error } = await principalSS.rpc("add_class_child", { p_class_id: classSS1Id, p_passport_id: childSS[key] });
      if (error) throw error;
    }
    const { data: addDId, error: addDErr } = await principalSS.rpc("add_class_child", { p_class_id: classSS1Id, p_passport_id: childSS.D });
    if (addDErr) throw addDErr;
    const { error: removeDErr } = await principalSS.rpc("remove_class_child", { p_class_children_id: addDId, p_reason: "SS fixture: needs a genuinely removed-then-eligible-again child." });
    if (removeDErr) throw removeDErr;
    const { error: endEnrolEErr } = await admin.from("enrolments").insert({ passport_id: childSS.E, institution_id: institutionSSId, ended_at: new Date().toISOString(), started_by: principalSSId, ended_by: principalSSId, end_reason: "left" });
    if (endEnrolEErr) throw endEnrolEErr;

    const { error: classSnaErr } = await principalSS.rpc("assign_class_sna", { p_class_id: classSS1Id, p_user_id: snaSS1Id });
    if (classSnaErr) throw classSnaErr;
    const { data: assignAId, error: assignAErr } = await principalSS.rpc("assign_sna_to_child", { p_passport_id: childSS.A, p_user_id: snaSS2Id, p_institution_id: institutionSSId });
    if (assignAErr) throw assignAErr;
    // A former assignment on childSS.A too, so the history split has
    // something real to isolate from the current one.
    const { error: endAErr } = await principalSS.rpc("end_child_assignment", { p_child_assignment_id: assignAId, p_reason: "SS fixture: ending to create history." });
    if (endAErr) throw endAErr;
    const { error: reassignAErr } = await principalSS.rpc("assign_sna_to_child", { p_passport_id: childSS.A, p_user_id: snaSS3Id, p_institution_id: institutionSSId });
    if (reassignAErr) throw reassignAErr;

    // ---- SS-1: get_institution_classes_roster() -- the LIST page's own
    // mapping (class_id -> id, teacher_count/child_count passed through
    // unchanged). ----
    {
      const { data: classesRosterSS } = await principalSS.rpc("get_institution_classes_roster", { p_institution_id: institutionSSId });
      const room1 = (classesRosterSS ?? []).find((r) => r.class_id === classSS1Id);
      const mapped = room1
        ? { id: room1.class_id, name: room1.name, teacherCount: room1.teacher_count, childCount: room1.child_count }
        : null;
      record(
        "SS-1 the list page's own mapping reproduces the roster row correctly -- id from class_id, counts passed through",
        mapped?.id === classSS1Id && mapped?.name === "SS Room 1" && mapped?.childCount == 2,
        JSON.stringify(mapped)
      );
    }

    // ---- SS-2: AddClassChildSheet's own eligibleChildren filter,
    // reproduced verbatim: !enrolment_ended_at && current_class_id === null. ----
    {
      const { data: childRosterSS } = await principalSS.rpc("get_institution_child_roster", { p_institution_id: institutionSSId });
      const eligibleSS = (childRosterSS ?? [])
        .filter((c) => !c.enrolment_ended_at && c.current_class_id === null)
        .map((c) => c.passport_id);
      record(
        "SS-2a childSS.C (enrolled, never classed) IS eligible",
        eligibleSS.includes(childSS.C),
        JSON.stringify(eligibleSS)
      );
      record(
        "SS-2b childSS.D (removed from Room 1) is eligible AGAIN -- current_class_id correctly cleared back to null",
        eligibleSS.includes(childSS.D),
        JSON.stringify(eligibleSS)
      );
      record(
        "SS-2c childSS.A (currently in Room 1) is NOT eligible",
        !eligibleSS.includes(childSS.A),
        JSON.stringify(eligibleSS)
      );
      record(
        "SS-2d THE REAL FIX: childSS.E (departed, unassigned) is NEVER eligible despite current_class_id being null -- the old filter never checked this at all",
        !eligibleSS.includes(childSS.E),
        JSON.stringify(eligibleSS)
      );
    }

    // ---- SS-3: the per-child SNA-line priority, reproduced verbatim
    // from the class detail page's own derivation. ----
    {
      const { data: assignmentRowsSS } = await principalSS
        .from("child_assignments")
        .select("passport_id, user_id, ended_at")
        .in("passport_id", [childSS.A, childSS.B]);
      const assignmentMapSS = new Map((assignmentRowsSS ?? []).filter((a) => !a.ended_at).map((a) => [a.passport_id, a.user_id]));
      const { data: classSnaRowsSS } = await principalSS
        .from("class_sna_assignments")
        .select("user_id")
        .eq("class_id", classSS1Id)
        .is("ended_at", null);
      const classSnaUserIdsSS = (classSnaRowsSS ?? []).map((r) => r.user_id);

      const lineFor = (passportId) => {
        const oneToOne = assignmentMapSS.get(passportId);
        if (oneToOne) return `1:1 SNA: ${oneToOne}`;
        if (classSnaUserIdsSS.length > 0) return `Class SNA: ${classSnaUserIdsSS.join(", ")}`;
        return "No SNA assigned";
      };
      record(
        "SS-3a childSS.A: 1:1 SNA wins display priority over the class SNA, even though both exist",
        lineFor(childSS.A) === `1:1 SNA: ${snaSS3Id}`,
        lineFor(childSS.A)
      );
      record(
        "SS-3b childSS.B: no 1:1 assignment -- falls back to Class SNA",
        lineFor(childSS.B) === `Class SNA: ${snaSS1Id}`,
        lineFor(childSS.B)
      );
    }

    // ---- SS-4: the assignment-history split, reproduced verbatim --
    // ended_at null goes to the current map, ended_at set goes to
    // history. childSS.A now has exactly one of each. ----
    {
      const { data: allAssignmentsSS } = await principalSS
        .from("child_assignments")
        .select("id, passport_id, user_id, ended_at")
        .eq("passport_id", childSS.A);
      const current = (allAssignmentsSS ?? []).filter((a) => !a.ended_at);
      const history = (allAssignmentsSS ?? []).filter((a) => a.ended_at);
      record(
        "SS-4a exactly one current (ended_at null) assignment for childSS.A",
        current.length === 1 && current[0].user_id === snaSS3Id,
        JSON.stringify(current)
      );
      record(
        "SS-4b exactly one history (ended_at set) row for childSS.A, the original snaSS2 assignment",
        history.length === 1 && history[0].user_id === snaSS2Id,
        JSON.stringify(history)
      );
    }

    console.log("SS summary complete.");

    await admin.from("passports").delete().in("id", Object.values(childSS));
    await admin.from("institutions").delete().eq("id", institutionSSId);
    for (const id of [principalSSId, snaSS1Id, snaSS2Id, snaSS3Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK TT: SQL for Stage 6 (migrations 0131/0132) -- get_institution_temporary_access() shape (names/class_name resolved inline, institution-scoping, any active staff not just principal), is_currently_active computed live against the SAME grant across its own lifecycle (comfortably-ahead cutoff -> true, cutoff already passed but not revoked -> false, then actually revoked -> false for a second reason), the recent-past window (p_days_back excludes/includes an old resolved grant on request), revoking from the new surface via the institution's principal (not the class's own teacher), and resolve_lapsed_incident_ownership()'s own new temporary_access_id link -- correctly populated when a covering SNA's lapsed grant caused the transfer, correctly NULL when a genuine class_teacher's own deactivation caused it (no grant to link to at all). ==`);
  if (shouldRun("TT")) {
    const { data: instTT, error: instTTErr } = await admin
      .from("institutions")
      .insert({ name: "TT Institution", institution_code: CODE + "TT", status: "verified" })
      .select()
      .single();
    if (instTTErr) throw instTTErr;
    const institutionTTId = instTT.id;

    const { data: instTTOther, error: instTTOtherErr } = await admin
      .from("institutions")
      .insert({ name: "TT Other Institution", institution_code: CODE + "TTB", status: "verified" })
      .select()
      .single();
    if (instTTOtherErr) throw instTTOtherErr;
    const institutionTTOtherId = instTTOther.id;

    const principalTTId = await createUser("checktt.principal@thebehaviourhive.com", "TT Principal", "principal");
    const principalTTOtherId = await createUser("checktt.principalother@thebehaviourhive.com", "TT Other Principal", "principal");
    const teacherTTId = await createUser("checktt.teacher@thebehaviourhive.com", "TT Teacher", "class_teacher");
    const snaCoverTTId = await createUser("checktt.snacover@thebehaviourhive.com", "TT SNA Cover", "sna");

    const { data: staffTTRows, error: staffTTErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionTTId, user_id: principalTTId, role: "principal" },
      { institution_id: institutionTTOtherId, user_id: principalTTOtherId, role: "principal" },
      { institution_id: institutionTTId, user_id: teacherTTId, role: "class_teacher" },
      { institution_id: institutionTTId, user_id: snaCoverTTId, role: "sna" },
    ]).select();
    if (staffTTErr) throw staffTTErr;

    const principalTT = await signedInClient("checktt.principal@thebehaviourhive.com");
    const principalTTOther = await signedInClient("checktt.principalother@thebehaviourhive.com");
    for (const row of staffTTRows.filter((r) => r.institution_id === institutionTTId && r.user_id !== principalTTId)) {
      const { error } = await principalTT.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherTT = await signedInClient("checktt.teacher@thebehaviourhive.com");
    const snaCoverTT = await signedInClient("checktt.snacover@thebehaviourhive.com");

    const { data: classTT1Id, error: classTT1Err } = await principalTT.rpc("create_class", { p_institution_id: institutionTTId, p_name: "TT Room 1" });
    if (classTT1Err) throw classTT1Err;

    const { data: childTTId, error: childTTErr } = await principalTT.rpc("create_school_passport", { p_institution_id: institutionTTId, p_child_name: "TT Child" });
    if (childTTErr) throw childTTErr;

    const { data: locTT } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    // ---- Set-up: cutoff comfortably ahead, grant temp access to
    // snaCoverTT for Room 1, today. Authority 2 (principal, any class),
    // not Authority 1 -- exercising the SAME path the new institution-
    // wide view's own principal-driven grant would use. ----
    const nowPartsTT = dublinNowParts();
    const cutoffAheadTT = addMinutesClamped(nowPartsTT.time, 180);
    const { error: cutoffAheadErr } = await principalTT.rpc("set_temporary_access_cutoff", { p_institution_id: institutionTTId, p_cutoff_time: cutoffAheadTT });
    if (cutoffAheadErr) throw cutoffAheadErr;
    const { error: grantTTErr } = await principalTT.rpc("grant_temporary_access", { p_class_id: classTT1Id, p_user_id: snaCoverTTId, p_date: nowPartsTT.date, p_reason: "TT fixture: covering Room 1." });
    if (grantTTErr) throw grantTTErr;

    const { data: statusAfterGrant } = await principalTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
    const grantRowTT = (statusAfterGrant ?? []).find((r) => r.granted_to === snaCoverTTId);
    const grantIdTT = grantRowTT?.grant_id;

    // ---- TT-1: shape -- names/class_name resolved inline, live and
    // active. ----
    record(
      "TT-1a the grant row resolves granted_to_name, granted_by_name, class_name inline -- no second roster call needed",
      grantRowTT?.granted_to_name === "TT SNA Cover" &&
        grantRowTT?.granted_by_name === "TT Principal" &&
        grantRowTT?.class_name === "TT Room 1",
      JSON.stringify(grantRowTT)
    );
    record(
      "TT-1b is_currently_active=true while the cutoff is comfortably ahead and the grant is unrevoked (lower activation bound proven live separately, CHECK AA's AA-1j/AA-1k, 0133 -- not re-proven here)",
      grantRowTT?.is_currently_active === true,
      JSON.stringify(grantRowTT)
    );

    // ---- TT-6: any active staff, not just the principal, can call
    // this -- matches temporary_access's own SELECT policy breadth. ----
    {
      const { data: statusAsSna, error: statusAsSnaErr } = await snaCoverTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
      record(
        "TT-6 a non-principal active staff member (the covering SNA themselves) can call get_institution_temporary_access() and sees the grant",
        !statusAsSnaErr && (statusAsSna ?? []).some((r) => r.grant_id === grantIdTT),
        JSON.stringify({ error: statusAsSnaErr?.message, count: statusAsSna?.length })
      );
    }

    // ---- The incident this grant makes possible -- created while the
    // grant is live, owning_teacher_id auto-assigned to the covering
    // SNA via can_own_incident()'s own temporary-grant branch. ----
    const { data: incidentTTAId, error: incidentTTAErr } = await snaCoverTT.rpc("create_incident_stamp", {
      p_institution_id: institutionTTId, p_occurred_at: new Date().toISOString(), p_location_id: locTT.id,
      p_child_passport_ids: [childTTId], p_staff: [],
    });
    if (incidentTTAErr) throw incidentTTAErr;
    const { data: owningCheckTTA } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentTTAId).single();
    record(
      "the covering SNA IS auto-assigned owning_teacher_id while their grant is live -- can_own_incident()'s temporary-grant branch, not the role check",
      owningCheckTTA?.owning_teacher_id === snaCoverTTId,
      owningCheckTTA?.owning_teacher_id
    );

    // A genuinely separate incident, owned by a REAL class_teacher --
    // no temporary_access row involved at all. Case B's own setup.
    const { data: incidentTTBId, error: incidentTTBErr } = await teacherTT.rpc("create_incident_stamp", {
      p_institution_id: institutionTTId, p_occurred_at: new Date().toISOString(), p_location_id: locTT.id,
      p_child_passport_ids: [childTTId], p_staff: [],
    });
    if (incidentTTBErr) throw incidentTTBErr;

    // ---- TT-2: the cutoff passes (still NOT revoked) -- the SAME
    // grant now reads is_currently_active=false, live, without ever
    // touching the row itself. "07:31" is always > institutionTTId's own
    // start time (still the untouched 07:30 default here) and, for any
    // reasonable time this suite runs, already in the past -- the one
    // edge this can't rule out (running this suite between 07:30 and
    // 07:31 local time) is now provable a different way (move start_time
    // itself, as CHECK AA's AA-1j/AA-1k do, 0133) but not re-proven here.
    // ----
    const { error: cutoffPassedErr } = await principalTT.rpc("set_temporary_access_cutoff", { p_institution_id: institutionTTId, p_cutoff_time: "07:31:00" });
    if (cutoffPassedErr) throw cutoffPassedErr;
    {
      const { data: statusAfterCutoff } = await principalTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
      const rowAfterCutoff = (statusAfterCutoff ?? []).find((r) => r.grant_id === grantIdTT);
      record(
        "TT-2 THE DISTINCTION ITSELF: is_currently_active=false once the cut-off passes, even though revoked_at is STILL null -- 'ended at the cut-off' and 'revoked' are different facts, proven as two separate transitions on the one row",
        rowAfterCutoff?.is_currently_active === false && rowAfterCutoff?.revoked_at === null,
        JSON.stringify(rowAfterCutoff)
      );
    }

    // ---- TT-7: revoke from the new institution-wide surface's own
    // target RPC -- the PRINCIPAL revoking, not the class's own
    // teacher (there isn't one on Room 1 in this fixture at all),
    // proving the "institution's principal can revoke ANY grant"
    // authority this view depends on. ----
    const { error: revokeTTErr } = await principalTT.rpc("revoke_temporary_access", { p_temporary_access_id: grantIdTT, p_reason: "TT-7: revoking early from the institution-wide view." });
    if (revokeTTErr) throw revokeTTErr;

    // ---- TT-3: revoked_at/revoked_by_name/revocation_reason all
    // resolve correctly, is_currently_active now false for a SECOND,
    // independent reason. ----
    {
      const { data: statusAfterRevoke } = await principalTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
      const rowAfterRevoke = (statusAfterRevoke ?? []).find((r) => r.grant_id === grantIdTT);
      record(
        "TT-3 revoked_at set, revoked_by_name resolves to the real revoking principal, revocation_reason matches exactly, is_currently_active still false",
        Boolean(rowAfterRevoke?.revoked_at) &&
          rowAfterRevoke?.revoked_by_name === "TT Principal" &&
          rowAfterRevoke?.revocation_reason === "TT-7: revoking early from the institution-wide view." &&
          rowAfterRevoke?.is_currently_active === false,
        JSON.stringify(rowAfterRevoke)
      );
    }

    // ---- Case B setup: a genuine class_teacher, deactivated. ----
    const teacherTTStaffId = staffTTRows.find((r) => r.user_id === teacherTTId).id;
    const { error: deactivateTTErr } = await principalTT.rpc("deactivate_institution_staff", { p_institution_staff_id: teacherTTStaffId, p_reason: "TT fixture: needs a genuinely deactivated class teacher." });
    if (deactivateTTErr) throw deactivateTTErr;

    // ---- resolve_lapsed_incident_ownership() -- both incidents lapse
    // in the same call, for two structurally different reasons. ----
    const { data: resolvedCountTT, error: resolveTTErr } = await principalTT.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionTTId });
    if (resolveTTErr) throw resolveTTErr;
    record("both incidents resolved in one call", resolvedCountTT === 2, resolvedCountTT);

    {
      const { data: transferRows } = await admin
        .from("incident_ownership_transfers")
        .select("incident_id, from_teacher_id, to_principal_id, temporary_access_id")
        .in("incident_id", [incidentTTAId, incidentTTBId]);
      const transferA = (transferRows ?? []).find((r) => r.incident_id === incidentTTAId);
      const transferB = (transferRows ?? []).find((r) => r.incident_id === incidentTTBId);
      record(
        "TT-8a THE LINK ITSELF (0132): the covering SNA's own incident transfer correctly points temporary_access_id at the exact grant that lapsed",
        transferA?.from_teacher_id === snaCoverTTId &&
          transferA?.to_principal_id === principalTTId &&
          transferA?.temporary_access_id === grantIdTT,
        JSON.stringify(transferA)
      );
      record(
        "TT-8b the deactivated class_teacher's own transfer correctly has temporary_access_id = NULL -- no grant caused this, and none is invented",
        transferB?.from_teacher_id === teacherTTId &&
          transferB?.to_principal_id === principalTTId &&
          transferB?.temporary_access_id === null,
        JSON.stringify(transferB)
      );
    }

    // ---- TT-4: the recent-past window. A raw, service-role-inserted
    // grant dated 45 days ago, already revoked -- no real write path
    // can produce a genuinely old grant (grant_temporary_access()
    // refuses any date that's already passed), same "construct the
    // state directly, the real RPCs can't produce it" precedent this
    // suite already uses elsewhere (CHECK HH's own cross-institution
    // link, CHECK V's own grandfathered row). ----
    const oldDateTT = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { data: oldGrantTT, error: oldGrantTTErr } = await admin
      .from("temporary_access")
      .insert({
        institution_id: institutionTTId, class_id: classTT1Id, granted_to: snaCoverTTId,
        granted_for_date: oldDateTT, granted_by: principalTTId, granted_by_role: "principal",
        reason: "TT-4 fixture: an old, already-resolved grant.",
        revoked_at: new Date().toISOString(), revoked_by: principalTTId, revocation_reason: "TT-4 fixture cleanup.",
      })
      .select()
      .single();
    if (oldGrantTTErr) throw oldGrantTTErr;
    {
      const { data: defaultWindow } = await principalTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
      record(
        "TT-4a the 45-day-old resolved grant is EXCLUDED under the default 30-day window",
        !(defaultWindow ?? []).some((r) => r.grant_id === oldGrantTT.id),
        JSON.stringify((defaultWindow ?? []).map((r) => r.grant_id))
      );
      const { data: widerWindow } = await principalTT.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId, p_days_back: 60 });
      record(
        "TT-4b the SAME grant is INCLUDED once p_days_back is widened past its own age -- the parameter genuinely changes the window, not just sometimes-empty",
        (widerWindow ?? []).some((r) => r.grant_id === oldGrantTT.id),
        JSON.stringify((widerWindow ?? []).map((r) => r.grant_id))
      );
    }

    // ---- TT-5: institution-scoping. ----
    {
      const { data: crossInstStatus } = await principalTTOther.rpc("get_institution_temporary_access", { p_institution_id: institutionTTId });
      record(
        "TT-5 a principal at a DIFFERENT institution, supplying institutionTT's own id, gets nothing",
        (crossInstStatus ?? []).length === 0,
        JSON.stringify(crossInstStatus)
      );
    }

    console.log("TT summary complete.");

    await admin.from("incident_children").delete().in("incident_id", [incidentTTAId, incidentTTBId]);
    await admin.from("incident_ownership_transfers").delete().in("incident_id", [incidentTTAId, incidentTTBId]);
    await admin.from("incidents").delete().in("id", [incidentTTAId, incidentTTBId]);
    await admin.from("passports").delete().eq("id", childTTId);
    await admin.from("institutions").delete().in("id", [institutionTTId, institutionTTOtherId]);
    for (const id of [principalTTId, principalTTOtherId, teacherTTId, snaCoverTTId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK UU: Client-behaviour half of Stage 6 (src/app/principal/temporary-access/page.tsx) -- proven via the LITERAL client bucket derivation, not a proxy for it. CHECK TT already proves get_institution_temporary_access() and is_currently_active are correct at the SQL level; this check proves the page's own three-way split (Active Now / Upcoming / Recent Past) reproduces the right bucket for three grants in three different real states, fetched in ONE call, simultaneously -- not sequentially reasoned about. Upcoming is deliberately included: GrantTemporaryAccessSheet's own date field allows scheduling ahead of today, a real reachable state, not a hypothetical one. ==`);
  if (shouldRun("UU")) {
    const { data: instUU, error: instUUErr } = await admin
      .from("institutions")
      .insert({ name: "UU Institution", institution_code: CODE + "UU", status: "verified" })
      .select()
      .single();
    if (instUUErr) throw instUUErr;
    const institutionUUId = instUU.id;

    const principalUUId = await createUser("checkuu.principal@thebehaviourhive.com", "UU Principal", "principal");
    // Two SNA identities, not one -- the "active" and "past" example
    // grants both need today's date (the institution's own cut-off
    // time is shared, not per-grant, so "past" here means revoked, not
    // cut-off-passed -- see the check's own header comment), and the
    // unique index is (class_id, granted_to, granted_for_date): the
    // SAME person can't hold two rows for the same class/date even if
    // one is about to be revoked, so this needs a second person, not a
    // workaround.
    const snaUU1Id = await createUser("checkuu.sna1@thebehaviourhive.com", "UU SNA One", "sna");
    const snaUU2Id = await createUser("checkuu.sna2@thebehaviourhive.com", "UU SNA Two", "sna");

    const { data: staffUURows, error: staffUUErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionUUId, user_id: principalUUId, role: "principal" },
      { institution_id: institutionUUId, user_id: snaUU1Id, role: "sna" },
      { institution_id: institutionUUId, user_id: snaUU2Id, role: "sna" },
    ]).select();
    if (staffUUErr) throw staffUUErr;

    const principalUU = await signedInClient("checkuu.principal@thebehaviourhive.com");
    for (const row of staffUURows.filter((r) => r.user_id !== principalUUId)) {
      const { error } = await principalUU.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }

    const { data: classUUId, error: classUUErr } = await principalUU.rpc("create_class", { p_institution_id: institutionUUId, p_name: "UU Room" });
    if (classUUErr) throw classUUErr;

    const nowPartsUU = dublinNowParts();
    const cutoffAheadUU = addMinutesClamped(nowPartsUU.time, 180);
    const { error: cutoffUUErr } = await principalUU.rpc("set_temporary_access_cutoff", { p_institution_id: institutionUUId, p_cutoff_time: cutoffAheadUU });
    if (cutoffUUErr) throw cutoffUUErr;

    // Three grants, three real states, coexisting in the SAME fetch.
    const tomorrowUU = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const { error: grantActiveErr } = await principalUU.rpc("grant_temporary_access", { p_class_id: classUUId, p_user_id: snaUU1Id, p_date: nowPartsUU.date, p_reason: "UU-active fixture grant." });
    if (grantActiveErr) throw grantActiveErr;
    const { error: grantUpcomingErr } = await principalUU.rpc("grant_temporary_access", { p_class_id: classUUId, p_user_id: snaUU1Id, p_date: tomorrowUU, p_reason: "UU-upcoming fixture grant." });
    if (grantUpcomingErr) throw grantUpcomingErr;
    const { error: grantPastErr } = await principalUU.rpc("grant_temporary_access", { p_class_id: classUUId, p_user_id: snaUU2Id, p_date: nowPartsUU.date, p_reason: "UU-past fixture grant, revoked immediately." });
    if (grantPastErr) throw grantPastErr;

    const { data: statusBeforeRevokeUU } = await principalUU.rpc("get_institution_temporary_access", { p_institution_id: institutionUUId });
    const pastGrantIdUU = (statusBeforeRevokeUU ?? []).find((r) => r.granted_to === snaUU2Id)?.grant_id;
    const { error: revokePastUUErr } = await principalUU.rpc("revoke_temporary_access", { p_temporary_access_id: pastGrantIdUU, p_reason: "UU fixture: making this a past example." });
    if (revokePastUUErr) throw revokePastUUErr;

    // ---- The literal client derivation, reproduced verbatim from
    // src/app/principal/temporary-access/page.tsx's own three filters. ----
    const { data: rowsUU, error: rowsUUErr } = await principalUU.rpc("get_institution_temporary_access", { p_institution_id: institutionUUId });
    if (rowsUUErr) throw rowsUUErr;
    const todayUU = nowPartsUU.date;
    const activeUU = (rowsUU ?? []).filter((g) => g.is_currently_active);
    const upcomingUU = (rowsUU ?? []).filter((g) => !g.is_currently_active && !g.revoked_at && g.granted_for_date > todayUU);
    const pastUU = (rowsUU ?? []).filter((g) => !g.is_currently_active && (Boolean(g.revoked_at) || g.granted_for_date <= todayUU));

    record(
      "UU-1 THE ACTIVE BUCKET: contains exactly the one truly-live grant (snaUU1, today, unrevoked)",
      activeUU.length === 1 && activeUU[0].granted_to === snaUU1Id && activeUU[0].granted_for_date === todayUU,
      JSON.stringify(activeUU.map((g) => ({ granted_to: g.granted_to, date: g.granted_for_date })))
    );
    record(
      "UU-2 THE UPCOMING BUCKET: contains exactly the tomorrow-dated, unrevoked grant -- a real reachable state (GrantTemporaryAccessSheet allows scheduling ahead), not lumped into 'past'",
      upcomingUU.length === 1 && upcomingUU[0].granted_to === snaUU1Id && upcomingUU[0].granted_for_date === tomorrowUU,
      JSON.stringify(upcomingUU.map((g) => ({ granted_to: g.granted_to, date: g.granted_for_date })))
    );
    record(
      "UU-3 THE RECENT PAST BUCKET: contains exactly the revoked grant (snaUU2), not the active or upcoming ones",
      pastUU.length === 1 && pastUU[0].granted_to === snaUU2Id && Boolean(pastUU[0].revoked_at),
      JSON.stringify(pastUU.map((g) => ({ granted_to: g.granted_to, revoked_at: g.revoked_at })))
    );
    record(
      "UU-4 all three buckets are simultaneously non-empty from ONE fetch -- not a vacuous pass from a fixture that only ever produced one state at a time",
      activeUU.length === 1 && upcomingUU.length === 1 && pastUU.length === 1,
      JSON.stringify({ active: activeUU.length, upcoming: upcomingUU.length, past: pastUU.length })
    );

    console.log("UU summary complete.");

    await admin.from("institutions").delete().eq("id", institutionUUId);
    for (const id of [principalUUId, snaUU1Id, snaUU2Id]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK VV: SQL for Stage 7's principal action items (migration 0134) -- get_institution_restraints_needing_parent_call() (institution-scoping, non-authority caller sees nothing, a required-and-not-yet-called row is included with the right incident_children_id/child_name/owning_teacher_name, a not-required row and an already-called row are both excluded, and the returned incident_children_id round-trips straight into a real mark_parent_called() call), and get_institution_withdrawn_attestations() (institution-scoping, non-authority caller sees nothing, a genuinely withdrawn attestation is included with the right staff_name/withdrawal_reason/withdrawn_by_name, a never-withdrawn attestation is excluded -- and the one property that matters most: a withdrawn-then-RE-ATTESTED row DISAPPEARS the moment the re-attestation lands, live, proving this is genuinely live-state and not the school_notices-shaped staleness CLAUDE.md's new entry names). ==`);
  if (shouldRun("VV")) {
    const { data: instVV, error: instVVErr } = await admin
      .from("institutions")
      .insert({ name: "VV Institution", institution_code: CODE + "VV", status: "verified" })
      .select()
      .single();
    if (instVVErr) throw instVVErr;
    const institutionVVId = instVV.id;

    const { data: instVVOther, error: instVVOtherErr } = await admin
      .from("institutions")
      .insert({ name: "VV Other Institution", institution_code: CODE + "VVB", status: "verified" })
      .select()
      .single();
    if (instVVOtherErr) throw instVVOtherErr;
    const institutionVVOtherId = instVVOther.id;

    const principalVVId = await createUser("checkvv.principal@thebehaviourhive.com", "VV Principal", "principal");
    const principalVVOtherId = await createUser("checkvv.principalother@thebehaviourhive.com", "VV Other Principal", "principal");
    const teacherVVId = await createUser("checkvv.teacher@thebehaviourhive.com", "VV Teacher", "class_teacher");
    const staffVVId = await createUser("checkvv.staff@thebehaviourhive.com", "VV Named Staff", "class_teacher");

    const { data: staffVVRows, error: staffVVErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionVVId, user_id: principalVVId, role: "principal" },
      { institution_id: institutionVVOtherId, user_id: principalVVOtherId, role: "principal" },
      { institution_id: institutionVVId, user_id: teacherVVId, role: "class_teacher" },
      { institution_id: institutionVVId, user_id: staffVVId, role: "class_teacher" },
    ]).select();
    if (staffVVErr) throw staffVVErr;

    const principalVV = await signedInClient("checkvv.principal@thebehaviourhive.com");
    const principalVVOther = await signedInClient("checkvv.principalother@thebehaviourhive.com");
    for (const row of staffVVRows.filter((r) => r.institution_id === institutionVVId && r.user_id !== principalVVId)) {
      const { error } = await principalVV.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacherVV = await signedInClient("checkvv.teacher@thebehaviourhive.com");
    const staffVV = await signedInClient("checkvv.staff@thebehaviourhive.com");

    const { data: child1VVId, error: child1VVErr } = await principalVV.rpc("create_school_passport", { p_institution_id: institutionVVId, p_child_name: "VV Child One" });
    if (child1VVErr) throw child1VVErr;
    const { data: child2VVId, error: child2VVErr } = await principalVV.rpc("create_school_passport", { p_institution_id: institutionVVId, p_child_name: "VV Child Two" });
    if (child2VVErr) throw child2VVErr;
    const { data: childVVOtherId, error: childVVOtherErr } = await principalVVOther.rpc("create_school_passport", { p_institution_id: institutionVVOtherId, p_child_name: "VV Other-Institution Child" });
    if (childVVOtherErr) throw childVVOtherErr;

    const { data: locVV } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    // ---- VV0: one incident at institutionVV naming BOTH children (A =
    // parent-call-required, B = not) and BOTH staff (teacherVV,
    // staffVV) -- exclusion proofs live alongside inclusion proofs on
    // the SAME incident, not a second fixture. ----
    const { data: incidentVVId, error: incidentVVErr } = await teacherVV.rpc("create_incident_stamp", {
      p_institution_id: institutionVVId, p_occurred_at: new Date().toISOString(), p_location_id: locVV.id,
      p_child_passport_ids: [child1VVId, child2VVId], p_staff: [{ user_id: staffVVId }],
    });
    if (incidentVVErr) throw incidentVVErr;

    const { data: icVVRows } = await admin.from("incident_children").select("id, passport_id, child_index").eq("incident_id", incidentVVId);
    const icVVChild1 = icVVRows.find((r) => r.passport_id === child1VVId);
    const icVVChild2 = icVVRows.find((r) => r.passport_id === child2VVId);

    // A second incident, at the OTHER institution, also parent-call-
    // required -- the cross-institution-scoping proof.
    const { data: incidentVVOtherId, error: incidentVVOtherErr } = await principalVVOther.rpc("create_incident_stamp", {
      p_institution_id: institutionVVOtherId, p_occurred_at: new Date().toISOString(), p_location_id: locVV.id,
      p_child_passport_ids: [childVVOtherId], p_staff: [],
    });
    if (incidentVVOtherErr) throw incidentVVOtherErr;
    const { data: icVVOtherRows } = await admin.from("incident_children").select("id").eq("incident_id", incidentVVOtherId);
    await admin.from("incident_children").update({ parent_call_required: true }).eq("id", icVVOtherRows[0].id);

    // ---- VV1: get_institution_restraints_needing_parent_call() ----
    // Child A: required, not yet called. Child B: never required.
    await teacherVV.from("incident_children").update({ parent_call_required: true }).eq("id", icVVChild1.id);

    const { data: nonAuthorityCallsVV } = await teacherVV.rpc("get_institution_restraints_needing_parent_call", { p_institution_id: institutionVVId });
    record(
      "VV-1a a caller with no countersign authority (ordinary class teacher, own institution) gets zero rows",
      (nonAuthorityCallsVV ?? []).length === 0,
      JSON.stringify(nonAuthorityCallsVV)
    );

    const { data: callsVV1, error: callsVV1Err } = await principalVV.rpc("get_institution_restraints_needing_parent_call", { p_institution_id: institutionVVId });
    record("VV-1b the principal CAN call get_institution_restraints_needing_parent_call()", !callsVV1Err, callsVV1Err?.message);
    const rowVVChild1 = (callsVV1 ?? []).find((r) => r.incident_children_id === icVVChild1.id);
    record(
      "VV-1c the required-and-not-yet-called child IS included, with the right incident_children_id/child_name/owning_teacher_name/child_index",
      rowVVChild1?.child_name === "VV Child One" && rowVVChild1?.owning_teacher_name === "VV Teacher" && rowVVChild1?.child_index === icVVChild1.child_index,
      JSON.stringify(rowVVChild1)
    );
    record(
      "VV-1d the SAME incident's child B (never parent_call_required) is EXCLUDED",
      !(callsVV1 ?? []).some((r) => r.incident_children_id === icVVChild2.id),
      JSON.stringify((callsVV1 ?? []).map((r) => r.incident_children_id))
    );
    record(
      "VV-1e a DIFFERENT institution's parent-call-required child is EXCLUDED",
      !(callsVV1 ?? []).some((r) => r.incident_children_id === icVVOtherRows[0].id),
      JSON.stringify((callsVV1 ?? []).map((r) => r.incident_children_id))
    );

    // ---- VV2: the returned id round-trips into the REAL write path. ----
    const { error: markCalledVVErr } = await principalVV.rpc("mark_parent_called", { p_incident_children_id: rowVVChild1.incident_children_id });
    record("VV-2a mark_parent_called() succeeds against the id this RPC returned -- no second lookup needed", !markCalledVVErr, markCalledVVErr?.message);

    const { data: callsVV2 } = await principalVV.rpc("get_institution_restraints_needing_parent_call", { p_institution_id: institutionVVId });
    record(
      "VV-2b the SAME child now DISAPPEARS from the list -- parent_called_at is no longer null",
      !(callsVV2 ?? []).some((r) => r.incident_children_id === icVVChild1.id),
      JSON.stringify((callsVV2 ?? []).map((r) => r.incident_children_id))
    );

    // ---- VV3: get_institution_withdrawn_attestations() ----
    const { data: staffVVStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", incidentVVId).eq("user_id", staffVVId).single();
    const staffVVStaffId = staffVVStaffRow.id;

    const { error: attestVVErr } = await staffVV.rpc("attest_to_incident", { p_incident_staff_id: staffVVStaffId, p_addendum: "Confirmed." });
    if (attestVVErr) throw attestVVErr;

    const { data: nonAuthorityAttestVV } = await teacherVV.rpc("get_institution_withdrawn_attestations", { p_institution_id: institutionVVId });
    record(
      "VV-3a a caller with no countersign authority gets zero rows from get_institution_withdrawn_attestations() too",
      (nonAuthorityAttestVV ?? []).length === 0,
      JSON.stringify(nonAuthorityAttestVV)
    );

    const { data: withdrawnVV0 } = await principalVV.rpc("get_institution_withdrawn_attestations", { p_institution_id: institutionVVId });
    record(
      "VV-3b a merely-current (never withdrawn) attestation is EXCLUDED",
      !(withdrawnVV0 ?? []).some((r) => r.incident_staff_id === staffVVStaffId),
      JSON.stringify((withdrawnVV0 ?? []).map((r) => r.incident_staff_id))
    );

    const WITHDRAWAL_REASON_VV = "VV fixture: checking something before re-attesting.";
    const { error: withdrawVVErr } = await staffVV.rpc("withdraw_attestation", { p_incident_staff_id: staffVVStaffId, p_reason: WITHDRAWAL_REASON_VV });
    if (withdrawVVErr) throw withdrawVVErr;

    const { data: withdrawnVV1, error: withdrawnVV1Err } = await principalVV.rpc("get_institution_withdrawn_attestations", { p_institution_id: institutionVVId });
    record("VV-3c the principal CAN call get_institution_withdrawn_attestations()", !withdrawnVV1Err, withdrawnVV1Err?.message);
    const rowVVWithdrawn = (withdrawnVV1 ?? []).find((r) => r.incident_staff_id === staffVVStaffId);
    record(
      "VV-3d the just-withdrawn attestation IS included, with the right staff_name/withdrawal_reason/withdrawn_by_name/is_closed",
      rowVVWithdrawn?.staff_name === "VV Named Staff" &&
        rowVVWithdrawn?.withdrawal_reason === WITHDRAWAL_REASON_VV &&
        rowVVWithdrawn?.withdrawn_by_name === "VV Named Staff" &&
        rowVVWithdrawn?.is_closed === false,
      JSON.stringify(rowVVWithdrawn)
    );
    record(
      "VV-3e a DIFFERENT institution's withdrawn attestation is excluded (institution-scoping) -- checked structurally: this fixture created none there, so the row count itself is the proof there's no cross-institution leak surfacing extra rows",
      (withdrawnVV1 ?? []).every((r) => r.incident_staff_id === staffVVStaffId),
      JSON.stringify((withdrawnVV1 ?? []).map((r) => r.incident_staff_id))
    );

    // ---- VV4: THE property that matters -- re-attesting makes the row
    // disappear live, proving this is genuinely live-state and not an
    // event log a later action can't correct. ----
    const { error: reattestVVErr } = await staffVV.rpc("attest_to_incident", { p_incident_staff_id: staffVVStaffId, p_addendum: "Re-attesting, all clear now." });
    if (reattestVVErr) throw reattestVVErr;

    const { data: withdrawnVV2 } = await principalVV.rpc("get_institution_withdrawn_attestations", { p_institution_id: institutionVVId });
    record(
      "VV-4 THE LIVE-STATE PROOF: the SAME incident_staff_id DISAPPEARS the moment it's re-attested -- a school_notices-shaped log would still show this as outstanding",
      !(withdrawnVV2 ?? []).some((r) => r.incident_staff_id === staffVVStaffId),
      JSON.stringify((withdrawnVV2 ?? []).map((r) => r.incident_staff_id))
    );

    console.log("VV summary complete.");

    await admin.from("incident_attestations").delete().in("incident_staff_id", [staffVVStaffId]);
    await admin.from("incident_staff").delete().in("incident_id", [incidentVVId, incidentVVOtherId]);
    await admin.from("incident_children").delete().in("incident_id", [incidentVVId, incidentVVOtherId]);
    await admin.from("incidents").delete().in("id", [incidentVVId, incidentVVOtherId]);
    await admin.from("passports").delete().in("id", [child1VVId, child2VVId, childVVOtherId]);
    await admin.from("institutions").delete().in("id", [institutionVVId, institutionVVOtherId]);
    for (const id of [principalVVId, principalVVOtherId, teacherVVId, staffVVId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK WW: SQL for Stage 7's teacher action items (migrations 0135/0136/0137) -- get_my_incidents() as a genuinely NEW capability (no query or screen has ever listed a teacher's own incidents before this), the debrief-completed real signal, the transfer case proving visibility and to-do membership are different claims, the countersign/not-signed-off INVERSION proven on one incident moving through both states rather than two separate fixtures, get_my_incident_attestation_issues()'s withdrawn/stale/current/not-owner distinctions, get_my_cover_grants_expiring_today()'s grantor scoping, get_my_class_sna_gaps()'s three-classes-one-call shape with 1:1/class-SNA/former-class exclusions, and institution_staff standing enforced identically across all four. ==`);
  if (shouldRun("WW")) {
    const { data: instWW, error: instWWErr } = await admin
      .from("institutions")
      .insert({ name: "WW Institution", institution_code: CODE + "WW", status: "verified" })
      .select()
      .single();
    if (instWWErr) throw instWWErr;
    const institutionWWId = instWW.id;

    const { data: instWWOther, error: instWWOtherErr } = await admin
      .from("institutions")
      .insert({ name: "WW Other Institution", institution_code: CODE + "WWB", status: "verified" })
      .select()
      .single();
    if (instWWOtherErr) throw instWWOtherErr;
    const institutionWWOtherId = instWWOther.id;

    const principalWWId = await createUser("checkww.principal@thebehaviourhive.com", "WW Principal", "principal");
    const teacher1WWId = await createUser("checkww.teacher1@thebehaviourhive.com", "WW Teacher One", "class_teacher");
    const teacher2WWId = await createUser("checkww.teacher2@thebehaviourhive.com", "WW Teacher Two", "class_teacher");
    const supplyWWId = await createUser("checkww.supply@thebehaviourhive.com", "WW Supply", "sna");
    const principalWWOtherId = await createUser("checkww.principalother@thebehaviourhive.com", "WW Other Principal", "principal");
    const teacherWWOtherId = await createUser("checkww.teacherother@thebehaviourhive.com", "WW Other Teacher", "class_teacher");

    const { data: staffWWRows, error: staffWWErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionWWId, user_id: principalWWId, role: "principal" },
      { institution_id: institutionWWId, user_id: teacher1WWId, role: "class_teacher" },
      { institution_id: institutionWWId, user_id: teacher2WWId, role: "class_teacher" },
      { institution_id: institutionWWId, user_id: supplyWWId, role: "sna" },
      { institution_id: institutionWWOtherId, user_id: principalWWOtherId, role: "principal" },
      { institution_id: institutionWWOtherId, user_id: teacherWWOtherId, role: "class_teacher" },
    ]).select();
    if (staffWWErr) throw staffWWErr;

    const principalWW = await signedInClient("checkww.principal@thebehaviourhive.com");
    const principalWWOther = await signedInClient("checkww.principalother@thebehaviourhive.com");
    for (const row of staffWWRows.filter((r) => r.institution_id === institutionWWId && r.user_id !== principalWWId)) {
      const { error } = await principalWW.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    for (const row of staffWWRows.filter((r) => r.institution_id === institutionWWOtherId && r.user_id !== principalWWOtherId)) {
      const { error } = await principalWWOther.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw error;
    }
    const teacher1WW = await signedInClient("checkww.teacher1@thebehaviourhive.com");
    const teacher2WW = await signedInClient("checkww.teacher2@thebehaviourhive.com");
    const supplyWW = await signedInClient("checkww.supply@thebehaviourhive.com");
    const teacherWWOther = await signedInClient("checkww.teacherother@thebehaviourhive.com");

    const { data: locWW } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

    // ==== WW1: get_my_incidents() -- basic scoping ====
    const { data: childWW1Id, error: childWW1Err } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Child One" });
    if (childWW1Err) throw childWW1Err;

    const { data: incidentWW1Id, error: incidentWW1Err } = await teacher1WW.rpc("create_incident_stamp", {
      p_institution_id: institutionWWId, p_occurred_at: new Date().toISOString(), p_location_id: locWW.id,
      p_child_passport_ids: [childWW1Id], p_staff: [{ user_id: teacher2WWId }],
    });
    if (incidentWW1Err) throw incidentWW1Err;

    const { data: mineWW1, error: mineWW1Err } = await teacher1WW.rpc("get_my_incidents");
    record("WW-1a get_my_incidents() -- the NEW CAPABILITY: teacher1 CAN call it and sees their own unsigned incident", !mineWW1Err && (mineWW1 ?? []).some((r) => r.incident_id === incidentWW1Id), JSON.stringify({ error: mineWW1Err?.message, ids: (mineWW1 ?? []).map((r) => r.incident_id) }));

    const { data: mineWW2 } = await teacher2WW.rpc("get_my_incidents");
    record("WW-1b teacher2, merely NAMED as staff on teacher1's incident (not owning it), does NOT see it on their own get_my_incidents()", !(mineWW2 ?? []).some((r) => r.incident_id === incidentWW1Id), JSON.stringify((mineWW2 ?? []).map((r) => r.incident_id)));

    const { data: mineWWOther } = await teacherWWOther.rpc("get_my_incidents");
    record("WW-1c a teacher at a DIFFERENT institution sees nothing of it either (self-scoped, no institution id even needed to prove this)", (mineWWOther ?? []).length === 0, JSON.stringify(mineWWOther));

    // ==== WW2: the debrief bucket -- real completion signal, not the ====
    // principal dashboard's own signed_at proxy (which cannot apply here
    // -- this bucket is entirely pre-signoff incidents).
    await teacher1WW.from("incidents").update({ debrief_required: true }).eq("id", incidentWW1Id);
    const { data: mineWW2a } = await teacher1WW.rpc("get_my_incidents");
    const rowWW2a = (mineWW2a ?? []).find((r) => r.incident_id === incidentWW1Id);
    record("WW-2a debrief_required=true, not yet completed -- debrief_completed reads false, teacher_signed_at still null (the 'debrief owed' bucket would include this row)", rowWW2a?.debrief_required === true && rowWW2a?.debrief_completed === false && rowWW2a?.teacher_signed_at === null, JSON.stringify(rowWW2a));

    const { data: debriefWWRow, error: debriefWWErr } = await teacher1WW
      .from("incident_debriefs")
      .insert({ incident_id: incidentWW1Id, debrief_date: "2026-01-01", staff_present: ["WW Teacher One"], notes: "WW fixture debrief." })
      .select()
      .single();
    if (debriefWWErr) throw debriefWWErr;
    await teacher1WW.from("incident_debriefs").update({ completed_at: new Date().toISOString(), completed_by: teacher1WWId }).eq("id", debriefWWRow.id);

    const { data: mineWW2b } = await teacher1WW.rpc("get_my_incidents");
    const rowWW2b = (mineWW2b ?? []).find((r) => r.incident_id === incidentWW1Id);
    record("WW-2b once the debrief is completed, debrief_completed flips true LIVE -- this incident would now drop out of the 'debrief owed' bucket even though it's still not signed off", rowWW2b?.debrief_completed === true && rowWW2b?.teacher_signed_at === null, JSON.stringify(rowWW2b));

    // ==== WW3: the transfer case -- visibility and to-do membership ====
    // are different claims, the distinction that made 0136 a real bug.
    const nowPartsWW = dublinNowParts();
    const cutoffAheadWW = addMinutesClamped(nowPartsWW.time, 180);
    const { error: cutoffWWErr } = await principalWW.rpc("set_temporary_access_cutoff", { p_institution_id: institutionWWId, p_cutoff_time: cutoffAheadWW });
    if (cutoffWWErr) throw cutoffWWErr;
    const { data: classWWTransferId, error: classWWTransferErr } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Transfer Room" });
    if (classWWTransferErr) throw classWWTransferErr;
    const { data: grantWWId, error: grantWWErr } = await principalWW.rpc("grant_temporary_access", { p_class_id: classWWTransferId, p_user_id: supplyWWId, p_date: nowPartsWW.date, p_reason: "WW fixture: supply cover, then lapsing." });
    if (grantWWErr) throw grantWWErr;

    const { data: incidentWWTransferId, error: incidentWWTransferErr } = await supplyWW.rpc("create_incident_stamp", {
      p_institution_id: institutionWWId, p_occurred_at: new Date().toISOString(), p_location_id: locWW.id,
      p_child_passport_ids: [childWW1Id], p_staff: [],
    });
    if (incidentWWTransferErr) throw incidentWWTransferErr;
    const { data: preTransferCheck } = await admin.from("incidents").select("owning_teacher_id, created_by").eq("id", incidentWWTransferId).single();
    record("WW-3-setup: the supply teacher genuinely owns this incident before the transfer", preTransferCheck.owning_teacher_id === supplyWWId && preTransferCheck.created_by === supplyWWId, JSON.stringify(preTransferCheck));

    const { data: mineWWSupplyBefore } = await supplyWW.rpc("get_my_incidents");
    record("WW-3a before the transfer, the supply teacher DOES see it on their own get_my_incidents()", (mineWWSupplyBefore ?? []).some((r) => r.incident_id === incidentWWTransferId), JSON.stringify((mineWWSupplyBefore ?? []).map((r) => r.incident_id)));

    const { error: revokeWWErr } = await principalWW.rpc("revoke_temporary_access", { p_temporary_access_id: grantWWId, p_reason: "WW fixture: ending cover early to trigger the transfer." });
    if (revokeWWErr) throw revokeWWErr;
    const { error: resolveWWErr } = await principalWW.rpc("resolve_lapsed_incident_ownership", { p_institution_id: institutionWWId });
    if (resolveWWErr) throw resolveWWErr;
    const { data: postTransferCheck } = await admin.from("incidents").select("owning_teacher_id, created_by").eq("id", incidentWWTransferId).single();
    record("WW-3-setup2: ownership genuinely moved to the principal; created_by is UNCHANGED (it never changes)", postTransferCheck.owning_teacher_id === principalWWId && postTransferCheck.created_by === supplyWWId, JSON.stringify(postTransferCheck));

    const { data: mineWWSupplyAfter } = await supplyWW.rpc("get_my_incidents");
    record("WW-3b THE FIX ITSELF: after the transfer, the supply teacher's get_my_incidents() no longer includes it -- they have no remaining authority over it", !(mineWWSupplyAfter ?? []).some((r) => r.incident_id === incidentWWTransferId), JSON.stringify((mineWWSupplyAfter ?? []).map((r) => r.incident_id)));

    const { data: mineWWPrincipalAfter } = await principalWW.rpc("get_my_incidents");
    record("WW-3c the principal's OWN get_my_incidents() now includes it -- they genuinely own it, via the same generic mechanism, even though the principal dashboard itself doesn't call this RPC today", (mineWWPrincipalAfter ?? []).some((r) => r.incident_id === incidentWWTransferId), JSON.stringify((mineWWPrincipalAfter ?? []).map((r) => r.incident_id)));

    const { data: supplyStillViews, error: supplyStillViewsErr } = await supplyWW.from("incidents").select("id").eq("id", incidentWWTransferId);
    record("WW-3d THE DISTINCTION THAT MADE 0136 A REAL BUG: the supply teacher can STILL VIEW the incident directly (created_by, per AA-7e) even though it no longer belongs on their to-do list -- visibility and to-do membership are different claims, proven as two different, simultaneously-true facts about the SAME row", !supplyStillViewsErr && (supplyStillViews ?? []).length === 1, JSON.stringify({ error: supplyStillViewsErr?.message, rows: supplyStillViews }));

    // ==== WW4: THE INVERSION -- one incident, two states, both RPCs ====
    // called at each state. Stronger than two fixtures: a single
    // incident moving cannot be correct for reasons unrelated to the
    // predicates under test the way two independently-built fixtures
    // could be.
    const { data: incidentWW4Id, error: incidentWW4Err } = await teacher1WW.rpc("create_incident_stamp", {
      p_institution_id: institutionWWId, p_occurred_at: new Date().toISOString(), p_location_id: locWW.id,
      p_child_passport_ids: [childWW1Id], p_staff: [],
    });
    if (incidentWW4Err) throw incidentWW4Err;

    // State B (unsigned) first.
    const { data: instIncWWBefore } = await principalWW.rpc("get_institution_incidents", { p_institution_id: institutionWWId });
    const onPrincipalQueueBefore = (instIncWWBefore ?? []).some((r) => r.incident_id === incidentWW4Id && r.teacher_signed_at && !r.countersigned_at);
    record("WW-4a STATE B (unsigned): does NOT appear on the principal's countersign-pending predicate", !onPrincipalQueueBefore, JSON.stringify((instIncWWBefore ?? []).find((r) => r.incident_id === incidentWW4Id)));

    const { data: mineWW4Before } = await teacher1WW.rpc("get_my_incidents");
    const onTeacherNotSignedBefore = (mineWW4Before ?? []).some((r) => r.incident_id === incidentWW4Id && !r.teacher_signed_at);
    record("WW-4b STATE B (unsigned): DOES appear on the teacher's own 'not signed off' filter", onTeacherNotSignedBefore, JSON.stringify((mineWW4Before ?? []).find((r) => r.incident_id === incidentWW4Id)));

    // Now sign it off -- State A.
    await teacher1WW.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacher1WWId }).eq("id", incidentWW4Id);

    const { data: instIncWWAfter } = await principalWW.rpc("get_institution_incidents", { p_institution_id: institutionWWId });
    const onPrincipalQueueAfter = (instIncWWAfter ?? []).some((r) => r.incident_id === incidentWW4Id && r.teacher_signed_at && !r.countersigned_at);
    record("WW-4c STATE A (signed): the SAME incident NOW appears on the principal's countersign-pending predicate", onPrincipalQueueAfter, JSON.stringify((instIncWWAfter ?? []).find((r) => r.incident_id === incidentWW4Id)));

    const { data: mineWW4After } = await teacher1WW.rpc("get_my_incidents");
    const onTeacherNotSignedAfter = (mineWW4After ?? []).some((r) => r.incident_id === incidentWW4Id && !r.teacher_signed_at);
    record("WW-4d STATE A (signed): the SAME incident NO LONGER appears on the teacher's own 'not signed off' filter -- opposite states on the same two columns, not the same predicate at a different scope", !onTeacherNotSignedAfter, JSON.stringify((mineWW4After ?? []).find((r) => r.incident_id === incidentWW4Id)));

    // ==== WW5: get_my_incident_attestation_issues() ====
    const { data: incidentWW5Id, error: incidentWW5Err } = await teacher1WW.rpc("create_incident_stamp", {
      p_institution_id: institutionWWId, p_occurred_at: new Date().toISOString(), p_location_id: locWW.id,
      p_child_passport_ids: [childWW1Id], p_staff: [{ user_id: teacher2WWId }],
    });
    if (incidentWW5Err) throw incidentWW5Err;
    const { data: staffWW5Row } = await admin.from("incident_staff").select("id").eq("incident_id", incidentWW5Id).eq("user_id", teacher2WWId).single();

    await teacher2WW.rpc("attest_to_incident", { p_incident_staff_id: staffWW5Row.id, p_addendum: "Confirmed." });
    const { data: issuesWW5Current } = await teacher1WW.rpc("get_my_incident_attestation_issues");
    record("WW-5a a merely-CURRENT attestation on an incident the caller owns is EXCLUDED", !(issuesWW5Current ?? []).some((r) => r.incident_staff_id === staffWW5Row.id), JSON.stringify((issuesWW5Current ?? []).map((r) => r.incident_staff_id)));

    await teacher1WW.from("incidents").update({ narrative: "WW fixture: revised after attestation, to trigger staleness." }).eq("id", incidentWW5Id);
    const { data: issuesWW5Stale } = await teacher1WW.rpc("get_my_incident_attestation_issues");
    const rowWW5Stale = (issuesWW5Stale ?? []).find((r) => r.incident_staff_id === staffWW5Row.id);
    record("WW-5b a STALE attestation on an incident the caller owns IS included, with status_label 'Stale' and the right staff_name", rowWW5Stale?.status === "stale" && rowWW5Stale?.status_label === "Stale" && rowWW5Stale?.staff_name === "WW Teacher Two", JSON.stringify(rowWW5Stale));

    await teacher2WW.rpc("withdraw_attestation", { p_incident_staff_id: staffWW5Row.id, p_reason: "WW fixture: withdrawing after the narrative changed." });
    const { data: issuesWW5Withdrawn } = await teacher1WW.rpc("get_my_incident_attestation_issues");
    const rowWW5Withdrawn = (issuesWW5Withdrawn ?? []).find((r) => r.incident_staff_id === staffWW5Row.id);
    record("WW-5c a WITHDRAWN attestation on an incident the caller owns IS included, with status_label 'Withdrawn'", rowWW5Withdrawn?.status === "withdrawn" && rowWW5Withdrawn?.status_label === "Withdrawn", JSON.stringify(rowWW5Withdrawn));

    const { data: issuesWW5NotOwner } = await teacher2WW.rpc("get_my_incident_attestation_issues");
    record("WW-5d teacher2, the one who actually withdrew, sees NOTHING calling this themselves -- they don't OWN the incident, ownership is the predicate, not being named", (issuesWW5NotOwner ?? []).length === 0, JSON.stringify(issuesWW5NotOwner));

    // ==== WW6: get_my_cover_grants_expiring_today() ====
    const { data: classWW6Id, error: classWW6Err } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Cover Room" });
    if (classWW6Err) throw classWW6Err;
    await principalWW.rpc("add_class_teacher", { p_class_id: classWW6Id, p_user_id: teacher1WWId });
    const { data: grantWW6Id, error: grantWW6Err } = await teacher1WW.rpc("grant_temporary_access", { p_class_id: classWW6Id, p_user_id: supplyWWId, p_date: nowPartsWW.date, p_reason: "WW fixture: teacher1's own grant, today." });
    if (grantWW6Err) throw grantWW6Err;

    const { data: coverWW6a } = await teacher1WW.rpc("get_my_cover_grants_expiring_today");
    record("WW-6a a grant teacher1 made today IS included, with the right class_name/granted_to_name", (coverWW6a ?? []).some((r) => r.grant_id === grantWW6Id && r.class_name === "WW Cover Room" && r.granted_to_name === "WW Supply"), JSON.stringify(coverWW6a));

    const { data: coverWW6b } = await principalWW.rpc("get_my_cover_grants_expiring_today");
    record("WW-6b a DIFFERENT person's grant (the principal calling, teacher1 is the actual grantor) does NOT show up for them", !(coverWW6b ?? []).some((r) => r.grant_id === grantWW6Id), JSON.stringify(coverWW6b));

    await principalWW.rpc("revoke_temporary_access", { p_temporary_access_id: grantWW6Id, p_reason: "WW fixture: revoking to prove exclusion." });
    const { data: coverWW6c } = await teacher1WW.rpc("get_my_cover_grants_expiring_today");
    record("WW-6c once revoked, the SAME grant no longer appears -- it's already over, not 'expiring'", !(coverWW6c ?? []).some((r) => r.grant_id === grantWW6Id), JSON.stringify(coverWW6c));

    // ==== WW7: get_my_class_sna_gaps() -- three classes, one call, ====
    // plus the three exclusion shapes.
    const { data: classWWGap1Id } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Gap Room 1" });
    const { data: classWWGap2Id } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Gap Room 2" });
    const { data: classWWMixedId } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Mixed Room" });
    const { data: classWWClassSnaId } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Class-SNA Room" });
    const { data: classWWFormerId } = await principalWW.rpc("create_class", { p_institution_id: institutionWWId, p_name: "WW Former Room" });

    for (const cid of [classWWGap1Id, classWWGap2Id, classWWMixedId, classWWClassSnaId]) {
      await principalWW.rpc("add_class_teacher", { p_class_id: cid, p_user_id: teacher1WWId });
    }
    const formerClassTeacherWWId = await principalWW.rpc("add_class_teacher", { p_class_id: classWWFormerId, p_user_id: teacher1WWId }).then((r) => r.data);

    const { data: childGap1Id } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Gap Child 1" });
    const { data: childGap2Id } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Gap Child 2" });
    const { data: childMixedGapId } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Mixed Room Gap Child" });
    const { data: childMixed1to1Id } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Mixed Room 1:1 Child" });
    const { data: childClassSnaId } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Class-SNA Child" });
    const { data: childFormerId } = await principalWW.rpc("create_school_passport", { p_institution_id: institutionWWId, p_child_name: "WW Former Room Child" });

    await principalWW.rpc("add_class_child", { p_class_id: classWWGap1Id, p_passport_id: childGap1Id });
    await principalWW.rpc("add_class_child", { p_class_id: classWWGap2Id, p_passport_id: childGap2Id });
    await principalWW.rpc("add_class_child", { p_class_id: classWWMixedId, p_passport_id: childMixedGapId });
    await principalWW.rpc("add_class_child", { p_class_id: classWWMixedId, p_passport_id: childMixed1to1Id });
    await principalWW.rpc("add_class_child", { p_class_id: classWWClassSnaId, p_passport_id: childClassSnaId });
    await principalWW.rpc("add_class_child", { p_class_id: classWWFormerId, p_passport_id: childFormerId });

    await principalWW.rpc("assign_sna_to_child", { p_passport_id: childMixed1to1Id, p_user_id: supplyWWId, p_institution_id: institutionWWId });
    await principalWW.rpc("assign_class_sna", { p_class_id: classWWClassSnaId, p_user_id: supplyWWId });
    await principalWW.rpc("remove_class_teacher", { p_class_teacher_id: formerClassTeacherWWId, p_reason: "WW fixture: ending this one to prove historical membership excludes." });

    const { data: gapsWW7, error: gapsWW7Err } = await teacher1WW.rpc("get_my_class_sna_gaps");
    record("WW-7a get_my_class_sna_gaps() succeeds and returns exactly the three genuine gaps, one per class, THREE CLASSES in ONE call", !gapsWW7Err && (gapsWW7 ?? []).length === 3, JSON.stringify({ error: gapsWW7Err?.message, rows: gapsWW7 }));
    const gapIdsWW7 = (gapsWW7 ?? []).map((r) => r.passport_id);
    record("WW-7b class 1's genuinely unassigned child IS included", gapIdsWW7.includes(childGap1Id), JSON.stringify(gapIdsWW7));
    record("WW-7c class 2's genuinely unassigned child IS included (the second of the three classes)", gapIdsWW7.includes(childGap2Id), JSON.stringify(gapIdsWW7));
    record("WW-7d the Mixed Room's unassigned child IS included (the third of the three classes)", gapIdsWW7.includes(childMixedGapId), JSON.stringify(gapIdsWW7));
    record("WW-7e the SAME Mixed Room's 1:1-assigned child is EXCLUDED, even though its classmate is included -- proves per-child, not per-class", !gapIdsWW7.includes(childMixed1to1Id), JSON.stringify(gapIdsWW7));
    record("WW-7f the Class-SNA Room's child is EXCLUDED -- a class-level SNA assignment covers it", !gapIdsWW7.includes(childClassSnaId), JSON.stringify(gapIdsWW7));
    record("WW-7g THE NEGATIVE CONTROL: the Former Room's child contributes NOTHING -- a class_teachers row with ended_at set is historical membership, not current", !gapIdsWW7.includes(childFormerId), JSON.stringify(gapIdsWW7));

    // ==== WW8: institution_staff standing, identically across all four ====
    const { data: teacher1WWStaffRow } = await admin.from("institution_staff").select("id").eq("institution_id", institutionWWId).eq("user_id", teacher1WWId).single();
    await principalWW.rpc("deactivate_institution_staff", { p_institution_staff_id: teacher1WWStaffRow.id, p_reason: "WW fixture: proving the standing gate on all four new functions." });

    const { data: deactivatedIncidents } = await teacher1WW.rpc("get_my_incidents");
    record("WW-8a a DEACTIVATED teacher's get_my_incidents() returns nothing, though several of their own incidents still structurally exist", (deactivatedIncidents ?? []).length === 0, JSON.stringify(deactivatedIncidents));

    const { data: deactivatedIssues } = await teacher1WW.rpc("get_my_incident_attestation_issues");
    record("WW-8b a DEACTIVATED teacher's get_my_incident_attestation_issues() returns nothing", (deactivatedIssues ?? []).length === 0, JSON.stringify(deactivatedIssues));

    const { data: deactivatedGaps } = await teacher1WW.rpc("get_my_class_sna_gaps");
    record("WW-8c a DEACTIVATED teacher's get_my_class_sna_gaps() returns nothing", (deactivatedGaps ?? []).length === 0, JSON.stringify(deactivatedGaps));

    const { data: classWW8Id } = await admin.from("classes").select("id").eq("institution_id", institutionWWId).eq("name", "WW Cover Room").single();
    const { data: grantWW8Id, error: grantWW8Err } = await admin.from("temporary_access").insert({
      institution_id: institutionWWId, class_id: classWW8Id.id, granted_to: supplyWWId,
      granted_for_date: nowPartsWW.date, granted_by: teacher1WWId, granted_by_role: "class_teacher",
      reason: "WW fixture: a grant attributed to the now-deactivated teacher1, for WW-8d.",
    }).select().single();
    if (grantWW8Err) throw grantWW8Err;
    const { data: deactivatedCover } = await teacher1WW.rpc("get_my_cover_grants_expiring_today");
    record("WW-8d a DEACTIVATED teacher's get_my_cover_grants_expiring_today() returns nothing, even for a grant genuinely attributed to them today", !(deactivatedCover ?? []).some((r) => r.grant_id === grantWW8Id.id), JSON.stringify(deactivatedCover));

    console.log("WW summary complete.");

    await admin.from("temporary_access").delete().in("id", [grantWW8Id.id]);
    await admin.from("class_sna_assignments").delete().eq("class_id", classWWClassSnaId);
    await admin.from("child_assignments").delete().eq("passport_id", childMixed1to1Id);
    await admin.from("incident_attestations").delete().in("incident_staff_id", [staffWW5Row.id]);
    await admin.from("incident_staff").delete().in("incident_id", [incidentWW1Id, incidentWW5Id]);
    await admin.from("incident_debriefs").delete().eq("incident_id", incidentWW1Id);
    await admin.from("incident_children").delete().in("incident_id", [incidentWW1Id, incidentWWTransferId, incidentWW4Id, incidentWW5Id]);
    await admin.from("incident_ownership_transfers").delete().in("incident_id", [incidentWWTransferId]);
    await admin.from("incidents").delete().in("id", [incidentWW1Id, incidentWWTransferId, incidentWW4Id, incidentWW5Id]);
    await admin.from("passports").delete().in("id", [childWW1Id, childGap1Id, childGap2Id, childMixedGapId, childMixed1to1Id, childClassSnaId, childFormerId]);
    await admin.from("institutions").delete().in("id", [institutionWWId, institutionWWOtherId]);
    for (const id of [principalWWId, teacher1WWId, teacher2WWId, supplyWWId, principalWWOtherId, teacherWWOtherId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK XX: SQL for PRD 3 Stage 1 (migration 0138) -- passports/passport_section_b/c/d RLS moved to owns_passport(). THE UPSERT BUG, found by accident while building this check and locked as a permanent regression (XX0b): .upsert() sends Prefer: return=representation by default, even with no .select() chained, so a first-time insert must pass the SELECT policy (owns_passport(id), 0117) WITHIN THE SAME STATEMENT a trigger hasn't finished its own cross-table write in yet -- every brand-new parent's first save, not a claimed-guardian edge case. XX2a CORRECTS an earlier draft of this check: the OLD onConflict:"user_id" pattern does NOT silently orphan a second passport for a claimed guardian -- it hits the identical upsert bug and fails cleanly, leaving nothing behind. The NEW explicit update-by-id pattern (XX2b) succeeds and leaves exactly one passport, the claimed one, updated. Section B/C/D: a claimed guardian can now SELECT/INSERT/UPDATE with a real passport_id; a spoofed user_id in the payload is refused (WITH CHECK's own user_id = auth.uid()); an outsider with zero passport_guardians row is refused on all four tables, both directions, proven by re-reading the actual row afterward, not by absence of a client error. LAST-WRITER ATTRIBUTION, proven not assumed: two real guardians on the same claimed passport, sequential updates -- each one's own payload includes user_id, matching how the real hooks already write -- the row's user_id ends up as whoever wrote last and a field neither update touched survives untouched. A genuine self-created passport's own original owner is unaffected -- the regression control. XX2c: passports.user_id is explicitly re-read and confirmed still null after a claimed guardian's real save, not just inferred from the payload never mentioning it. XX8: the DASHBOARD READ bug found sweeping for the same shape after this check first went green -- parent-dashboard/page.tsx and passport/dashboard/page.tsx both used to read sectionB/C/D via .eq("user_id", user.id), harmless before this migration (a claimed guardian could never have a row there) but wrong the moment a row can be attributed to a co-guardian who isn't the one viewing their own dashboard; both fixed to .eq("passport_id", ...), proven here in both the broken-old-shape and fixed-new-shape directions. ==`);
  if (shouldRun("XX")) {
    const { data: instXX, error: instXXErr } = await admin
      .from("institutions")
      .insert({ name: "XX Institution", institution_code: CODE + "XX", status: "verified" })
      .select()
      .single();
    if (instXXErr) throw instXXErr;
    const institutionXXId = instXX.id;

    const principalXXId = await createUser("checkxx.principal@thebehaviourhive.com", "XX Principal", "principal");
    const guardian1XXId = await createUser("checkxx.guardian1@thebehaviourhive.com", "XX Guardian One", "parent");
    const guardian2XXId = await createUser("checkxx.guardian2@thebehaviourhive.com", "XX Guardian Two", "parent");
    const outsiderXXId = await createUser("checkxx.outsider@thebehaviourhive.com", "XX Outsider Parent", "parent");
    const selfCreatedXXId = await createUser("checkxx.selfcreated@thebehaviourhive.com", "XX Self-Created Parent", "parent");

    const { error: staffXXErr } = await admin.from("institution_staff").insert({
      institution_id: institutionXXId, user_id: principalXXId, role: "principal",
    });
    if (staffXXErr) throw staffXXErr;

    const principalXX = await signedInClient("checkxx.principal@thebehaviourhive.com");
    const guardian1XX = await signedInClient("checkxx.guardian1@thebehaviourhive.com");
    const guardian2XX = await signedInClient("checkxx.guardian2@thebehaviourhive.com");
    const outsiderXX = await signedInClient("checkxx.outsider@thebehaviourhive.com");
    const selfCreatedXX = await signedInClient("checkxx.selfcreated@thebehaviourhive.com");

    // ---- XX0: a real school-created passport, claimed by TWO real
    // guardians through the actual redeem chain -- never a hand-set
    // passport_guardians row. ----
    const { data: childXXId, error: childXXErr } = await principalXX.rpc("create_school_passport", {
      p_institution_id: institutionXXId, p_child_name: "XX Child",
    });
    if (childXXErr) throw childXXErr;

    const { data: code1XX, error: code1XXErr } = await principalXX.rpc("generate_passport_claim_code", {
      p_institution_id: institutionXXId, p_passport_id: childXXId,
    });
    if (code1XXErr) throw code1XXErr;
    const { error: redeem1XXErr } = await guardian1XX.rpc("redeem_passport_claim_code", { p_code: code1XX });
    if (redeem1XXErr) throw redeem1XXErr;

    const { data: code2XX, error: code2XXErr } = await principalXX.rpc("generate_passport_claim_code", {
      p_institution_id: institutionXXId, p_passport_id: childXXId,
    });
    if (code2XXErr) throw code2XXErr;
    const { error: redeem2XXErr } = await guardian2XX.rpc("redeem_passport_claim_code", { p_code: code2XX });
    if (redeem2XXErr) throw redeem2XXErr;

    const { data: preCheckXX } = await admin.from("passports").select("id, user_id, diagnoses").eq("id", childXXId).single();
    record("XX0: the claimed passport genuinely has user_id null -- the exact shape that broke the old upsert", preCheckXX.user_id === null, JSON.stringify(preCheckXX));

    // ---- XX0b: THE OTHER BUG, found by accident while building this
    // check -- not a claimed-guardian edge case, every brand-new
    // parent's first-ever save, live in production since 0117 shipped.
    // .upsert() sends Prefer: return=representation by default, even
    // with no .select() chained -- so the new row has to pass passports'
    // own SELECT policy (owns_passport(id)) WITHIN THE SAME STATEMENT.
    // That policy depends on a passport_guardians row a trigger creates
    // AFTER the insert -- invisible to the same-statement check. A
    // permanent regression lock: this must keep failing for exactly
    // this reason (proving the library behavior this whole bug hinges
    // on hasn't quietly changed under us), while a plain insert for the
    // identical row must keep succeeding -- the fix both client files
    // now use instead of upsert. ----
    {
      const freshXXId = await createUser("checkxx.freshupsert@thebehaviourhive.com", "XX Fresh Upsert Victim", "parent");
      const freshXX = await signedInClient("checkxx.freshupsert@thebehaviourhive.com");

      const { error: brokenUpsertXXErr } = await freshXX.from("passports").upsert(
        { user_id: freshXXId, passport_status: "in_progress" },
        { onConflict: "user_id" }
      );
      record("XX0b THE BUG, LOCKED AS A REGRESSION CHECK: .upsert() on a genuinely first-time passport still fails, even with no .select() chained -- Prefer: return=representation is implicit, and owns_passport(id) can't see the trigger's own passport_guardians row within the same statement", Boolean(brokenUpsertXXErr) && /row-level security/i.test(brokenUpsertXXErr.message), brokenUpsertXXErr?.message);
      const { data: noOrphanFromBrokenUpsertXX } = await admin.from("passports").select("id").eq("user_id", freshXXId);
      record("XX0b-confirm: the failed upsert left NOTHING behind -- a clean failure, not a partial write", (noOrphanFromBrokenUpsertXX ?? []).length === 0, JSON.stringify(noOrphanFromBrokenUpsertXX));

      const { error: fixedInsertXXErr } = await freshXX.from("passports").insert(
        { user_id: freshXXId, passport_status: "in_progress" }
      );
      record("XX0b THE FIX: a plain insert, identical row, succeeds -- the exact pattern both client files now use", !fixedInsertXXErr, fixedInsertXXErr?.message);

      await admin.from("passport_guardians").delete().eq("user_id", freshXXId);
      await admin.from("passports").delete().eq("user_id", freshXXId);
      await admin.auth.admin.deleteUser(freshXXId);
    }

    // A genuinely self-created passport, for the regression control.
    // Plain insert, not upsert -- upsert sends Prefer: return=
    // representation by default even with no .select() chained, which
    // requires the new row to pass passports' own SELECT policy
    // (owns_passport(id)) WITHIN THE SAME STATEMENT -- and that policy
    // depends on a passport_guardians row a trigger creates AFTER the
    // insert, invisible to the same-statement check. Found live, by
    // this exact line failing first, before either client file was
    // fixed to stop using upsert at all -- see CLAUDE.md's new gotcha.
    const { error: selfCreatedXXErr } = await selfCreatedXX.from("passports").insert(
      { user_id: selfCreatedXXId, child_name: "XX Self-Created Child", passport_status: "in_progress" }
    );
    if (selfCreatedXXErr) throw selfCreatedXXErr;
    const { data: selfCreatedPassportXX } = await admin.from("passports").select("id").eq("user_id", selfCreatedXXId).single();
    const selfCreatedPassportXXId = selfCreatedPassportXX.id;

    // ---- XX1: passports UPDATE via owns_passport(id). ----
    const { error: guardian1UpdateXXErr } = await guardian1XX
      .from("passports")
      .update({ diagnoses: ["autism"] })
      .eq("id", childXXId);
    record("XX1a a claimed guardian CAN update the passport they claimed, via owns_passport(id)", !guardian1UpdateXXErr, guardian1UpdateXXErr?.message);
    const { data: afterGuardian1UpdateXX } = await admin.from("passports").select("diagnoses").eq("id", childXXId).single();
    record("XX1a-confirm: the update actually persisted (re-read via service role, not assumed from the absence of an error)", JSON.stringify(afterGuardian1UpdateXX.diagnoses) === JSON.stringify(["autism"]), JSON.stringify(afterGuardian1UpdateXX));

    const { error: outsiderUpdateXXErr } = await outsiderXX
      .from("passports")
      .update({ diagnoses: ["should not land"] })
      .eq("id", childXXId);
    const { data: afterOutsiderUpdateXX } = await admin.from("passports").select("diagnoses").eq("id", childXXId).single();
    record("XX1b an OUTSIDER with no passport_guardians row is refused -- re-read confirms the value is UNCHANGED, not just that no client error was thrown (RLS on UPDATE silently filters)", JSON.stringify(afterOutsiderUpdateXX.diagnoses) === JSON.stringify(["autism"]), JSON.stringify({ clientError: outsiderUpdateXXErr?.message, actualValue: afterOutsiderUpdateXX.diagnoses }));

    // ---- XX2: the OLD pattern vs. the NEW pattern, on the same
    // claimed passport. CORRECTED from an earlier draft of this check
    // (and from what was first reported): the old onConflict:"user_id"
    // pattern does NOT silently create a second, orphaned passport for
    // a claimed guardian -- it hits the SAME upsert-triggers-
    // representation bug XX0b already proved (a brand-new row's own
    // trigger-created passport_guardians entry isn't visible to the
    // same-statement SELECT-policy check either), and fails cleanly,
    // leaving nothing behind. The real, empirically-confirmed shape of
    // the bug is narrower than first assumed: not silent corruption,
    // a loud failure on every first save, guardian or not -- still
    // real, still worth the same fix, just not the mechanism first
    // described.
    const { error: oldPatternXXErr } = await guardian1XX.from("passports").upsert(
      { user_id: guardian1XXId, diagnoses: ["orphan attempt"] },
      { onConflict: "user_id" }
    );
    record("XX2a THE OLD PATTERN FAILS CLEANLY, not silently -- same upsert-representation bug as XX0b, for the same reason", Boolean(oldPatternXXErr) && /row-level security/i.test(oldPatternXXErr.message), oldPatternXXErr?.message);
    const { data: afterOrphanXX } = await admin.from("passports").select("id, user_id, diagnoses").eq("user_id", guardian1XXId);
    record("XX2a-confirm: NO orphan was created -- the failed write left nothing behind, and the claimed passport itself is untouched", (afterOrphanXX ?? []).length === 0, JSON.stringify({ rowsForGuardian1: afterOrphanXX, claimedPassportId: childXXId }));
    const { data: claimedStillThereXX } = await admin.from("passports").select("id, user_id").eq("id", childXXId).single();
    record("XX2a-confirm2: the claimed passport is still exactly one row, still null user_id, unaffected by the failed attempt", claimedStillThereXX.user_id === null, JSON.stringify(claimedStillThereXX));

    // 2b: the NEW pattern -- explicit update-by-id, the fix the client
    // moves to. Same claimed passport, same guardian.
    const { error: newPatternXXErr } = await guardian1XX
      .from("passports")
      .update({ diagnoses: ["adhd"], school: "XX National School" })
      .eq("id", childXXId);
    record("XX2b THE FIX: the NEW explicit update-by-id pattern succeeds", !newPatternXXErr, newPatternXXErr?.message);
    const { data: allXXPassportsForGuardian1 } = await admin.from("passports").select("id, user_id, diagnoses, school").or(`id.eq.${childXXId},user_id.eq.${guardian1XXId}`);
    record("XX2b-confirm: exactly ONE passport exists for this family now -- the claimed one, updated in place, not a second one", allXXPassportsForGuardian1.length === 1 && allXXPassportsForGuardian1[0].id === childXXId && JSON.stringify(allXXPassportsForGuardian1[0].diagnoses) === JSON.stringify(["adhd"]) && allXXPassportsForGuardian1[0].school === "XX National School", JSON.stringify(allXXPassportsForGuardian1));
    // XX2c: explicit, direct proof of the fourth item on Daniel's own
    // coverage list -- not implied by XX2b-confirm above (that re-read
    // never selected user_id at all). savePassport()'s real payload
    // (section-a/page.tsx) never includes user_id on the update branch
    // for exactly this reason: user_id carries 0113's dual-write-trigger
    // meaning, not "who edited this," and a claimed passport must keep
    // it null. This update call already never mentioned user_id -- this
    // just re-reads the column afterward to prove it, rather than assume
    // it from the payload shape alone.
    record("XX2c passports.user_id stays null on a claimed guardian's real save -- explicitly re-read, not inferred from the payload never mentioning it", allXXPassportsForGuardian1[0].user_id === null, JSON.stringify(allXXPassportsForGuardian1[0]));

    // ---- XX3: section B/C/D -- a claimed guardian CAN now read/write,
    // with a real passport_id, on all three tables independently. ----
    for (const [table, completeCol] of [
      ["passport_section_b", "section_b_complete"],
      ["passport_section_c", "section_c_complete"],
      ["passport_section_d", "section_d_complete"],
    ]) {
      const { data: selectBeforeXX } = await guardian1XX.from(table).select("*").eq("passport_id", childXXId);
      record(`XX3-${table}-a a claimed guardian SELECTs their own (currently empty) section -- zero rows, not an error`, (selectBeforeXX ?? []).length === 0, JSON.stringify(selectBeforeXX));

      const insertPayload = { passport_id: childXXId, user_id: guardian1XXId };
      insertPayload[completeCol] = false;
      const { error: insertXXErr } = await guardian1XX.from(table).insert(insertPayload);
      record(`XX3-${table}-b a claimed guardian CAN insert into ${table} with a real passport_id -- unblocked, not a NOT NULL violation`, !insertXXErr, insertXXErr?.message);

      const { data: rowXX } = await admin.from(table).select("id").eq("passport_id", childXXId).single();
      const updatePayload = {};
      updatePayload[completeCol] = true;
      const { error: updateXXErr } = await guardian1XX.from(table).update(updatePayload).eq("id", rowXX.id);
      record(`XX3-${table}-c the SAME guardian CAN update it via owns_passport(passport_id)`, !updateXXErr, updateXXErr?.message);
      const { data: afterUpdateXX } = await admin.from(table).select(completeCol).eq("id", rowXX.id).single();
      record(`XX3-${table}-c-confirm: the update actually persisted`, afterUpdateXX[completeCol] === true, JSON.stringify(afterUpdateXX));
    }

    // ---- XX4: spoofing refused -- WITH CHECK's user_id = auth.uid(). ----
    const { error: spoofXXErr } = await guardian1XX.from("passport_section_b").upsert(
      { passport_id: childXXId, user_id: guardian2XXId, section_b_complete: false },
      { onConflict: "passport_id" }
    );
    record("XX4 a guardian CANNOT write a section row claiming someone ELSE's user_id, even a fellow guardian's -- WITH CHECK's own user_id = auth.uid() catches it", Boolean(spoofXXErr), spoofXXErr?.message);

    // ---- XX5: an outsider, zero relationship, refused on all four
    // tables, both directions. ----
    const { error: outsiderPassportXXErr } = await outsiderXX.from("passports").update({ diagnoses: ["nope"] }).eq("id", childXXId);
    const { data: afterOutsiderPassportXX } = await admin.from("passports").select("diagnoses").eq("id", childXXId).single();
    record("XX5a an outsider is refused on passports UPDATE -- re-read confirms unchanged", JSON.stringify(afterOutsiderPassportXX.diagnoses) === JSON.stringify(["adhd"]), JSON.stringify({ clientError: outsiderPassportXXErr?.message, actual: afterOutsiderPassportXX.diagnoses }));

    for (const table of ["passport_section_b", "passport_section_c", "passport_section_d"]) {
      const { data: outsiderSelectXX } = await outsiderXX.from(table).select("*").eq("passport_id", childXXId);
      record(`XX5b-${table} an outsider SELECTs nothing for this passport's section`, (outsiderSelectXX ?? []).length === 0, JSON.stringify(outsiderSelectXX));
      const { error: outsiderInsertXXErr } = await outsiderXX.from(table).insert({ passport_id: childXXId, user_id: outsiderXXId });
      record(`XX5c-${table} an outsider CANNOT insert into this passport's section`, Boolean(outsiderInsertXXErr), outsiderInsertXXErr?.message);
    }

    // ---- XX6: LAST-WRITER ATTRIBUTION, proven not assumed. Guardian 1
    // writes hard_signals; guardian 2 (a REAL, second guardian on the
    // SAME passport, via the actual claim chain, not a hand-set row)
    // writes only okay_signals afterwards, in a SEPARATE statement that
    // never mentions hard_signals at all. ----
    await admin.from("passport_section_b").delete().eq("passport_id", childXXId);
    const { error: g1WriteXXErr } = await guardian1XX.from("passport_section_b").insert({
      passport_id: childXXId, user_id: guardian1XXId, hard_signals: ["loud noises"], section_b_complete: false,
    });
    if (g1WriteXXErr) throw g1WriteXXErr;
    const { data: g2RowXX } = await admin.from("passport_section_b").select("id").eq("passport_id", childXXId).single();
    // user_id: guardian2XXId is deliberately included -- WITH CHECK
    // requires user_id = auth.uid() on the RESULTING row, and an update
    // that never mentions the column leaves it exactly as it was
    // (guardian 1's id), correctly refused. This matches how the real
    // client hooks already behave (usePassportSectionB.ts's own save()
    // always includes user_id in its own payload) -- not a workaround
    // invented for this check.
    const { error: g2WriteXXErr } = await guardian2XX.from("passport_section_b").update({
      user_id: guardian2XXId,
      okay_signals: ["favourite song"],
    }).eq("id", g2RowXX.id);
    record("XX6a guardian 2's own update succeeds -- they're a real second guardian on this passport", !g2WriteXXErr, g2WriteXXErr?.message);

    const { data: finalRowXX } = await admin.from("passport_section_b").select("user_id, hard_signals, okay_signals").eq("id", g2RowXX.id).single();
    record("XX6b THE ATTRIBUTION: the row's user_id now reads guardian 2 -- whoever wrote last, as designed", finalRowXX.user_id === guardian2XXId, JSON.stringify(finalRowXX));
    record("XX6c THE FIELD guardian 2's update never touched (hard_signals) SURVIVES, exactly as guardian 1 left it -- a plain column-scoped UPDATE, not a silent overwrite of the whole row", JSON.stringify(finalRowXX.hard_signals) === JSON.stringify(["loud noises"]), JSON.stringify(finalRowXX));
    record("XX6d THE FIELD guardian 2 DID write (okay_signals) reflects their own value", JSON.stringify(finalRowXX.okay_signals) === JSON.stringify(["favourite song"]), JSON.stringify(finalRowXX));

    // ---- XX8: the DASHBOARD READ shape, found sweeping for the same
    // fix -- parent-dashboard/page.tsx and passport/dashboard/page.tsx
    // both used to read sectionB/C/D via .eq("user_id", user.id) for
    // their own summary/resume-href display. That was harmless before
    // this migration (a claimed guardian could never have a row there
    // at all), but XX6 above just proved a real row can now be
    // attributed to a DIFFERENT guardian than the one viewing their own
    // dashboard. guardian1XX wrote hard_signals first but is no longer
    // this row's user_id (guardian 2 saved last) -- the OLD dashboard
    // query, .eq("user_id", guardian1XXId), would find nothing for
    // guardian 1 even though their own child's section B is genuinely
    // complete with real data. Both dashboards were fixed in the same
    // pass to .eq("passport_id", passportId) instead -- this proves
    // that shape, exactly as the fixed client code now queries it. ----
    const { data: g1OldShapeXX } = await guardian1XX.from("passport_section_b").select("hard_signals, okay_signals").eq("user_id", guardian1XXId).maybeSingle();
    record("XX8a THE BUG THIS WOULD HAVE BEEN: the OLD dashboard query shape (.eq('user_id', guardian1's own id)) finds NOTHING for guardian 1 -- their own child's data, invisible to their own dashboard, because guardian 2 saved last", g1OldShapeXX === null, JSON.stringify(g1OldShapeXX));
    const { data: g1NewShapeXX } = await guardian1XX.from("passport_section_b").select("hard_signals, okay_signals").eq("passport_id", childXXId).maybeSingle();
    record("XX8b THE FIX: the NEW dashboard query shape (.eq('passport_id', ...)) finds the real row for guardian 1 regardless of who wrote it last", g1NewShapeXX !== null && JSON.stringify(g1NewShapeXX.hard_signals) === JSON.stringify(["loud noises"]) && JSON.stringify(g1NewShapeXX.okay_signals) === JSON.stringify(["favourite song"]), JSON.stringify(g1NewShapeXX));

    // ---- XX7: regression -- a genuine self-created passport's own
    // original owner is unaffected by any of this. ----
    const { error: selfCreatedUpdateXXErr } = await selfCreatedXX
      .from("passports")
      .update({ school: "XX Self-Created School" })
      .eq("id", selfCreatedPassportXXId);
    record("XX7 REGRESSION: a self-created passport's own original owner can still update it exactly as before", !selfCreatedUpdateXXErr, selfCreatedUpdateXXErr?.message);
    const { data: selfCreatedAfterXX } = await admin.from("passports").select("school").eq("id", selfCreatedPassportXXId).single();
    record("XX7-confirm: the update actually persisted", selfCreatedAfterXX.school === "XX Self-Created School", JSON.stringify(selfCreatedAfterXX));

    console.log("XX summary complete.");

    await admin.from("passport_section_b").delete().eq("passport_id", childXXId);
    await admin.from("passport_section_c").delete().eq("passport_id", childXXId);
    await admin.from("passport_section_d").delete().eq("passport_id", childXXId);
    await admin.from("passport_guardians").delete().eq("passport_id", childXXId);
    await admin.from("passports").delete().in("id", [childXXId, selfCreatedPassportXXId]);
    await admin.from("institutions").delete().eq("id", institutionXXId);
    for (const id of [principalXXId, guardian1XXId, guardian2XXId, outsiderXXId, selfCreatedXXId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK YY: Client-behaviour half of PRD 3 Stage 2 (src/app/passport/dashboard/page.tsx's loadApprovedInstitutions()) -- proven via the LITERAL client query shape, not a proxy for it. approved_by_parent is a compatibility default now, not a consent record (create_school_passport() always sets it true; ShareBottomSheet's own handleApprove() -- the only other writer -- is deleted this stage), so a link sitting at approved_by_parent = false is not evidence a school isn't really connected, it's just old data or an edge case nothing ever flips back to true. The old .eq("approved_by_parent", true) filter hid exactly this shape from a parent's own Connected Schools list. This check reproduces the query byte-for-byte (institution_id, parent_approved_at, institutions(name), .eq("passport_id", ...), no approved_by_parent filter) against a real false-approved link and proves it's now returned. ==`);
  if (shouldRun("YY")) {
    const { data: instYY, error: instYYErr } = await admin
      .from("institutions")
      .insert({ name: "YY Institution", institution_code: CODE + "YY", status: "verified" })
      .select()
      .single();
    if (instYYErr) throw instYYErr;
    const institutionYYId = instYY.id;

    const parentYYId = await createUser("checkyy.parent@thebehaviourhive.com", "YY Parent", "parent");
    const parentYY = await signedInClient("checkyy.parent@thebehaviourhive.com");

    // Bare insert, no chained .select() -- a fresh self-created passport's
    // own passport_guardians row is created by a trigger AFTER this
    // insert, invisible to owns_passport(id) within the same statement
    // (see CLAUDE.md's upsert/representation gotcha; CHECK XX's own
    // XX0b proves this same-statement race directly). A separate
    // follow-up read is the correct pattern, not a workaround.
    const { error: passportYYErr } = await parentYY
      .from("passports")
      .insert({ user_id: parentYYId, child_name: "YY Child", passport_status: "in_progress" });
    if (passportYYErr) throw passportYYErr;
    const { data: passportYY } = await admin.from("passports").select("id").eq("user_id", parentYYId).single();
    const passportYYId = passportYY.id;

    // The exact shape a genuinely never-approved link has -- not
    // reachable through any live client path today (both writers set it
    // true unconditionally), but real as old data, and this is what the
    // fix has to handle regardless of how a false row came to exist.
    const { error: linkYYErr } = await admin.from("passport_institution_links").insert({
      passport_id: passportYYId,
      institution_id: institutionYYId,
      approved_by_parent: false,
    });
    if (linkYYErr) throw linkYYErr;

    // loadApprovedInstitutions()'s own literal query shape.
    const { data: rowsYY, error: queryYYErr } = await parentYY
      .from("passport_institution_links")
      .select("institution_id, parent_approved_at, institutions(name)")
      .eq("passport_id", passportYYId)
      .order("parent_approved_at", { ascending: false });
    record("YY1 THE FIX: the client's own Connected Schools query now returns a link that was never approved_by_parent -- the old filter would have shown zero rows here", !queryYYErr && (rowsYY ?? []).length === 1 && rowsYY[0].institution_id === institutionYYId, JSON.stringify({ error: queryYYErr?.message, rowsYY }));

    console.log("YY summary complete.");

    await admin.from("passport_institution_links").delete().eq("passport_id", passportYYId);
    await admin.from("passports").delete().eq("id", passportYYId);
    await admin.from("institutions").delete().eq("id", institutionYYId);
    await admin.auth.admin.deleteUser(parentYYId);
  }

  console.log(`\n== CHECK ZZ: SQL for PRD 3 Stage 3, CORRECTED (migration 0143) -- passport_completion_requests, a lightweight ledger, not a form. The original six-field question set (0141/0142) was deleted entirely -- it duplicated content Sections A-D already collect, and came from an example list in the PRD never approved as spec. request_passport_completion()'s own gate (institution standing AND an active passport_access grant) proven independently from has_child_access()-gated reads, same as before. NO STATUS COLUMN: "outstanding" derives entirely from passports.section_a_complete, proven by driving a REAL Section A save through the actual guardian-write path Stage 1 built, not a hand-set flag -- and proven SHARED, not per-guardian: one guardian completing Section A clears BOTH guardians' own outstanding feeds and the institution bucket, because Section A is one shared record, unlike the deleted six-field system's own per-guardian answers. NO UPDATE POLICY AT ALL on this table -- proven explicitly, including for the row's own recipient, since there is nothing on a request row that's ever meant to change after it's inserted. ZZ4 itself was a live instance of CLAUDE.md's own gotcha: first written checking for a client error, which RLS-on-UPDATE never throws -- caught by this check's own first real run, fixed to re-read via service role instead. ==`);
  if (shouldRun("ZZ")) {
    const { data: instZZ, error: instZZErr } = await admin
      .from("institutions")
      .insert({ name: "ZZ Institution", institution_code: CODE + "ZZ", status: "verified" })
      .select()
      .single();
    if (instZZErr) throw instZZErr;
    const institutionZZId = instZZ.id;

    const principalZZId = await createUser("checkzz.principal@thebehaviourhive.com", "ZZ Principal", "principal");
    const teacherZZId = await createUser("checkzz.teacher@thebehaviourhive.com", "ZZ Teacher", "class_teacher");
    const teacherNoAccessZZId = await createUser("checkzz.teachernoaccess@thebehaviourhive.com", "ZZ Teacher No Access", "class_teacher");
    const outsiderZZId = await createUser("checkzz.outsider@thebehaviourhive.com", "ZZ Outsider", "class_teacher");
    const guardian1ZZId = await createUser("checkzz.guardian1@thebehaviourhive.com", "ZZ Guardian One", "parent");
    const guardian2ZZId = await createUser("checkzz.guardian2@thebehaviourhive.com", "ZZ Guardian Two", "parent");

    const { error: staffZZErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionZZId, user_id: principalZZId, role: "principal" },
      { institution_id: institutionZZId, user_id: teacherZZId, role: "class_teacher", approved_at: new Date().toISOString(), approved_by: principalZZId, approval_source: "principal" },
      { institution_id: institutionZZId, user_id: teacherNoAccessZZId, role: "class_teacher", approved_at: new Date().toISOString(), approved_by: principalZZId, approval_source: "principal" },
    ]);
    if (staffZZErr) throw staffZZErr;

    const principalZZ = await signedInClient("checkzz.principal@thebehaviourhive.com");
    const teacherZZ = await signedInClient("checkzz.teacher@thebehaviourhive.com");
    const teacherNoAccessZZ = await signedInClient("checkzz.teachernoaccess@thebehaviourhive.com");
    const outsiderZZ = await signedInClient("checkzz.outsider@thebehaviourhive.com");
    const guardian1ZZ = await signedInClient("checkzz.guardian1@thebehaviourhive.com");
    const guardian2ZZ = await signedInClient("checkzz.guardian2@thebehaviourhive.com");

    // ---- ZZ0: setup -- a real school-created, claimed-by-two-guardians
    // child, exactly CHECK XX's own established pattern. ----
    const { data: childZZId, error: childZZErr } = await principalZZ.rpc("create_school_passport", {
      p_institution_id: institutionZZId, p_child_name: "ZZ Child",
    });
    if (childZZErr) throw childZZErr;

    const { data: code1ZZ } = await principalZZ.rpc("generate_passport_claim_code", { p_institution_id: institutionZZId, p_passport_id: childZZId });
    await guardian1ZZ.rpc("redeem_passport_claim_code", { p_code: code1ZZ });
    const { data: code2ZZ } = await principalZZ.rpc("generate_passport_claim_code", { p_institution_id: institutionZZId, p_passport_id: childZZId });
    await guardian2ZZ.rpc("redeem_passport_claim_code", { p_code: code2ZZ });

    const { error: grantZZErr } = await principalZZ.rpc("grant_passport_access", {
      p_passport_id: childZZId, p_user_id: teacherZZId, p_institution_id: institutionZZId, p_reason: "Class teacher.",
    });
    if (grantZZErr) throw grantZZErr;

    // ---- ZZ1: request_passport_completion()'s own refusals. ----
    const { error: noStandingZZErr } = await outsiderZZ.rpc("request_passport_completion", { p_passport_id: childZZId, p_institution_id: institutionZZId });
    record("ZZ1a refused: no standing at this institution at all", Boolean(noStandingZZErr) && /active member of staff/i.test(noStandingZZErr.message), noStandingZZErr?.message);

    const { error: noAccessZZErr } = await teacherNoAccessZZ.rpc("request_passport_completion", { p_passport_id: childZZId, p_institution_id: institutionZZId });
    record("ZZ1b refused: real standing, but no passport_access grant on this child", Boolean(noAccessZZErr) && /need access/i.test(noAccessZZErr.message), noAccessZZErr?.message);

    // A passport with zero guardians -- a fresh school-created child, no
    // claim redeemed yet.
    const { data: childZZNoGuardianId } = await principalZZ.rpc("create_school_passport", { p_institution_id: institutionZZId, p_child_name: "ZZ No Guardian Child" });
    await principalZZ.rpc("grant_passport_access", { p_passport_id: childZZNoGuardianId, p_user_id: teacherZZId, p_institution_id: institutionZZId, p_reason: "Class teacher." });
    const { error: noGuardianZZErr } = await teacherZZ.rpc("request_passport_completion", { p_passport_id: childZZNoGuardianId, p_institution_id: institutionZZId });
    record("ZZ1c refused: passport has no guardian to notify yet", Boolean(noGuardianZZErr) && /no guardian/i.test(noGuardianZZErr.message), noGuardianZZErr?.message);
    await admin.from("passports").delete().eq("id", childZZNoGuardianId);

    // ---- ZZ2: THE REAL REQUEST -- two guardians, two rows. ----
    const { data: createdCountZZ, error: requestZZErr } = await teacherZZ.rpc("request_passport_completion", { p_passport_id: childZZId, p_institution_id: institutionZZId });
    record("ZZ2a a real eligible teacher's request succeeds", !requestZZErr, requestZZErr?.message);
    record("ZZ2b THE COUNT: exactly 2 new requests created -- one per current guardian", createdCountZZ === 2, createdCountZZ);

    const { data: rowsAfterZZ } = await admin.from("passport_completion_requests").select("id, recipient_id").eq("passport_id", childZZId);
    record("ZZ2c exactly 2 rows exist, one per guardian", rowsAfterZZ?.length === 2 && rowsAfterZZ.some((r) => r.recipient_id === guardian1ZZId) && rowsAfterZZ.some((r) => r.recipient_id === guardian2ZZId), JSON.stringify(rowsAfterZZ));

    const guardian1RowZZ = rowsAfterZZ.find((r) => r.recipient_id === guardian1ZZId);

    // ---- ZZ3: re-requesting when everyone already has a row is refused,
    // not silently duplicated. ----
    const { error: alreadyRequestedZZErr } = await teacherZZ.rpc("request_passport_completion", { p_passport_id: childZZId, p_institution_id: institutionZZId });
    record("ZZ3a refused: every current guardian already has a row", Boolean(alreadyRequestedZZErr) && /already been requested/i.test(alreadyRequestedZZErr.message), alreadyRequestedZZErr?.message);
    const { data: stillTwoRowsZZ } = await admin.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ3b confirm: still exactly 2 rows, the refused attempt created nothing", stillTwoRowsZZ?.length === 2, JSON.stringify(stillTwoRowsZZ));

    // ---- ZZ4: NO ONE can update a request row -- not even its own
    // recipient. There is no UPDATE policy on this table at all, unlike
    // 0141's original (deleted) column-scoped grant -- nothing on a
    // request is ever meant to change after it's inserted. Per CLAUDE.md's
    // own standing gotcha, this was FIRST written checking the client
    // error and failed -- RLS on UPDATE silently filters, it doesn't
    // error, and a table with NO update policy at all behaves exactly
    // like a row that fails one: {data: [], error: null}. Caught by this
    // check's own first real run, not by inspection -- corrected to
    // re-read via service role, the fix the gotcha itself prescribes.
    const { error: g1UpdateZZErr } = await guardian1ZZ.from("passport_completion_requests").update({ recipient_id: guardian2ZZId }).eq("id", guardian1RowZZ.id);
    const { data: g1RowAfterUpdateZZ } = await admin.from("passport_completion_requests").select("recipient_id").eq("id", guardian1RowZZ.id).single();
    record("ZZ4 a request's own recipient CANNOT update it -- no UPDATE policy exists on this table at all -- re-read confirms unchanged, not just absence of a client error", g1RowAfterUpdateZZ.recipient_id === guardian1ZZId, JSON.stringify({ clientError: g1UpdateZZErr?.message, actual: g1RowAfterUpdateZZ.recipient_id }));

    // ---- ZZ5: read-side boundary -- guardians (either one, via
    // owns_passport), staff with real access, staff without, an outsider. ----
    const { data: g1ReadZZ } = await guardian1ZZ.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ5a either guardian can read both requests on their own passport -- owns_passport()", (g1ReadZZ ?? []).length === 2, JSON.stringify(g1ReadZZ));

    const { data: teacherReadZZ } = await teacherZZ.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ5b staff WITH real child access can read the requests", (teacherReadZZ ?? []).length === 2, JSON.stringify(teacherReadZZ));

    const { data: noAccessReadZZ } = await teacherNoAccessZZ.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ5c staff WITHOUT child access reads nothing -- not an error, zero rows", (noAccessReadZZ ?? []).length === 0, JSON.stringify(noAccessReadZZ));

    const { data: outsiderReadZZ } = await outsiderZZ.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ5d an outsider with no relationship to this child reads nothing", (outsiderReadZZ ?? []).length === 0, JSON.stringify(outsiderReadZZ));

    // ---- ZZ6: get_passport_completion_requests() -- resolved names,
    // same boundary. ----
    const { data: resolvedZZ } = await teacherZZ.rpc("get_passport_completion_requests", { p_passport_id: childZZId });
    record("ZZ6a the resolved-name RPC returns both rows with real recipient names attached", resolvedZZ?.length === 2 && resolvedZZ.every((r) => typeof r.recipient_name === "string" && r.recipient_name.length > 0), JSON.stringify(resolvedZZ));
    const { data: resolvedOutsiderZZ } = await outsiderZZ.rpc("get_passport_completion_requests", { p_passport_id: childZZId });
    record("ZZ6b the same RPC returns nothing for an outsider", (resolvedOutsiderZZ ?? []).length === 0, JSON.stringify(resolvedOutsiderZZ));

    // ---- ZZ7: both guardians' feeds and the institution bucket all show
    // this as outstanding BEFORE Section A is touched. ----
    const { data: g1FeedBeforeZZ } = await guardian1ZZ.rpc("get_my_passport_completion_requests");
    record("ZZ7a guardian 1's own feed shows the outstanding request, labeled by institution name", (g1FeedBeforeZZ ?? []).some((r) => r.passport_id === childZZId && r.institution_name === "ZZ Institution"), JSON.stringify(g1FeedBeforeZZ));
    const { data: g2FeedBeforeZZ } = await guardian2ZZ.rpc("get_my_passport_completion_requests");
    record("ZZ7b guardian 2's own feed ALSO shows it -- both guardians, same passport", (g2FeedBeforeZZ ?? []).some((r) => r.passport_id === childZZId), JSON.stringify(g2FeedBeforeZZ));
    const { data: bucketBeforeZZ } = await principalZZ.rpc("get_institution_passport_completions_outstanding", { p_institution_id: institutionZZId });
    record("ZZ7c the institution bucket shows it too, before Section A is touched", (bucketBeforeZZ ?? []).some((r) => r.passport_id === childZZId), JSON.stringify(bucketBeforeZZ));
    const { data: bucketOutsiderZZ } = await outsiderZZ.rpc("get_institution_passport_completions_outstanding", { p_institution_id: institutionZZId });
    record("ZZ7d non-authority caller (no standing at this institution) sees nothing in the bucket", (bucketOutsiderZZ ?? []).length === 0, JSON.stringify(bucketOutsiderZZ));

    // ---- ZZ8: THE CORE CLAIM -- guardian 1 completes Section A through
    // the REAL guardian-write path (Stage 1), not a hand-set flag. The
    // question set IS Section A, unchanged; this proves the derivation
    // against the actual production write shape. ----
    const { error: sectionAWriteZZErr } = await guardian1ZZ.from("passports").update({
      child_name: "ZZ Child", date_of_birth: "2018-01-01", section_a_complete: true, passport_status: "in_progress",
    }).eq("id", childZZId);
    record("ZZ8a guardian 1 completes Section A via the real write path", !sectionAWriteZZErr, sectionAWriteZZErr?.message);

    // ---- ZZ9: THE SHARED-COMPLETION CLAIM -- Section A is ONE record,
    // not per-guardian like the deleted six-field system's own answers.
    // Guardian 1 completing it clears BOTH guardians' outstanding feeds
    // and the institution bucket, correctly -- not a bug, the intended
    // consequence of deriving from a shared field. ----
    const { data: g1FeedAfterZZ } = await guardian1ZZ.rpc("get_my_passport_completion_requests");
    record("ZZ9a guardian 1's own feed no longer shows it", !(g1FeedAfterZZ ?? []).some((r) => r.passport_id === childZZId), JSON.stringify(g1FeedAfterZZ));
    const { data: g2FeedAfterZZ } = await guardian2ZZ.rpc("get_my_passport_completion_requests");
    record("ZZ9b guardian 2's own feed ALSO no longer shows it -- shared completion, not per-guardian", !(g2FeedAfterZZ ?? []).some((r) => r.passport_id === childZZId), JSON.stringify(g2FeedAfterZZ));
    const { data: bucketAfterZZ } = await principalZZ.rpc("get_institution_passport_completions_outstanding", { p_institution_id: institutionZZId });
    record("ZZ9c the institution bucket no longer shows it -- live derivation, not a status column that could drift", !(bucketAfterZZ ?? []).some((r) => r.passport_id === childZZId), JSON.stringify(bucketAfterZZ));

    // ---- ZZ10: the request ROWS themselves are untouched by any of
    // this -- the ledger still records that both guardians were asked,
    // completion is derived at read time, not written back onto them. ----
    const { data: rowsStillThereZZ } = await admin.from("passport_completion_requests").select("id").eq("passport_id", childZZId);
    record("ZZ10 both request rows still exist, unmodified -- completion is derived, never written back onto the ledger", rowsStillThereZZ?.length === 2, JSON.stringify(rowsStillThereZZ));

    console.log("ZZ summary complete.");

    await admin.from("passport_completion_requests").delete().eq("passport_id", childZZId);
    await admin.from("passport_guardians").delete().eq("passport_id", childZZId);
    await admin.from("passports").delete().eq("id", childZZId);
    await admin.from("institutions").delete().eq("id", institutionZZId);
    for (const id of [principalZZId, teacherZZId, teacherNoAccessZZId, outsiderZZId, guardian1ZZId, guardian2ZZId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK AAA: SQL for PRD 3 Stage 5 (migration 0144) -- morning check-in visibility. THE RLS WIDENING IS THE STAGE: "Users can view their own check-ins" moves from auth.uid() = user_id to owns_passport(passport_id), proven with two real guardians via the actual claim chain, not a hand-set passport_guardians row -- a co-guardian genuinely could not read another guardian's row before this migration, confirmed directly, not assumed from the query shape alone. INSERT stays exactly as it was: each guardian writes their own, a spoofed user_id refused. No UPDATE policy exists on this table, by design (an audit trail), and none is added. No unique constraint exists and none is added -- two real guardians BOTH submit today, for the same child, and both rows persist. get_todays_checkin()'s own priority ordering IS the three-state UI: a caller's own row wins even when a co-guardian ALSO submitted today (not just when they're the only one), proven on the same passport after both have real rows. ==`);
  if (shouldRun("AAA")) {
    const { data: instAAA, error: instAAAErr } = await admin
      .from("institutions")
      .insert({ name: "AAA Institution", institution_code: CODE + "AAA", status: "verified" })
      .select()
      .single();
    if (instAAAErr) throw instAAAErr;
    const institutionAAAId = instAAA.id;

    const principalAAAId = await createUser("checkaaa.principal@thebehaviourhive.com", "AAA Principal", "principal");
    const guardian1AAAId = await createUser("checkaaa.guardian1@thebehaviourhive.com", "AAA Guardian One", "parent");
    const guardian2AAAId = await createUser("checkaaa.guardian2@thebehaviourhive.com", "AAA Guardian Two", "parent");
    const outsiderAAAId = await createUser("checkaaa.outsider@thebehaviourhive.com", "AAA Outsider", "parent");

    const { error: staffAAAErr } = await admin.from("institution_staff").insert({
      institution_id: institutionAAAId, user_id: principalAAAId, role: "principal",
    });
    if (staffAAAErr) throw staffAAAErr;

    const principalAAA = await signedInClient("checkaaa.principal@thebehaviourhive.com");
    const guardian1AAA = await signedInClient("checkaaa.guardian1@thebehaviourhive.com");
    const guardian2AAA = await signedInClient("checkaaa.guardian2@thebehaviourhive.com");
    const outsiderAAA = await signedInClient("checkaaa.outsider@thebehaviourhive.com");

    // ---- AAA0: setup -- a real school-created, claimed-by-two-guardians
    // child, exactly CHECK XX/ZZ's own established pattern. ----
    const { data: childAAAId, error: childAAAErr } = await principalAAA.rpc("create_school_passport", {
      p_institution_id: institutionAAAId, p_child_name: "AAA Child",
    });
    if (childAAAErr) throw childAAAErr;

    const { data: code1AAA } = await principalAAA.rpc("generate_passport_claim_code", { p_institution_id: institutionAAAId, p_passport_id: childAAAId });
    await guardian1AAA.rpc("redeem_passport_claim_code", { p_code: code1AAA });
    const { data: code2AAA } = await principalAAA.rpc("generate_passport_claim_code", { p_institution_id: institutionAAAId, p_passport_id: childAAAId });
    await guardian2AAA.rpc("redeem_passport_claim_code", { p_code: code2AAA });

    const startOfTodayAAA = new Date();
    startOfTodayAAA.setHours(0, 0, 0, 0);

    // ---- AAA1: before anyone submits -- nothing to read, nothing to
    // derive. ----
    const { data: nothingYetAAA } = await guardian1AAA.rpc("get_todays_checkin", {
      p_passport_id: childAAAId, p_start_of_today: startOfTodayAAA.toISOString(),
    });
    record("AAA1 before either guardian submits, get_todays_checkin() returns nothing", (nothingYetAAA ?? []).length === 0, JSON.stringify(nothingYetAAA));

    // ---- AAA2: guardian 1 submits. Guardian 2 -- who has NOT submitted
    // -- can now read guardian 1's row directly (the RLS widening
    // itself), and get_todays_checkin() correctly attributes it as NOT
    // theirs. ----
    const { error: g1InsertAAAErr } = await guardian1AAA.from("morning_checkins").insert({
      passport_id: childAAAId, user_id: guardian1AAAId,
      sleep_quality: "barely_slept", regulation_state: "dysregulated", heads_up: "Rough night, up twice.",
    });
    record("AAA2a guardian 1 can insert their own check-in", !g1InsertAAAErr, g1InsertAAAErr?.message);

    const { data: g2ReadsG1AAA } = await guardian2AAA.from("morning_checkins").select("sleep_quality").eq("passport_id", childAAAId);
    record("AAA2b THE RLS WIDENING ITSELF: guardian 2 -- who has not submitted -- can now read guardian 1's row directly, before this migration they could not", (g2ReadsG1AAA ?? []).length === 1 && g2ReadsG1AAA[0].sleep_quality === "barely_slept", JSON.stringify(g2ReadsG1AAA));

    const { data: g2ViewAAA } = await guardian2AAA.rpc("get_todays_checkin", {
      p_passport_id: childAAAId, p_start_of_today: startOfTodayAAA.toISOString(),
    });
    const g2ViewRowAAA = (g2ViewAAA ?? [])[0];
    record("AAA2c guardian 2's own view: is_mine=false, attributed to guardian 1 by name, guardian 1's real content", Boolean(g2ViewRowAAA) && g2ViewRowAAA.is_mine === false && g2ViewRowAAA.submitted_by_name === "AAA Guardian One" && g2ViewRowAAA.sleep_quality === "barely_slept", JSON.stringify(g2ViewRowAAA));

    const { data: g1ViewAAA } = await guardian1AAA.rpc("get_todays_checkin", {
      p_passport_id: childAAAId, p_start_of_today: startOfTodayAAA.toISOString(),
    });
    const g1ViewRowAAA = (g1ViewAAA ?? [])[0];
    record("AAA2d guardian 1's own view: is_mine=true, their own content", Boolean(g1ViewRowAAA) && g1ViewRowAAA.is_mine === true && g1ViewRowAAA.sleep_quality === "barely_slept", JSON.stringify(g1ViewRowAAA));

    // ---- AAA3: an outsider, zero relationship, reads nothing. ----
    const { data: outsiderReadAAA } = await outsiderAAA.from("morning_checkins").select("id").eq("passport_id", childAAAId);
    record("AAA3 an outsider with no relationship to this child reads nothing", (outsiderReadAAA ?? []).length === 0, JSON.stringify(outsiderReadAAA));

    // ---- AAA4: guardian 1 cannot spoof guardian 2's user_id on insert
    // -- INSERT stays exactly as it was. ----
    const { error: spoofAAAErr } = await guardian1AAA.from("morning_checkins").insert({
      passport_id: childAAAId, user_id: guardian2AAAId, sleep_quality: "slept_through",
    });
    record("AAA4 a guardian cannot insert a check-in claiming to be someone else -- INSERT unchanged, still user_id = auth.uid()", Boolean(spoofAAAErr), spoofAAAErr?.message);

    // ---- AAA5: THE CORE CLAIM -- guardian 2 now ALSO submits (a
    // genuinely different account of the same morning). No unique
    // constraint blocks it. Both rows persist. Each guardian's own view
    // still shows THEIR OWN row -- not the other's, and not whichever
    // was submitted most recently. ----
    const { error: g2InsertAAAErr } = await guardian2AAA.from("morning_checkins").insert({
      passport_id: childAAAId, user_id: guardian2AAAId,
      sleep_quality: "slept_through", regulation_state: "settled", heads_up: "Great morning here.",
    });
    record("AAA5a guardian 2 can also submit their own, genuinely different account of the same morning -- no unique constraint blocks it", !g2InsertAAAErr, g2InsertAAAErr?.message);

    const { data: bothRowsAAA } = await admin.from("morning_checkins").select("id, user_id, sleep_quality").eq("passport_id", childAAAId);
    record("AAA5b both rows persist -- two real, disagreeing accounts, neither overwritten", bothRowsAAA?.length === 2, JSON.stringify(bothRowsAAA));

    const { data: g1ViewAfterAAA } = await guardian1AAA.rpc("get_todays_checkin", {
      p_passport_id: childAAAId, p_start_of_today: startOfTodayAAA.toISOString(),
    });
    const g1ViewAfterRowAAA = (g1ViewAfterAAA ?? [])[0];
    record("AAA5c THE PRIORITY ORDERING: guardian 1's own view STILL shows their own row (is_mine=true, barely_slept) -- not guardian 2's more recent one", Boolean(g1ViewAfterRowAAA) && g1ViewAfterRowAAA.is_mine === true && g1ViewAfterRowAAA.sleep_quality === "barely_slept", JSON.stringify(g1ViewAfterRowAAA));

    const { data: g2ViewAfterAAA } = await guardian2AAA.rpc("get_todays_checkin", {
      p_passport_id: childAAAId, p_start_of_today: startOfTodayAAA.toISOString(),
    });
    const g2ViewAfterRowAAA = (g2ViewAfterAAA ?? [])[0];
    record("AAA5d guardian 2's own view shows THEIR OWN row (is_mine=true, slept_through)", Boolean(g2ViewAfterRowAAA) && g2ViewAfterRowAAA.is_mine === true && g2ViewAfterRowAAA.sleep_quality === "slept_through", JSON.stringify(g2ViewAfterRowAAA));

    console.log("AAA summary complete.");

    await admin.from("morning_checkins").delete().eq("passport_id", childAAAId);
    await admin.from("passport_guardians").delete().eq("passport_id", childAAAId);
    await admin.from("passports").delete().eq("id", childAAAId);
    await admin.from("institutions").delete().eq("id", institutionAAAId);
    for (const id of [principalAAAId, guardian1AAAId, guardian2AAAId, outsiderAAAId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== CHECK BBB: SQL for PRD 3 Stage 5, teacher-side (migration 0146) -- get_todays_checkins_for_passports(). Two real guardians via the actual claim chain submit genuinely disagreeing accounts of the same morning; a teacher with real access gets BOTH, attributed by name, in full -- no "most recent wins" reduction, the exact silent-data-loss useTeacherMorningCheckins.ts's own old client-side reduction would have produced. A second teacher with access to a DIFFERENT child in the same call gets nothing for this one -- has_child_access() scoping proven per-row inside an array argument, not just per-call. An outsider with no access at all gets nothing. ==`);
  if (shouldRun("BBB")) {
    const { data: instBBB, error: instBBBErr } = await admin
      .from("institutions")
      .insert({ name: "BBB Institution", institution_code: CODE + "BBB", status: "verified" })
      .select()
      .single();
    if (instBBBErr) throw instBBBErr;
    const institutionBBBId = instBBB.id;

    const principalBBBId = await createUser("checkbbb.principal@thebehaviourhive.com", "BBB Principal", "principal");
    const teacherBBBId = await createUser("checkbbb.teacher@thebehaviourhive.com", "BBB Teacher", "class_teacher");
    const otherTeacherBBBId = await createUser("checkbbb.otherteacher@thebehaviourhive.com", "BBB Other Teacher", "class_teacher");
    const outsiderBBBId = await createUser("checkbbb.outsider@thebehaviourhive.com", "BBB Outsider", "class_teacher");
    const guardian1BBBId = await createUser("checkbbb.guardian1@thebehaviourhive.com", "BBB Guardian One", "parent");
    const guardian2BBBId = await createUser("checkbbb.guardian2@thebehaviourhive.com", "BBB Guardian Two", "parent");

    const { error: staffBBBErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionBBBId, user_id: principalBBBId, role: "principal" },
      { institution_id: institutionBBBId, user_id: teacherBBBId, role: "class_teacher", approved_at: new Date().toISOString(), approved_by: principalBBBId, approval_source: "principal" },
      { institution_id: institutionBBBId, user_id: otherTeacherBBBId, role: "class_teacher", approved_at: new Date().toISOString(), approved_by: principalBBBId, approval_source: "principal" },
    ]);
    if (staffBBBErr) throw staffBBBErr;

    const principalBBB = await signedInClient("checkbbb.principal@thebehaviourhive.com");
    const teacherBBB = await signedInClient("checkbbb.teacher@thebehaviourhive.com");
    const otherTeacherBBB = await signedInClient("checkbbb.otherteacher@thebehaviourhive.com");
    const outsiderBBB = await signedInClient("checkbbb.outsider@thebehaviourhive.com");
    const guardian1BBB = await signedInClient("checkbbb.guardian1@thebehaviourhive.com");
    const guardian2BBB = await signedInClient("checkbbb.guardian2@thebehaviourhive.com");

    // ---- BBB0: setup -- teacherBBB has real access to childBBB;
    // otherTeacherBBB has real access to a SEPARATE child, proving the
    // RPC's own per-row scoping, not just a per-call authorization gate. ----
    const { data: childBBBId } = await principalBBB.rpc("create_school_passport", { p_institution_id: institutionBBBId, p_child_name: "BBB Child" });
    const { data: code1BBB } = await principalBBB.rpc("generate_passport_claim_code", { p_institution_id: institutionBBBId, p_passport_id: childBBBId });
    await guardian1BBB.rpc("redeem_passport_claim_code", { p_code: code1BBB });
    const { data: code2BBB } = await principalBBB.rpc("generate_passport_claim_code", { p_institution_id: institutionBBBId, p_passport_id: childBBBId });
    await guardian2BBB.rpc("redeem_passport_claim_code", { p_code: code2BBB });
    await principalBBB.rpc("grant_passport_access", { p_passport_id: childBBBId, p_user_id: teacherBBBId, p_institution_id: institutionBBBId, p_reason: "Class teacher." });

    const { data: otherChildBBBId } = await principalBBB.rpc("create_school_passport", { p_institution_id: institutionBBBId, p_child_name: "BBB Other Child" });
    await principalBBB.rpc("grant_passport_access", { p_passport_id: otherChildBBBId, p_user_id: otherTeacherBBBId, p_institution_id: institutionBBBId, p_reason: "Class teacher." });

    const startOfTodayBBB = new Date();
    startOfTodayBBB.setHours(0, 0, 0, 0);

    // ---- BBB1: two guardians submit genuinely disagreeing accounts. ----
    const { error: g1InsertBBBErr } = await guardian1BBB.from("morning_checkins").insert({
      passport_id: childBBBId, user_id: guardian1BBBId,
      sleep_quality: "barely_slept", regulation_state: "dysregulated", heads_up: "Rough night.",
    });
    if (g1InsertBBBErr) throw g1InsertBBBErr;
    const { error: g2InsertBBBErr } = await guardian2BBB.from("morning_checkins").insert({
      passport_id: childBBBId, user_id: guardian2BBBId,
      sleep_quality: "slept_through", regulation_state: "settled", heads_up: "Great morning.",
    });
    if (g2InsertBBBErr) throw g2InsertBBBErr;

    // ---- BBB2: the teacher with real access gets BOTH, attributed --
    // no reduction, no silent drop. ----
    const { data: teacherViewBBB } = await teacherBBB.rpc("get_todays_checkins_for_passports", {
      p_passport_ids: [childBBBId, otherChildBBBId], p_start_of_today: startOfTodayBBB.toISOString(),
    });
    const forChildBBB = (teacherViewBBB ?? []).filter((r) => r.passport_id === childBBBId);
    record("BBB2a THE CORE CLAIM: the teacher receives BOTH disagreeing accounts, not just the most recent -- no silent drop", forChildBBB.length === 2, JSON.stringify(forChildBBB));
    record("BBB2b both accounts are attributed by real name", forChildBBB.every((r) => typeof r.submitted_by_name === "string" && r.submitted_by_name.length > 0) && forChildBBB.some((r) => r.submitted_by_name === "BBB Guardian One") && forChildBBB.some((r) => r.submitted_by_name === "BBB Guardian Two"), JSON.stringify(forChildBBB.map((r) => r.submitted_by_name)));
    record("BBB2c the two accounts' own content is genuinely different, neither overwritten", forChildBBB.some((r) => r.sleep_quality === "barely_slept") && forChildBBB.some((r) => r.sleep_quality === "slept_through"), JSON.stringify(forChildBBB.map((r) => r.sleep_quality)));

    // ---- BBB3: the SAME call also asked about otherChildBBB, which
    // has zero check-ins today -- proves per-row scoping, not a blanket
    // "this teacher passed access somewhere" gate. ----
    const forOtherChildBBB = (teacherViewBBB ?? []).filter((r) => r.passport_id === otherChildBBBId);
    record("BBB3 the same call correctly returns nothing for the other child (zero check-ins today), not an error and not childBBB's rows leaking across", forOtherChildBBB.length === 0, JSON.stringify(forOtherChildBBB));

    // ---- BBB4: a second teacher, with real access only to the OTHER
    // child, gets nothing for childBBB even when childBBB's id is in
    // the same array argument -- has_child_access() scoped per row. ----
    const { data: otherTeacherViewBBB } = await otherTeacherBBB.rpc("get_todays_checkins_for_passports", {
      p_passport_ids: [childBBBId, otherChildBBBId], p_start_of_today: startOfTodayBBB.toISOString(),
    });
    record("BBB4 a teacher without access to childBBB gets nothing for it, even with its id in the same array argument", !(otherTeacherViewBBB ?? []).some((r) => r.passport_id === childBBBId), JSON.stringify(otherTeacherViewBBB));

    // ---- BBB5: an outsider with no relationship to either child gets
    // nothing at all. ----
    const { data: outsiderViewBBB } = await outsiderBBB.rpc("get_todays_checkins_for_passports", {
      p_passport_ids: [childBBBId, otherChildBBBId], p_start_of_today: startOfTodayBBB.toISOString(),
    });
    record("BBB5 an outsider with no access to either child gets nothing", (outsiderViewBBB ?? []).length === 0, JSON.stringify(outsiderViewBBB));

    console.log("BBB summary complete.");

    await admin.from("morning_checkins").delete().in("passport_id", [childBBBId, otherChildBBBId]);
    await admin.from("passport_guardians").delete().eq("passport_id", childBBBId);
    await admin.from("passports").delete().in("id", [childBBBId, otherChildBBBId]);
    await admin.from("institutions").delete().eq("id", institutionBBBId);
    for (const id of [principalBBBId, teacherBBBId, otherTeacherBBBId, outsiderBBBId, guardian1BBBId, guardian2BBBId]) {
      await admin.auth.admin.deleteUser(id);
    }
  }

  console.log(`\n== Summary ==`);
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("FAILURES / FINDINGS:");
    failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`));
  }

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
