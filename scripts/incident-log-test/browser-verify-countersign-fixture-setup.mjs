// Disposable browser-verification fixture for Phase 4 Piece 3
// (countersign screen). NOT ZZFIXTURE_THUMBTEST -- torn down in this
// same session, confirmed gone by direct query.
//
// Builds a teacher-signed incident with: a named real-account staff
// member who attests, withdraws, then re-attests (exercising the
// sequence-rendering case), and a free-text staff member with no
// account at all ("not attested -- no account"). Principal is left to
// countersign live via the browser.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/browser-verify-countersign-fixture-setup.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing env vars.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "CountersignBrowserVerify-2026!";
const CODE = "CSBROWSER" + Math.floor(Math.random() * 10000);

async function signedInClient(email) {
  const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: fullName }, app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Countersign Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;

  const teacherAId = await createUser("csbrowser.teacherA@thebehaviourhive.com", "CS Teacher A", "class_teacher");
  const teacherBId = await createUser("csbrowser.teacherB@thebehaviourhive.com", "CS Teacher B", "class_teacher");
  const principalId = await createUser("csbrowser.principal@thebehaviourhive.com", "CS Principal", "principal");
  const parentId = await createUser("csbrowser.parent@thebehaviourhive.com", "CS Parent", "parent");

  await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: teacherAId, role: "class_teacher" },
    { institution_id: institutionId, user_id: teacherBId, role: "class_teacher" },
    { institution_id: institutionId, user_id: principalId, role: "principal" },
  ]);

  const { data: passport } = await admin
    .from("passports")
    .insert({ user_id: parentId, child_name: "Countersign Browser Child", passport_status: "complete" })
    .select()
    .single();

  await admin.from("passport_institution_links").insert({ passport_id: passport.id, institution_id: institutionId, approved_by_parent: true });

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  const teacherA = await signedInClient("csbrowser.teacherA@thebehaviourhive.com");
  const teacherB = await signedInClient("csbrowser.teacherB@thebehaviourhive.com");

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [passport.id],
    p_staff: [
      { user_id: teacherBId, involvement: "witnessed" },
      { free_text_name: "Bus Escort Jane", involvement: "witnessed" },
    ],
  });
  if (stampErr) throw stampErr;

  await teacherA
    .from("incidents")
    .update({
      category: "one_party_incident",
      narrative: "A pupil became distressed during transition and required support to regulate.",
      parent_summary: "Your child was supported by staff during a difficult moment today.",
    })
    .eq("id", incidentId);

  const { data: teacherBStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", incidentId).eq("user_id", teacherBId).single();

  // Sequence: attest, withdraw, re-attest -- exercises the "render as a
  // sequence, not two contradictory states" case.
  await teacherB.rpc("attest_to_incident", { p_incident_staff_id: teacherBStaffRow.id, p_addendum: "Confirmed, I was there for the whole thing." });
  await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffRow.id, p_reason: "On reflection I want to check the timeline before standing over this." });
  await teacherB.rpc("attest_to_incident", { p_incident_staff_id: teacherBStaffRow.id, p_addendum: "Checked against my own notes -- this is accurate." });

  const { error: signErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: incidentId });
  if (signErr) throw signErr;

  console.log(JSON.stringify(
    {
      institutionId,
      incidentId,
      teacherAEmail: "csbrowser.teacherA@thebehaviourhive.com",
      teacherBEmail: "csbrowser.teacherB@thebehaviourhive.com",
      principalEmail: "csbrowser.principal@thebehaviourhive.com",
      password: PASSWORD,
      incidentUrl: `/teacher/incidents/${incidentId}`,
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
