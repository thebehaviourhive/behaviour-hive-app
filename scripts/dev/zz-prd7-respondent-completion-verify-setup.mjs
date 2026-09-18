/* PRD 7 -- migration 0239 verification: the parent/school-facing
   response-sheet completion flow. Real signed-in sessions throughout;
   service-role only for fixture setup and confirming persisted state.

   TWO institutions, deliberately -- a clinic (ZZPRD7RESPCLINIC, where
   the assessment is authored) and a wholly separate school
   (ZZPRD7RESPSCHOOL, where the respondent teacher works), to prove
   get_assessment_respondent_candidates() resolves cross-organisation
   candidates through the CHILD's own passport_institution_links, never
   the calling clinician's own institution.

   Accounts: clinicDirector (principal, clinic), clinicianA (the
   assessment's own author), clinicianB (a second clinic practitioner
   with real clinician_access to the same child -- proves a clinic
   colleague is NOT a valid respondent candidate, since
   has_child_access() is purely school-side), schoolPrincipal (creates
   the school-side passport), schoolTeacher (the cross-org respondent
   candidate), parent (guardian, the other respondent candidate),
   outsider (zero relationship to the child -- proves server-side
   candidate validation, not just a UI suggestion).

   Run: node --env-file=.env.local scripts/dev/zz-prd7-respondent-completion-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd7-respondent-completion-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd7RespVerify-2026!";
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

async function main() {
  // =====================================================================
  // Institutions.
  // =====================================================================
  const { data: school, error: schoolErr } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 Resp School", institution_code: "ZZPRD7RESPSCHOOL", status: "verified", type: "school" })
    .select("id")
    .single();
  if (schoolErr) throw new Error(`school insert: ${schoolErr.message}`);

  const { data: clinic, error: clinicErr } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 Resp Clinic", institution_code: "ZZPRD7RESPCLINIC", status: "verified", type: "clinic" })
    .select("id")
    .single();
  if (clinicErr) throw new Error(`clinic insert: ${clinicErr.message}`);

  console.log(`School: ${school.id} | Clinic: ${clinic.id}`);

  // =====================================================================
  // Users.
  // =====================================================================
  const schoolPrincipalId = await createUser("zzprd7resp.schoolprincipal@thebehaviourhive.com");
  const schoolTeacherId = await createUser("zzprd7resp.schoolteacher@thebehaviourhive.com");
  const clinicDirectorId = await createUser("zzprd7resp.clinicdirector@thebehaviourhive.com");
  const clinicianAId = await createUser("zzprd7resp.cliniciana@thebehaviourhive.com");
  const clinicianBId = await createUser("zzprd7resp.clinicianb@thebehaviourhive.com");
  const parentId = await createUser("zzprd7resp.parent@thebehaviourhive.com");
  const outsiderId = await createUser("zzprd7resp.outsider@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(schoolPrincipalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(schoolTeacherId, { app_metadata: { role: "class_teacher" } });
  await admin.auth.admin.updateUserById(clinicDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicianAId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicianBId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(parentId, { app_metadata: { role: "parent" } });
  await admin.auth.admin.updateUserById(outsiderId, { app_metadata: { role: "parent" } });

  const now = new Date().toISOString();
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolPrincipalId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });

  const schoolPrincipal = await sessionFor("zzprd7resp.schoolprincipal@thebehaviourhive.com");
  const schoolTeacher = await sessionFor("zzprd7resp.schoolteacher@thebehaviourhive.com");
  const clinicDirector = await sessionFor("zzprd7resp.clinicdirector@thebehaviourhive.com");
  const clinicianA = await sessionFor("zzprd7resp.cliniciana@thebehaviourhive.com");
  const clinicianB = await sessionFor("zzprd7resp.clinicianb@thebehaviourhive.com");
  const parent = await sessionFor("zzprd7resp.parent@thebehaviourhive.com");
  const outsider = await sessionFor("zzprd7resp.outsider@thebehaviourhive.com");

  // School teacher: real institution_staff row, approved.
  const { data: teacherStaff, error: teacherStaffErr } = await admin
    .from("institution_staff")
    .insert({ institution_id: school.id, user_id: schoolTeacherId, role: "class_teacher", approved_at: now, approval_source: "bootstrap" })
    .select("id")
    .single();
  if (teacherStaffErr) throw new Error(`teacher staff insert: ${teacherStaffErr.message}`);

  // Clinicians self-link by code, director approves -- the real
  // production path (0222): the director's own approval IS the
  // practitioner's verification.
  await clinicianA.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianAId, role: "clinician" });
  const { data: staffA } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", clinicianAId).single();
  await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: staffA.id });

  await clinicianB.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianBId, role: "clinician" });
  const { data: staffB } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", clinicianBId).single();
  await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: staffB.id });

  // =====================================================================
  // The passport -- school-created (a real create_school_passport()
  // call, real principal session), then linked into the clinic
  // directly (mirroring onboard_clinic_client()'s own internal inserts
  // exactly -- PRD 5 Stage 3's own established precedent for attaching
  // an already-existing passport to a second organisation, since no
  // RPC for that exists yet).
  // =====================================================================
  const { data: passportId, error: passportErr } = await schoolPrincipal.client.rpc("create_school_passport", {
    p_institution_id: school.id,
    p_child_name: "ZZ PRD7 Resp Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);

  const { error: guardianErr } = await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId });
  if (guardianErr) throw new Error(`passport_guardians insert: ${guardianErr.message}`);

  const { error: paErr } = await admin.from("passport_access").insert({
    passport_id: passportId,
    teacher_id: schoolTeacherId,
    institution_id: school.id,
    is_active: true,
    actor_role: "class_teacher",
    granted_by: schoolTeacherId,
  });
  if (paErr) throw new Error(`passport_access insert: ${paErr.message}`);

  const { error: pilErr } = await admin.from("passport_institution_links").insert({
    passport_id: passportId,
    institution_id: clinic.id,
    approved_by_parent: true,
    parent_approved_at: null,
  });
  if (pilErr) throw new Error(`clinic passport_institution_links insert: ${pilErr.message}`);

  const { error: eocErr } = await admin.from("episodes_of_care").insert({ passport_id: passportId, institution_id: clinic.id, started_by: clinicDirectorId });
  if (eocErr) throw new Error(`episodes_of_care insert: ${eocErr.message}`);

  // clinicianA gets real clinician_access via the real roster-assign
  // RPC (the director's own session, matching the deployed bulk-assign
  // screen exactly). clinicianB too -- their own access is real, and
  // is precisely what proves has_child_access() alone (not
  // clinician_access) gates the candidate list.
  const { error: grantAErr } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
    p_institution_id: clinic.id,
    p_passport_ids: [passportId],
    p_roster_user_id: clinicianAId,
  });
  if (grantAErr) throw new Error(`bulk_grant_clinician_access (A): ${grantAErr.message}`);

  const { error: grantBErr } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
    p_institution_id: clinic.id,
    p_passport_ids: [passportId],
    p_roster_user_id: clinicianBId,
  });
  if (grantBErr) throw new Error(`bulk_grant_clinician_access (B): ${grantBErr.message}`);

  console.log(`Passport: ${passportId}`);

  const { data: mas } = await admin.from("assessment_instruments").select("id").eq("name", "MAS").single();
  const { data: wiscV } = await admin.from("assessment_instruments").select("id").eq("name", "WISC-V").single();

  // =====================================================================
  // The assessment -- authored by clinicianA, a real MAS response
  // sheet, real INSERT policy (author + verified + active
  // clinician_access).
  // =====================================================================
  // interpretation/scores are structurally impossible on a response_sheet
  // row (assessments_record_type_fields_check requires both null) -- the
  // real thing a respondent must never see or tamper on THIS row shape
  // is subscale_totals, per Daniel's own correction: the clinician
  // enters these from the paper's own scoring key, and a respondent
  // writing (or even reading) them would defeat that.
  const { data: assessment, error: assessErr } = await clinicianA.client
    .from("assessments")
    .insert({
      passport_id: passportId,
      clinician_id: clinicianAId,
      instrument_id: mas.id,
      subscale_totals: [{ label: "Attention", total: "12" }],
      responses: {},
    })
    .select("id")
    .single();
  if (assessErr) throw new Error(`assessments insert: ${assessErr.message}`);
  const assessmentId = assessment.id;
  console.log(`Assessment (MAS, response sheet): ${assessmentId}`);

  const { data: externalRecord, error: extErr } = await clinicianA.client
    .from("assessments")
    .insert({ passport_id: passportId, clinician_id: clinicianAId, instrument_id: wiscV.id })
    .select("id")
    .single();
  if (extErr) throw new Error(`external record insert: ${extErr.message}`);
  const externalRecordId = externalRecord.id;
  console.log(`Assessment (WISC-V, external record): ${externalRecordId}`);

  // =====================================================================
  // PART A -- candidate resolution. Cross-organisation, and the
  // clinic-colleague / outsider / director exclusions.
  // =====================================================================
  console.log("\nPART A -- candidate resolution.");

  const { data: candidates, error: candErr } = await clinicianA.client.rpc("get_assessment_respondent_candidates", { p_assessment_id: assessmentId });
  ok("candidate query succeeds", !candErr, candErr?.message);
  const candIds = (candidates ?? []).map((c) => c.recipient_id);
  ok("parent (same passport, different institution entirely) is a candidate", candIds.includes(parentId), candIds);
  ok("parent's own role resolves to 'parent'", (candidates ?? []).find((c) => c.recipient_id === parentId)?.role === "parent");
  ok(
    "school teacher (cross-organisation -- a wholly separate school) is a candidate",
    candIds.includes(schoolTeacherId),
    candIds
  );
  ok(
    "school teacher's own role resolves to their real institution_staff role ('class_teacher')",
    (candidates ?? []).find((c) => c.recipient_id === schoolTeacherId)?.role === "class_teacher"
  );
  ok(
    "clinicianB -- a clinic colleague WITH real clinician_access to this child -- is NOT a candidate (has_child_access() is purely school-side)",
    !candIds.includes(clinicianBId),
    candIds
  );
  ok("the clinic director is NOT a candidate (no has_child_access() of their own)", !candIds.includes(clinicDirectorId), candIds);
  ok("a wholly unrelated outsider is NOT a candidate", !candIds.includes(outsiderId), candIds);

  // =====================================================================
  // PART B -- assignment: server-side validation, not just a UI
  // suggestion; reset-on-assign; author-only; response-sheet-only.
  // =====================================================================
  console.log("\nPART B -- assignment.");

  const { error: assignOutsiderErr } = await clinicianA.client.rpc("assign_assessment_respondent", {
    p_assessment_id: assessmentId,
    p_respondent_id: outsiderId,
  });
  ok(
    "assigning an invalid candidate (not offered by the UI, attempted directly) is refused server-side",
    !!assignOutsiderErr && /not a valid respondent/i.test(assignOutsiderErr.message),
    assignOutsiderErr?.message
  );

  const { error: assignByOtherErr } = await clinicianB.client.rpc("assign_assessment_respondent", {
    p_assessment_id: assessmentId,
    p_respondent_id: parentId,
  });
  ok(
    "a different clinician (not this assessment's own author) cannot assign a respondent",
    !!assignByOtherErr && /own author/i.test(assignByOtherErr.message),
    assignByOtherErr?.message
  );

  const { error: assignExternalErr } = await clinicianA.client.rpc("assign_assessment_respondent", {
    p_assessment_id: externalRecordId,
    p_respondent_id: parentId,
  });
  ok(
    "an external record (not a response sheet) cannot be assigned to a respondent",
    !!assignExternalErr && /response sheet/i.test(assignExternalErr.message),
    assignExternalErr?.message
  );

  const { error: assignParentErr } = await clinicianA.client.rpc("assign_assessment_respondent", {
    p_assessment_id: assessmentId,
    p_respondent_id: parentId,
  });
  ok("a real, legitimate assignment (to the parent) succeeds", !assignParentErr, assignParentErr?.message);

  const { data: afterAssign } = await admin
    .from("assessments")
    .select("assigned_respondent_id, assigned_at, last_reminded_at, responses, respondent_type")
    .eq("id", assessmentId)
    .single();
  ok("assigned_respondent_id is set to the parent", afterAssign.assigned_respondent_id === parentId, afterAssign);
  ok("assigned_at is set", !!afterAssign.assigned_at);
  ok("last_reminded_at is null on a fresh assignment", afterAssign.last_reminded_at === null);
  ok("responses is reset to {} on assignment", JSON.stringify(afterAssign.responses) === "{}", afterAssign.responses);
  ok("respondent_type is derived correctly as 'parent' -- never independently clinician-chosen", afterAssign.respondent_type === "parent");

  // =====================================================================
  // PART C -- the SELECT leak: a respondent has ZERO raw access to
  // this table, either direction. RLS is genuinely silent -- 0 rows,
  // not an error.
  // =====================================================================
  console.log("\nPART C -- the SELECT/UPDATE leak, closed.");

  const { data: rawSelect, error: rawSelectErr } = await parent.client.from("assessments").select("*").eq("id", assessmentId);
  ok(
    "the respondent has NO raw SELECT on assessments at all -- RLS-silent, zero rows, not an error",
    !rawSelectErr && (rawSelect ?? []).length === 0,
    { error: rawSelectErr?.message, rows: rawSelect?.length }
  );

  const { data: rawUpdate } = await parent.client
    .from("assessments")
    .update({ subscale_totals: [{ label: "hacked", total: "999" }] })
    .eq("id", assessmentId)
    .select("id");
  ok(
    "a raw UPDATE from the respondent silently touches nothing (RLS-on-UPDATE, this schema's own documented trap)",
    (rawUpdate ?? []).length === 0,
    rawUpdate
  );

  const { data: afterTamper } = await admin.from("assessments").select("subscale_totals").eq("id", assessmentId).single();
  ok(
    "confirmed via service-role read: the clinician's own scored subscale_totals genuinely did not change",
    JSON.stringify(afterTamper.subscale_totals) === JSON.stringify([{ label: "Attention", total: "12" }]),
    afterTamper
  );

  const { data: toComplete, error: toCompleteErr } = await parent.client.rpc("get_assessment_to_complete", { p_assessment_id: assessmentId });
  const toCompleteRow = (toComplete ?? [])[0];
  ok("get_assessment_to_complete() succeeds for the assigned respondent", !toCompleteErr && !!toCompleteRow, toCompleteErr?.message);
  ok(
    "the returned row has NO interpretation/scores/subscale_totals key at all -- structurally excluded, not just unrendered",
    toCompleteRow && !("interpretation" in toCompleteRow) && !("scores" in toCompleteRow) && !("subscale_totals" in toCompleteRow),
    toCompleteRow ? Object.keys(toCompleteRow) : null
  );
  ok(
    "the returned row DOES carry what a respondent needs (instrument name, item count, response scale)",
    toCompleteRow?.instrument_name === "MAS" && toCompleteRow?.item_count === 16 && Array.isArray(toCompleteRow?.response_scale),
    toCompleteRow
  );

  // =====================================================================
  // PART D -- submit: responses only, never subscale_totals.
  // =====================================================================
  console.log("\nPART D -- submit (responses only).");

  const { error: submitErr } = await parent.client.rpc("submit_assessment_response", {
    p_assessment_id: assessmentId,
    p_responses: { "1": "Never", "2": "Usually" },
  });
  ok("the respondent's own submit succeeds", !submitErr, submitErr?.message);

  const { data: afterSubmit } = await admin.from("assessments").select("responses, subscale_totals").eq("id", assessmentId).single();
  ok("responses persisted exactly as submitted", JSON.stringify(afterSubmit.responses) === JSON.stringify({ "1": "Never", "2": "Usually" }), afterSubmit.responses);
  ok(
    "subscale_totals is untouched (still the clinician's own original scored value) -- the RPC's own signature has no way to write it at all, per 13a",
    JSON.stringify(afterSubmit.subscale_totals) === JSON.stringify([{ label: "Attention", total: "12" }]),
    afterSubmit.subscale_totals
  );

  // =====================================================================
  // PART E -- recipient permanence (0040's own judgment, copied
  // exactly): reassign to the school teacher, they submit, THEN their
  // access to the child is fully revoked -- and they can still finish.
  // =====================================================================
  console.log("\nPART E -- recipient permanence.");

  const { error: reassignErr } = await clinicianA.client.rpc("assign_assessment_respondent", {
    p_assessment_id: assessmentId,
    p_respondent_id: schoolTeacherId,
  });
  ok("reassigning to the school teacher succeeds", !reassignErr, reassignErr?.message);

  const { data: afterReassign } = await admin.from("assessments").select("responses, respondent_type").eq("id", assessmentId).single();
  ok(
    "responses is reset to {} on reassignment -- the parent's earlier answers do not carry forward under changed attribution",
    JSON.stringify(afterReassign.responses) === "{}",
    afterReassign.responses
  );
  ok("respondent_type correctly derives to 'school_staff' for the teacher", afterReassign.respondent_type === "school_staff");

  const { error: teacherSubmitErr } = await schoolTeacher.client.rpc("submit_assessment_response", {
    p_assessment_id: assessmentId,
    p_responses: { "1": "Always" },
  });
  ok("the school teacher (currently WITH access) can submit", !teacherSubmitErr, teacherSubmitErr?.message);

  // Revoke the teacher's own access to this child entirely -- both the
  // direct grant and their own institution_staff standing.
  await admin.from("passport_access").update({ is_active: false }).eq("passport_id", passportId).eq("teacher_id", schoolTeacherId);
  await admin.from("institution_staff").update({ deactivated_at: new Date().toISOString() }).eq("id", teacherStaff.id);

  const { data: candidatesAfterRevoke } = await clinicianA.client.rpc("get_assessment_respondent_candidates", { p_assessment_id: assessmentId });
  ok(
    "the teacher no longer appears as a CANDIDATE once their access is revoked -- candidate resolution is live/current",
    !(candidatesAfterRevoke ?? []).some((c) => c.recipient_id === schoolTeacherId),
    candidatesAfterRevoke
  );

  const { data: stillToComplete, error: stillToCompleteErr } = await schoolTeacher.client.rpc("get_assessment_to_complete", { p_assessment_id: assessmentId });
  ok(
    "yet the ALREADY-ASSIGNED teacher can STILL reach it via get_assessment_to_complete() -- being named respondent is sufficient, permanently, per 0040's own judgment",
    !stillToCompleteErr && (stillToComplete ?? []).length === 1,
    { error: stillToCompleteErr?.message, rows: stillToComplete?.length }
  );

  const { error: stillSubmitErr } = await schoolTeacher.client.rpc("submit_assessment_response", {
    p_assessment_id: assessmentId,
    p_responses: { "1": "Always", "2": "Seldom" },
  });
  ok("...and can still submit, despite having zero current access to the child", !stillSubmitErr, stillSubmitErr?.message);

  // =====================================================================
  // PART F -- unassign: clears assignment, preserves partial answers.
  // =====================================================================
  console.log("\nPART F -- unassign.");

  const { error: unassignErr } = await clinicianA.client.rpc("unassign_assessment_respondent", { p_assessment_id: assessmentId });
  ok("unassign succeeds", !unassignErr, unassignErr?.message);

  const { data: afterUnassign } = await admin
    .from("assessments")
    .select("assigned_respondent_id, assigned_at, last_reminded_at, responses")
    .eq("id", assessmentId)
    .single();
  ok("assigned_respondent_id/assigned_at/last_reminded_at all cleared", !afterUnassign.assigned_respondent_id && !afterUnassign.assigned_at && !afterUnassign.last_reminded_at, afterUnassign);
  ok(
    "the teacher's own partial responses are LEFT AS THEY ARE, not wiped -- the clinician may pick up where they left off",
    JSON.stringify(afterUnassign.responses) === JSON.stringify({ "1": "Always", "2": "Seldom" }),
    afterUnassign.responses
  );

  const { data: afterUnassignRead } = await schoolTeacher.client.rpc("get_assessment_to_complete", { p_assessment_id: assessmentId });
  ok("once unassigned, the former respondent can no longer reach it at all", (afterUnassignRead ?? []).length === 0, afterUnassignRead);

  // =====================================================================
  // PART G -- remind.
  // =====================================================================
  console.log("\nPART G -- remind.");

  const { error: remindNoAssignmentErr } = await clinicianA.client.rpc("remind_assessment_respondent", { p_assessment_id: assessmentId });
  ok(
    "reminding an assessment with no active assignment is refused with a real message",
    !!remindNoAssignmentErr && /no active assignment/i.test(remindNoAssignmentErr.message),
    remindNoAssignmentErr?.message
  );

  await clinicianA.client.rpc("assign_assessment_respondent", { p_assessment_id: assessmentId, p_respondent_id: parentId });

  const { error: remindErr } = await clinicianA.client.rpc("remind_assessment_respondent", { p_assessment_id: assessmentId });
  ok("reminding a genuinely assigned respondent succeeds", !remindErr, remindErr?.message);

  const { data: afterRemind } = await admin.from("assessments").select("last_reminded_at").eq("id", assessmentId).single();
  ok("last_reminded_at is now set", !!afterRemind.last_reminded_at, afterRemind);

  // =====================================================================
  // PART H -- auto-cancel on completion: an explicit, readable
  // refusal, never a silent no-op. Matches 0199's own reasoning.
  // =====================================================================
  console.log("\nPART H -- auto-cancel on completion.");

  await clinicianA.client.from("assessments").update({ completed_at: new Date().toISOString() }).eq("id", assessmentId);

  const { error: submitAfterCompleteErr } = await parent.client.rpc("submit_assessment_response", {
    p_assessment_id: assessmentId,
    p_responses: { "1": "Never" },
  });
  ok(
    "submitting to an already-completed assessment is refused with an explicit, readable message -- not a silent RLS no-op",
    !!submitAfterCompleteErr && /already been completed/i.test(submitAfterCompleteErr.message),
    submitAfterCompleteErr?.message
  );

  const { data: toCompleteAfterComplete } = await parent.client.rpc("get_assessment_to_complete", { p_assessment_id: assessmentId });
  ok("get_assessment_to_complete() returns nothing once completed", (toCompleteAfterComplete ?? []).length === 0, toCompleteAfterComplete);

  const { data: myListAfterComplete } = await parent.client.rpc("get_my_assessments_to_complete");
  ok(
    "get_my_assessments_to_complete() -- the dashboard prompt card's own query -- no longer lists it",
    !(myListAfterComplete ?? []).some((r) => r.id === assessmentId),
    myListAfterComplete
  );

  const { error: assignAfterCompleteErr } = await clinicianA.client.rpc("assign_assessment_respondent", {
    p_assessment_id: assessmentId,
    p_respondent_id: schoolTeacherId,
  });
  ok(
    "the clinician cannot reassign an already-completed assessment either",
    !!assignAfterCompleteErr && /already been completed/i.test(assignAfterCompleteErr.message),
    assignAfterCompleteErr?.message
  );

  console.log(`\n${pass} passed, ${fail} failed.`);

  console.log("\nFixture IDs (for teardown / manual inspection):");
  console.log(JSON.stringify({ schoolId: school.id, clinicId: clinic.id, passportId, assessmentId, externalRecordId }, null, 2));

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
