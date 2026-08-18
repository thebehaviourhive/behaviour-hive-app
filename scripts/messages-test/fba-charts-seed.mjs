// Disposable test rig for verifying the Behaviour-chart addition (Part 1)
// and the QABF/MAS duplicate-results fix (Part 2). Fully throwaway --
// never touches real accounts. Builds: a verified clinician, a parent +
// passport, a linked class_teacher and SNA, ABC logs from all four
// authors within one assessment window (for the Behaviour chart's
// multi-author + SNA-inclusion check), and a completed FBA report with
// a completed QABF (one category -- Physical -- fully excluded via 'X',
// to exercise the "Not applicable" path) and a completed MAS.
//
// Run with: node --env-file=.env.local scripts/messages-test/fba-charts-seed.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const s = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PASSWORD = "FbaChartsTest-2026!";
const INSTITUTION_CODE = "FBACHART-TEST";

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
  .insert({ name: "FBA Charts Test School", institution_code: INSTITUTION_CODE, status: "verified" })
  .select("id")
  .single();
if (instErr) throw instErr;

const parent = await createUser("fbachart.parent@thebehaviourhive.com", "Chart Parent", "parent");
const teacher = await createUser("fbachart.teacher@thebehaviourhive.com", "Chart Teacher", "class_teacher");
const sna = await createUser("fbachart.sna@thebehaviourhive.com", "Chart SNA", "sna");
const clinician = await createUser("fbachart.clinician@thebehaviourhive.com", "Dr. Chart Clinician", "clinician");

const { error: clinErr } = await s.from("clinicians").insert({
  user_id: clinician.id,
  full_name: "Dr. Chart Clinician",
  specialty: "behavioural_psychologist",
  verification_status: "verified",
  clinician_code: "FBACHRT1",
});
if (clinErr) throw clinErr;

console.log("== Passport ==");
const { data: passport, error: passErr } = await s
  .from("passports")
  .insert({
    user_id: parent.id,
    child_name: "Chart Test Child",
    diagnoses: ["Autism"],
    passport_code: "FBAC0001",
    passport_code_active: true,
    section_a_complete: true,
    passport_status: "complete",
  })
  .select("id")
  .single();
if (passErr) throw passErr;

console.log("== Links: institution staff, passport_institution_links, passport_access, clinician_access ==");
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

console.log("== ABC logs: 4 authors within the assessment window ==");
const RANGE_START = "2026-08-01";
const RANGE_END = "2026-08-18";
const ABC_BASE = { incident_date: "2026-08-10", incident_time: "10:00", intensity: 3, passport_id: passport.id };

// Each author's behaviours use only that role's own real option set (per
// roleConfig.ts's ABC_ROLE_CONFIG) -- "Vocal outburst" isn't a parent
// option, for instance, so the parent log below uses "Cried or
// screamed" instead. Deliberately uneven counts so the Behaviour
// chart's tally is easy to hand-check: "Vocal outburst" should total 3
// (teacher, sna, clinician), "Physical aggression" should total 2
// (teacher, clinician), "Cried or screamed" and "Elopement (leaving
// area)" should each total 1 (parent only; sna only).
const logs = [
  { logged_by: parent.id, logged_by_role: "parent", antecedents: ["Other"], antecedent_other: "t", behaviours: ["Cried or screamed"], consequences: ["Other"], consequence_other: "t" },
  { logged_by: teacher.id, logged_by_role: "class_teacher", antecedents: ["Other"], antecedent_other: "t", behaviours: ["Vocal outburst", "Physical aggression"], consequences: ["Other"], consequence_other: "t" },
  { logged_by: sna.id, logged_by_role: "sna", antecedents: ["Other"], antecedent_other: "t", behaviours: ["Vocal outburst", "Elopement (leaving area)"], consequences: ["Other"], consequence_other: "t" },
  { logged_by: clinician.id, logged_by_role: "clinician", antecedents: ["Other"], antecedent_other: "t", behaviours: ["Vocal outburst", "Physical aggression"], consequences: ["Other"], consequence_other: "t" },
];
for (const log of logs) {
  const { error } = await s.from("abc_logs").insert({ ...ABC_BASE, ...log });
  if (error) throw new Error(`abc_logs insert (${log.logged_by_role}): ${error.message}`);
}
console.log("  expected Behaviour tally: Vocal outburst=3, Physical aggression=2, Cried or screamed=1, Elopement (leaving area)=1");

