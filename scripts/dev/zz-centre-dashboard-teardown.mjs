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

// Comprehensive prefix-keyed sweep, matching this codebase's own
// established practice (the snooze fixture teardown hit this exact
// gap -- id-list-based teardown only knows about the ids a successful
// run produced; a prefix sweep catches everything, including partial
// runs).
const { data: institutions } = await admin.from("institutions").select("id, institution_code").ilike("institution_code", "ZZCENTRE%");
console.log("Matching institutions:", institutions?.length ?? 0, institutions?.map((i) => i.institution_code));
const institutionIds = (institutions ?? []).map((i) => i.id);

if (institutionIds.length > 0) {
  const { data: passportLinks } = await admin.from("passport_institution_links").select("passport_id").in("institution_id", institutionIds);
  const passportIds = [...new Set((passportLinks ?? []).map((p) => p.passport_id))];

  await admin.from("outstanding_task_snoozes").delete().in("institution_id", institutionIds);
  await admin.from("respite_on_call_designations").delete().in("institution_id", institutionIds);
  await admin.from("abc_logs").delete().in("passport_id", passportIds.length ? passportIds : ["00000000-0000-0000-0000-000000000000"]);
  await admin.from("respite_stay_checkins").delete().in("institution_id", institutionIds);
  await admin.from("respite_activations").delete().in("institution_id", institutionIds);
  await admin.from("respite_stays").delete().in("institution_id", institutionIds);
  await admin.from("episodes_of_care").delete().in("institution_id", institutionIds);
  await admin.from("passport_institution_links").delete().in("institution_id", institutionIds);
  if (passportIds.length) await admin.from("passports").delete().in("id", passportIds);
  await admin.from("institution_staff").delete().in("institution_id", institutionIds);
  await admin.from("institutions").delete().in("id", institutionIds);
}

const { data: authList } = await admin.auth.admin.listUsers({ perPage: 200 });
const leftover = (authList?.users ?? []).filter((u) => u.email?.includes("zzcentresmall") || u.email?.includes("zzcentrelarge"));
console.log("Leftover auth users:", leftover.length);
for (const u of leftover) {
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) console.error(`deleteUser ${u.email} error:`, error.message);
}

console.log("Teardown complete.");
const { data: finalInst } = await admin.from("institutions").select("id").ilike("institution_code", "ZZCENTRE%");
console.log("institutions remaining:", finalInst?.length ?? 0);
const { data: finalAuth } = await admin.auth.admin.listUsers({ perPage: 200 });
console.log(
  "auth users remaining:",
  (finalAuth?.users ?? []).filter((u) => u.email?.includes("zzcentresmall") || u.email?.includes("zzcentrelarge")).length
);
