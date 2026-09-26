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
const PW = `ZzBaseline-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ Baseline Audit Centre", institution_code: `ZZBASELINE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();
if (centreErr) throw centreErr;

const managerEmail = `zzbaseline.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zzbaseline.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zzbaseline.careb.${stamp}@thebehaviourhive.com`;
const managerId = await createUser(managerEmail, "centre_manager");
const careAId = await createUser(careAEmail, "care_staff");
const careBId = await createUser(careBEmail, "care_staff");

await admin.from("institution_staff").insert([
  { institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
  { institution_id: centre.id, user_id: careAId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
  { institution_id: centre.id, user_id: careBId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
]).throwOnError();

const manager = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await manager.auth.signInWithPassword({ email: managerEmail, password: PW });
const careA = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await careA.auth.signInWithPassword({ email: careAEmail, password: PW });

async function onboard(name) {
  const { data: passportId, error } = await manager.rpc("onboard_clinic_client", { p_institution_id: centre.id, p_client_name: name });
  if (error) throw error;
  const { data: episode } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).single();
  return { passportId, episodeId: episode.id };
}

console.log("Onboarding 5 children (search needs a real list, not 1-2 rows)...");
const names = ["Aoife Byrne", "Cian Doyle", "Fiadh Kelly", "Oisin Murphy", "Saoirse Walsh"];
const children = [];
for (const name of names) {
  children.push(await onboard(name));
}
console.log("Onboarded.");

// Child 1 (Aoife): a real, CURRENT active stay -- for the passport-detail
// screens (back-nav, real content, no error/loading forced there).
const nowMs = Date.now();
{
  const { data: stayId, error } = await manager.rpc("create_respite_stay", {
    p_episode_id: children[0].episodeId,
    p_starts_at: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
    p_ends_at: new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  const { error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
  if (actErr) throw actErr;
  children[0].stayId = stayId;
}

// Child 2 (Cian): a stay that has ALREADY ENDED and is not yet
// finalised -- so get_respite_stays_awaiting_report() surfaces it and
// /centre/report/[stayId] has something real to load.
{
  const { data: stayId, error } = await manager.rpc("create_respite_stay", {
    p_episode_id: children[1].episodeId,
    p_starts_at: new Date(nowMs - 3 * 24 * 60 * 60 * 1000).toISOString(),
    p_ends_at: new Date(nowMs - 1 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (error) throw error;
  const { error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
  if (actErr) throw actErr;
  // A check-in during that stay, so the report screen's own reference
  // material has something real to show.
  await admin.from("respite_stay_checkins").insert({
    stay_id: stayId,
    passport_id: children[1].passportId,
    institution_id: centre.id,
    checked_in_by: managerId,
    check_in_type: "morning",
    check_in_date: new Date(nowMs - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    note: "Settled in well, no concerns.",
  });
  children[1].stayId = stayId;
}

// Child 3 (Fiadh): placement ENDED entirely -- for the showEnded toggle
// and to prove search filters across both segments.
{
  const { error } = await manager.rpc("end_clinic_episode", {
    p_episode_id: children[2].episodeId,
    p_reason: "Goals met",
  });
  if (error) throw error;
}

const { data: categories } = await admin.from("message_categories").select("id, label").eq("label", "Handover");
const handoverCategoryId = categories[0].id;

async function sendHandover(senderClient, passportId, body, recipientIds) {
  const { error } = await senderClient.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: handoverCategoryId,
    p_body: body,
    p_response_required: false,
    p_recipient_ids: recipientIds,
  });
  if (error) throw error;
}

// Real handovers for the currently-active child (Aoife) -- one read, one
// left unread so the nav badge/dot has something real to show.
await sendHandover(manager, children[0].passportId, "Morning was calm, had a snack at 10. Loves the sensory room if things get tense.", [careAId, careBId]);
await sendHandover(manager, children[0].passportId, "Afternoon update: settled well after lunch.", [careAId, careBId]);
console.log("Handover messages sent (both left unread for careA -- for the badge/dot).");

const fixture = {
  stamp, password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  careA: { email: careAEmail, id: careAId },
  careB: { email: careBEmail, id: careBId },
  children: children.map((c) => ({ passportId: c.passportId, name: c.name })),
  activeChildPassportId: children[0].passportId,
  reportStayId: children[1].stayId,
  endedChildPassportId: children[2].passportId,
};
fs.writeFileSync("scripts/dev/zz-baseline-audit-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ managerEmail, careAEmail, careBEmail, password: PW, reportStayId: children[1].stayId }, null, 2));
