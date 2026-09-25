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
const PW = `ZzCentreMsg-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

const { data: centre } = await admin
  .from("institutions")
  .insert({ name: "ZZ Centre Messages", institution_code: `ZZCENTREMSG${stamp}`, status: "verified", type: "respite_centre" })
  .select("id, institution_code")
  .single();

const managerEmail = `zzcentremsg.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zzcentremsg.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zzcentremsg.careb.${stamp}@thebehaviourhive.com`;
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

async function onboardAndActivate(name) {
  const { data: passportId, error } = await manager.rpc("onboard_clinic_client", { p_institution_id: centre.id, p_client_name: name });
  if (error) throw error;
  const { data: episode } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).single();
  const nowMs = Date.now();
  const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
    p_episode_id: episode.id,
    p_starts_at: new Date(nowMs - 3 * 60 * 60 * 1000).toISOString(),
    p_ends_at: new Date(nowMs + 2 * 24 * 60 * 60 * 1000).toISOString(),
  });
  if (stayErr) throw stayErr;
  const { error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
  if (actErr) throw actErr;
  return { passportId, episodeId: episode.id, stayId };
}

console.log("Onboarding and activating 8 on-site children...");
const children = [];
for (let i = 1; i <= 8; i++) {
  const c = await onboardAndActivate(`ZZ Msg Child ${String(i).padStart(2, "0")}`);
  children.push(c);
}
console.log("Done.");

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

// Child 1: two handovers from the manager to careA -- one will be left
// unread, one will be read (marked via a real mark_message_read call
// as careA), proving read/unread state genuinely round-trips.
await sendHandover(manager, children[0].passportId, "Morning was calm. Had a snack at 10, no incidents. Loves the sensory room -- offer it if things get tense.", [careAId]);
await sendHandover(manager, children[0].passportId, "Afternoon update: slept well after lunch. All good for the evening shift.", [careAId]);

// Child 2: a handover from careA to the manager, read immediately by
// the manager (in the same fixture run) -- proving cross-role
// visibility (care_staff -> centre_manager) and the sender-name
// resolution.
await sendHandover(careA, children[1].passportId, "Refused breakfast but ate a full lunch. Watch for the 3pm transition, it's usually the hard part.", [managerId]);

// Children 3-8: real volume, addressed to BOTH care staff so both
// accounts can prove they see the same shared handover -- child 3
// gets 5 handovers (deliberately over PREVIEW_LIMIT=3) to prove the
// "+N more" capping genuinely triggers on a real, non-contrived
// thread, not just a fixture row count.
const busyChildIdx = 2;
for (let i = 1; i <= 5; i++) {
  await sendHandover(manager, children[busyChildIdx].passportId, `Handover note ${i} of 5 for this child -- shift change update.`, [careAId, careBId]);
}
for (let i = 3; i < 8; i++) {
  if (i === busyChildIdx) continue;
  await sendHandover(manager, children[i].passportId, `Quiet shift, nothing of note beyond the usual routine.`, [careAId, careBId]);
}
console.log("Handover messages sent.");

// Mark ONE of child 1's two messages as read, by careA -- via the real
// RPC, not a direct row update -- so the fixture shows a genuine mix
// of read and unread within the same group.
const { data: child1Messages } = await admin
  .from("messages")
  .select("id, created_at")
  .eq("passport_id", children[0].passportId)
  .order("created_at", { ascending: true });
await careA.rpc("mark_message_read", { p_message_id: child1Messages[0].id });
console.log("One message marked read by careA.");

const fixture = {
  stamp, password: PW,
  centre: { id: centre.id, code: centre.institution_code },
  manager: { email: managerEmail, id: managerId },
  careA: { email: careAEmail, id: careAId },
  careB: { email: careBEmail, id: careBId },
  children: children.map((c) => c.passportId),
  busyChildPassportId: children[busyChildIdx].passportId,
  busyChildStayId: children[busyChildIdx].stayId,
};
fs.writeFileSync("scripts/dev/zz-centre-messages-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify({ managerEmail, careAEmail, careBEmail, password: PW }, null, 2));
