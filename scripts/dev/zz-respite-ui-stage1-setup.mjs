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
const PW = `ZzRespiteUi-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre } = await admin
  .from("institutions")
  .insert({ name: "ZZ Respite UI Centre", institution_code: `ZZRESPITEUI${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();

const managerEmail = `zzrespiteui.manager.${stamp}@thebehaviourhive.com`;
const managerId = await createUser(managerEmail, "centre_manager");
await admin.from("institution_staff").insert({
  institution_id: centre.id,
  user_id: managerId,
  role: "centre_manager",
  approved_at: new Date().toISOString(),
  approval_source: "bootstrap",
}).throwOnError();

const managerClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await managerClient.auth.signInWithPassword({ email: managerEmail, password: PW });

// A real client, onboarded through the real RPC.
const { data: childPassportId, error: onboardErr } = await managerClient.rpc("onboard_clinic_client", {
  p_institution_id: centre.id,
  p_client_name: "ZZ Respite UI Child",
});
if (onboardErr) throw onboardErr;

// A single stay starting 19 days out -- the exact reported shape:
// "the only stay starts in 19 days," no activation, so check-ins
// should be hidden and the next-stay date shown instead.
const { data: episodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", childPassportId).single();
const startsAt = new Date(Date.now() + 19 * 24 * 60 * 60 * 1000);
const endsAt = new Date(startsAt.getTime() + 3 * 24 * 60 * 60 * 1000);
const { data: stayRow } = await admin.from("respite_stays").insert({
  episode_id: episodeRow.id,
  passport_id: childPassportId,
  institution_id: centre.id,
  starts_at: startsAt.toISOString(),
  ends_at: endsAt.toISOString(),
  created_by: managerId,
}).select("id").single();

const fixture = {
  stamp,
  password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  childPassportId,
  stayId: stayRow.id,
};
fs.writeFileSync("scripts/dev/zz-respite-ui-stage1-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify(fixture, null, 2));
