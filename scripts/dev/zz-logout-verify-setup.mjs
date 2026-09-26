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
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now();
const PW = `ZzLogout-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ Logout Verify Centre", institution_code: `ZZLOGOUT${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (centreErr) throw centreErr;

const managerEmail = `zzlogout.manager.${stamp}@thebehaviourhive.com`;
const careEmail = `zzlogout.care.${stamp}@thebehaviourhive.com`;
const managerId = await createUser(managerEmail, "centre_manager");
const careId = await createUser(careEmail, "care_staff");

await admin.from("institution_staff").insert([
  { institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
  { institution_id: centre.id, user_id: careId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
]).throwOnError();

const fixture = {
  stamp, password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  care: { email: careEmail, id: careId },
};
fs.writeFileSync("scripts/dev/zz-logout-verify-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ managerEmail, careEmail, password: PW }, null, 2));
