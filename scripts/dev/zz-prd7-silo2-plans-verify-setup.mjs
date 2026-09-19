/* PRD 7 -- migration 0244 verification: the Silo 2 placeholders
   (crisis, sensory diet, AAC, care, student support). Real signed-in
   sessions throughout; service-role only for fixture setup and
   confirming persisted state.

   THE CENTREPIECE: requirement 2 -- a school can see that a plan
   exists and read its body, and cannot fetch the signed file. Proven
   directly against a real uploaded attachment, both via the raw
   attachments table AND via a real signed-URL/storage attempt.

   Clinic (ZZPRD7PLANSCLINIC): director, clinicianA (author),
   clinicianB (a domain-matched colleague), clinicianC (a NON-domain-
   matched colleague, for the negative control). School
   (ZZPRD7PLANSSCHOOL): principal, class teacher. One passport, school-
   created then clinic-linked, one parent guardian (to prove the
   deliberate absence of any parent branch).

   Run: node --env-file=.env.local scripts/dev/zz-prd7-silo2-plans-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd7-silo2-plans-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd7PlansVerify-2026!";
const BUCKET = "clinical-attachments";
let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}${detail ? " -- " + JSON.stringify(detail) : ""}`);
  }
}

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function sessionFor(email) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

const TINY_PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>", "utf-8");

async function main() {
  // =====================================================================
  // Institutions, users, the passport.
  // =====================================================================
  const { data: school } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 Plans School", institution_code: "ZZPRD7PLANSSCHOOL", status: "verified", type: "school" })
    .select("id")
    .single();
  const { data: clinic } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 Plans Clinic", institution_code: "ZZPRD7PLANSCLINIC", status: "verified", type: "clinic" })
    .select("id")
    .single();
  console.log(`School: ${school.id} | Clinic: ${clinic.id}`);

  const schoolPrincipalId = await createUser("zzprd7plans.schoolprincipal@thebehaviourhive.com");
  const schoolTeacherId = await createUser("zzprd7plans.schoolteacher@thebehaviourhive.com");
  const clinicDirectorId = await createUser("zzprd7plans.clinicdirector@thebehaviourhive.com");
  const clinicianAId = await createUser("zzprd7plans.cliniciana@thebehaviourhive.com");
  const clinicianBId = await createUser("zzprd7plans.clinicianb@thebehaviourhive.com");
  const clinicianCId = await createUser("zzprd7plans.clinicianc@thebehaviourhive.com");
  const parentId = await createUser("zzprd7plans.parent@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(schoolPrincipalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(schoolTeacherId, { app_metadata: { role: "class_teacher" } });
  await admin.auth.admin.updateUserById(clinicDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicianAId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicianBId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicianCId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(parentId, { app_metadata: { role: "parent" } });

  const now = new Date().toISOString();
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolPrincipalId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolTeacherId, role: "class_teacher", approved_at: now, approval_source: "bootstrap" });

  const schoolPrincipal = await sessionFor("zzprd7plans.schoolprincipal@thebehaviourhive.com");
  const schoolTeacher = await sessionFor("zzprd7plans.schoolteacher@thebehaviourhive.com");
  const clinicDirector = await sessionFor("zzprd7plans.clinicdirector@thebehaviourhive.com");
  const clinicianA = await sessionFor("zzprd7plans.cliniciana@thebehaviourhive.com");
  const clinicianB = await sessionFor("zzprd7plans.clinicianb@thebehaviourhive.com");
  const clinicianC = await sessionFor("zzprd7plans.clinicianc@thebehaviourhive.com");
  const parent = await sessionFor("zzprd7plans.parent@thebehaviourhive.com");

  for (const [session, id] of [[clinicianA, clinicianAId], [clinicianB, clinicianBId], [clinicianC, clinicianCId]]) {
    await session.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: id, role: "clinician" });
    const { data: staff } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", id).single();
    await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: staff.id });
  }

  const { data: passportId, error: passportErr } = await schoolPrincipal.client.rpc("create_school_passport", {
    p_institution_id: school.id,
    p_child_name: "ZZ PRD7 Plans Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);

  await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId });
  await admin.from("passport_access").insert({
    passport_id: passportId, teacher_id: schoolTeacherId, institution_id: school.id,
    is_active: true, actor_role: "class_teacher", granted_by: schoolTeacherId,
  });
  await admin.from("passport_institution_links").insert({ passport_id: passportId, institution_id: clinic.id, approved_by_parent: true, parent_approved_at: null });
  await admin.from("episodes_of_care").insert({ passport_id: passportId, institution_id: clinic.id, started_by: clinicDirectorId });

  for (const id of [clinicianAId, clinicianBId, clinicianCId]) {
    const { error: grantErr } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
      p_institution_id: clinic.id, p_passport_ids: [passportId], p_roster_user_id: id,
    });
    if (grantErr) throw new Error(`bulk_grant_clinician_access (${id}): ${grantErr.message}`);
  }

  console.log(`Passport: ${passportId}`);

  // clinicianB declares 'communication' (matches aac_plan's own
  // default) -- a real domain match. clinicianC declares 'cognition'
  // -- deliberately non-overlapping, the negative control.
  await admin.from("clinicians").update({ domain_tags: ["communication"] }).eq("user_id", clinicianBId);
  await admin.from("clinicians").update({ domain_tags: ["cognition"] }).eq("user_id", clinicianCId);

  // =====================================================================
  // PART A -- create, across types, confirming the FK/CHECK both hold
  // and the domain-tag prefill (client-side, from clinical_artefact_
  // types) matches what a clinician would actually get via the app.
  // =====================================================================
  console.log("\nPART A -- creating plans across types.");

  const { data: aacDefault } = await admin.from("clinical_artefact_types").select("default_domain_tags").eq("artefact_type", "aac_plan").single();

  const { data: aacPlan, error: aacErr } = await clinicianA.client
    .from("clinical_plans")
    .insert({
      passport_id: passportId, clinician_id: clinicianAId, plan_type: "aac_plan",
      name: "ZZ AAC Plan", domain_tags: aacDefault.default_domain_tags,
    })
    .select("id")
    .single();
  ok("clinicianA creates an AAC plan", !aacErr, aacErr?.message);

  const { data: sspPlan, error: sspErr } = await clinicianA.client
    .from("clinical_plans")
    .insert({ passport_id: passportId, clinician_id: clinicianAId, plan_type: "student_support_plan", name: "ZZ Student Support Plan" })
    .select("id")
    .single();
  ok("clinicianA creates a Student Support Plan", !sspErr, sspErr?.message);

  const { data: clinicOnlyPlan, error: clinicOnlyErr } = await clinicianA.client
    .from("clinical_plans")
    .insert({
      passport_id: passportId, clinician_id: clinicianAId, plan_type: "care_plan",
      name: "ZZ Clinic-Only Care Plan", school_visibility_override: "clinic_only",
    })
    .select("id")
    .single();
  ok("clinicianA creates a clinic_only-overridden care plan", !clinicOnlyErr, clinicOnlyErr?.message);

  const { error: badTypeErr } = await clinicianA.client
    .from("clinical_plans")
    .insert({ passport_id: passportId, clinician_id: clinicianAId, plan_type: "fba_report", name: "Should fail" });
  ok(
    "plan_type is refused outside the five real Silo-2 values, even though clinical_artefact_types itself contains 'fba_report'",
    !!badTypeErr,
    badTypeErr?.message
  );

  const REAL_BODY = "The full clinical summary of this Student Support Plan -- what a school reads.";
  await clinicianA.client.from("clinical_plans").update({ body: REAL_BODY }).eq("id", sspPlan.id);

  // =====================================================================
  // PART B -- THE CENTREPIECE. Requirement 2: a school can see that a
  // plan exists and read its body, and cannot fetch the signed file.
  // A real attachment, uploaded through the real path.
  // =====================================================================
  console.log("\nPART B -- the school-sees-body-not-file split, proven against a real file.");

  const storagePath = `clinical_plan/${sspPlan.id}/${crypto.randomUUID()}-report.pdf`;
  const { error: uploadErr } = await clinicianA.client.storage.from(BUCKET).upload(storagePath, TINY_PDF, { contentType: "application/pdf" });
  ok("clinicianA (the author) uploads a real attachment to the shareable Student Support Plan", !uploadErr, uploadErr?.message);

  const { error: attRowErr } = await clinicianA.client.from("attachments").insert({
    artefact_type: "clinical_plan", artefact_id: sspPlan.id, storage_path: storagePath,
    original_filename: "report.pdf", content_type: "application/pdf", size_bytes: TINY_PDF.length, uploaded_by: clinicianAId,
  });
  ok("the attachments metadata row is recorded", !attRowErr, attRowErr?.message);

  // The body, via the real school-facing RPC.
  const { data: teacherPlans } = await schoolTeacher.client.rpc("get_clinical_plans_for_passport", { p_passport_id: passportId });
  const teacherSsp = (teacherPlans ?? []).find((p) => p.id === sspPlan.id);
  ok("the teacher sees the Student Support Plan exists, via the RPC", !!teacherSsp, teacherPlans);
  ok("...and reads its REAL body, verbatim", teacherSsp?.body === REAL_BODY, teacherSsp?.body);

  // The body, via raw RLS too (the table's own policy, independent of
  // the RPC).
  const { data: teacherRawRow } = await schoolTeacher.client.from("clinical_plans").select("name, body").eq("id", sspPlan.id).maybeSingle();
  ok("the teacher's raw table SELECT also succeeds (a real, independent RLS grant, not just the RPC)", teacherRawRow?.body === REAL_BODY, teacherRawRow);

  // The file: refused, both at the attachments-row layer and at
  // Storage itself.
  const { data: teacherAttRows } = await schoolTeacher.client.from("attachments").select("id").eq("artefact_type", "clinical_plan").eq("artefact_id", sspPlan.id);
  ok("the teacher gets ZERO rows from attachments for this same plan -- the file's own existence is invisible", (teacherAttRows ?? []).length === 0, teacherAttRows);

  const { data: teacherSignedUrl, error: teacherSignedUrlErr } = await schoolTeacher.client.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  ok(
    "the teacher cannot even GENERATE a signed URL for the real storage path -- refused before any fetch is attempted",
    !!teacherSignedUrlErr || !teacherSignedUrl,
    { error: teacherSignedUrlErr?.message, url: teacherSignedUrl }
  );

  const { data: teacherDirectDownload, error: teacherDownloadErr } = await schoolTeacher.client.storage.from(BUCKET).download(storagePath);
  ok("...and a direct download attempt against the real path is refused too", !!teacherDownloadErr || !teacherDirectDownload, teacherDownloadErr?.message);

  // Same two claims for the principal.
  const { data: principalPlans } = await schoolPrincipal.client.rpc("get_clinical_plans_for_passport", { p_passport_id: passportId });
  const principalSsp = (principalPlans ?? []).find((p) => p.id === sspPlan.id);
  ok("the principal reads the same body via the RPC", principalSsp?.body === REAL_BODY, principalSsp?.body);
  const { data: principalSignedUrl, error: principalSignedUrlErr } = await schoolPrincipal.client.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  ok("the principal likewise cannot generate a signed URL", !!principalSignedUrlErr || !principalSignedUrl, { error: principalSignedUrlErr?.message });

  // The regression control: the AUTHOR's own signed URL genuinely works.
  const { data: authorSignedUrl, error: authorSignedUrlErr } = await clinicianA.client.storage.from(BUCKET).createSignedUrl(storagePath, 60);
  ok("...while the author's OWN signed URL is granted -- confirming the refusal above is real, not a blanket bucket failure", !authorSignedUrlErr && !!authorSignedUrl, authorSignedUrlErr?.message);
  if (authorSignedUrl) {
    const resp = await fetch(authorSignedUrl.signedUrl);
    const bytes = Buffer.from(await resp.arrayBuffer());
    ok("...and actually fetching it returns the real uploaded bytes", resp.ok && bytes.equals(TINY_PDF), { ok: resp.ok, len: bytes.length });
  }

  // =====================================================================
  // PART C -- the clinic_only override closes the same two reads.
  // =====================================================================
  console.log("\nPART C -- a clinic_only override closes both reads.");

  const { data: teacherClinicOnlyRpc } = await schoolTeacher.client.rpc("get_clinical_plans_for_passport", { p_passport_id: passportId });
  ok(
    "the clinic_only-overridden care plan never appears to the teacher via the RPC",
    !(teacherClinicOnlyRpc ?? []).some((p) => p.id === clinicOnlyPlan.id),
    teacherClinicOnlyRpc
  );
  const { data: teacherClinicOnlyRaw } = await schoolTeacher.client.from("clinical_plans").select("id").eq("id", clinicOnlyPlan.id);
  ok("...nor via a raw table SELECT", (teacherClinicOnlyRaw ?? []).length === 0, teacherClinicOnlyRaw);

  // =====================================================================
  // PART D -- domain-matched colleague read, and the negative control.
  // =====================================================================
  console.log("\nPART D -- domain-tag colleague read.");

  const { data: clinicianBRead } = await clinicianB.client.from("clinical_plans").select("id").eq("id", aacPlan.id);
  ok("clinicianB (domain-matched: communication) can read the AAC plan", (clinicianBRead ?? []).length === 1, clinicianBRead);

  const { data: clinicianCRead } = await clinicianC.client.from("clinical_plans").select("id").eq("id", aacPlan.id);
  ok("clinicianC (NOT domain-matched: cognition only) cannot read the same AAC plan", (clinicianCRead ?? []).length === 0, clinicianCRead);

  // =====================================================================
  // PART E -- write authority: author-only, no lock, no delete.
  // =====================================================================
  console.log("\nPART E -- write authority.");

  const { data: colleagueEditAttempt } = await clinicianB.client.from("clinical_plans").update({ name: "Hijacked" }).eq("id", aacPlan.id).select("id");
  ok("a domain-matched colleague (read access) cannot edit the plan -- RLS-on-UPDATE silently touches nothing", (colleagueEditAttempt ?? []).length === 0, colleagueEditAttempt);

  const { data: authorEditAttempt, error: authorEditErr } = await clinicianA.client.from("clinical_plans").update({ name: "ZZ AAC Plan (renamed)" }).eq("id", aacPlan.id).select("id");
  ok("the author CAN edit their own plan, no lock, ever", !authorEditErr && (authorEditAttempt ?? []).length === 1, authorEditErr?.message);

  const { data: deleteAttempt } = await clinicianA.client.from("clinical_plans").delete().eq("id", aacPlan.id).select("id");
  ok("no DELETE policy exists -- even the author's own delete attempt silently touches nothing", (deleteAttempt ?? []).length === 0, deleteAttempt);
  const { data: stillExists } = await admin.from("clinical_plans").select("id").eq("id", aacPlan.id);
  ok("...confirmed via service-role read: the row is still there", (stillExists ?? []).length === 1, stillExists);

  // =====================================================================
  // PART F -- no parent branch, deliberately, matching bsp's own
  // precedent.
  // =====================================================================
  console.log("\nPART F -- the deliberate absence of a parent branch.");

  const { data: parentRpc } = await parent.client.rpc("get_clinical_plans_for_passport", { p_passport_id: passportId });
  ok("a parent gets zero plans via the RPC -- no parent branch exists in its own authorization", (parentRpc ?? []).length === 0, parentRpc);
  const { data: parentRaw } = await parent.client.from("clinical_plans").select("id").eq("passport_id", passportId);
  ok("...nor via a raw table SELECT", (parentRaw ?? []).length === 0, parentRaw);

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log("\nFixture IDs (for teardown / manual inspection):");
  console.log(JSON.stringify({ schoolId: school.id, clinicId: clinic.id, passportId, aacPlanId: aacPlan.id, sspPlanId: sspPlan.id, clinicOnlyPlanId: clinicOnlyPlan.id }, null, 2));

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
