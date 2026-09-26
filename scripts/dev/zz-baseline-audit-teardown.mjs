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

const { data: institutions } = await admin.from("institutions").select("id, institution_code").ilike("institution_code", "ZZBASELINE%");
console.log(`Found ${institutions?.length ?? 0} matching institution(s).`);

for (const inst of institutions ?? []) {
  const { data: passportLinks } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", inst.id);
  const passportIds = [...new Set((passportLinks ?? []).map((r) => r.passport_id))];

  if (passportIds.length > 0) {
    await admin.from("messages").delete().in("passport_id", passportIds);
    await admin.from("respite_stay_checkins").delete().eq("institution_id", inst.id);
    await admin.from("respite_post_stay_reports").delete().in("stay_id",
      (await admin.from("respite_stays").select("id").eq("institution_id", inst.id)).data?.map((r) => r.id) ?? []
    );
    await admin.from("respite_activations").delete().eq("institution_id", inst.id);
    await admin.from("respite_stays").delete().eq("institution_id", inst.id);
    await admin.from("episodes_of_care").delete().eq("institution_id", inst.id);
    await admin.from("passport_institution_links").delete().eq("institution_id", inst.id);
    for (const pid of passportIds) {
      await admin.from("passports").delete().eq("id", pid);
    }
  }

  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`Torn down institution ${inst.institution_code}.`);
}

const { data: users } = await admin.auth.admin.listUsers();
const stragglers = (users?.users ?? []).filter((u) => u.email?.startsWith("zzbaseline."));
for (const u of stragglers) {
  await admin.auth.admin.deleteUser(u.id);
  console.log(`Deleted stray user ${u.email}.`);
}

console.log(JSON.stringify({
  institutionsRemaining: (await admin.from("institutions").select("id", { count: "exact", head: true }).ilike("institution_code", "ZZBASELINE%")).count,
  usersRemaining: (await admin.auth.admin.listUsers()).data.users.filter((u) => u.email?.startsWith("zzbaseline.")).length,
}, null, 2));

if (fs.existsSync("scripts/dev/zz-baseline-audit-fixture.json")) {
  fs.unlinkSync("scripts/dev/zz-baseline-audit-fixture.json");
}
console.log("Teardown complete.");
