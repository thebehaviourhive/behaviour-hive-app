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
const fixture = JSON.parse(fs.readFileSync("scripts/dev/zz-centre-messages-fixture.json", "utf8"));

const manager = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await manager.auth.signInWithPassword({ email: fixture.manager.email, password: fixture.password });

const { data: passportId, error: onboardErr } = await manager.rpc("onboard_clinic_client", { p_institution_id: fixture.centre.id, p_client_name: "ZZ Msg Child 09 (Closure Visual)" });
if (onboardErr) throw onboardErr;
const { data: episode } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).single();
const nowMs = Date.now();
const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
  p_episode_id: episode.id,
  p_starts_at: new Date(nowMs - 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
});
if (stayErr) throw stayErr;
const { error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
if (actErr) throw actErr;

const { data: categories } = await admin.from("message_categories").select("id").eq("label", "Handover").single();
const { error: sendErr } = await manager.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: categories.id,
  p_body: "VISUAL PROOF: this handover should vanish from Messages once the activation closes.",
  p_response_required: false,
  p_recipient_ids: [fixture.careA.id],
});
if (sendErr) throw sendErr;

console.log(JSON.stringify({ passportId, stayId }, null, 2));
