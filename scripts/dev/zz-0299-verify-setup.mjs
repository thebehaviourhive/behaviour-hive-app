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
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const stamp = Date.now();
const PW = `Zz0299-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: PW,
    app_metadata: role ? { role } : undefined,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

// Two centres -- one where the placement lives (the real, relevant
// one), one wholly unrelated (the negative control for "a care worker
// at a DIFFERENT centre must not read this").
const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0299 Clinic", institution_code: `ZZ0299CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id, institution_code")
  .single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0299 Centre", institution_code: `ZZ0299CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (centreErr) throw centreErr;

const { data: otherCentre, error: otherCentreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0299 Other Centre", institution_code: `ZZ0299OTHER${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (otherCentreErr) throw otherCentreErr;

const directorEmail = `zz0299.director.${stamp}@thebehaviourhive.com`;
const managerEmail = `zz0299.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zz0299.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zz0299.careb.${stamp}@thebehaviourhive.com`;
const outsiderCareEmail = `zz0299.outsidercare.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const managerId = await createUser(managerEmail, "centre_manager");
const careAId = await createUser(careAEmail, "care_staff");
const careBId = await createUser(careBEmail, "care_staff");
const outsiderCareId = await createUser(outsiderCareEmail, "care_staff");

const { error: dirStaffErr } = await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (dirStaffErr) throw dirStaffErr;

const { error: mgrStaffErr } = await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (mgrStaffErr) throw mgrStaffErr;

// Real care_staff at the REAL centre -- approved directly (service-role
// here is fine for FIXTURE setup speed; the actual approval RPC itself
// is exercised for real elsewhere in this PRD's own verification, this
// pass is about the READ policy specifically).
for (const uid of [careAId, careBId]) {
  const { error } = await admin.from("institution_staff").insert({
    institution_id: centre.id, user_id: uid, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap",
  });
  if (error) throw error;
}

// The outsider -- real, approved care_staff, but at the OTHER, wholly
// unrelated centre. No relationship to the real child at all.
const { error: outsiderErr } = await admin.from("institution_staff").insert({
  institution_id: otherCentre.id, user_id: outsiderCareId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (outsiderErr) throw outsiderErr;

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, clinicCode: clinic.institution_code,
  centreId: centre.id, centreCode: centre.institution_code,
  otherCentreId: otherCentre.id, otherCentreCode: otherCentre.institution_code,
  directorEmail, managerEmail, careAEmail, careBEmail, outsiderCareEmail,
}, null, 2));
