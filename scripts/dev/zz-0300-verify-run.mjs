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

const fixture = JSON.parse(fs.readFileSync("/tmp/zz-0300-fixture.json", "utf8"));
const { password, clinicId, centreId, directorEmail, managerAEmail, managerBEmail, careStaffEmail, outsiderManagerEmail } = fixture;

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
const managerA = await signIn(managerAEmail);
const managerB = await signIn(managerBEmail);
const outsiderManager = await signIn(outsiderManagerEmail);

// Real client, real placement at the REAL centre.
const { data: passportId } = await director.rpc("onboard_clinic_client", { p_institution_id: clinicId, p_client_name: "ZZ 0300 Child" });
const { data: linkCode } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
await managerA.rpc("redeem_institution_link_code", { p_institution_id: centreId, p_code: linkCode });
const { data: episodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).eq("institution_id", centreId).single();

// A real stay that has ALREADY ENDED, with a real care_staff-authored
// entry against it -- the exact shape the post-stay report assembles
// from: entries a care worker logged during a now-past stay, which the
// manager needs to read once the stay is over to write the report.
const careStaffUid = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === careStaffEmail).id;
const past = Date.now() - 5 * 24 * 60 * 60 * 1000;
const { data: pastStayId } = await managerA.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(past).toISOString(),
  p_ends_at: new Date(past + 2 * 24 * 60 * 60 * 1000).toISOString(), // ended 3 days ago
});

// Since the stay has already ended, care_staff's own INSERT policy
// (0297, stay-scoped) would correctly refuse a write against it now --
// so this entry is inserted via service role, standing in for "an entry
// genuinely written during that now-past stay" (proving the READ side
// of a stay that's over, not re-proving the write side, already covered
// by Stage 3's own 18/18 and 0299's own 9/9).
const { data: pastEntry, error: pastEntryErr } = await admin
  .from("abc_logs")
  .insert({
    passport_id: passportId, logged_by: careStaffUid, logged_by_role: "care_staff", stay_id: pastStayId,
    intensity: 3, antecedents: ["transition"], behaviours: ["shouting"], consequences: ["redirected"],
    perceived_function: "escape",
  })
  .select("id")
  .single();
if (pastEntryErr) throw pastEntryErr;

// 1. THE REPORT-WRITING CASE: centre_manager B (a DIFFERENT manager,
// same centre, never redeemed the code or wrote this entry) reads
// care_staff's entry from the now-ended stay -- via the raw table
// SELECT (RLS). This is the exact "manager assembling the report from a
// colleague's entries" case.
const { data: rawRead, error: rawReadErr } = await managerB
  .from("abc_logs")
  .select("id, logged_by_role, stay_id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("centre_manager B reads care_staff's entry from a now-ENDED stay, raw RLS", !rawReadErr && rawRead?.id === pastEntry.id, { rawReadErr: rawReadErr?.message, rawRead });

// 2. The same case, via get_abc_logs() -- the actual sanctioned UI path.
const { data: rpcRead, error: rpcReadErr } = await managerB.rpc("get_abc_logs", { p_passport_id: passportId });
const foundViaRpc = (rpcRead ?? []).find((r) => r.id === pastEntry.id);
check("centre_manager B reads the same entry via get_abc_logs()", !rpcReadErr && Boolean(foundViaRpc), { rpcReadErr: rpcReadErr?.message, foundViaRpc });

// 3. perceived_function stays redacted for centre_manager even though
// they CAN now read the row -- confirms the redaction survives the new
// read grant. A centre manager is an administrative role, not clinical.
check("perceived_function stays null for centre_manager via get_abc_logs()", foundViaRpc && foundViaRpc.perceived_function === null, { perceived_function: foundViaRpc?.perceived_function });

// 4. Manager A (the one who redeemed the code, the "primary" manager)
// also reads it -- not just B reading a colleague's entry.
const { data: selfCentreRead, error: selfCentreReadErr } = await managerA
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("centre_manager A (redeemed the code) can also read the entry", !selfCentreReadErr && selfCentreRead?.id === pastEntry.id, { selfCentreReadErr: selfCentreReadErr?.message });

// 5. NEGATIVE: an outsider centre_manager at a WHOLLY UNRELATED centre
// gets nothing.
const { data: outsiderRead, error: outsiderReadErr } = await outsiderManager
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("an outsider centre_manager at an unrelated centre CANNOT read the entry (raw RLS)", !outsiderReadErr && outsiderRead === null, { outsiderReadErr: outsiderReadErr?.message, outsiderRead });

const { data: outsiderRpcRead, error: outsiderRpcErr } = await outsiderManager.rpc("get_abc_logs", { p_passport_id: passportId });
check("the same outsider gets zero rows via get_abc_logs() too", !outsiderRpcErr && (outsiderRpcRead ?? []).length === 0, { outsiderRpcErr: outsiderRpcErr?.message, count: outsiderRpcRead?.length });

// 6. NEGATIVE, THE SHARPEST CASE: once the PLACEMENT itself ends
// (discharged), read access closes too -- even for a centre_manager at
// the RIGHT centre. "Active at their centre" is a real, live-checked
// fact, not a one-time grant -- and this is the exact moment a real
// manager would ALSO be finalising the post-stay report, so the report-
// writing window and the discharge moment need to be understood
// together, not assumed independent.
const { data: reasons } = await admin.from("discharge_reasons").select("value").limit(1);
const { error: dischargeErr } = await managerA.rpc("end_clinic_episode", { p_episode_id: episodeRow.id, p_reason: reasons[0].value });
check("centre manager discharges the placement (real RPC)", !dischargeErr, { dischargeErr: dischargeErr?.message });

const { data: postDischargeRead, error: postDischargeErr } = await managerB
  .from("abc_logs")
  .select("id")
  .eq("id", pastEntry.id)
  .maybeSingle();
check("after discharge, centre_manager B CAN NO LONGER read the same entry (raw RLS)", !postDischargeErr && postDischargeRead === null, { postDischargeErr: postDischargeErr?.message, postDischargeRead });

const { data: postDischargeRpc, error: postDischargeRpcErr } = await managerB.rpc("get_abc_logs", { p_passport_id: passportId });
check("after discharge, get_abc_logs() also returns zero rows for centre_manager B", !postDischargeRpcErr && (postDischargeRpc ?? []).length === 0, { postDischargeRpcErr: postDischargeRpcErr?.message, count: postDischargeRpc?.length });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}
