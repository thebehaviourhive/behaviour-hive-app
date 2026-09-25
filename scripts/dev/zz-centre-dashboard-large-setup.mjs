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
const PW = `ZzCentreLarge-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre } = await admin
  .from("institutions")
  .insert({ name: "ZZ Centre Large", institution_code: `ZZCENTRELARGE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();

const managerEmail = `zzcentrelarge.manager.${stamp}@thebehaviourhive.com`;
const managerId = await createUser(managerEmail, "centre_manager");
await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager",
  approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

const manager = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await manager.auth.signInWithPassword({ email: managerEmail, password: PW });

async function onboard(name) {
  const { data, error } = await manager.rpc("onboard_clinic_client", { p_institution_id: centre.id, p_client_name: name });
  if (error) throw new Error(`onboard ${name}: ${error.message}`);
  const { data: episode } = await admin.from("episodes_of_care").select("id").eq("passport_id", data).single();
  return { passportId: data, episodeId: episode.id };
}

const nowMs = Date.now();
const day = 24 * 60 * 60 * 1000;

console.log("Onboarding 30 children...");
const children = [];
for (let i = 1; i <= 30; i++) {
  const c = await onboard(`ZZ Large Child ${String(i).padStart(2, "0")}`);
  children.push(c);
}
console.log("Onboarded.");

const stayIds = [];
const passportIds = children.map((c) => c.passportId);

// Children 1-14: on-site now (stay started a few hours ago). Of these:
//  - 1-4: neither check-in done -- named "needs attention" rows.
//  - 5-14: at least one check-in done -- collapses into the summary
//    line once the on-site count exceeds the named-row threshold.
// Children 15-30: placed but never activated -- counted in the
// centre's total, never shown in Today at all (on-site only).
for (let i = 0; i < 14; i++) {
  const c = children[i];
  const startsAt = new Date(nowMs - (1 + i % 6) * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(nowMs + (1 + (i % 5)) * day).toISOString();
  const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
    p_episode_id: c.episodeId, p_starts_at: startsAt, p_ends_at: endsAt,
  });
  if (stayErr) throw stayErr;
  stayIds.push(stayId);
  const { error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
  if (actErr) throw actErr;
  if (i >= 4) {
    const { error: ckErr } = await manager.rpc("record_respite_stay_checkin", { p_stay_id: stayId, p_check_in_type: "morning" });
    if (ckErr) throw ckErr;
  }
}
console.log("14 children activated on-site.");

// A real ABC entry logged today for two of the on-site children.
await admin.from("abc_logs").insert([
  {
    passport_id: children[0].passportId, logged_by: managerId, logged_by_role: "care_staff",
    stay_id: stayIds[0], incident_date: new Date(nowMs).toISOString().slice(0, 10),
    intensity: 3, antecedents: ["Transition"], behaviours: ["Refusal"], consequences: ["Redirected"],
  },
  {
    passport_id: children[6].passportId, logged_by: managerId, logged_by_role: "care_staff",
    stay_id: stayIds[6], incident_date: new Date(nowMs).toISOString().slice(0, 10),
    intensity: 2, antecedents: ["Noise"], behaviours: ["Withdrawal"], consequences: ["Offered break"],
  },
]).throwOnError();

// Children 15-24 (10 of the not-yet-on-site ones): a future stay
// starting within the next 7 days -- arrivals. Spread across the
// week, well past the Coming-and-going cap, to prove the "+N more"
// summary line.
for (let i = 14; i < 24; i++) {
  const c = children[i];
  const daysOut = 1 + ((i - 14) % 7);
  const startsAt = new Date(nowMs + daysOut * day + 3 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(nowMs + (daysOut + 2) * day).toISOString();
  const { error: stayErr } = await manager.rpc("create_respite_stay", {
    p_episode_id: c.episodeId, p_starts_at: startsAt, p_ends_at: endsAt,
  });
  if (stayErr) throw stayErr;
}
console.log("10 upcoming arrivals scheduled.");

// Two stays that have ALREADY ENDED with no report yet, for Needs
// Doing's "awaiting report" bucket -- built on two of the never-
// activated children (25, 26), a real past stay, no activation and no
// report either.
const awaitingReportChildren = children.slice(24, 26);
for (const c of awaitingReportChildren) {
  const startsAt = new Date(nowMs - 5 * day).toISOString();
  const endsAt = new Date(nowMs - 1 * day).toISOString();
  const { error: stayErr } = await manager.rpc("create_respite_stay", {
    p_episode_id: c.episodeId, p_starts_at: startsAt, p_ends_at: endsAt,
  });
  if (stayErr) throw stayErr;
}
console.log("2 stays awaiting report created.");

// Three pending staff joins, for Needs Doing's other bucket.
const pendingStaffEmails = [];
for (let i = 1; i <= 3; i++) {
  const email = `zzcentrelarge.pending${i}.${stamp}@thebehaviourhive.com`;
  const id = await createUser(email);
  await admin.from("institution_staff").insert({
    institution_id: centre.id, user_id: id, role: "care_staff",
  }).throwOnError();
  pendingStaffEmails.push(email);
}
console.log("3 pending staff joins created.");

// On-call, set for real.
const onCall = await manager.rpc("set_on_call", {
  p_institution_id: centre.id, p_name: "Cillian Doyle", p_phone: "+353861234567",
  p_until: new Date(nowMs + 6 * 60 * 60 * 1000).toISOString(),
});
if (onCall.error) throw onCall.error;

const fixture = {
  stamp, password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  passportIds,
  pendingStaffEmails,
};
fs.writeFileSync("scripts/dev/zz-centre-dashboard-large-fixture.json", JSON.stringify(fixture, null, 2));
console.log("Done.");
console.log(JSON.stringify({ stamp, managerEmail, password: PW, centreCode: centre.institution_code }, null, 2));
