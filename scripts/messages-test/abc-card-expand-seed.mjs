// Disposable test rig for the ABC incident card expansion feature.
// Builds a parent+passport, a class_teacher, an SNA, and a verified
// clinician all linked, with a spread of ABC logs designed to exercise
// every check in the brief:
// - clinician's own log: perceived_function + general_notes set, plus
//   clinical_notes set directly at the DB level (to prove it never
//   crosses the wire to ANYONE, not even the clinician, since
//   get_abc_logs() never selects it for any caller).
// - teacher's own log: perceived_function ALSO set at the DB level,
//   specifically to prove get_abc_logs()'s gating is keyed on the
//   VIEWER's role, not the logger's -- a teacher viewing their own
//   authored log must still get perceived_function=null back.
// - SNA's own log: same perceived_function-gating check for the SNA
//   track.
// - a parent-authored log shared with the teacher via an incident-note
//   message (abc_log_id set) -- the "shared" card + Messages View-log
//   path.
// - a max-length-text log (long antecedent_other/general_notes) to
//   check expanded layout doesn't break.
//
// Run with: node --env-file=.env.local scripts/messages-test/abc-card-expand-seed.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PASSWORD = "AbcExpandTest-2026!";
const INSTITUTION_CODE = "ABCEXPAND-1";

async function createUser(email, fullName, role) {
  const { data, error } = await s.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) throw error;
  return data.user;
}

console.log("== Institution + users ==");
const { data: inst, error: instErr } = await s
  .from("institutions")
  .insert({ name: "ABC Expand Test School", institution_code: INSTITUTION_CODE, status: "verified" })
  .select("id")
  .single();
if (instErr) throw instErr;

const parent = await createUser("abcexpand.parent@thebehaviourhive.com", "Expand Parent", "parent");
const teacher = await createUser("abcexpand.teacher@thebehaviourhive.com", "Expand Teacher", "class_teacher");
const sna = await createUser("abcexpand.sna@thebehaviourhive.com", "Expand SNA", "sna");
const clinician = await createUser("abcexpand.clinician@thebehaviourhive.com", "Dr. Expand Clinician", "clinician");

await s.from("clinicians").insert({
  user_id: clinician.id,
  full_name: "Dr. Expand Clinician",
  specialty: "behavioural_psychologist",
  verification_status: "verified",
  clinician_code: "EXPANDOC1",
});

console.log("== Passport ==");
const { data: passport, error: passErr } = await s
  .from("passports")
  .insert({
    user_id: parent.id,
    child_name: "Expand Test Child",
    diagnoses: ["Autism"],
    section_a_complete: true,
    passport_status: "complete",
  })
  .select("id")
  .single();
if (passErr) throw passErr;

console.log("== Links ==");
await s.from("institution_staff").insert([
  { user_id: teacher.id, institution_id: inst.id, role: "class_teacher" },
  { user_id: sna.id, institution_id: inst.id, role: "sna" },
]);
await s.from("passport_institution_links").insert({
  passport_id: passport.id,
  institution_id: inst.id,
  approved_by_parent: true,
  parent_approved_at: new Date().toISOString(),
});
await s.from("passport_access").insert([
  { passport_id: passport.id, teacher_id: teacher.id, institution_id: inst.id, is_active: true, actor_role: "class_teacher" },
  { passport_id: passport.id, teacher_id: sna.id, institution_id: inst.id, is_active: true, actor_role: "sna" },
]);
await s.from("clinician_access").insert({
  passport_id: passport.id,
  clinician_id: clinician.id,
  is_active: true,
  linked_at: new Date().toISOString(),
});

const BASE = { passport_id: passport.id, incident_date: "2026-08-19", intensity: 3, antecedents: ["Other"], antecedent_other: "seed", behaviours: ["Other"], behaviour_other: "seed", consequences: ["Other"], consequence_other: "seed" };