console.log("== FBA report (completed) ==");
const { data: fba, error: fbaErr } = await s
  .from("fba_reports")
  .insert({
    passport_id: passport.id,
    clinician_id: clinician.id,
    status: "completed",
    completed_at: new Date().toISOString(),
    content_data: {
      abcRangeStart: RANGE_START,
      abcRangeEnd: RANGE_END,
      abcInterpretation: "Seeded for the Behaviour-chart + QABF/MAS duplicate verification pass.",
    },
  })
  .select("id")
  .single();
if (fbaErr) throw fbaErr;

console.log("== QABF (completed, Physical category fully excluded via 'X') ==");
// Categories: Attention (1,6,11,16,21), Escape (2,7,12,17,22),
// Non-social function (3,8,13,18,23), Physical (4,9,14,19,24),
// Tangible (5,10,15,20,25) -- per migration 0047's real item bank.
const qabfResponses = {};
for (let n = 1; n <= 25; n++) {
  const isPhysical = [4, 9, 14, 19, 24].includes(n);
  qabfResponses[`qabf-${n}`] = isPhysical ? "X" : String(n % 4); // 0-3, deterministic non-excluded scores
}
qabfResponses["header-name"] = "Chart Parent";
qabfResponses["header-date"] = "2026-08-15";

const { data: qabfReq, error: qabfErr } = await s
  .from("fba_instrument_requests")
  .insert({
    fba_id: fba.id,
    passport_id: passport.id,
    instrument_type: "qabf",
    recipient_id: parent.id,
    status: "completed",
    responses_data: qabfResponses,
    completed_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (qabfErr) throw qabfErr;

console.log("== MAS (completed, all 16 items answered normally) ==");
const masResponses = {};
const MAS_SCALE = ["Never", "Almost Never", "Seldom", "Half the Time", "Usually", "Almost Always", "Always"];
for (let n = 1; n <= 16; n++) {
  masResponses[`mas-${n}`] = MAS_SCALE[n % MAS_SCALE.length];
}
masResponses["header-name"] = "Chart Teacher";
masResponses["header-date"] = "2026-08-15";

const { data: masReq, error: masErr } = await s
  .from("fba_instrument_requests")
  .insert({
    fba_id: fba.id,
    passport_id: passport.id,
    instrument_type: "mas",
    recipient_id: teacher.id,
    status: "completed",
    responses_data: masResponses,
    completed_at: new Date().toISOString(),
  })
  .select("id")
  .single();
if (masErr) throw masErr;

console.log("== Interpretation narratives ==");
await s
  .from("fba_reports")
  .update({
    content_data: {
      abcRangeStart: RANGE_START,
      abcRangeEnd: RANGE_END,
      abcInterpretation: "Seeded for the Behaviour-chart + QABF/MAS duplicate verification pass.",
      instrumentInterpretations: {
        [qabfReq.id]: "QABF interpretation: elevated escape-function scores, Physical category not assessed.",
        [masReq.id]: "MAS interpretation: mixed profile, no single dominant function.",
      },
    },
  })
  .eq("id", fba.id);

const seed = {
  passwordHint: PASSWORD,
  institutionId: inst.id,
  passportId: passport.id,
  fbaId: fba.id,
  qabfRequestId: qabfReq.id,
  masRequestId: masReq.id,
  parent: { id: parent.id, email: "fbachart.parent@thebehaviourhive.com" },
  teacher: { id: teacher.id, email: "fbachart.teacher@thebehaviourhive.com" },
  sna: { id: sna.id, email: "fbachart.sna@thebehaviourhive.com" },
  clinician: { id: clinician.id, email: "fbachart.clinician@thebehaviourhive.com" },
};
writeFileSync(new URL("./fba-charts-seed-output.json", import.meta.url), JSON.stringify(seed, null, 2));
console.log("\n== Seed complete ==");
console.log(seed);
