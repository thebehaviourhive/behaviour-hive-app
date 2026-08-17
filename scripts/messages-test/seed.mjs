// Throwaway test rig for Messages Stage 1 verification. Creates
// clearly-scoped msgtest.*@thebehaviourhive.com accounts + a msgtest
// institution, meant to be deleted again by cleanup.mjs in this same
// directory once verification is done.
//
// Run with: node --env-file=.env.local scripts/messages-test/seed.mjs

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PASSWORD = "MsgTest-2026!";

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

async function upsert(table, row, conflictCols) {
  const { data, error } = await supabase
    .from(table)
    .upsert(row, conflictCols ? { onConflict: conflictCols } : undefined)
    .select()
    .single();
  if (error) throw new Error(`${table} upsert: ${error.message}`);
  return data;
}

async function insertIfNotExists(table, match, row) {
  let query = supabase.from(table).select("*");
  for (const [col, val] of Object.entries(match)) {
    query = query.eq(col, val);
  }
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw new Error(`${table} select: ${selectError.message}`);
  if (existing) return existing;
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data;
}

async function main() {
  console.log("== Institution ==");
  const institution = await upsert(
    "institutions",
    { name: "Messages Test School", institution_code: "MSGT-TEST", status: "verified", phone: "01 555 0100" },
    "institution_code"
  );
  console.log("institution:", institution.id);

  console.log("== Auth users ==");
  const parent = await createUser({
    email: "msgtest.parent@thebehaviourhive.com",
    fullName: "Parent Msgtest",
    role: "parent",
  });
  const parent2 = await createUser({
    email: "msgtest.parent2@thebehaviourhive.com",
    fullName: "Parent Two Msgtest",
    role: "parent",
  });
  const teacher1 = await createUser({
    email: "msgtest.teacher1@thebehaviourhive.com",
    fullName: "Teacher One Msgtest",
    role: "class_teacher",
  });
  const teacher2 = await createUser({
    email: "msgtest.teacher2@thebehaviourhive.com",
    fullName: "Teacher Two Msgtest",
    role: "class_teacher",
  });
  const clinician1 = await createUser({
    email: "msgtest.clinician1@thebehaviourhive.com",
    fullName: "Clinician One Msgtest",
    role: "clinician",
  });
  console.log("parent:", parent.id, "teacher1:", teacher1.id, "teacher2:", teacher2.id, "clinician1:", clinician1.id);

  console.log("== Clinician profile (verified) ==");
  await upsert(
    "clinicians",
    {
      user_id: clinician1.id,
      specialty: "behavioural_psychologist",
      verification_status: "verified",
      full_name: "Clinician One Msgtest",
      review_cadence_days: 30,
    },
    "user_id"
  );

  console.log("== Passport ==");
  const passport = await upsert(
    "passports",
    {
      user_id: parent.id,
      child_name: "Test Child Messages",
      date_of_birth: "2017-05-10",
      school: "Messages Test School",
      diagnoses: ["ASD (Autism Spectrum Disorder)"],
      diagnosis_other: null,
      section_a_complete: true,
      passport_status: "complete",
    },
    "user_id"
  );
  console.log("passport:", passport.id);

  console.log("== Linking teacher1 to institution + passport (genuine participant) ==");
  await insertIfNotExists(
    "institution_staff",
    { institution_id: institution.id, user_id: teacher1.id },
    { institution_id: institution.id, user_id: teacher1.id, role: "class_teacher" }
  );
  await insertIfNotExists(
    "passport_institution_links",
    { passport_id: passport.id, institution_id: institution.id },
    {
      passport_id: passport.id,
      institution_id: institution.id,
      approved_by_parent: true,
      parent_approved_at: new Date().toISOString(),
    }
  );
  await upsert(
    "passport_access",
    {
      passport_id: passport.id,
      teacher_id: teacher1.id,
      institution_id: institution.id,
      is_active: true,
      linked_at: new Date().toISOString(),
    },
    "passport_id,teacher_id"
  );

  console.log("== Second passport (Stage 2 triage: teacher1 needs >=2 pupils) ==");
  const passport2 = await upsert(
    "passports",
    {
      user_id: parent2.id,
      child_name: "Test Child Messages Two",
      date_of_birth: "2018-02-20",
      school: "Messages Test School",
      diagnoses: ["ADHD"],
      diagnosis_other: null,
      section_a_complete: true,
      passport_status: "complete",
    },
    "user_id"
  );
  console.log("passport2:", passport2.id);

  await insertIfNotExists(
    "passport_institution_links",
    { passport_id: passport2.id, institution_id: institution.id },
    {
      passport_id: passport2.id,
      institution_id: institution.id,
      approved_by_parent: true,
      parent_approved_at: new Date().toISOString(),
    }
  );
  await upsert(
    "passport_access",
    {
      passport_id: passport2.id,
      teacher_id: teacher1.id,
      institution_id: institution.id,
      is_active: true,
      linked_at: new Date().toISOString(),
    },
    "passport_id,teacher_id"
  );

  console.log("== teacher2: institution staff only, deliberately NOT linked to the passport ==");
  await insertIfNotExists(
    "institution_staff",
    { institution_id: institution.id, user_id: teacher2.id },
    { institution_id: institution.id, user_id: teacher2.id, role: "class_teacher" }
  );

  console.log("== Linking clinician1 to passport (active, verified) ==");
  await upsert(
    "clinician_access",
    {
      passport_id: passport.id,
      clinician_id: clinician1.id,
      is_active: true,
      linked_at: new Date().toISOString(),
    },
    "passport_id,clinician_id"
  );

  const summary = {
    passwordHint: PASSWORD,
    institutionId: institution.id,
    passportId: passport.id,
    passportId2: passport2.id,
    parent: { id: parent.id, email: parent.email },
    parent2: { id: parent2.id, email: parent2.email },
    teacher1: { id: teacher1.id, email: teacher1.email },
    teacher2: { id: teacher2.id, email: teacher2.email },
    clinician1: { id: clinician1.id, email: clinician1.email },
  };
  writeFileSync(new URL("./seed-output.json", import.meta.url), JSON.stringify(summary, null, 2));
  console.log("\n== Seed complete ==");
  console.log(summary);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
