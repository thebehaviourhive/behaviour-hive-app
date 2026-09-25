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

const stamp = Date.now();
const PW = `ZzSnooze-${stamp}!`;

async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

// --- School ---
const { data: school } = await admin.from("institutions").insert({ name: "ZZ Snooze School", institution_code: `ZZSNOOZESCHOOL${stamp}`, status: "verified", type: "school" }).select("id").single();
const principalEmail = `zzsnooze.principal.${stamp}@thebehaviourhive.com`;
const teacherEmail = `zzsnooze.teacher.${stamp}@thebehaviourhive.com`;
const principalId = await createUser(principalEmail, "principal");
const teacherId = await createUser(teacherEmail, "class_teacher");
await admin.from("institution_staff").insert({ institution_id: school.id, user_id: principalId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: school.id, user_id: teacherId, role: "class_teacher", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();

// A real, unassigned child (principal_unassigned_child bucket) -- via create_school_passport as the real principal.
const principalClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await principalClient.auth.signInWithPassword({ email: principalEmail, password: PW });
const { data: childPassportId, error: childErr } = await principalClient.rpc("create_school_passport", {
  p_institution_id: school.id,
  p_child_name: "ZZ Snooze Child",
});
if (childErr) throw childErr;

// --- Clinic ---
const { data: clinic } = await admin.from("institutions").insert({ name: "ZZ Snooze Clinic", institution_code: `ZZSNOOZECLINIC${stamp}`, status: "verified", type: "clinic" }).select("id").single();
const directorEmail = `zzsnooze.director.${stamp}@thebehaviourhive.com`;
const clinicianEmail = `zzsnooze.clinician.${stamp}@thebehaviourhive.com`;
const leadEmail = `zzsnooze.lead.${stamp}@thebehaviourhive.com`;
const directorId = await createUser(directorEmail, "principal");
const clinicianId = await createUser(clinicianEmail, "clinician");
const leadId = await createUser(leadEmail, "clinical_lead");
await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianId, role: "clinician", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: leadId, role: "clinical_lead", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();

const directorClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await directorClient.auth.signInWithPassword({ email: directorEmail, password: PW });

// Child A: a genuinely untouched draft FBA (content_data = '{}') --
// should appear in the director's own "draft FBA" bucket.
const { data: childAPassportId } = await directorClient.rpc("onboard_clinic_client", { p_institution_id: clinic.id, p_client_name: "ZZ Snooze FBA Untouched" });
await admin.from("fba_reports").insert({ passport_id: childAPassportId, clinician_id: clinicianId, status: "draft", content_data: {} }).throwOnError();

// Child B: an FBA with REAL content already written -- the deeper fix
// (0308/0310) should make this one NEVER appear, no snoozing needed.
const { data: childBPassportId } = await directorClient.rpc("onboard_clinic_client", { p_institution_id: clinic.id, p_client_name: "ZZ Snooze FBA In Progress" });
await admin.from("fba_reports").insert({ passport_id: childBPassportId, clinician_id: clinicianId, status: "draft", content_data: { targetBehaviours: [{ label: "test" }] } }).throwOnError();

// A pending tag change request, for the clinical_lead's own "Awaiting
// Your Decision" bucket. Needs a real episode + real catalogue tags,
// resolved through the real onboard flow above (childA's episode).
const { data: episodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", childAPassportId).single();
const { data: tagRow } = await admin.from("institution_tags").insert({ institution_id: clinic.id, dimension: "service", value: "ZZ Snooze Service", is_active: true, created_by: directorId }).select("id").single();
const { data: leadStaffRow } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", leadId).single();
await admin.from("clinical_lead_scope").insert({ institution_staff_id: leadStaffRow.id, institution_tag_id: tagRow.id }).throwOnError();
const { data: requestId, error: reqErr } = await directorClient.rpc("raise_tag_change_request", {
  p_episode_id: episodeRow.id,
  p_proposed_tags: [{ dimension: "service", value: "ZZ Snooze Service" }],
  p_reason: "ZZ snooze fixture request",
});
if (reqErr) console.error("raise_tag_change_request error:", reqErr.message);

// --- Respite centre, two managers (a real "colleague" pair -- unlike
// principal/director, centre_manager is not capped at one per
// institution). ---
const { data: centre } = await admin.from("institutions").insert({ name: "ZZ Snooze Centre", institution_code: `ZZSNOOZECENTRE${stamp}`, status: "verified", type: "respite_centre" }).select("id").single();
const managerAEmail = `zzsnooze.managera.${stamp}@thebehaviourhive.com`;
const managerBEmail = `zzsnooze.managerb.${stamp}@thebehaviourhive.com`;
const managerAId = await createUser(managerAEmail, "centre_manager");
const managerBId = await createUser(managerBEmail, "centre_manager");
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: managerAId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();
await admin.from("institution_staff").insert({ institution_id: centre.id, user_id: managerBId, role: "centre_manager", approved_at: new Date().toISOString(), approval_source: "bootstrap" }).throwOnError();

const managerAClient = createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
await managerAClient.auth.signInWithPassword({ email: managerAEmail, password: PW });
const { data: centreChildPassportId } = await managerAClient.rpc("onboard_clinic_client", { p_institution_id: centre.id, p_client_name: "ZZ Snooze Centre Child" });
// A real stay, ended, no report -- centre_needs_report bucket.
const { data: centreEpisodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", centreChildPassportId).single();
const startedAt = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
const endedAt = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString();
const { data: stayRow, error: stayErr } = await admin.from("respite_stays").insert({ episode_id: centreEpisodeRow.id, passport_id: centreChildPassportId, institution_id: centre.id, starts_at: startedAt, ends_at: endedAt, created_by: managerAId }).select("id").single();
if (stayErr) console.error("respite_stays insert error:", stayErr.message);

// --- Clinician's own booking-sync bucket -- a fixture booking row
// standing in for a real Google-drift event (the write path under
// test here is the snooze wiring around it, not PRD 9's own booking
// creation, which has its own dedicated, already-verified coverage). ---
const { data: sessionTypeRow, error: sessionTypeErr } = await admin.from("session_types").insert({
  institution_id: clinic.id,
  name: "ZZ Snooze Session",
  location_mode: "online",
  length_minutes: 60,
  is_active: true,
  created_by: directorId,
}).select("id").maybeSingle();
if (sessionTypeErr) console.error("session_types insert error:", sessionTypeErr.message);
let bookingId = null;
if (sessionTypeRow) {
  const { data: bookingRow, error: bookingErr } = await admin.from("bookings").insert({
    passport_id: childAPassportId,
    clinician_id: clinicianId,
    institution_id: clinic.id,
    session_type_id: sessionTypeRow.id,
    session_type_name: "ZZ Snooze Session",
    session_type_mode: "online",
    session_start_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString(),
    session_end_at: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000 + 60 * 60 * 1000).toISOString(),
    google_calendar_id: "zz-snooze-fixture@example.com",
    google_sync_status: "sync_failed",
    cancellation_policy_snapshot: "Test policy",
    consented_at: new Date().toISOString(),
    created_by: directorId,
  }).select("id").maybeSingle();
  if (bookingErr) console.error("bookings insert error:", bookingErr.message);
  bookingId = bookingRow?.id ?? null;
}

const fixture = {
  stamp,
  password: PW,
  school: { id: school.id },
  clinic: { id: clinic.id },
  centre: { id: centre.id },
  principal: { email: principalEmail, id: principalId },
  teacher: { email: teacherEmail, id: teacherId },
  director: { email: directorEmail, id: directorId },
  clinician: { email: clinicianEmail, id: clinicianId },
  lead: { email: leadEmail, id: leadId },
  managerA: { email: managerAEmail, id: managerAId },
  managerB: { email: managerBEmail, id: managerBId },
  childPassportId,
  childAPassportId,
  childBPassportId,
  requestId,
  stayId: stayRow?.id ?? null,
  centreChildPassportId,
  bookingId,
};
fs.writeFileSync("scripts/dev/zz-snooze-fixture.json", JSON.stringify(fixture, null, 2));
console.log(JSON.stringify(fixture, null, 2));
