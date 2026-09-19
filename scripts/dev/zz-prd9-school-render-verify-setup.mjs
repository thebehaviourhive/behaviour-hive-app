/* PRD 9 Stage 1 -- render-level proof that ClinicianCoverageDetail's
   Workspace-email block never renders for a SCHOOL principal (the
   RPC-level twin is already proven in zz-prd9-stage1-verify-setup.mjs;
   this is the live-browser render check specifically). Sets up a real
   school, a real principal account with a known password (so it can
   sign in through the actual /login form, not a service-role session),
   and a real engaged clinician so the Directory > Clinicians detail
   pane has something to select and render.

   Run: node --env-file=.env.local scripts/dev/zz-prd9-school-render-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd9-school-render-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd9SchoolRenderVerify-2026!";

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function main() {
  const { data: school } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD9 School Render Verify", institution_code: "ZZPRD9SCHOOLRENDER", status: "verified", type: "school" })
    .select("id")
    .single();
  console.log(`School: ${school.id}`);

  const principalId = await createUser("zzprd9schoolrender.principal@thebehaviourhive.com");
  const clinicianId = await createUser("zzprd9schoolrender.clinician@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(principalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicianId, { app_metadata: { role: "clinician" } });

  const now = new Date().toISOString();
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: principalId, role: "principal", approved_at: now, approval_source: "bootstrap" });

  // A real, verified clinicians row -- fixture setup only, not exercising
  // the verification flow itself (already covered elsewhere).
  await admin.from("clinicians").insert({ user_id: clinicianId, full_name: "ZZ Render Clinician", specialty: "behavioural_psychologist", verification_status: "verified", verification_route: "behaviour_hive" });

  // A real school-created passport, and a real institution-engaged
  // clinician_access row so get_institution_clinicians() actually
  // returns a row for the principal to select in the Directory.
  const principalClient = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const { data: signIn, error: signInErr } = await principalClient.auth.signInWithPassword({ email: "zzprd9schoolrender.principal@thebehaviourhive.com", password: PASSWORD });
  if (signInErr) throw new Error(`principal signIn: ${signInErr.message}`);

  const { data: passportId, error: passportErr } = await principalClient.rpc("create_school_passport", {
    p_institution_id: school.id,
    p_child_name: "ZZ Render Verify Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);

  await admin.from("clinician_access").insert({
    passport_id: passportId,
    clinician_id: clinicianId,
    engaged_by: "institution",
    engaged_by_institution_id: school.id,
    is_active: true,
  });

  console.log(`Passport: ${passportId}`);
  console.log(`Principal login: zzprd9schoolrender.principal@thebehaviourhive.com / ${PASSWORD}`);
  console.log(`Clinician should now appear under Directory > Clinicians as "ZZ Render Clinician".`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
