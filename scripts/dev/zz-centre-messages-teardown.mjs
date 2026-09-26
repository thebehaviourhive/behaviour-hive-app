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

const centreFixture = JSON.parse(fs.readFileSync("scripts/dev/zz-centre-messages-fixture.json", "utf8"));
const centreId = centreFixture.centre.id;
const closureFixturePath = "scripts/dev/zz-handover-closure-proof-fixture.json";
const closureFixture = fs.existsSync(closureFixturePath) ? JSON.parse(fs.readFileSync(closureFixturePath, "utf8")) : null;
const clinicId = closureFixture?.clinic.id ?? null;
const sharedPassportId = closureFixture?.passportId ?? null;

// -----------------------------------------------------------------
// Step 1: the ONE passport that spans both institutions (the closure-
// proof child -- clinic-onboarded, parent-claimed, then separately
// linked into the respite centre) -- handled explicitly, in dependency
// order, BEFORE either institution's own generic sweep, so neither
// sweep hits a dangling foreign key from the other institution's own
// still-live link/episode row.
// -----------------------------------------------------------------
if (sharedPassportId) {
  await admin.from("messages").delete().eq("passport_id", sharedPassportId);
  const { data: sharedStays } = await admin.from("respite_stays").select("id").eq("passport_id", sharedPassportId);
  const sharedStayIds = (sharedStays ?? []).map((r) => r.id);
  if (sharedStayIds.length > 0) {
    await admin.from("respite_post_stay_reports").delete().in("stay_id", sharedStayIds);
  }
  await admin.from("respite_stay_checkins").delete().eq("passport_id", sharedPassportId);
  await admin.from("respite_activations").delete().eq("passport_id", sharedPassportId);
  await admin.from("respite_stays").delete().eq("passport_id", sharedPassportId);
  await admin.from("episodes_of_care").delete().eq("passport_id", sharedPassportId);
  await admin.from("passport_guardians").delete().eq("passport_id", sharedPassportId);
  await admin.from("passport_institution_links").delete().eq("passport_id", sharedPassportId);
  await admin.from("passports").delete().eq("id", sharedPassportId);
  console.log("Shared closure-proof passport (clinic + respite centre) fully torn down.");
}

// -----------------------------------------------------------------
// Step 2: the respite centre's own remaining 8 (originally onboarded
// directly at the centre, never shared with the clinic).
// -----------------------------------------------------------------
async function tearDownInstitution(institutionId, label) {
  const { data: passportLinks } = await admin.from("passport_institution_links").select("passport_id").eq("institution_id", institutionId);
  const passportIds = [...new Set((passportLinks ?? []).map((r) => r.passport_id))];

  if (passportIds.length > 0) {
    await admin.from("messages").delete().in("passport_id", passportIds);
    const { data: stayRows } = await admin.from("respite_stays").select("id").eq("institution_id", institutionId);
    const stayIds = (stayRows ?? []).map((r) => r.id);
    if (stayIds.length > 0) {
      await admin.from("respite_post_stay_reports").delete().in("stay_id", stayIds);
    }
    await admin.from("respite_stay_checkins").delete().eq("institution_id", institutionId);
    await admin.from("respite_activations").delete().eq("institution_id", institutionId);
    await admin.from("respite_stays").delete().eq("institution_id", institutionId);
    await admin.from("episodes_of_care").delete().eq("institution_id", institutionId);
    await admin.from("passport_guardians").delete().in("passport_id", passportIds);
    await admin.from("passport_institution_links").delete().eq("institution_id", institutionId);
    for (const pid of passportIds) {
      await admin.from("passports").delete().eq("id", pid);
    }
  }
  await admin.from("institution_staff").delete().eq("institution_id", institutionId);
  await admin.from("institutions").delete().eq("id", institutionId);
  console.log(`Torn down ${label}.`);
}

await tearDownInstitution(centreId, `centre ${centreFixture.centre.code}`);
if (clinicId) {
  await tearDownInstitution(clinicId, "clinic ZZCLOSURE");
}

// -----------------------------------------------------------------
// Step 3: every real auth user created across both fixtures.
// -----------------------------------------------------------------
const { data: allUsers } = await admin.auth.admin.listUsers();
const emailsToDelete = [centreFixture.manager.email, centreFixture.careA.email, centreFixture.careB.email];
if (closureFixture) emailsToDelete.push(closureFixture.director.email, closureFixture.parent.email);
for (const email of emailsToDelete) {
  const u = allUsers.users.find((x) => x.email === email);
  if (u) {
    await admin.auth.admin.deleteUser(u.id);
    console.log(`Deleted user ${email}.`);
  }
}

// -----------------------------------------------------------------
// Final confirmation, direct queries, not the script's own self-report.
// -----------------------------------------------------------------
const { count: remainingCentreInst } = await admin.from("institutions").select("id", { count: "exact", head: true }).ilike("institution_code", "ZZCENTREMSG%");
const { count: remainingClosureInst } = await admin.from("institutions").select("id", { count: "exact", head: true }).ilike("institution_code", "ZZCLOSURE%");
const { data: finalUsers } = await admin.auth.admin.listUsers();
const strayUsers = finalUsers.users.filter((u) => u.email?.includes("zzcentremsg.") || u.email?.includes("zzclosure."));
const sharedPassportStillExists = sharedPassportId
  ? Boolean((await admin.from("passports").select("id").eq("id", sharedPassportId).maybeSingle()).data)
  : false;

console.log(JSON.stringify({
  remainingCentreInstitutions: remainingCentreInst ?? 0,
  remainingClosureInstitutions: remainingClosureInst ?? 0,
  strayUsersRemaining: strayUsers.length,
  sharedPassportStillExists,
}, null, 2));

fs.unlinkSync("scripts/dev/zz-centre-messages-fixture.json");
if (fs.existsSync(closureFixturePath)) fs.unlinkSync(closureFixturePath);
console.log("Teardown complete.");
