/* Tears down the PRD 7 Stage 4 verification fixture: ZZPRD7S4CLINIC,
   ZZPRD7S4OTHER, and every zzprd7s4*.* account -- including real
   Storage objects in clinic-bank-assets. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });
const BUCKET = "clinic-bank-assets";

async function removeInstitution(code) {
  const { data: inst } = await admin.from("institutions").select("id").eq("institution_code", code).maybeSingle();
  if (!inst) {
    console.log(`institution ${code}: not found, skipping`);
    return;
  }

  // Bank assets/strategies first (bsp/bsp_strategies reference them via
  // FK -- deleting the referencing rows first avoids any FK ordering
  // issue, matching this schema's own established cascade discipline).
  const { data: bankAssets } = await admin.from("bank_assets").select("id, storage_path").eq("institution_id", inst.id);
  const paths = (bankAssets ?? []).map((a) => a.storage_path);
  if (paths.length > 0) await admin.storage.from(BUCKET).remove(paths);

  const { data: links } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", inst.id);
  for (const link of links ?? []) {
    const { data: bsps } = await admin.from("bsp").select("id").eq("passport_id", link.passport_id);
    for (const b of bsps ?? []) {
      await admin.from("bsp_strategies").delete().eq("bsp_id", b.id);
    }
    // supersedes_id is self-referential -- clear it before deleting, to
    // avoid an FK ordering issue between the two bsp rows.
    await admin.from("bsp").update({ supersedes_id: null }).eq("passport_id", link.passport_id);
    await admin.from("bsp").delete().eq("passport_id", link.passport_id);
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

  await admin.from("strategy_bank").delete().eq("institution_id", inst.id);
  await admin.from("bank_assets").delete().eq("institution_id", inst.id);
  await admin.from("institution_staff").delete().eq("institution_id", inst.id);
  await admin.from("institutions").delete().eq("id", inst.id);
  console.log(`institution ${code}: removed`);
}

async function main() {
  await removeInstitution("ZZPRD7S4CLINIC");
  await removeInstitution("ZZPRD7S4OTHER");

  const { data: users } = await admin.auth.admin.listUsers({ perPage: 200 });
  const matches = (users?.users ?? []).filter((u) => u.email && u.email.includes("zzprd7s4"));
  for (const u of matches) {
    await admin.from("clinicians").delete().eq("user_id", u.id);
    await admin.auth.admin.deleteUser(u.id);
    console.log(`user ${u.email}: removed`);
  }

  const { data: recheckInst } = await admin.from("institutions").select("id").in("institution_code", ["ZZPRD7S4CLINIC", "ZZPRD7S4OTHER"]);
  const { data: recheckUsers } = await admin.auth.admin.listUsers({ perPage: 200 });
  const stillThere = (recheckUsers?.users ?? []).filter((u) => u.email && u.email.includes("zzprd7s4"));
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
