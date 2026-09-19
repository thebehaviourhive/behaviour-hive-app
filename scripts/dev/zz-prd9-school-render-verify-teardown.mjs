/* Tears down the ZZPRD9SCHOOLRENDER fixture. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", "ZZPRD9SCHOOLRENDER").maybeSingle();
  if (inst) {
    const { data: links } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", inst.id);
    for (const link of links ?? []) {
      const passportId = link.passport_id;
      await admin.from("clinician_access").delete().eq("passport_id", passportId);
      await admin.from("enrolments").delete().eq("passport_id", passportId);
      await admin.from("passport_institution_links").delete().eq("passport_id", passportId);
      await admin.from("passports").delete().eq("id", passportId);
      console.log(`passport ${passportId}: removed`);
    }
    await admin.from("institution_staff").delete().eq("institution_id", inst.id);
    await admin.from("institutions").delete().eq("id", inst.id);
    console.log(`institution ZZPRD9SCHOOLRENDER: removed`);
  }

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const matches = (users?.users ?? []).filter((u) => u.email && u.email.includes("zzprd9schoolrender."));
  for (const u of matches) {
    await admin.from("clinicians").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`user ${u.email}: removed`);
  }

  const { data: recheckInst } = await admin.from("institutions").select("id").eq("institution_code", "ZZPRD9SCHOOLRENDER").maybeSingle();
  const { data: recheckUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const stillThere = (recheckUsers?.users ?? []).filter((u) => u.email && u.email.includes("zzprd9schoolrender."));
  if (recheckInst || stillThere.length > 0) {
    console.error("Orphans remain:", { inst: recheckInst, users: stillThere.map((u) => u.email) });
    process.exit(1);
  }
  console.log("\nZero orphans confirmed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
