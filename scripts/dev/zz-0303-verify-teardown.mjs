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
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const { data: institutions } = await admin
  .from("institutions")
  .select("id, institution_code")
  .ilike("institution_code", "ZZ0303%");

const { data: strayPassports } = await admin.from("passports").select("id").eq("child_name", "ZZ 0303 Child");
for (const p of strayPassports ?? []) {
  await admin.from("message_recipients").delete().in(
    "message_id",
    (await admin.from("messages").select("id").eq("passport_id", p.id)).data?.map((m) => m.id) ?? []
  );
  await admin.from("messages").delete().eq("passport_id", p.id);
  await admin.from("respite_activations").delete().eq("passport_id", p.id);
  await admin.from("respite_stay_checkins").delete().eq("passport_id", p.id);
  await admin.from("respite_post_stay_reports").delete().eq("passport_id", p.id);
  await admin.from("respite_stays").delete().eq("passport_id", p.id);
  await admin.from("clinician_access").delete().eq("passport_id", p.id);
  await admin.from("episodes_of_care").delete().eq("passport_id", p.id);
  await admin.from("passport_access").delete().eq("passport_id", p.id);
  await admin.from("passport_guardians").delete().eq("passport_id", p.id);
  await admin.from("enrolments").delete().eq("passport_id", p.id);
  await admin.from("passport_institution_links").delete().eq("passport_id", p.id);
  await admin.from("passports").delete().eq("id", p.id);
  console.log(`Deleted stray passport ${p.id}`);
}

for (const inst of institutions ?? []) {
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`Deleted institution ${inst.institution_code}`);
}

const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
const targets = usersList.users.filter((u) => u.email && u.email.startsWith("zz0303."));
for (const u of targets) {
  await admin.from("consents").delete().eq("user_id", u.id);
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) throw new Error(`deleteUser ${u.email}: ${error.message}`);
  console.log(`Deleted user ${u.email}`);
}

const { data: instAfter } = await admin.from("institutions").select("id").ilike("institution_code", "ZZ0303%");
const { data: passportsAfter } = await admin.from("passports").select("id").eq("child_name", "ZZ 0303 Child");
const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 1000 });
const remainingUsers = usersAfter.users.filter((u) => u.email && u.email.startsWith("zz0303."));

console.log(JSON.stringify({
  remainingInstitutions: instAfter?.length ?? 0,
  remainingPassports: passportsAfter?.length ?? 0,
  remainingUsers: remainingUsers.length,
}, null, 2));
