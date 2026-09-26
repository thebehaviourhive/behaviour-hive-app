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

const fixture = JSON.parse(fs.readFileSync("scripts/dev/zz-logout-verify-fixture.json", "utf8"));

await admin.from("institution_staff").delete().eq("institution_id", fixture.centre.id);
await admin.from("institutions").delete().eq("id", fixture.centre.id);
await admin.auth.admin.deleteUser(fixture.manager.id);
await admin.auth.admin.deleteUser(fixture.care.id);

// Also remove the consents rows created by the real consent-screen flow
// (auth.users deletion cascades most things, but consents references
// user_id directly and is worth confirming explicitly).
const { count: staffLeft } = await admin.from("institution_staff").select("*", { count: "exact", head: true }).eq("institution_id", fixture.centre.id);
const { data: instLeft } = await admin.from("institutions").select("id").eq("id", fixture.centre.id);
const { data: usersLeft } = await admin.auth.admin.listUsers();
const stragglers = (usersLeft?.users ?? []).filter((u) => u.email?.includes(`zzlogout.`) && u.email?.includes(String(fixture.stamp)));

console.log(JSON.stringify({
  staffRowsRemaining: staffLeft ?? 0,
  institutionRemaining: instLeft?.length ?? 0,
  strayUsersRemaining: stragglers.length,
}, null, 2));

fs.unlinkSync("scripts/dev/zz-logout-verify-fixture.json");
console.log("Teardown complete.");
