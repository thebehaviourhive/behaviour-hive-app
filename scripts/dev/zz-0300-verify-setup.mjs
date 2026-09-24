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
const PW = `Zz0300-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: PW,
    app_metadata: role ? { role } : undefined,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

// Two centres -- one where the placement lives (the real, relevant
// one), one wholly unrelated (the negative control for "a manager at a
// DIFFERENT centre must not read this").
const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0300 Clinic", institution_code: `ZZ0300CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id, institution_code")
  .single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0300 Centre", institution_code: `ZZ0300CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (centreErr) throw centreErr;

const { data: otherCentre, error: otherCentreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0300 Other Centre", institution_code: `ZZ0300OTHER${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (otherCentreErr) throw otherCentreErr;

const directorEmail = `zz0300.director.${stamp}@thebehaviourhive.com`;
const managerAEmail = `zz0300.managera.${stamp}@thebehaviourhive.com`;
const managerBEmail = `zz0300.managerb.${stamp}@thebehaviourhive.com`;
const careStaffEmail = `zz0300.carestaff.${stamp}@thebehaviourhive.com`;
const outsiderManagerEmail = `zz0300.outsidermanager.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const managerAId = await createUser(managerAEmail, "centre_manager");
const managerBId = await createUser(managerBEmail, "centre_manager");
const careStaffId = await createUser(careStaffEmail, "care_staff");
const outsiderManagerId = await createUser(outsiderManagerEmail, "centre_manager");

const { error: dirStaffErr } = await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (dirStaffErr) throw dirStaffErr;

// Two real centre_managers at the REAL centre -- so the read proof
// mirrors 0299's own "a different colleague reads it" shape, not just
// "the author reads their own entry back."
for (const uid of [managerAId, managerBId]) {
  const { error } = await admin.from("institution_staff").insert({
    institution_id: centre.id, user_id: uid, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap",
  });
  if (error) throw error;
}

// A real care_staff at the same centre -- the entry's real author (this
// proves the manager reads a COLLEAGUE's entry, not just another
// manager's, matching how the post-stay report actually assembles: from
// care_staff-authored entries).
const { error: careStaffErr } = await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: careStaffId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (careStaffErr) throw careStaffErr;

// The outsider -- a real, approved centre_manager, but at the OTHER,
// wholly unrelated centre. No relationship to the real child at all.
const { error: outsiderErr } = await admin.from("institution_staff").insert({
  institution_id: otherCentre.id, user_id: outsiderManagerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (outsiderErr) throw outsiderErr;

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, clinicCode: clinic.institution_code,
  centreId: centre.id, centreCode: centre.institution_code,
  otherCentreId: otherCentre.id, otherCentreCode: otherCentre.institution_code,
  directorEmail, managerAEmail, managerBEmail, careStaffEmail, outsiderManagerEmail,
}, null, 2));
