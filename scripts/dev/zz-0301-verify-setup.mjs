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
const PW = `Zz0301-${stamp}!`;

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
  .insert({ name: "ZZ 0301 Clinic", institution_code: `ZZ0301CLINIC${stamp}`, status: "verified", type: "clinic" })
  .select("id").single();
if (clinicErr) throw clinicErr;

const { data: centre, error: centreErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ 0301 Centre", institution_code: `ZZ0301CENTRE${stamp}`, status: "verified", type: "respite_centre" })
  .select("id").single();
if (centreErr) throw centreErr;

const directorEmail = `zz0301.director.${stamp}@thebehaviourhive.com`;
const clinicianEmail = `zz0301.clinician.${stamp}@thebehaviourhive.com`;
const managerEmail = `zz0301.manager.${stamp}@thebehaviourhive.com`;
const careStaffEmail = `zz0301.carestaff.${stamp}@thebehaviourhive.com`;

const directorId = await createUser(directorEmail, "principal");
const clinicianId = await createUser(clinicianEmail, "clinician");
const managerId = await createUser(managerEmail, "centre_manager");
const careStaffId = await createUser(careStaffEmail, "care_staff");

await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();
await admin.from("institution_staff").insert({
  institution_id: clinic.id, user_id: clinicianId, role: "clinician", approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();
await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: managerId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();
await admin.from("institution_staff").insert({
  institution_id: centre.id, user_id: careStaffId, role: "care_staff", approved_at: new Date().toISOString(), approval_source: "bootstrap",
}).throwOnError();

const director = await signIn(directorEmail);
const manager = await signIn(managerEmail);

// Real production paths throughout: onboard, generate the clinic's own
// link code, redeem it as the centre manager -- creates the placement.
const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", {
  p_institution_id: clinic.id, p_client_name: "ZZ 0301 Child",
});
if (onboardErr) throw onboardErr;

const { data: linkCode, error: linkErr } = await director.rpc("generate_institution_link_code_for_clinic", {
  p_passport_id: passportId,
});
if (linkErr) throw linkErr;

const { error: redeemErr } = await manager.rpc("redeem_institution_link_code", {
  p_institution_id: centre.id, p_code: linkCode,
});
if (redeemErr) throw redeemErr;

const { data: episodeRow, error: episodeErr } = await admin
  .from("episodes_of_care")
  .select("id")
  .eq("passport_id", passportId)
  .eq("institution_id", centre.id)
  .single();
if (episodeErr) throw episodeErr;

// A real clinician_access row -- matching real data shape, even though
// none of this migration's own new policies depend on it.
await admin.from("clinician_access").insert({
  passport_id: passportId, clinician_id: clinicianId, engaged_by: "institution",
  engaged_by_institution_id: clinic.id, is_active: true,
}).throwOnError();

// Two real stays: one near-now (for the activate -> read -> finalise ->
// closed sequence), one deliberately far in the past (for the timed
// backstop -- ended 12 days ago, well past the 7-day default grace).
const now = Date.now();
const { data: currentStayId, error: stay1Err } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(now - 1 * 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(now + 2 * 60 * 60 * 1000).toISOString(),
});
if (stay1Err) throw stay1Err;

const { data: staleStayId, error: stay2Err } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(now - 12 * 24 * 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(now - 10 * 24 * 60 * 60 * 1000).toISOString(),
});
if (stay2Err) throw stay2Err;

// The six clinical targets, seeded via service role -- standing in for
// genuinely clinic-authored content, the same posture this session has
// already used repeatedly ("service-role stands in for a genuine write,
// since what's being proven is the READ gate, not the authoring flow").
const { data: fba, error: fbaErr } = await admin.from("fba_reports").insert({
  passport_id: passportId, clinician_id: clinicianId, status: "completed",
  completed_at: new Date().toISOString(), content_data: { summary: "ZZ 0301 FBA content" },
}).select("id").single();
if (fbaErr) throw fbaErr;

await admin.from("afls_assessments").insert({
  fba_id: fba.id, assessor_name: "ZZ 0301 Assessor", scores: {},
}).throwOnError();

const { data: bsp, error: bspErr } = await admin.from("bsp").insert({
  passport_id: passportId, institution_id: clinic.id, clinician_id: clinicianId,
  status: "active", signed_at: new Date().toISOString(), signed_by: clinicianId,
}).select("id").single();
if (bspErr) throw bspErr;

await admin.from("bsp_strategies").insert({
  bsp_id: bsp.id, title: "ZZ 0301 Strategy", why: "Because.", how: "Like this.", placement: "shared",
}).throwOnError();

await admin.from("fba_calm_cards").insert({
  fba_id: fba.id, strategy_ref: "recommendationsShared:zz0301", title: "ZZ 0301 Calm Card",
  steps: ["Step one", "Step two"], door_type: "prevention", is_published: true,
}).throwOnError();

const { data: plan, error: planErr } = await admin.from("clinical_plans").insert({
  passport_id: passportId, clinician_id: clinicianId, plan_type: "crisis_plan",
  name: "ZZ 0301 Crisis Plan", body: "ZZ 0301 crisis plan body.",
}).select("id").single();
if (planErr) throw planErr;

// Negative controls -- explicitly NOT gated by this migration.
await admin.from("session_notes").insert({
  passport_id: passportId, clinician_id: clinicianId, clinical_record: "ZZ 0301 session note.",
}).throwOnError();

const { data: instrument } = await admin.from("assessment_instruments").select("id").eq("record_type", "external_record").limit(1).single();
await admin.from("assessments").insert({
  passport_id: passportId, clinician_id: clinicianId, instrument_id: instrument.id,
}).throwOnError();

// Section B/C/D/E -- one row each, seeded via service role (no parent
// has claimed this clinic client yet, so user_id is a placeholder --
// none of this migration's own new policies reference it).
for (const table of ["passport_section_b", "passport_section_c", "passport_section_d"]) {
  await admin.from(table).insert({ passport_id: passportId, user_id: directorId }).throwOnError();
}
await admin.from("passport_section_e").insert({ passport_id: passportId, user_id: directorId }).throwOnError();

console.log(JSON.stringify({
  stamp, password: PW,
  clinicId: clinic.id, centreId: centre.id,
  directorEmail, clinicianEmail, managerEmail, careStaffEmail,
  passportId, episodeId: episodeRow.id,
  currentStayId, staleStayId,
  fbaId: fba.id, bspId: bsp.id, clinicalPlanId: plan.id,
}, null, 2));
