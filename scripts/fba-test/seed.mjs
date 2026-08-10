// Throwaway test rig for FBA module (Stage 1) verification. NOT the same
// world as scripts/demo/ (that demo world was deleted per explicit user
// instruction and is not being resurrected here). This creates its own
// clearly-scoped fbatest.*@thebehaviourhive.com accounts, meant to be
// deleted again by cleanup.mjs in this same directory once verification
// is done.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed.mjs

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

const PASSWORD = "FbaTest-2026!";

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
    { name: "FBA Test School", institution_code: "FBAT-TEST", status: "verified" },
    "institution_code"
  );
  console.log("institution:", institution.id);

  console.log("== Auth users ==");
  const clinician = await createUser({
    email: "fbatest.clinician@thebehaviourhive.com",
    fullName: "Dr. Fiona Clarke",
    role: "clinician",
  });
  const teacher = await createUser({
    email: "fbatest.teacher@thebehaviourhive.com",
    fullName: "Tara Byrne",
    role: "class_teacher",
  });
  const parent = await createUser({
    email: "fbatest.parent@thebehaviourhive.com",
    fullName: "Orla Quinn",
    role: "parent",
  });
  console.log("clinician:", clinician.id, "teacher:", teacher.id, "parent:", parent.id);

  console.log("== Clinician profile (verified) ==");
  await upsert(
    "clinicians",
    {
      user_id: clinician.id,
      specialty: "behavioural_psychologist",
      verification_status: "verified",
      full_name: "Dr. Fiona Clarke",
      review_cadence_days: 30,
    },
    "user_id"
  );

  console.log("== Passport ==");
  const passport = await upsert(
    "passports",
    {
      user_id: parent.id,
      child_name: "Test Child FBA",
      date_of_birth: "2017-05-10",
      school: "FBA Test School",
      diagnoses: ["ASD (Autism Spectrum Disorder)"],
      diagnosis_other: null,
      section_a_complete: true,
      passport_status: "complete",
    },
    "user_id"
  );
  console.log("passport:", passport.id);

  console.log("== Linking teacher to institution + passport ==");
  await insertIfNotExists(
    "institution_staff",
    { institution_id: institution.id, user_id: teacher.id },
    { institution_id: institution.id, user_id: teacher.id, role: "class_teacher" }
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
      teacher_id: teacher.id,
      institution_id: institution.id,
      is_active: true,
      linked_at: new Date().toISOString(),
    },
    "passport_id,teacher_id"
  );

  console.log("== Linking clinician to passport ==");
  await upsert(
    "clinician_access",
    {
      passport_id: passport.id,
      clinician_id: clinician.id,
      is_active: true,
      linked_at: new Date().toISOString(),
    },
    "passport_id,clinician_id"
  );

  const credentials = {
    password: PASSWORD,
    institutionId: institution.id,
    clinician: { id: clinician.id, email: "fbatest.clinician@thebehaviourhive.com" },
    teacher: { id: teacher.id, email: "fbatest.teacher@thebehaviourhive.com" },
    parent: { id: parent.id, email: "fbatest.parent@thebehaviourhive.com" },
    passportId: passport.id,
  };
  writeFileSync(new URL("./.credentials.json", import.meta.url), JSON.stringify(credentials, null, 2));

  console.log("\n== Seed complete ==");
  console.log(JSON.stringify(credentials, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
