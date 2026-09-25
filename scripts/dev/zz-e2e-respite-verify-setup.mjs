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

const stamp = Date.now().toString().slice(-6);
const password = "ZzE2eRespite!2026";

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true, app_metadata: { role },
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const { data: clinic, error: clinicErr } = await admin.from("institutions")
  .insert({ name: "ZZ E2E Clinic", institution_code: `ZZE2ECLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id").single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin.from("institutions")
  .insert({ name: "ZZ E2E Respite Centre", institution_code: `ZZE2ECENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (centreErr) throw centreErr;

const directorEmail = `zze2e.director.${stamp}@thebehaviourhive.com`;
const managerEmail = `zze2e.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zze2e.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zze2e.careb.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const managerId = await createUser(managerEmail, "centre_manager");
const careAId = await createUser(careAEmail, "care_staff");
const careBId = await createUser(careBEmail, "care_staff");

await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: directorId, role: "principal",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: careAId, role: "care_staff",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: careBId, role: "care_staff",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

// Consent rows -- every real screen these accounts land on checks
// hasConsented() first; the E2E proof is about the respite track's own
// reachability, not re-proving the consent gate.
for (const [uid, role] of [[directorId, "principal"], [managerId, "centre_manager"], [careAId, "care_staff"], [careBId, "care_staff"]]) {
  await admin.from("consents").insert({ user_id: uid, role, consent_version: 999 }).throwOnError();
}

// The director's own real session, not service role -- onboard_clinic_client()
// is SECURITY DEFINER but its own caller check requires a real auth.uid().
const director = await signIn(directorEmail);
const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", {
  p_institution_id: clinic.id, p_client_name: "ZZ E2E Child",
});
if (onboardErr) throw onboardErr;

const fixture = {
  password, clinicId: clinic.id, centreId: centre.id,
  directorEmail, managerEmail, careAEmail, careBEmail,
  directorId, managerId, careAId, careBId, passportId,
};
fs.writeFileSync("/tmp/zz-e2e-respite-fixture.json", JSON.stringify(fixture, null, 2));
console.log("Fixture written:", fixture);
