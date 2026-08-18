// Throwaway live-verification rig for Phase 3 (SNA surfaces). Creates a
// full case: parent + passport (with section B/C/D data + a morning
// check-in), a verified clinician with school/shared clinical content,
// a class_teacher (own unshared ABC log, to prove SNA can't see it),
// and an SNA linked to the same passport via actor_role='sna'.
//
// Run with: node --env-file=.env.local scripts/messages-test/sna-surfaces-seed.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PASSWORD = "SnaSurfTest-2026!";

async function createUser({ email, fullName, role }) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) {
    if (error.message?.includes("already been registered") || error.status === 422) {
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
      const existing = list?.users?.find((u) => u.email === email);
      if (existing) return existing;
    }
    throw new Error(`createUser(${email}): ${error.message}`);
  }
  return data.user;
}

console.log("== Institution ==");
const INSTITUTION_CODE = "SNASURF-TEST";
let institution;
{
  const { data: existing } = await supabase.from("institutions").select("id").eq("institution_code", INSTITUTION_CODE).maybeSingle();
  if (existing) {
    institution = existing;
  } else {
    const { data, error } = await supabase
      .from("institutions")
      .insert({ name: "SNA Surfaces Test School", institution_code: INSTITUTION_CODE, status: "verified" })
      .select("id")
      .single();
    if (error) throw error;
    institution = data;
  }
}
console.log("institution:", institution.id);

console.log("== Auth users ==");
const parent = await createUser({ email: "snasurftest.parent@thebehaviourhive.com", fullName: "Surf Parent", role: "parent" });
const teacher = await createUser({ email: "snasurftest.teacher@thebehaviourhive.com", fullName: "Surf Teacher", role: "class_teacher" });
const sna = await createUser({ email: "snasurftest.sna@thebehaviourhive.com", fullName: "Surf SNA", role: "sna" });
const clinician = await createUser({ email: "snasurftest.clinician@thebehaviourhive.com", fullName: "Dr. Surf Clinician", role: "clinician" });
console.log("parent:", parent.id, "teacher:", teacher.id, "sna:", sna.id, "clinician:", clinician.id);

console.log("== Clinician profile (verified) ==");
await supabase.from("clinicians").upsert(
  { user_id: clinician.id, full_name: "Dr. Surf Clinician", specialty: "bcba", verification_status: "verified", clinician_code: "SURFDOC1" },
  { onConflict: "user_id" }
);

console.log("== Passport (with section B/C/D + today's check-in) ==");
let passport;
{
  const { data: existing } = await supabase.from("passports").select("id").eq("user_id", parent.id).maybeSingle();
  if (existing) {
    passport = existing;
  } else {
    const { data, error } = await supabase
      .from("passports")
      .insert({
        user_id: parent.id,
        child_name: "Surf Child",
        diagnoses: ["Autism", "Other"],
        diagnosis_other: "Sensory Processing Disorder",
        passport_code: "SURF-0001",
        passport_code_active: true,
      })
      .select("id")
      .single();
    if (error) throw error;
    passport = data;
  }
}
console.log("passport:", passport.id);

// Sections B/C/D are keyed unique on user_id (one evolving row per
// parent), not passport_id -- both the upsert target and the missing
// required user_id column below were wrong in an earlier version of
// this script and failed silently (PostgREST doesn't error on an
// onConflict target that isn't a real constraint; it just no-ops).
await supabase.from("passport_section_b").upsert(
  {
    passport_id: passport.id,
    user_id: parent.id,
    hard_signals: ["Clenched fists", "Other"],
    hard_signals_other: "Goes very quiet",
    hard_triggers: ["Loud noises"],
  },
  { onConflict: "user_id" }
);
await supabase.from("passport_section_c").upsert(
  {
    passport_id: passport.id,
    user_id: parent.id,
    communication_methods: ["Verbal", "PECS"],
    shows_happy: "Big smile, flapping hands",
    shows_anxious: "Goes quiet, avoids eye contact",
    phrases_to_avoid: "\"Calm down\"",
  },
  { onConflict: "user_id" }
);
await supabase.from("passport_section_d").upsert(
  {
    passport_id: passport.id,
    user_id: parent.id,
    before_behaviour: ["Offer a break"],
    during_distress: ["Reduce demands", "Give space"],
    after_distress: ["Quiet corner time"],
    sensory_seeks: ["Deep pressure"],
    sensory_avoids: ["Loud noises"],
  },
  { onConflict: "user_id" }
);
{
  const { error } = await supabase.from("morning_checkins").insert({
    passport_id: passport.id,
    user_id: parent.id,
    sleep_quality: "woke_briefly",
    regulation_state: "unsettled",
    morning_stressors: ["Rushed morning"],
    heads_up: "Had a rough start, might need extra check-ins today.",
  });
  if (error) throw new Error(`insert into morning_checkins: ${error.message}`);
}

