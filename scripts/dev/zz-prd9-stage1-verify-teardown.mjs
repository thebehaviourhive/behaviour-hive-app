/* Tears down the migration-0255 verification fixture:
   ZZPRD9CLINIC, ZZPRD9CLINICB, ZZPRD9SCHOOL, and every zzprd9stage1.*
   account. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function removePassportsFor(institutionCode) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", institutionCode).maybeSingle();
  if (!inst) return;

  const { data: episodes } = await admin.from("episodes_of_care").select("id, passport_id").eq("institution_id", inst.id);
  for (const e of episodes ?? []) {
    const passportId = e.passport_id;

    await admin.from("bookings").delete().eq("passport_id", passportId);
    await admin.from("clinician_access").delete().eq("passport_id", passportId);
    await admin.from("episode_tags").delete().eq("episode_id", e.id);
    await admin.from("episodes_of_care").delete().eq("id", e.id);
    await admin.from("passport_guardians").delete().eq("passport_id", passportId);
    await admin.from("passport_institution_links").delete().eq("passport_id", passportId);
    await admin.from("passports").delete().eq("id", passportId);
    console.log(`passport ${passportId}: removed`);
  }
}

async function removeInstitution(code) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", code).maybeSingle();
  if (!inst) return;
  await admin.from("bookings").delete().eq("institution_id", inst.id);
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`institution ${code}: removed`);
}

async function main() {
  await removePassportsFor("ZZPRD9CLINIC");

  await removeInstitution("ZZPRD9CLINIC");
  await removeInstitution("ZZPRD9CLINICB");
  await removeInstitution("ZZPRD9SCHOOL");

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const matches = (users?.users ?? []).filter((u) => u.email && u.email.includes("zzprd9stage1."));
  for (const u of matches) {
    await admin.from("clinicians").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`user ${u.email}: removed`);
  }

  const codes = ["ZZPRD9CLINIC", "ZZPRD9CLINICB", "ZZPRD9SCHOOL"];
  const { data: recheckInsts } = await admin.from("institutions").select("id, institution_code").in("institution_code", codes);
  const { data: recheckUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const stillThere = (recheckUsers?.users ?? []).filter((u) => u.email && u.email.includes("zzprd9stage1."));
  if ((recheckInsts ?? []).length > 0 || stillThere.length > 0) {
    console.error("Orphans remain:", { insts: recheckInsts, users: stillThere.map((u) => u.email) });
    process.exit(1);
  }
  console.log("\nZero orphans confirmed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
