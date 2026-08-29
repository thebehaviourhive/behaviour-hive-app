// PRD 1's own closing deliverable: the full 375px human pass, deferred
// since Stage 1. Builds the ACCOUNTS for one coherent journey --
// principal enrols a child, assigns a teacher and SNAs, staff log an
// incident, a guardian claims, a clinician is engaged, a staff member
// leaves -- and stops there. Every step that has a real UI path is left
// for a human to walk through live in the browser; this script only
// does the two things with NO reachable UI path at all:
//   1. the founding principal's own institution_staff row (nothing can
//      create an institution's first principal except a service-role
//      insert -- there's no "create an institution" screen, matching
//      every other browser-verification fixture in this repo)
//   2. the clinician's own verification (approve_clinician() is
//      service-role-only by design, migrations 0029/0030 -- there has
//      never been a self-verify UI to bypass)
// Everything else -- approving joins, enrolling the child, assigning
// staff, logging an incident, claiming, connecting the clinician,
// deactivating a staff member -- is deliberately left undone, for
// Daniel to perform himself against docs/prd-1-human-pass-checklist.md.
//
// DELIBERATELY NOT ZZFIXTURE-PREFIXED. scripts/dev/teardown.mjs refuses
// unconditionally to touch anything outside that naming convention --
// this fixture is structurally immune to any future automated
// teardown, not just protected by a "don't delete this" comment. Leave
// it up. Tear it down only when explicitly told to.
//
// Run with: node --env-file=.env.local scripts/dev/humanpass-fixture-setup.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "HumanPass-2026!";
const INSTITUTION_CODE = "HUMANPASS" + Math.floor(Math.random() * 10000);

function client() {
  return createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

async function signIn(email) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function main() {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "The Meadow School", institution_code: INSTITUTION_CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;

  const principalEmail = "humanpass.principal@thebehaviourhive.com";
  const teacherEmail = "humanpass.teacher@thebehaviourhive.com";
  const sna1Email = "humanpass.sna1@thebehaviourhive.com";
  const sna2Email = "humanpass.sna2@thebehaviourhive.com";
  const parentEmail = "humanpass.parent@thebehaviourhive.com";
  const clinicianEmail = "humanpass.clinician@thebehaviourhive.com";

  const principalId = await createUser(principalEmail, "Priya Principal", "principal");
  const teacherId = await createUser(teacherEmail, "Tara Teacher", "class_teacher");
  const sna1Id = await createUser(sna1Email, "Sam SNA", "sna");
  const sna2Id = await createUser(sna2Email, "Sian SNA", "sna");
  await createUser(parentEmail, "Pat Parent", "parent");
  const clinicianId = await createUser(clinicianEmail, "Cara Clinician", "clinician");

  // The one unavoidable service-role step: the founding principal.
  // Nothing in the product can create an institution's first principal
  // any other way -- every other fixture script in this repo does the
  // same thing for the same reason.
  const { error: staffErr } = await admin.from("institution_staff").insert({
    institution_id: institutionId,
    user_id: principalId,
    role: "principal",
  });
  if (staffErr) throw staffErr;

  // Teacher and both SNAs submit REAL pending joins -- the same direct
  // insert under RLS the actual /teacher/join-institution and
  // /sna/join-institution screens perform, not a service-role shortcut.
  // Left PENDING deliberately: approving them is the checklist's own
  // first step, not something this script should do for Daniel.
  for (const [email, uid, role] of [
    [teacherEmail, teacherId, "class_teacher"],
    [sna1Email, sna1Id, "sna"],
    [sna2Email, sna2Id, "sna"],
  ]) {
    const c = await signIn(email);
    const { error } = await c.from("institution_staff").insert({ institution_id: institutionId, user_id: uid, role });
    if (error) throw error;
  }

  // The clinician: verified through the real chain (their own session
  // selects a specialty; the admin path approves them) -- this is
  // itself the ONE verification path that exists, service-role by
  // design, not a shortcut around a UI that could otherwise do it.
  const clinicianClient = await signIn(clinicianEmail);
  const { error: specErr } = await clinicianClient.rpc("select_clinician_specialty", { p_specialty: "behavioural_psychologist" });
  if (specErr) throw specErr;
  const { data: approveRows, error: approveErr } = await admin.rpc("approve_clinician", { clinician_email: clinicianEmail });
  if (approveErr) throw approveErr;
  const clinicianCode = approveRows?.[0]?.code ?? approveRows?.code;

  console.log(JSON.stringify({
    password: PASSWORD,
    institutionCode: INSTITUTION_CODE,
    institutionName: "The Meadow School",
    accounts: {
      principal: { email: principalEmail, name: "Priya Principal", status: "active (founding principal)" },
      teacher: { email: teacherEmail, name: "Tara Teacher", status: "pending join -- approve live" },
      sna1: { email: sna1Email, name: "Sam SNA", status: "pending join -- approve live (standing assignment)" },
      sna2: { email: sna2Email, name: "Sian SNA", status: "pending join -- approve live (temporary cover)" },
      parent: { email: parentEmail, name: "Pat Parent", status: "active, no data yet -- will claim the child live" },
      clinician: { email: clinicianEmail, name: "Cara Clinician", status: "pre-verified (no self-verify UI exists)", clinicianCode },
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