console.log("== Institution links: teacher + sna ==");
// institution_staff and passport_institution_links have no unique
// constraint to upsert against (only passport_access and
// clinician_access do) -- upsert with an onConflict target that
// doesn't exist fails silently rather than erroring loudly, so these
// use an explicit select-then-insert instead.
async function insertIfMissing(table, match, row) {
  const { data: existing } = await supabase.from(table).select("id").match(match).maybeSingle();
  if (existing) return;
  const { error } = await supabase.from(table).insert(row);
  if (error) throw new Error(`insert into ${table}: ${error.message}`);
}

await insertIfMissing(
  "institution_staff",
  { user_id: teacher.id, institution_id: institution.id },
  { user_id: teacher.id, institution_id: institution.id, role: "class_teacher" }
);
await insertIfMissing(
  "institution_staff",
  { user_id: sna.id, institution_id: institution.id },
  { user_id: sna.id, institution_id: institution.id, role: "sna" }
);
await insertIfMissing(
  "passport_institution_links",
  { passport_id: passport.id, institution_id: institution.id },
  { passport_id: passport.id, institution_id: institution.id, approved_by_parent: true, parent_approved_at: new Date().toISOString() }
);
await supabase.from("passport_access").upsert(
  { passport_id: passport.id, teacher_id: teacher.id, institution_id: institution.id, is_active: true, actor_role: "class_teacher" },
  { onConflict: "passport_id,teacher_id" }
);
await supabase.from("passport_access").upsert(
  { passport_id: passport.id, teacher_id: sna.id, institution_id: institution.id, is_active: true, actor_role: "sna" },
  { onConflict: "passport_id,teacher_id" }
);
await supabase.from("clinician_access").upsert(
  { passport_id: passport.id, clinician_id: clinician.id, is_active: true, linked_at: new Date().toISOString() },
  { onConflict: "passport_id,clinician_id" }
);

console.log("== Clinical content: school + shared strategies (SNA should see these) ==");
// source_document_id is NOT NULL with no FK (a polymorphic pointer
// alongside source_document_type, per migration 0040) -- any UUID is
// valid for this throwaway rig; no real fba_reports row needed.
const fakeSourceDocId = crypto.randomUUID();
{
  const { error } = await supabase.from("passport_clinical_content").insert([
    {
      passport_id: passport.id,
      author_id: clinician.id,
      item_type: "strategy_school",
      content: { title: "Offer a 5-minute movement break", description: "Before task demands increase, offer a supervised walk or movement break." },
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeSourceDocId,
    },
    {
      passport_id: passport.id,
      author_id: clinician.id,
      item_type: "strategy_shared",
      content: { title: "Use a visual first-then board", description: "Reduces demand-avoidance behaviours across settings." },
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeSourceDocId,
    },
    {
      passport_id: passport.id,
      author_id: clinician.id,
      item_type: "strategy_home",
      content: { title: "Home-only calming routine", description: "This must NEVER appear to the SNA -- home strategies are parent-only." },
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeSourceDocId,
    },
  ]);
  if (error) throw new Error(`insert into passport_clinical_content: ${error.message}`);
}

console.log("== Teacher's own unshared ABC log (SNA must NOT see this) ==");
await supabase.from("abc_logs").insert({
  passport_id: passport.id,
  logged_by: teacher.id,
  logged_by_role: "class_teacher",
  incident_date: "2026-08-17",
  incident_time: "11:00",
  intensity: 3,
  antecedents: ["Other"],
  antecedent_other: "teacher-only unshared test log",
  behaviours: ["Other"],
  behaviour_other: "test",
  consequences: ["Other"],
  consequence_other: "test",
  general_notes: "This log must NOT be visible to the SNA test account.",
});

const seed = {
  passwordHint: PASSWORD,
  institutionId: institution.id,
  institutionCode: INSTITUTION_CODE,
  passportId: passport.id,
  parent: { id: parent.id, email: "snasurftest.parent@thebehaviourhive.com" },
  teacher: { id: teacher.id, email: "snasurftest.teacher@thebehaviourhive.com" },
  sna: { id: sna.id, email: "snasurftest.sna@thebehaviourhive.com" },
  clinician: { id: clinician.id, email: "snasurftest.clinician@thebehaviourhive.com" },
};
writeFileSync(new URL("./sna-surfaces-seed-output.json", import.meta.url), JSON.stringify(seed, null, 2));

console.log("\n== Seed complete ==");
console.log(seed);
