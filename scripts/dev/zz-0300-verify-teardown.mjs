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
  .ilike("institution_code", "ZZ0300%");

for (const inst of institutions ?? []) {
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`Deleted institution ${inst.institution_code}`);
}

const { data: strayPassports } = await admin.from("passports").select("id").eq("child_name", "ZZ 0300 Child");
for (const p of strayPassports ?? []) {
  await admin.from("abc_logs").delete().eq("passport_id", p.id);
  await admin.from("episodes_of_care").delete().eq("passport_id", p.id);
  await admin.from("passport_institution_links").delete().eq("passport_id", p.id);
  await admin.from("passports").delete().eq("id", p.id);
  console.log(`Deleted stray passport ${p.id}`);
}

const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
const targets = usersList.users.filter((u) => u.email && u.email.startsWith("zz0300."));
for (const u of targets) {
  await admin.from("consents").delete().eq("user_id", u.id);
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) throw new Error(`deleteUser ${u.email}: ${error.message}`);
  console.log(`Deleted user ${u.email}`);
}

const { data: instAfter } = await admin.from("institutions").select("id").ilike("institution_code", "ZZ0300%");
const { data: passportsAfter } = await admin.from("passports").select("id").eq("child_name", "ZZ 0300 Child");
const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 1000 });
const remainingUsers = usersAfter.users.filter((u) => u.email && u.email.startsWith("zz0300."));

console.log(JSON.stringify({
  remainingInstitutions: instAfter?.length ?? 0,
  remainingPassports: passportsAfter?.length ?? 0,
  remainingUsers: remainingUsers.length,
}, null, 2));
