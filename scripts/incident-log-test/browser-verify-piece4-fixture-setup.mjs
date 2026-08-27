// Disposable browser-verification fixture for Phase 4 Piece 4
// (two-stage parent notification + parent-call flag). NOT
// ZZFIXTURE_THUMBTEST -- torn down in this same session, confirmed gone
// by direct query.
//
// One active parent (child1, will sign in and check the dashboard) and
// one dormant parent (child2, never signed in -- exercises the
// teacher-facing "can't be notified" message). teacherA stamps an
// incident naming both children.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/browser-verify-piece4-fixture-setup.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing env vars.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Piece4BrowserVerify-2026!";
const CODE = "P4BROWSER" + Math.floor(Math.random() * 10000);

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
  const { data: inst } = await admin
    .from("institutions")
    .insert({ name: "Piece 4 Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  const institutionId = inst.id;

  const teacherAId = await createUser("p4browser.teacherA@thebehaviourhive.com", "P4 Teacher A", "class_teacher");
  const parent1Id = await createUser("p4browser.parent1@thebehaviourhive.com", "P4 Parent Active", "parent");
  const parent2Id = await createUser("p4browser.parent2@thebehaviourhive.com", "P4 Parent Dormant", "parent");

  await admin.from("institution_staff").insert([{ institution_id: institutionId, user_id: teacherAId, role: "class_teacher" }]);

  const { data: child1 } = await admin.from("passports").insert({ user_id: parent1Id, child_name: "P4 Browser Child Active", passport_status: "complete" }).select().single();
  const { data: child2 } = await admin.from("passports").insert({ user_id: parent2Id, child_name: "P4 Browser Child Dormant", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert([
    { passport_id: child1.id, institution_id: institutionId, approved_by_parent: true },
    { passport_id: child2.id, institution_id: institutionId, approved_by_parent: true },
  ]);

  const teacherA = await signedInClient("p4browser.teacherA@thebehaviourhive.com");
  // parent1 signs in now -> active. parent2 is deliberately never signed in -> dormant.
  await signedInClient("p4browser.parent1@thebehaviourhive.com");

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: (await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single()).data.id,
    p_child_passport_ids: [child1.id, child2.id],
    p_staff: [],
  });
  if (stampErr) throw stampErr;

  await teacherA
    .from("incidents")
    .update({
      category: "one_party_incident",
      narrative: "Browser verification narrative for piece 4.",
      parent_summary: "Your child had a difficult moment today and was supported to settle by staff.",
    })
    .eq("id", incidentId);

  console.log(JSON.stringify(
    {
      institutionId,
      incidentId,
      teacherAEmail: "p4browser.teacherA@thebehaviourhive.com",
      parent1Email: "p4browser.parent1@thebehaviourhive.com",
      parent2Email: "p4browser.parent2@thebehaviourhive.com",
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