console.log("== Clinician's own log (perceived_function + general_notes + clinical_notes) ==");
const { data: clinicianLog, error: clinLogErr } = await s
  .from("abc_logs")
  .insert({
    ...BASE,
    incident_time: "09:00",
    logged_by: clinician.id,
    logged_by_role: "clinician",
    duration_minutes: 12,
    perceived_function: "escape",
    general_notes: "Clinician's own general notes -- should be visible to everyone who can see this log at all.",
    clinical_notes: "CLINICAL-NOTES-CANARY-STRING-MUST-NEVER-APPEAR-IN-ANY-NETWORK-PAYLOAD",
  })
  .select("id")
  .single();
if (clinLogErr) throw clinLogErr;

console.log("== Teacher's own log (perceived_function set at DB level -- must come back null when the teacher views it) ==");
const { data: teacherLog, error: teacherLogErr } = await s
  .from("abc_logs")
  .insert({
    ...BASE,
    incident_time: "10:00",
    logged_by: teacher.id,
    logged_by_role: "class_teacher",
    duration_minutes: 5,
    perceived_function: "attention",
    general_notes: "Teacher's own notes on their own logged incident.",
  })
  .select("id")
  .single();
if (teacherLogErr) throw teacherLogErr;

console.log("== SNA's own log (perceived_function set at DB level -- must come back null when the SNA views it) ==");
const { data: snaLog, error: snaLogErr } = await s
  .from("abc_logs")
  .insert({
    ...BASE,
    incident_time: "11:00",
    logged_by: sna.id,
    logged_by_role: "sna",
    duration_minutes: 8,
    perceived_function: "sensory",
    general_notes: "SNA's own notes on their own logged incident.",
  })
  .select("id")
  .single();
if (snaLogErr) throw snaLogErr;

console.log("== Parent-authored log, to be shared with the teacher via an incident-note message ==");
const LONG_TEXT = "This is a maximum-length free-text field used to verify the expanded card renders fully without layout breakage. ".repeat(15);
const { data: sharedLog, error: sharedLogErr } = await s
  .from("abc_logs")
  .insert({
    ...BASE,
    incident_time: "12:00",
    logged_by: parent.id,
    logged_by_role: "parent",
    duration_minutes: 45,
    antecedent_other: LONG_TEXT,
    general_notes: LONG_TEXT,
  })
  .select("id")
  .single();
if (sharedLogErr) throw sharedLogErr;

console.log("== Share it with the teacher via an incident-note message ==");
const { data: incidentCategory } = await s.from("message_categories").select("id").eq("label", "Incident note").single();
const { data: shareMessage, error: shareMsgErr } = await s
  .from("messages")
  .insert({
    passport_id: passport.id,
    sender_id: parent.id,
    sender_role: "parent",
    category_id: incidentCategory.id,
    body: "Sharing this incident with you.",
    response_required: false,
    status: "open",
    abc_log_id: sharedLog.id,
  })
  .select("id")
  .single();
if (shareMsgErr) throw shareMsgErr;
await s.from("message_recipients").insert({ message_id: shareMessage.id, recipient_id: teacher.id, recipient_role: "class_teacher" });

const seed = {
  passwordHint: PASSWORD,
  institutionId: inst.id,
  passportId: passport.id,
  clinicianLogId: clinicianLog.id,
  teacherLogId: teacherLog.id,
  snaLogId: snaLog.id,
  sharedLogId: sharedLog.id,
  shareMessageId: shareMessage.id,
  parent: { id: parent.id, email: "abcexpand.parent@thebehaviourhive.com" },
  teacher: { id: teacher.id, email: "abcexpand.teacher@thebehaviourhive.com" },
  sna: { id: sna.id, email: "abcexpand.sna@thebehaviourhive.com" },
  clinician: { id: clinician.id, email: "abcexpand.clinician@thebehaviourhive.com" },
};
writeFileSync(new URL("./abc-card-expand-seed-output.json", import.meta.url), JSON.stringify(seed, null, 2));
console.log("\n== Seed complete ==");
console.log(seed);
