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

const f = JSON.parse(fs.readFileSync("/tmp/zz-e2e-respite-fixture.json", "utf8"));

// Order matters -- children of institution_staff/passport rows first,
// then the accounts, then the institutions themselves.
await admin.from("respite_stay_checkins").delete().eq("passport_id", f.passportId);
await admin.from("respite_post_stay_reports").delete().eq("passport_id", f.passportId);
await admin.from("respite_activations").delete().eq("passport_id", f.passportId);
await admin.from("respite_stays").delete().eq("passport_id", f.passportId);
await admin.from("respite_on_call_designations").delete().eq("institution_id", f.centreId);
await admin.from("message_recipients").delete().eq("message_id", (await admin.from("messages").select("id").eq("passport_id", f.passportId)).data?.[0]?.id ?? "00000000-0000-0000-0000-000000000000");
await admin.from("messages").delete().eq("passport_id", f.passportId);
await admin.from("passport_link_codes").delete().eq("passport_id", f.passportId);
await admin.from("episodes_of_care").delete().eq("passport_id", f.passportId);
await admin.from("passport_institution_links").delete().eq("passport_id", f.passportId);
await admin.from("consents").delete().in("user_id", [f.directorId, f.managerId, f.careAId, f.careBId]);
await admin.from("institution_staff").delete().in("user_id", [f.directorId, f.managerId, f.careAId, f.careBId]);
await admin.from("passports").delete().eq("id", f.passportId);

for (const uid of [f.directorId, f.managerId, f.careAId, f.careBId]) {
  await admin.auth.admin.deleteUser(uid);
}

await admin.from("institutions").delete().eq("id", f.clinicId);
await admin.from("institutions").delete().eq("id", f.centreId);

// Confirm zero orphans.
const { data: leftoverInst } = await admin.from("institutions").select("id").in("id", [f.clinicId, f.centreId]);
const { data: leftoverPassport } = await admin.from("passports").select("id").eq("id", f.passportId);
const { data: leftoverUsers } = await admin.auth.admin.listUsers({ perPage: 1000 });
const leftoverAccounts = leftoverUsers.users.filter((u) => [f.directorEmail, f.managerEmail, f.careAEmail, f.careBEmail].includes(u.email));

console.log("Leftover institutions:", leftoverInst);
console.log("Leftover passport:", leftoverPassport);
console.log("Leftover accounts:", leftoverAccounts.map((u) => u.email));
console.log(leftoverInst.length === 0 && leftoverPassport.length === 0 && leftoverAccounts.length === 0 ? "CLEAN -- zero orphans." : "ORPHANS FOUND.");
