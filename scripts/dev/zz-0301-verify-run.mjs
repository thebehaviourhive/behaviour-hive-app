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

const f = JSON.parse(fs.readFileSync("/tmp/zz-0301-fixture.json", "utf8"));
const { password, clinicId, centreId, directorEmail, clinicianEmail, managerEmail, careStaffEmail,
  passportId, currentStayId, staleStayId } = f;

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} -- ${name}${detail ? " -- " + JSON.stringify(detail) : ""}`);
}

const director = await signIn(directorEmail);
const manager = await signIn(managerEmail);
const careStaff = await signIn(careStaffEmail);

async function careStaffCanRead(table, filterCol, filterVal) {
  const { data, error } = await careStaff.from(table).select("id").eq(filterCol, filterVal);
  return { ok: !error && (data ?? []).length > 0, error, data };
}
async function managerCanRead(table, filterCol, filterVal) {
  const { data, error } = await manager.from(table).select("id").eq(filterCol, filterVal);
  return { ok: !error && (data ?? []).length > 0, error, data };
}

// =====================================================================
// 1. BEFORE ACTIVATION: care_staff reads nothing on any of the six
// gated targets. bsp_strategies checked via its own bsp_id filter.
// =====================================================================
for (const [table] of [["passport_section_b"], ["passport_section_c"], ["passport_section_d"], ["passport_section_e"], ["fba_reports"], ["bsp"], ["clinical_plans"]]) {
  const r = await careStaffCanRead(table, "passport_id", passportId);
  check(`BEFORE activation: care_staff reads nothing on ${table}`, !r.ok, { error: r.error?.message, count: r.data?.length });
}
{
  const { data, error } = await careStaff.from("bsp_strategies").select("id").eq("bsp_id", f.bspId);
  check("BEFORE activation: care_staff reads nothing on bsp_strategies", !error && (data ?? []).length === 0, { error: error?.message });
}
{
  const { data, error } = await careStaff.from("fba_calm_cards").select("id").eq("fba_id", f.fbaId);
  check("BEFORE activation: care_staff reads nothing on fba_calm_cards", !error && (data ?? []).length === 0, { error: error?.message });
}

// =====================================================================
// 2. ACTIVATE (real centre_manager session), can be checked ahead of
// the stay's own start -- but this stay is already "current" (started
// an hour ago), so we're proving the ordinary case here; the ahead-of-
// time claim is structural (activate_respite_stay has no time check at
// all, confirmed by reading it) rather than needing its own live test.
// =====================================================================
const { data: activationId, error: activateErr } = await manager.rpc("activate_respite_stay", { p_stay_id: currentStayId });
check("centre manager activates the stay", !activateErr && Boolean(activationId), { activateErr: activateErr?.message });

const { data: doubleActivate, error: doubleActivateErr } = await manager.rpc("activate_respite_stay", { p_stay_id: currentStayId });
check("double-activation is refused", !!doubleActivateErr, { doubleActivateErr: doubleActivateErr?.message });

// =====================================================================
// 3. AFTER ACTIVATION: care_staff reads all five things (the six
// tables -- sections B-E count as one thing, "the behavioural
// profile") and NOTHING ELSE (session_notes, assessments,
// afls_assessments all stay refused).
// =====================================================================
for (const table of ["passport_section_b", "passport_section_c", "passport_section_d", "passport_section_e", "fba_reports", "bsp", "clinical_plans"]) {
  const r = await careStaffCanRead(table, "passport_id", passportId);
  check(`AFTER activation: care_staff reads ${table}`, r.ok, { error: r.error?.message, count: r.data?.length });
}
{
  const { data, error } = await careStaff.from("bsp_strategies").select("id, title").eq("bsp_id", f.bspId);
  check("AFTER activation: care_staff reads bsp_strategies", !error && (data ?? []).length === 1, { error: error?.message, data });
}
{
  const { data, error } = await careStaff.from("fba_calm_cards").select("id, title").eq("fba_id", f.fbaId);
  check("AFTER activation: care_staff reads fba_calm_cards", !error && (data ?? []).length === 1, { error: error?.message, data });
}

// The "nothing else" half -- session_notes, assessments, afls_assessments.
{
  const r = await careStaffCanRead("session_notes", "passport_id", passportId);
  check("AFTER activation: care_staff STILL reads nothing on session_notes", !r.ok, { error: r.error?.message, count: r.data?.length });
}
{
  const r = await careStaffCanRead("assessments", "passport_id", passportId);
  check("AFTER activation: care_staff STILL reads nothing on assessments", !r.ok, { error: r.error?.message, count: r.data?.length });
}
{
  const { data, error } = await careStaff.from("afls_assessments").select("id").eq("fba_id", f.fbaId);
  check("AFTER activation: care_staff STILL reads nothing on afls_assessments", !error && (data ?? []).length === 0, { error: error?.message });
}

// =====================================================================
// 4. centre_manager also reads all six, placement-scoped, throughout --
// activation state was never relevant to the manager's own read.
// =====================================================================
for (const table of ["passport_section_b", "fba_reports", "bsp", "clinical_plans"]) {
  const r = await managerCanRead(table, "passport_id", passportId);
  check(`centre manager reads ${table} regardless of activation`, r.ok, { error: r.error?.message, count: r.data?.length });
}

// =====================================================================
// 5. THE POKA-YOKE: finalise the report -- closes the stay's own open
// activation in the same transaction. care_staff loses read; manager
// keeps it.
// =====================================================================
const { data: reportId, error: finalizeErr } = await manager.rpc("finalize_respite_stay_report", {
  p_stay_id: currentStayId, p_body: "ZZ 0301 post-stay report body.",
});
check("centre manager finalises the report", !finalizeErr && Boolean(reportId), { finalizeErr: finalizeErr?.message });

const { data: reFinalize, error: reFinalizeErr } = await manager.rpc("finalize_respite_stay_report", {
  p_stay_id: currentStayId, p_body: "second attempt",
});
check("re-finalising an already-finalised report is refused", !!reFinalizeErr, { reFinalizeErr: reFinalizeErr?.message });

for (const table of ["passport_section_b", "fba_reports", "bsp", "clinical_plans"]) {
  const r = await careStaffCanRead(table, "passport_id", passportId);
  check(`AFTER finalise: care_staff CAN NO LONGER read ${table}`, !r.ok, { error: r.error?.message, count: r.data?.length });
}
{
  const { data, error } = await careStaff.from("fba_calm_cards").select("id").eq("fba_id", f.fbaId);
  check("AFTER finalise: care_staff CAN NO LONGER read fba_calm_cards", !error && (data ?? []).length === 0, { error: error?.message });
}

for (const table of ["passport_section_b", "fba_reports", "bsp", "clinical_plans"]) {
  const r = await managerCanRead(table, "passport_id", passportId);
  check(`AFTER finalise: centre manager STILL reads ${table} (placement-scoped)`, r.ok, { error: r.error?.message, count: r.data?.length });
}

// The activation row itself, confirmed closed with the right reason.
const { data: closedActivation } = await admin.from("respite_activations").select("closed_reason").eq("stay_id", currentStayId).single();
check("the activation's own closed_reason is 'report_finalised'", closedActivation?.closed_reason === "report_finalised", { closedActivation });

// =====================================================================
// 6. THE TIMED BACKSTOP: the stale stay (ended 12 days ago) is
// activated fresh, read is confirmed working, then
// expire_stale_respite_activations() (service role, default 7-day
// grace) closes it -- and care_staff loses read again.
// =====================================================================
const { data: staleActivationId, error: staleActivateErr } = await manager.rpc("activate_respite_stay", { p_stay_id: staleStayId });
check("centre manager activates the stale (already-ended) stay", !staleActivateErr && Boolean(staleActivationId), { staleActivateErr: staleActivateErr?.message });

{
  const r = await careStaffCanRead("passport_section_b", "passport_id", passportId);
  check("care_staff reads section B via the freshly-activated stale stay", r.ok, { error: r.error?.message });
}

const { data: expiredCount, error: expireErr } = await admin.rpc("expire_stale_respite_activations");
check("expire_stale_respite_activations() (default 7-day grace) closes the stale activation", !expireErr && expiredCount === 1, { expireErr: expireErr?.message, expiredCount });

{
  const r = await careStaffCanRead("passport_section_b", "passport_id", passportId);
  check("AFTER expiry: care_staff CAN NO LONGER read section B", !r.ok, { error: r.error?.message });
}
{
  const r = await managerCanRead("passport_section_b", "passport_id", passportId);
  check("AFTER expiry: centre manager STILL reads section B", r.ok, { error: r.error?.message });
}

const { data: expiredRow } = await admin.from("respite_activations").select("closed_reason").eq("id", staleActivationId).single();
check("the stale activation's own closed_reason is 'expired'", expiredRow?.closed_reason === "expired", { expiredRow });

// =====================================================================
// 7. Outstanding work -- the stale stay (no finalised report) shows up;
// the current stay (finalised) does not.
// =====================================================================
const { data: awaiting, error: awaitingErr } = await manager.rpc("get_respite_stays_awaiting_report", { p_institution_id: centreId });
const awaitingIds = (awaiting ?? []).map((r) => r.stay_id);
check("get_respite_stays_awaiting_report() lists the stale (unreported) stay", !awaitingErr && awaitingIds.includes(staleStayId), { awaitingErr: awaitingErr?.message, awaitingIds });
check("get_respite_stays_awaiting_report() correctly excludes the finalised current stay", !awaitingIds.includes(currentStayId), { awaitingIds });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}
