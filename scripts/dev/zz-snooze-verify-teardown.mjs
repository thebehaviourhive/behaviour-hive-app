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

const fixture = JSON.parse(fs.readFileSync("scripts/dev/zz-snooze-fixture.json", "utf8"));
const institutionIds = [fixture.school.id, fixture.clinic.id, fixture.centre.id];
const userIds = [
  fixture.principal.id,
  fixture.teacher.id,
  fixture.director.id,
  fixture.clinician.id,
  fixture.lead.id,
  fixture.managerA.id,
  fixture.managerB.id,
];
const passportIds = [
  fixture.childPassportId,
  fixture.childAPassportId,
  fixture.childBPassportId,
  fixture.centreChildPassportId,
  fixture.childCPassportId,
].filter(Boolean);

async function del(table, column, values) {
  if (!values.length) return;
  const { error } = await admin.from(table).delete().in(column, values);
  if (error) console.error(`${table} delete error:`, error.message);
}

// Audit rows first (references institution_id/item_id, no FK cascade
// assumed -- delete explicitly).
await del("outstanding_task_snoozes", "institution_id", institutionIds);

// Bookings (references passport_id/institution_id).
if (fixture.bookingId) await del("bookings", "id", [fixture.bookingId]);
await del("session_types", "institution_id", institutionIds);

// Respite stays.
if (fixture.stayId) await del("respite_stays", "id", [fixture.stayId]);

// Tag change requests, clinical lead scope, institution tags.
await del("tag_change_requests", "episode_id",
  (await admin.from("episodes_of_care").select("id").in("passport_id", passportIds)).data?.map((r) => r.id) ?? []
);
const { data: staffRows } = await admin.from("institution_staff").select("id").in("institution_id", institutionIds);
await del("clinical_lead_scope", "institution_staff_id", (staffRows ?? []).map((r) => r.id));
await del("institution_tags", "institution_id", institutionIds);

// FBA reports, episodes of care, passport links, passports.
await del("fba_reports", "passport_id", passportIds);
await del("episodes_of_care", "passport_id", passportIds);
await del("enrolments", "passport_id", passportIds);
await del("passport_institution_links", "passport_id", passportIds);
await del("passport_guardians", "passport_id", passportIds);
await del("passports", "id", passportIds);

// Staff + institutions.
await del("institution_staff", "institution_id", institutionIds);
await del("institutions", "id", institutionIds);

// Auth users.
for (const id of userIds) {
  const { error } = await admin.auth.admin.deleteUser(id);
  if (error) console.error(`deleteUser ${id} error:`, error.message);
}

console.log("Teardown complete.");

// Confirm zero orphans.
for (const [table, column, values] of [
  ["outstanding_task_snoozes", "institution_id", institutionIds],
  ["institutions", "id", institutionIds],
  ["passports", "id", passportIds],
]) {
  const { data } = await admin.from(table).select("id").in(column, values);
  console.log(`${table}: ${data?.length ?? 0} rows remaining`);
}
