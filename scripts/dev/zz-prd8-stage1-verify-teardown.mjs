/* Tears down the migration-0245 verification fixture:
   ZZPRD8SCHOOL, ZZPRD8CLINIC, ZZPRD8CLINICB, ZZPRD8SCHOOLB, and every
   zzprd8stage1.* account. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function removePassportsFor(institutionCode) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", institutionCode).maybeSingle();
  if (!inst) return;

  const { data: links } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", inst.id);
  for (const link of links ?? []) {
    const passportId = link.passport_id;

    await admin.from("cross_organisation_grants").delete().eq("passport_id", passportId);

    const { data: incidents } = await admin.from("incident_children").select("incident_id").eq("passport_id", passportId);
    for (const { incident_id } of incidents ?? []) {
      await admin.from("clinician_incident_notices").delete().eq("incident_id", incident_id);
      await admin.from("incident_amendments").delete().eq("incident_id", incident_id);
      await admin.from("incident_attestations").delete().in("incident_staff_id",
        (await admin.from("incident_staff").select("id").eq("incident_id", incident_id)).data?.map((r) => r.id) ?? []);
      await admin.from("incident_staff").delete().eq("incident_id", incident_id);
      await admin.from("incident_injuries").delete().eq("incident_id", incident_id);
      await admin.from("restrictive_practices").delete().eq("incident_id", incident_id);
      await admin.from("incident_actions").delete().eq("incident_id", incident_id);
      await admin.from("incident_children").delete().eq("incident_id", incident_id);
      await admin.from("incidents").delete().eq("id", incident_id);
    }

    const { data: bsps } = await admin.from("bsp").select("id").eq("passport_id", passportId);
    for (const b of bsps ?? []) {
      await admin.from("bsp_strategies").delete().eq("bsp_id", b.id);
    }
    await admin.from("bsp").delete().eq("passport_id", passportId);

    await admin.from("fba_reports").delete().eq("passport_id", passportId);
    await admin.from("activity_log").delete().eq("passport_id", passportId);
    await admin.from("clinician_access").delete().eq("passport_id", passportId);
    await admin.from("passport_access").delete().eq("passport_id", passportId);
    await admin.from("passport_guardians").delete().eq("passport_id", passportId);

    const { data: episodes } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId);
    for (const e of episodes ?? []) {
      await admin.from("episode_tags").delete().eq("episode_id", e.id);
    }
    await admin.from("episodes_of_care").delete().eq("passport_id", passportId);
    await admin.from("enrolments").delete().eq("passport_id", passportId);
    await admin.from("passport_institution_links").delete().eq("passport_id", passportId);
    await admin.from("passports").delete().eq("id", passportId);
    console.log(`passport ${passportId}: removed`);
  }
}

async function removeInstitution(code) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", code).maybeSingle();
  if (!inst) return;
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`institution ${code}: removed`);
}

async function main() {
  await removePassportsFor("ZZPRD8SCHOOL");
  await removePassportsFor("ZZPRD8CLINIC");

  await removeInstitution("ZZPRD8SCHOOL");
  await removeInstitution("ZZPRD8CLINIC");
  await removeInstitution("ZZPRD8CLINICB");
  await removeInstitution("ZZPRD8SCHOOLB");

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const matches = (users?.users ?? []).filter((u) => u.email && u.email.includes("zzprd8stage1."));
  for (const u of matches) {
    await admin.from("clinicians").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`user ${u.email}: removed`);
  }

  const codes = ["ZZPRD8SCHOOL", "ZZPRD8CLINIC", "ZZPRD8CLINICB", "ZZPRD8SCHOOLB"];
  const { data: recheckInsts } = await admin.from("institutions").select("id, institution_code").in("institution_code", codes);
  const { data: recheckUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const stillThere = (recheckUsers?.users ?? []).filter((u) => u.email && u.email.includes("zzprd8stage1."));
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
