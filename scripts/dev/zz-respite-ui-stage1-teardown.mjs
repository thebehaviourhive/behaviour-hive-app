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
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const fixture = JSON.parse(fs.readFileSync("scripts/dev/zz-respite-ui-stage1-fixture.json", "utf8"));

async function del(table, column, values) {
  if (!values.length) return;
  const { error } = await admin.from(table).delete().in(column, values);
  if (error) console.error(`${table} delete error:`, error.message);
}

const institutionIds = [fixture.centre.id];
const passportIds = [fixture.childPassportId];

await del("respite_stay_checkins", "stay_id", [fixture.stayId]);
await del("respite_activations", "stay_id", [fixture.stayId]);
await del("respite_stays", "id", [fixture.stayId]);
await del("episodes_of_care", "passport_id", passportIds);
await del("passport_institution_links", "passport_id", passportIds);
await del("passports", "id", passportIds);
await del("institution_staff", "institution_id", institutionIds);
await del("institutions", "id", institutionIds);

// The manager, plus the real care_staff account that joined via the
// live signup flow during verification.
const { data: authList } = await admin.auth.admin.listUsers({ perPage: 200 });
const leftover = (authList?.users ?? []).filter((u) => u.email?.includes("zzrespiteui"));
for (const u of leftover) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`deleteUser ${u.email} error:`, error.message);
}

console.log("Teardown complete.");

const { data: finalInst } = await admin.from("institutions").select("id").in("id", institutionIds);
console.log("institutions remaining:", finalInst?.length ?? 0);
const { data: finalAuth } = await admin.auth.admin.listUsers({ perPage: 200 });
console.log("zzrespiteui auth users remaining:", (finalAuth?.users ?? []).filter((u) => u.email?.includes("zzrespiteui")).length);
