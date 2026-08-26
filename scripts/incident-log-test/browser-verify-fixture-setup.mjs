// Disposable browser-verification fixture for Phase 4 Piece 2
// (attestation UI). NOT ZZFIXTURE_THUMBTEST -- torn down in this same
// session via browser-verify-fixture-teardown.mjs, confirmed gone by
// direct query, per this session's own established discipline.
//
// Creates one institution, one owning teacher, one SNA (named staff,
// real account), one child, and one incident with narrative/category
// filled in (so it's past the "empty draft" stage). Prints the login
// credentials and incident URL for manual browser walk-through.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/browser-verify-fixture-setup.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "AttestBrowserVerify-2026!";
const CODE = "ATTESTBROWSER" + Math.floor(Math.random() * 10000);

async function signedInClient(email) {
  const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
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

async function main() {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Attest Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;

  const teacherAId = await createUser("attestbrowser.teacherA@thebehaviourhive.com", "Attest Teacher A", "class_teacher");
  const snaId = await createUser("attestbrowser.sna@thebehaviourhive.com", "Attest SNA", "sna");
  const parentId = await createUser("attestbrowser.parent@thebehaviourhive.com", "Attest Parent", "parent");

  const { error: staffErr } = await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: teacherAId, role: "class_teacher" },
    { institution_id: institutionId, user_id: snaId, role: "sna" },
  ]);
  if (staffErr) throw staffErr;

  const { data: passport, error: passErr } = await admin
    .from("passports")
    .insert({ user_id: parentId, child_name: "Attest Browser Child", passport_status: "complete" })
    .select()
    .single();
  if (passErr) throw passErr;

  await admin.from("passport_institution_links").insert({ passport_id: passport.id, institution_id: institutionId, approved_by_parent: true });

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  const teacherA = await signedInClient("attestbrowser.teacherA@thebehaviourhive.com");

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [passport.id],
    p_staff: [{ user_id: snaId, involvement: "witnessed" }],
  });
  if (stampErr) throw stampErr;

  const { error: narrErr } = await teacherA
    .from("incidents")
    .update({
      category: "one_party_incident",
      narrative: "Initial narrative text for browser verification.",
      parent_summary: "Parent-facing summary text.",
    })
    .eq("id", incidentId);
  if (narrErr) throw narrErr;

  console.log(JSON.stringify(
    {
      institutionId,
      incidentId,
      teacherAEmail: "attestbrowser.teacherA@thebehaviourhive.com",
      snaEmail: "attestbrowser.sna@thebehaviourhive.com",
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
