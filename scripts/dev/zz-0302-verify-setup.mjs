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

const stamp = Date.now();
const PW = `Zz0302-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, email_confirm: true, password: PW,
    app_metadata: role ? { role } : undefined,
  });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0302 Clinic", institution_code: `ZZ0302CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id").single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0302 Centre", institution_code: `ZZ0302CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (centreErr) throw centreErr;

const { data: otherCentre, error: otherCentreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0302 Other Centre", institution_code: `ZZ0302OTHER${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (otherCentreErr) throw otherCentreErr;

const directorEmail = `zz0302.director.${stamp}@thebehaviourhive.com`;
const clinicianEmail = `zz0302.clinician.${stamp}@thebehaviourhive.com`;
const managerEmail = `zz0302.manager.${stamp}@thebehaviourhive.com`;
const careAEmail = `zz0302.carea.${stamp}@thebehaviourhive.com`;
const careBEmail = `zz0302.careb.${stamp}@thebehaviourhive.com`;
const outsiderCareEmail = `zz0302.outsidercare.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const clinicianId = await createUser(clinicianEmail, "clinician");
const managerId = await createUser(managerEmail, "centre_manager");
const careAId = await createUser(careAEmail, "care_staff");
const careBId = await createUser(careBEmail, "care_staff");
const outsiderCareId = await createUser(outsiderCareEmail, "care_staff");

await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianId, role: "clinician", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: careAId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: careBId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: otherCentre.id, user_id: outsiderCareId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();

const director = await signIn(directorEmail);
const manager = await signIn(managerEmail);

const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", { p_institution_id: clinic.id, p_client_name: "ZZ 0302 Child" });
if (onboardErr) throw onboardErr;

// A real date of birth -- get_respite_child_summary()'s own age display,
// and the RespiteChildRecord screen's "who is this child" step, both
// need a genuine value to render against.
await admin.from("passports").update({ date_of_birth: "2015-06-15" }).eq("id", passportId).throwOnError();

const { data: linkCode, error: linkErr } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
if (linkErr) throw linkErr;
const { error: redeemErr } = await manager.rpc("redeem_institution_link_code", { p_institution_id: centre.id, p_code: linkCode });
if (redeemErr) throw redeemErr;

const { data: episodeRow, error: episodeErr } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).eq("institution_id", centre.id).single();
if (episodeErr) throw episodeErr;

await admin.from("clinician_access").insert({
  passport_id: passportId, clinician_id: clinicianId, engaged_by: "institution",
  engaged_by_institution_id: clinic.id, is_active: true,
}).throwOnError();

const now = Date.now();
const { data: currentStayId, error: stayErr } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(now - 26 * 60 * 60 * 1000).toISOString(), // started yesterday -- a genuine multi-day stay
  p_ends_at: new Date(now + 24 * 60 * 60 * 1000).toISOString(),
});
if (stayErr) throw stayErr;

const { data: activationId, error: activateErr } = await manager.rpc("activate_respite_stay", { p_stay_id: currentStayId });
if (activateErr) throw activateErr;

// Content for the first-five-minutes screen.
const { data: fba, error: fbaErr } = await admin.from("fba_reports").insert({
  passport_id: passportId, clinician_id: clinicianId, status: "completed",
  completed_at: new Date().toISOString(), content_data: { summary: "ZZ 0302 FBA content" },
}).select("id").single();
if (fbaErr) throw fbaErr;

const { data: bsp, error: bspErr } = await admin.from("bsp").insert({
  passport_id: passportId, institution_id: clinic.id, clinician_id: clinicianId,
  status: "active", signed_at: new Date().toISOString(), signed_by: clinicianId,
}).select("id").single();
if (bspErr) throw bspErr;

await admin.from("bsp_strategies").insert({
  bsp_id: bsp.id, title: "ZZ 0302 Strategy", why: "Because reasons.", how: "Do this specific thing.", placement: "shared",
}).throwOnError();

await admin.from("fba_calm_cards").insert({
  fba_id: fba.id, strategy_ref: "recommendationsShared:zz0302", title: "ZZ 0302 Calm Card",
  steps: ["Step one", "Step two"], door_type: "prevention", is_published: true,
}).throwOnError();

const { data: plan, error: planErr } = await admin.from("clinical_plans").insert({
  passport_id: passportId, clinician_id: clinicianId, plan_type: "crisis_plan",
  name: "ZZ 0302 Crisis Plan", body: "If the child becomes distressed, do X then Y then Z.",
}).select("id").single();
if (planErr) throw planErr;

// A genuine trigger and communication method, on section B/C, for the
// screen's own ordered content to have something real to render.
await admin.from("passport_section_b").insert({
  passport_id: passportId, user_id: directorId, hard_triggers: ["Loud, sudden noises"],
}).throwOnError();
await admin.from("passport_section_c").insert({
  passport_id: passportId, user_id: directorId, communication_methods: ["Short, simple sentences"],
}).throwOnError();

// A backdated check-in "yesterday" (service role, standing in for a
// genuine prior-day entry, since the write RPC always stamps
// check_in_date as today) -- proving the multi-day span a moment later
// against a real, live-recorded "today" pair.
await admin.from("respite_stay_checkins").insert({
  stay_id: currentStayId, institution_id: centre.id, passport_id: passportId,
  check_in_type: "morning", check_in_date: new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  checked_in_by: careAId, note: "Settled well overnight.",
}).throwOnError();
await admin.from("respite_stay_checkins").insert({
  stay_id: currentStayId, institution_id: centre.id, passport_id: passportId,
  check_in_type: "end_of_day", check_in_date: new Date(now - 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
  checked_in_by: careAId, note: "Good day overall.",
}).throwOnError();

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, centreId: centre.id, otherCentreId: otherCentre.id,
  directorEmail, clinicianEmail, managerEmail, careAEmail, careBEmail, outsiderCareEmail,
  passportId, episodeId: episodeRow.id, currentStayId, activationId,
  fbaId: fba.id, bspId: bsp.id, clinicalPlanId: plan.id,
}, null, 2));
