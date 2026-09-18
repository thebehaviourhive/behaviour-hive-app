/* Tears down the PRD 7 Stage 3 verification fixture: ZZPRD7S3CLINIC,
   ZZPRD7S3OTHER, and every zzprd7s3*.* account -- including real
   Storage objects. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKET = "clinical-attachments";

async function removeInstitution(code) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", code).maybeSingle();
  if (!inst) {
    console.log(`institution ${code}: not found, skipping`);
    return;
  }

  const { data: links } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", inst.id);
  for (const link of links ?? []) {
    const { data: assessments } = await admin.from("assessments").select("id").eq("passport_id", link.passport_id);
    for (const a of assessments ?? []) {
      const { data: atts } = await admin.from("attachments").select("id, storage_path").eq("artefact_type", "assessment").eq("artefact_id", a.id);
      const paths = (atts ?? []).map((r) => r.storage_path);
      if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);
      await admin.from("attachments").delete().eq("artefact_type", "assessment").eq("artefact_id", a.id);
    }
    await admin.from("assessments").delete().eq("passport_id", link.passport_id);
    await admin.from("fba_reports").delete().eq("passport_id", link.passport_id);
    await admin.from("session_notes").delete().eq("passport_id", link.passport_id);
    await admin.from("activity_log").delete().eq("passport_id", link.passport_id);
    await admin.from("clinician_access").delete().eq("passport_id", link.passport_id);
    const { data: episodes } = await admin.from("episodes_of_care").select("id").eq("passport_id", link.passport_id);
    for (const e of episodes ?? []) {
      await admin.from("episode_tags").delete().eq("episode_id", e.id);
    }
    await admin.from("episodes_of_care").delete().eq("passport_id", link.passport_id);
    await admin.from("passport_institution_links").delete().eq("passport_id", link.passport_id);
    await admin.from("passports").delete().eq("id", link.passport_id);
    console.log(`passport ${link.passport_id}: removed`);
  }
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`institution ${code}: removed`);
}

async function main() {
  await removeInstitution("ZZPRD7S3CLINIC");
  await removeInstitution("ZZPRD7S3OTHER");

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const matches = (users?.users ?? []).filter((u) => u.email && u.email.includes("zzprd7s3"));
  for (const u of matches) {
    await admin.from("clinicians").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`user ${u.email}: removed`);
  }

  const { data: recheckInst } = await admin.from("institutions").select("id").in("institution_code", ["ZZPRD7S3CLINIC", "ZZPRD7S3OTHER"]);
  const { data: recheckUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const stillThere = (recheckUsers?.users ?? []).filter((u) => u.email && u.email.includes("zzprd7s3"));
  if ((recheckInst ?? []).length > 0 || stillThere.length > 0) {
    console.error("Orphans remain:", { inst: recheckInst, users: stillThere.map((u) => u.email) });
    process.exit(1);
  }
  console.log("\nZero orphans confirmed.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
