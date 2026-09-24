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

// Sweep by prefix -- three fixture generations exist across this
// session's own debugging (the two earlier failed/partial runs before
// the verification script's own chained-select bug was found and
// fixed, plus the final clean run).
const { data: institutions } = await admin
  .from("institutions")
  .select("id, institution_code")
  .or("institution_code.ilike.ZZSTAGE3CLINIC%,institution_code.ilike.ZZSTAGE3CENTRE%");

for (const inst of institutions ?? []) {
  // episodes_of_care/respite_stays/abc_logs all cascade on delete from
  // institutions or passports; institution_staff does not cascade from
  // institutions in every case, so clear it explicitly first, matching
  // this repo's own standing teardown ordering.
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`Deleted institution ${inst.institution_code}`);
}

// The passports created via onboard_clinic_client() cascade-delete
// their own episodes_of_care/passport_institution_links/passport_
// guardians/abc_logs/respite_stays rows via the institution delete
// above where FK'd to institution_id, but the PASSPORT row itself is
// only FK'd from institution-scoped tables, not the other way --
// delete any passport left with the fixture's own literal name.
const { data: strayPassports } = await admin.from("passports").select("id").eq("child_name", "ZZ Stage3 Child");
for (const p of strayPassports ?? []) {
  await admin.from("passports").delete().eq("id", p.id);
  console.log(`Deleted stray passport ${p.id}`);
}

const { data: usersList } = await admin.auth.admin.listUsers({ perPage: 1000 });
const targets = usersList.users.filter((u) => u.email && u.email.startsWith("zzstage3."));
for (const u of targets) {
  await admin.from("consents").delete().eq("user_id", u.id);
  const { error } = await admin.auth.admin.deleteUser(u.id);
  if (error) throw new Error(`deleteUser ${u.email}: ${error.message}`);
  console.log(`Deleted user ${u.email}`);
}

const { data: instAfter } = await admin
  .from("institutions")
  .select("id")
  .or("institution_code.ilike.ZZSTAGE3CLINIC%,institution_code.ilike.ZZSTAGE3CENTRE%");
const { data: passportsAfter } = await admin.from("passports").select("id").eq("child_name", "ZZ Stage3 Child");
const { data: usersAfter } = await admin.auth.admin.listUsers({ perPage: 1000 });
const remainingUsers = usersAfter.users.filter((u) => u.email && u.email.startsWith("zzstage3."));

console.log(JSON.stringify({
  remainingInstitutions: instAfter?.length ?? 0,
  remainingPassports: passportsAfter?.length ?? 0,
  remainingUsers: remainingUsers.length,
}, null, 2));
