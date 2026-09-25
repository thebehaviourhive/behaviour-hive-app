import fs from "fs";
const raw = fs.readFileSync(".env.local", "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[m[1]] = val;
}
const { createClient } = await import("@supabase/supabase-js");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

// Fixture for 0303 -- the cross-institution message-recipient-candidate
// leak. One passport, linked to FOUR institutions of three different
// types (clinic, respite centre, school, plus a wholly unrelated
// "outsider" respite centre that is NEVER linked at all), so the fix
// can be proven against every combination the bug actually covers:
// clinic<->respite (the confirmed live case), clinic<->school and
// respite<->school (the generalised case, same defect shape), and a
// genuinely unrelated institution (the pre-existing, unaffected
// negative control).

const stamp = Date.now();
const PW = `Zz0303-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: PW,
    app_metadata: role ? { role } : undefined,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0303 Clinic", institution_code: `ZZ0303CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id").single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0303 Centre", institution_code: `ZZ0303CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (centreErr) throw centreErr;

const { data: otherCentre, error: otherCentreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0303 Other Centre", institution_code: `ZZ0303OTHERCENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (otherCentreErr) throw otherCentreErr;

const { data: school, error: schoolErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0303 School", institution_code: `ZZ0303SCHOOL${stamp}`, status: "verified", type: "school" })
  .select("id").single();
if (schoolErr) throw schoolErr;

const directorEmail = `zz0303.director.${stamp}@thebehaviourhive.com`;
const clinicianEmail = `zz0303.clinician.${stamp}@thebehaviourhive.com`;
const managerEmail = `zz0303.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zz0303.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zz0303.careb.${stamp}@thebehaviourhive.com`;
const outsiderCareEmail = `zz0303.outsidercare.${stamp}@thebehaviourhive.com`;
const principalEmail = `zz0303.principal.${stamp}@thebehaviourhive.com`;
const teacherEmail = `zz0303.teacher.${stamp}@thebehaviourhive.com`;
const parentEmail = `zz0303.parent.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const clinicianId = await createUser(clinicianEmail, "clinician");
const managerId = await createUser(managerEmail, "centre_manager");
const careAId = await createUser(careAEmail, "care_staff");
const careBId = await createUser(careBEmail, "care_staff");
const outsiderCareId = await createUser(outsiderCareEmail, "care_staff");
const principalId = await createUser(principalEmail, "principal");
const teacherId = await createUser(teacherEmail, "class_teacher");
const parentId = await createUser(parentEmail, "parent");

await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianId, role: "clinician", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
// A real approve_staff_join() clinic-branch call would also create this
// row (verification_status='verified', verification_route='organisation')
// -- inserting institution_staff alone leaves is_verified_clinician()
// false, which silently empties the "clinician" candidate arm's own
// `authorized` gate for this account. Found live: the first run of this
// fixture produced 6 false FAILs, all traced to this one missing row.
await admin.from("clinicians").insert({ user_id: clinicianId, full_name: "ZZ 0303 Clinician", specialty: "behavioural_psychologist", verification_status: "verified", verification_route: "organisation" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: careAId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: careBId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: otherCentre.id, user_id: outsiderCareId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: school.id, user_id: principalId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: school.id, user_id: teacherId, role: "class_teacher", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();

const director = await signIn(directorEmail);
const manager = await signIn(managerEmail);
const principal = await signIn(principalEmail);

// The passport is CLINIC-created, exactly the confirmed-live shape.
const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", { p_institution_id: clinic.id, p_client_name: "ZZ 0303 Child" });
if (onboardErr) throw onboardErr;

// A real guardian -- proves the "parent" candidate arm's own
// cross-institution reach is unaffected by this fix.
await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId }).throwOnError();

// A real, active clinician_access grant -- proves the "clinician" arm's
// own cross-institution reach (the schema-wide precedent this fix
// deliberately preserves) is unaffected too.
await admin.from("clinician_access").insert({
  passport_id: passportId, clinician_id: clinicianId, engaged_by: "institution",
  engaged_by_institution_id: clinic.id, is_active: true,
}).throwOnError();

// Link the respite centre (real code, real redemption, real episode +
// activation -- the exact live path the bug was found through).
const { data: linkCode1, error: linkErr1 } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
if (linkErr1) throw linkErr1;
const { error: redeemErr1 } = await manager.rpc("redeem_institution_link_code", { p_institution_id: centre.id, p_code: linkCode1 });
if (redeemErr1) throw redeemErr1;

const { data: episodeRow, error: episodeErr } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).eq("institution_id", centre.id).single();
if (episodeErr) throw episodeErr;

const now = Date.now();
const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(now - 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
});
if (stayErr) throw stayErr;
const { error: activateErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
if (activateErr) throw activateErr;

// Link the school too, via a SECOND real link code from the SAME
// clinic -- generalising the bug/fix proof beyond respite<->clinic to
// school<->clinic and school<->respite as well.
const { data: linkCode2, error: linkErr2 } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
if (linkErr2) throw linkErr2;
const { error: redeemErr2 } = await principal.rpc("redeem_institution_link_code", { p_institution_id: school.id, p_code: linkCode2 });
if (redeemErr2) throw redeemErr2;

// The teacher's own class-teacher access at the school -- a direct
// passport_access grant (service role), standing in for the real
// class/class_teachers/class_children chain, since what's under test
// here is the candidate function's own institution scoping, not the
// class-assignment machinery (already covered elsewhere).
await admin.from("passport_access").insert({
  passport_id: passportId, teacher_id: teacherId, institution_id: school.id,
  actor_role: "class_teacher", is_active: true,
}).throwOnError();

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, centreId: centre.id, otherCentreId: otherCentre.id, schoolId: school.id,
  directorEmail, clinicianEmail, managerEmail, careAEmail, careBEmail, outsiderCareEmail,
  principalEmail, teacherEmail, parentEmail,
  directorId, clinicianId, managerId, careAId, careBId, outsiderCareId, principalId, teacherId, parentId,
  passportId, episodeId: episodeRow.id, stayId,
}, null, 2));
