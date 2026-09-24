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

const fixture = JSON.parse(fs.readFileSync("/tmp/zz-0299-fixture.json", "utf8"));
const { password, clinicId, centreId, otherCentreId, directorEmail, managerEmail, careAEmail, careBEmail, outsiderCareEmail } = fixture;

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
const careA = await signIn(careAEmail);
const careB = await signIn(careBEmail);
const outsiderCare = await signIn(outsiderCareEmail);

// Real client, real placement at the REAL centre.
const { data: passportId } = await director.rpc("onboard_clinic_client", { p_institution_id: clinicId, p_client_name: "ZZ 0299 Child" });
const { data: linkCode } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
await manager.rpc("redeem_institution_link_code", { p_institution_id: centreId, p_code: linkCode });
const { data: episodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).eq("institution_id", centreId).single();

// A real stay that has ALREADY ENDED -- proving read does NOT need an
// active stay window, only an active placement (the whole point of
// this migration's own "write is stay-scoped, read is placement-
// scoped" distinction).
const past = Date.now() - 5 * 24 * 60 * 60 * 1000;
const { data: pastStayId } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(past).toISOString(),
  p_ends_at: new Date(past + 2 * 24 * 60 * 60 * 1000).toISOString(), // ended 3 days ago
});

const careAUid = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === careAEmail).id;
const careBUid = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === careBEmail).id;

// Since the stay has already ENDED, careA's own INSERT policy (0297,
// stay-scoped) would correctly refuse a write against it now -- so
// this entry is inserted via service role, standing in for "an entry
// genuinely written during that now-past shift" (proving the READ
// side of a stay that's over, not re-proving the write side, which is
// already covered by Stage 3's own 18/18).
const { data: pastEntry, error: pastEntryErr } = await admin
  .from("abc_logs")
  .insert({
    passport_id: passportId, logged_by: careAUid, logged_by_role: "care_staff", stay_id: pastStayId,
    intensity: 3, antecedents: ["transition"], behaviours: ["shouting"], consequences: ["redirected"],
    perceived_function: "escape",
  })
  .select("id")
  .single();
if (pastEntryErr) throw pastEntryErr;

// 1. THE HANDOVER CASE: care_staff B (a DIFFERENT worker, same centre,
// never wrote this entry) reads care_staff A's entry from the
// now-ended shift -- via the raw table SELECT (RLS).
const { data: rawRead, error: rawReadErr } = await careB
  .from("abc_logs")
  .select("id, logged_by_role, stay_id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("care_staff B reads care_staff A's entry from a now-ENDED shift, raw RLS", !rawReadErr && rawRead?.id === pastEntry.id, { rawReadErr: rawReadErr?.message, rawRead });

// 2. The same case, via get_abc_logs() -- the actual sanctioned UI path.
const { data: rpcRead, error: rpcReadErr } = await careB.rpc("get_abc_logs", { p_passport_id: passportId });
const foundViaRpc = (rpcRead ?? []).find((r) => r.id === pastEntry.id);
check("care_staff B reads the same entry via get_abc_logs()", !rpcReadErr && Boolean(foundViaRpc), { rpcReadErr: rpcReadErr?.message, foundViaRpc });

// 3. perceived_function stays redacted for care_staff even though they
// CAN now read the row -- confirms the redaction survives the new
// read grant, not bypassed by it.
check("perceived_function stays null for care_staff via get_abc_logs()", foundViaRpc && foundViaRpc.perceived_function === null, { perceived_function: foundViaRpc?.perceived_function });

// 4. care_staff A reads their OWN entry too (not just B reading A's).
const { data: selfRead, error: selfReadErr } = await careA
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("care_staff A (the original author) can also read their own entry back", !selfReadErr && selfRead?.id === pastEntry.id, { selfReadErr: selfReadErr?.message });

// 5. NEGATIVE: an outsider care_staff at a WHOLLY UNRELATED centre gets nothing.
const { data: outsiderRead, error: outsiderReadErr } = await outsiderCare
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("an outsider care_staff at an unrelated centre CANNOT read the entry (raw RLS)", !outsiderReadErr && outsiderRead === null, { outsiderReadErr: outsiderReadErr?.message, outsiderRead });

const { data: outsiderRpcRead, error: outsiderRpcErr } = await outsiderCare.rpc("get_abc_logs", { p_passport_id: passportId });
check("the same outsider gets zero rows via get_abc_logs() too", !outsiderRpcErr && (outsiderRpcRead ?? []).length === 0, { outsiderRpcErr: outsiderRpcErr?.message, count: outsiderRpcRead?.length });

// 6. NEGATIVE, THE SHARPEST CASE: once the PLACEMENT itself ends
// (discharged), read access closes too -- even for care_staff at the
// RIGHT centre. "Active at their centre" is a real, live-checked fact,
// not a one-time grant.
const { data: reasons } = await admin.from("discharge_reasons").select("value").limit(1);
const { error: dischargeErr } = await manager.rpc("end_clinic_episode", { p_episode_id: episodeRow.id, p_reason: reasons[0].value });
check("centre manager discharges the placement (real RPC)", !dischargeErr, { dischargeErr: dischargeErr?.message });

const { data: postDischargeRead, error: postDischargeErr } = await careB
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("after discharge, care_staff B CAN NO LONGER read the same entry (raw RLS)", !postDischargeErr && postDischargeRead === null, { postDischargeErr: postDischargeErr?.message, postDischargeRead });

const { data: postDischargeRpc, error: postDischargeRpcErr } = await careB.rpc("get_abc_logs", { p_passport_id: passportId });
check("after discharge, get_abc_logs() also returns zero rows for care_staff B", !postDischargeRpcErr && (postDischargeRpc ?? []).length === 0, { postDischargeRpcErr: postDischargeRpcErr?.message, count: postDischargeRpc?.length });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}
