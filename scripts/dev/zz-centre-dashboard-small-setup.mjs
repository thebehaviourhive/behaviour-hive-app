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
const PW = `ZzCentreSmall-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre } = await admin
  .from("institutions")
  .insert({ name: "ZZ Centre Small", institution_code: `ZZCENTRESMALL${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();

const managerEmail = `zzcentresmall.manager.${stamp}@thebehaviourhive.com`;
const managerId = await createUser(managerEmail, "centre_manager");
await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

const manager = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await manager.auth.signInWithPassword({ email: managerEmail, password: PW });

async function onboard(name) {
  const { data, error } = await manager.rpc("onboard_clinic_client", { p_institution_id: centre.id, p_client_name: name });
  if (error) throw error;
  const { data: episode } = await admin.from("episodes_of_care").select("id").eq("passport_id", data).single();
  return { passportId: data, episodeId: episode.id };
}

// Child A: on-site now (stay started 2h ago, ends in 2 days -- a
// departure inside the 7-day window), morning check-in done, end of
// day outstanding, a real ABC entry logged today -- the "needs
// attention" case that ISN'T actually outstanding on check-ins alone.
// Also given a SECOND, future stay (starts in 5 days) so the small
// fixture proves BOTH an arrival and a departure in Coming and Going
// without needing a third child.
const childA = await onboard("ZZ Small Child A");
const nowMs = Date.now();
const stayA1 = await manager.rpc("create_respite_stay", {
  p_episode_id: childA.episodeId,
  p_starts_at: new Date(nowMs - 2 * 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString(),
});
if (stayA1.error) throw stayA1.error;
const activationA = await manager.rpc("activate_respite_stay", { p_stay_id: stayA1.data });
if (activationA.error) throw activationA.error;
const ckA1 = await manager.rpc("record_respite_stay_checkin", { p_stay_id: stayA1.data, p_check_in_type: "morning" });
if (ckA1.error) throw ckA1.error;
// A real ABC entry logged today -- via service role, since only
// care_staff (not centre_manager) has an INSERT policy on abc_logs;
// this is seeding STATE for the dashboard's own read to prove, not
// re-proving the ABC-logging write path itself, which has its own
// separate, already-verified coverage.
await admin.from("abc_logs").insert({
  passport_id: childA.passportId,
  logged_by: managerId,
  logged_by_role: "care_staff",
  stay_id: stayA1.data,
  incident_date: new Date(nowMs).toISOString().slice(0, 10),
  intensity: 2,
  antecedents: ["Transition"],
  behaviours: ["Refusal"],
  consequences: ["Redirected"],
}).throwOnError();

const stayA2 = await manager.rpc("create_respite_stay", {
  p_episode_id: childA.episodeId,
  p_starts_at: new Date(nowMs + 5 * 24 * 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(nowMs + 8 * 24 * 60 * 60 * 1000).toISOString(),
});
if (stayA2.error) throw stayA2.error;

// Child B: on-site now, NEITHER check-in done -- the genuine "needs
// attention" row.
const childB = await onboard("ZZ Small Child B");
const stayB = await manager.rpc("create_respite_stay", {
  p_episode_id: childB.episodeId,
  p_starts_at: new Date(nowMs - 4 * 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(nowMs + 3 * 24 * 60 * 60 * 1000).toISOString(),
});
if (stayB.error) throw stayB.error;
const activationB = await manager.rpc("activate_respite_stay", { p_stay_id: stayB.data });
if (activationB.error) throw activationB.error;

// On-call, set for real.
const onCall = await manager.rpc("set_on_call", {
  p_institution_id: centre.id, p_name: "Aoife Byrne", p_phone: "+353871234567",
  p_until: new Date(nowMs + 8 * 60 * 60 * 1000).toISOString(),
});
if (onCall.error) throw onCall.error;

const fixture = {
  stamp, password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  childA: { passportId: childA.passportId, stayId: stayA1.data },
  childB: { passportId: childB.passportId, stayId: stayB.data },
};
fs.writeFileSync("scripts/dev/zz-centre-dashboard-small-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify(fixture, null, 2));
