// Disposable browser-verification fixture for Phase 5 (parent/clinician
// views + FBA pull-in). NOT ZZFIXTURE_THUMBTEST -- torn down same
// session, confirmed gone by direct query.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Phase5BrowserVerify-2026!";
const CODE = "P5BROWSER" + Math.floor(Math.random() * 10000);

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
    .insert({ name: "Phase 5 Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  const institutionId = inst.id;

  const teacherId = await createUser("p5browser.teacher@thebehaviourhive.com", "P5 Teacher", "class_teacher");
  const parentId = await createUser("p5browser.parent@thebehaviourhive.com", "P5 Parent", "parent");
  const clinicianId = await createUser("p5browser.clinician@thebehaviourhive.com", "P5 Clinician", "clinician");

  await admin.from("institution_staff").insert([{ institution_id: institutionId, user_id: teacherId, role: "class_teacher" }]);

  const { data: child } = await admin.from("passports").insert({ user_id: parentId, child_name: "P5 Browser Child", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert({ passport_id: child.id, institution_id: institutionId, approved_by_parent: true });
  await admin.from("clinicians").insert({ user_id: clinicianId, specialty: "behavioural_psychologist", verification_status: "verified" });
  await admin.from("clinician_access").insert({ passport_id: child.id, clinician_id: clinicianId, is_active: true });

  const teacher = await signedInClient("p5browser.teacher@thebehaviourhive.com");
  await signedInClient("p5browser.parent@thebehaviourhive.com");
  await signedInClient("p5browser.clinician@thebehaviourhive.com");

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  const { data: incidentId } = await teacher.rpc("create_incident_stamp", {
    p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
    p_child_passport_ids: [child.id], p_staff: [],
  });

  await teacher.from("incidents").update({
    category: "one_party_incident",
    narrative: "STAFF NARRATIVE ONLY: full account of the incident, staff perspective.",
    parent_summary: "PARENT SUMMARY: your child was supported today by staff.",
  }).eq("id", incidentId);

  await teacher.rpc("sign_off_incident", { p_incident_id: incidentId });

  console.log(JSON.stringify(
    {
      institutionId,
      incidentId,
      passportId: child.id,
      teacherEmail: "p5browser.teacher@thebehaviourhive.com",
      parentEmail: "p5browser.parent@thebehaviourhive.com",
      clinicianEmail: "p5browser.clinician@thebehaviourhive.com",
      password: PASSWORD,
      clinicianPassportUrl: `/clinician/passport/${child.id}`,
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
