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
const PW = `ZzStage3-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: PW,
    app_metadata: role ? { role } : undefined,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ Stage3 Clinic", institution_code: `ZZSTAGE3CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id, institution_code")
  .single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ Stage3 Centre", institution_code: `ZZSTAGE3CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (centreErr) throw centreErr;

const directorEmail = `zzstage3.director.${stamp}@thebehaviourhive.com`;
const managerEmail = `zzstage3.manager.${stamp}@thebehaviourhive.com`;
const careEmail = `zzstage3.care.${stamp}@thebehaviourhive.com`;
const parentEmail = `zzstage3.parent.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const managerId = await createUser(managerEmail, "centre_manager");
const careId = await createUser(careEmail, "care_staff");
const parentId = await createUser(parentEmail, "parent");

// Bootstrap-approve the director and manager directly (mirroring what
// derive_staff_join_approval()'s own trigger does for the FIRST
// principal/centre_manager at a fresh institution -- a real, equivalent
// state, not a shortcut around the rule it enforces).
const { error: dirStaffErr } = await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (dirStaffErr) throw dirStaffErr;

const { error: mgrStaffErr } = await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap",
});
if (mgrStaffErr) throw mgrStaffErr;

// Care staff joins PENDING, for real -- approved via the real RPC below
// as the manager's own signed-in session, not a service-role shortcut.
const { error: careStaffErr } = await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: careId, role: "care_staff",
});
if (careStaffErr) throw careStaffErr;

// Consent rows for all four -- unrelated to what this stage verifies,
// needed only so useRequireRole-style consent gates (irrelevant here,
// but hasConsented() is checked by some RPC-adjacent client code paths
// this script does not exercise) never block a direct RPC call. Not
// actually required for raw RPC calls (RLS/RPCs don't check consents),
// included for completeness/hygiene only.
for (const [uid, role] of [[directorId, "principal"], [managerId, "centre_manager"], [careId, "care_staff"], [parentId, "parent"]]) {
  await admin.from("consents").insert({ user_id: uid, role, consent_version: 2 });
}

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, clinicCode: clinic.institution_code,
  centreId: centre.id, centreCode: centre.institution_code,
  directorEmail, managerEmail, careEmail, parentEmail,
}, null, 2));
