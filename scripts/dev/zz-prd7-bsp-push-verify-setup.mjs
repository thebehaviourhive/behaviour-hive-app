/* PRD 7 -- migration 0240 verification: pushing a signed BSP's school/
   shared strategies into the classroom, and the revision case. Real
   signed-in sessions throughout; service-role only for fixture setup
   and confirming persisted state.

   Clinic (ZZPRD7BSPCLINIC): director, clinicianA (the plan's own
   author). School (ZZPRD7BSPSCHOOL): principal, class teacher. One
   passport, school-created then clinic-linked (mirroring PRD 5 Stage
   3's own established cross-org precedent), one parent guardian.

   Run: node --env-file=.env.local scripts/dev/zz-prd7-bsp-push-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd7-bsp-push-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd7BspPushVerify-2026!";
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

function idsIn(rows, ids) {
  const set = new Set((rows ?? []).map((r) => r.source_document_id ?? r.id));
  return ids.every((id) => set.has(id));
}

async function main() {
  // =====================================================================
  // Institutions, users, the passport.
  // =====================================================================
  const { data: school } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 BSP School", institution_code: "ZZPRD7BSPSCHOOL", status: "verified", type: "school" })
    .select("id")
    .single();
  const { data: clinic } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD7 BSP Clinic", institution_code: "ZZPRD7BSPCLINIC", status: "verified", type: "clinic" })
    .select("id")
    .single();
  console.log(`School: ${school.id} | Clinic: ${clinic.id}`);

  const schoolPrincipalId = await createUser("zzprd7bsp.schoolprincipal@thebehaviourhive.com");
  const schoolTeacherId = await createUser("zzprd7bsp.schoolteacher@thebehaviourhive.com");
  const clinicDirectorId = await createUser("zzprd7bsp.clinicdirector@thebehaviourhive.com");
  const clinicianAId = await createUser("zzprd7bsp.cliniciana@thebehaviourhive.com");
  const parentId = await createUser("zzprd7bsp.parent@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(schoolPrincipalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(schoolTeacherId, { app_metadata: { role: "class_teacher" } });
  await admin.auth.admin.updateUserById(clinicDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicianAId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(parentId, { app_metadata: { role: "parent" } });

  const now = new Date().toISOString();
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolPrincipalId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolTeacherId, role: "class_teacher", approved_at: now, approval_source: "bootstrap" });

  const schoolPrincipal = await sessionFor("zzprd7bsp.schoolprincipal@thebehaviourhive.com");
  const schoolTeacher = await sessionFor("zzprd7bsp.schoolteacher@thebehaviourhive.com");
  const clinicDirector = await sessionFor("zzprd7bsp.clinicdirector@thebehaviourhive.com");
  const clinicianA = await sessionFor("zzprd7bsp.cliniciana@thebehaviourhive.com");
  const parent = await sessionFor("zzprd7bsp.parent@thebehaviourhive.com");

  await clinicianA.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianAId, role: "clinician" });
  const { data: staffA } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", clinicianAId).single();
  await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: staffA.id });

  const { data: passportId, error: passportErr } = await schoolPrincipal.client.rpc("create_school_passport", {
    p_institution_id: school.id,
    p_child_name: "ZZ PRD7 BSP Push Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);

  await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId });
  await admin.from("passport_access").insert({
    passport_id: passportId, teacher_id: schoolTeacherId, institution_id: school.id,
    is_active: true, actor_role: "class_teacher", granted_by: schoolTeacherId,
  });
  await admin.from("passport_institution_links").insert({ passport_id: passportId, institution_id: clinic.id, approved_by_parent: true, parent_approved_at: null });
  await admin.from("episodes_of_care").insert({ passport_id: passportId, institution_id: clinic.id, started_by: clinicDirectorId });

  const { error: grantErr } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
    p_institution_id: clinic.id, p_passport_ids: [passportId], p_roster_user_id: clinicianAId,
  });
  if (grantErr) throw new Error(`bulk_grant_clinician_access: ${grantErr.message}`);

  console.log(`Passport: ${passportId}`);

  // =====================================================================
  // The BSP, three strategies (home / school-with-caveat / shared-with-
  // caveat), first sign.
  // =====================================================================
  const { data: bspId, error: bspErr } = await clinicianA.client.rpc("create_bsp", { p_passport_id: passportId, p_source_fba_id: null });
  if (bspErr) throw new Error(`create_bsp: ${bspErr.message}`);
  console.log(`BSP v1: ${bspId}`);

  const HOME_TITLE = "Home-Only Wind-Down Routine";
  const SCHOOL_TITLE = "Visual Schedule";
  const SHARED_TITLE = "First-Then Board";
  const SCHOOL_CAVEAT = "In the resource room, skip the transition bell -- it's not present there.";
  const SHARED_CAVEAT = "Same core steps, but skip step 3 at home.";
  const WHY_TEXT = "Rian benefits from predictability and clear visual information about what is happening now, what is finished, and what is coming next.";

  const { error: strategiesErr } = await clinicianA.client.from("bsp_strategies").insert([
    { bsp_id: bspId, title: HOME_TITLE, why: "Settling before bed reduces morning dysregulation.", how: "Follow the same five-step routine every night.", placement: "home" },
    { bsp_id: bspId, title: SCHOOL_TITLE, why: WHY_TEXT, how: "Present the visual schedule at the start of each transition.", placement: "school", caveat: SCHOOL_CAVEAT },
    { bsp_id: bspId, title: SHARED_TITLE, why: WHY_TEXT, how: "Show the First-Then board before any non-preferred task.", scripted_language: "\"First [task], then [reward].\"", placement: "shared", caveat: SHARED_CAVEAT },
  ]);
  if (strategiesErr) throw new Error(`bsp_strategies insert: ${strategiesErr.message}`);

  // =====================================================================
  // PART A -- pre-sign: nothing pushed yet.
  // =====================================================================
  console.log("\nPART A -- pre-sign state.");

  const { data: preSign } = await admin.from("passport_clinical_content").select("id").eq("source_document_type", "bsp").eq("source_document_id", bspId);
  ok("before signing, zero passport_clinical_content rows exist for this plan", (preSign ?? []).length === 0, preSign);

  // =====================================================================
  // PART B -- the sign, and what it pushed.
  // =====================================================================
  console.log("\nPART B -- sign, and the push.");

  const { error: signErr } = await clinicianA.client.rpc("sign_bsp", { p_bsp_id: bspId });
  ok("signing succeeds", !signErr, signErr?.message);

  const { data: pushed } = await admin
    .from("passport_clinical_content")
    .select("id, item_type, content, author_role, author_id, source_document_type, source_document_id")
    .eq("source_document_type", "bsp")
    .eq("source_document_id", bspId);

  ok("exactly two rows pushed (school + shared) -- home never crosses", (pushed ?? []).length === 2, pushed);
  ok("home-placement strategy is NOT among them", !(pushed ?? []).some((r) => r.content?.title === HOME_TITLE), pushed);

  const schoolRow = (pushed ?? []).find((r) => r.content?.title === SCHOOL_TITLE);
  const sharedRow = (pushed ?? []).find((r) => r.content?.title === SHARED_TITLE);
  ok("school strategy pushed with item_type = strategy_school", schoolRow?.item_type === "strategy_school", schoolRow);
  ok("shared strategy pushed with item_type = strategy_shared", sharedRow?.item_type === "strategy_shared", sharedRow);
  ok("both rows authored by the clinician, author_role = 'clinician'", schoolRow?.author_role === "clinician" && schoolRow?.author_id === clinicianAId);

  ok(
    "school strategy's description leads with WHY, then HOW, then the caveat -- in that order",
    schoolRow?.content?.description === `${WHY_TEXT}\nPresent the visual schedule at the start of each transition.\n${SCHOOL_CAVEAT}`,
    schoolRow?.content?.description
  );
  ok(
    "the caveat travels on the SCHOOL-placement strategy too, not just shared -- Daniel's own correction",
    schoolRow?.content?.description?.includes(SCHOOL_CAVEAT)
  );
  ok(
    "shared strategy's description carries why, how, scripted_language, AND the caveat, in order",
    sharedRow?.content?.description ===
      `${WHY_TEXT}\nShow the First-Then board before any non-preferred task.\n"First [task], then [reward]."\n${SHARED_CAVEAT}`,
    sharedRow?.content?.description
  );

  const { data: activityRows } = await admin
    .from("activity_log")
    .select("event_type, event_description")
    .eq("passport_id", passportId)
    .eq("event_type", "clinical_content_added");
  ok("a clinical_content_added activity_log entry was written on sign", (activityRows ?? []).length >= 1, activityRows);

  // =====================================================================
  // PART C -- the acting audiences read it: teacher, principal, parent.
  // =====================================================================
  console.log("\nPART C -- teacher / principal / parent all read the current plan.");

  const { data: teacherView } = await schoolTeacher.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok(
    "the class teacher sees both pushed strategies (this is the trap pre-emption proving out: the helper works even though the teacher has zero SELECT on bsp itself)",
    idsIn(teacherView, [schoolRow.id, sharedRow.id]),
    teacherView
  );
  ok("the class teacher does NOT see the home strategy (never pushed, structurally)", !(teacherView ?? []).some((r) => r.content?.title === HOME_TITLE));

  const { data: principalView } = await schoolPrincipal.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok("the school principal also sees both current strategies", idsIn(principalView, [schoolRow.id, sharedRow.id]), principalView);

  const { data: parentView } = await parent.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok("the parent also sees both current strategies", idsIn(parentView, [schoolRow.id, sharedRow.id]), parentView);

  // Confirm the class teacher genuinely has no SELECT on bsp itself --
  // the exact condition that would have made a naive inline subquery
  // silently always-false.
  const { data: teacherBspRead } = await schoolTeacher.client.from("bsp").select("id").eq("id", bspId);
  ok(
    "the teacher has ZERO raw SELECT on bsp itself -- confirms the helper's SECURITY DEFINER is load-bearing, not incidental",
    (teacherBspRead ?? []).length === 0,
    teacherBspRead
  );

  // =====================================================================
  // PART D -- the EOD wizard's own write path: a teacher rates the
  // shared strategy.
  // =====================================================================
  console.log("\nPART D -- the EOD wizard's own write path.");

  const { error: rateErr } = await schoolTeacher.client.from("strategy_feedback").insert({
    passport_id: passportId, strategy_content_id: sharedRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: schoolTeacherId,
  });
  ok("the class teacher can rate the pushed shared strategy, exactly like an FBA-sourced one", !rateErr, rateErr?.message);

  // =====================================================================
  // PART E -- the clinician's own insights, both RPCs.
  // =====================================================================
  console.log("\nPART E -- the clinician's insights aggregate includes it.");

  const { data: perChild } = await clinicianA.client.rpc("get_strategy_effectiveness", { p_passport_id: passportId });
  const sharedEff = (perChild ?? []).find((r) => r.strategy_content_id === sharedRow.id);
  ok("the per-child effectiveness RPC includes the BSP-sourced strategy, school_helped = 1", sharedEff?.school_helped === 1, sharedEff);

  const { data: caseload } = await clinicianA.client.rpc("get_clinician_strategy_type_insights", { p_setting: null, p_period_days: null });
  const untagged = (caseload ?? []).find((r) => r.strategy_type_label === "Untagged");
  ok(
    "the caseload-wide rollup includes it too, bucketed under 'Untagged' -- bsp_strategies has no strategy_type_id concept, recorded as a known resolution loss, not fixed here",
    (untagged?.rating_count ?? 0) >= 1,
    untagged
  );

  // =====================================================================
  // PART F -- the revision. Never delete; gate on status = 'active'.
  // =====================================================================
  console.log("\nPART F -- the revision case.");

  const { data: revisionId, error: revErr } = await clinicianA.client.rpc("create_bsp_revision", { p_bsp_id: bspId });
  ok("creating a revision succeeds", !revErr, revErr?.message);

  const { data: copiedStrategies } = await admin.from("bsp_strategies").select("title, placement").eq("bsp_id", revisionId);
  ok("the revision copied all three strategies verbatim, including the home one", (copiedStrategies ?? []).length === 3, copiedStrategies);

  const { error: signRevErr } = await clinicianA.client.rpc("sign_bsp", { p_bsp_id: revisionId });
  ok("signing the revision succeeds", !signRevErr, signRevErr?.message);

  const { data: statuses } = await admin.from("bsp").select("id, status").in("id", [bspId, revisionId]);
  const oldStatus = statuses.find((s) => s.id === bspId)?.status;
  const newStatus = statuses.find((s) => s.id === revisionId)?.status;
  ok("the original plan is now superseded", oldStatus === "superseded", oldStatus);
  ok("the revision is now active", newStatus === "active", newStatus);

  const { data: oldRowsStillExist } = await admin
    .from("passport_clinical_content")
    .select("id")
    .eq("source_document_type", "bsp")
    .eq("source_document_id", bspId);
  ok(
    "the ORIGINAL plan's own pushed rows still physically exist -- never deleted",
    (oldRowsStillExist ?? []).length === 2,
    oldRowsStillExist
  );

  const { data: newRows } = await admin
    .from("passport_clinical_content")
    .select("id, item_type, content")
    .eq("source_document_type", "bsp")
    .eq("source_document_id", revisionId);
  ok("the revision pushed its own two rows (school + shared) too", (newRows ?? []).length === 2, newRows);
  const newSharedRow = (newRows ?? []).find((r) => r.content?.title === SHARED_TITLE);

  const { data: teacherViewAfterRevision } = await schoolTeacher.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok(
    "the teacher no longer sees the OLD plan's rows -- gone from their read, though the rows themselves still exist",
    !idsIn(teacherViewAfterRevision, [schoolRow.id, sharedRow.id]) &&
      !(teacherViewAfterRevision ?? []).some((r) => r.id === schoolRow.id || r.id === sharedRow.id),
    teacherViewAfterRevision
  );
  ok("the teacher now sees the NEW plan's rows instead", idsIn(teacherViewAfterRevision, [newRows[0].id, newRows[1].id]), teacherViewAfterRevision);

  const { data: parentViewAfterRevision } = await parent.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok(
    "the parent likewise no longer sees the old plan's rows",
    !(parentViewAfterRevision ?? []).some((r) => r.id === schoolRow.id || r.id === sharedRow.id),
    parentViewAfterRevision
  );

  const { data: principalViewAfterRevision } = await schoolPrincipal.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok(
    "the principal likewise no longer sees the old plan's rows",
    !(principalViewAfterRevision ?? []).some((r) => r.id === schoolRow.id || r.id === sharedRow.id),
    principalViewAfterRevision
  );

  const { data: clinicianViewAfterRevision } = await clinicianA.client.rpc("get_passport_clinical_content", { p_passport_id: passportId });
  ok(
    "the CLINICIAN'S OWN read is unconditional -- sees BOTH the superseded plan's rows AND the new plan's rows, full history",
    idsIn(clinicianViewAfterRevision, [schoolRow.id, sharedRow.id, newRows[0].id, newRows[1].id]),
    clinicianViewAfterRevision
  );

  // The rating given against the OLD row before the revision --
  // confirmed NOT cascade-deleted.
  const { data: oldRatingStillThere } = await admin.from("strategy_feedback").select("id, rating").eq("strategy_content_id", sharedRow.id);
  ok(
    "the teacher's earlier rating against the OLD (now superseded) row was NOT cascade-deleted -- real history survives",
    (oldRatingStillThere ?? []).length === 1 && oldRatingStillThere[0].rating === "helped",
    oldRatingStillThere
  );

  const { data: perChildAfterRevision } = await clinicianA.client.rpc("get_strategy_effectiveness", { p_passport_id: passportId });
  const oldSharedEffAfter = (perChildAfterRevision ?? []).find((r) => r.strategy_content_id === sharedRow.id);
  ok(
    "the OLD row's own rating still counts in the per-child effectiveness view after the revision -- the evidence that justified the change is not erased",
    oldSharedEffAfter?.school_helped === 1,
    oldSharedEffAfter
  );

  const { data: caseloadAfterRevision } = await clinicianA.client.rpc("get_clinician_strategy_type_insights", { p_setting: null, p_period_days: null });
  const untaggedAfter = (caseloadAfterRevision ?? []).find((r) => r.strategy_type_label === "Untagged");
  ok(
    "the caseload-wide rollup still includes that same rating after the revision",
    (untaggedAfter?.rating_count ?? 0) >= 1,
    untaggedAfter
  );

  // =====================================================================
  // PART G -- the hardened write path: a teacher cannot rate a
  // superseded row directly, even bypassing the UI.
  // =====================================================================
  console.log("\nPART G -- the hardened strategy_feedback INSERT policy.");

  const { data: rawInsertAttempt, error: rawInsertErr } = await schoolTeacher.client
    .from("strategy_feedback")
    .insert({ passport_id: passportId, strategy_content_id: schoolRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: schoolTeacherId })
    .select("id");
  ok(
    "a raw attempt to rate the OLD (superseded) school strategy is refused server-side, not just avoided by the UI",
    !!rawInsertErr || (rawInsertAttempt ?? []).length === 0,
    { error: rawInsertErr?.message, rows: rawInsertAttempt?.length }
  );

  // And the regression control: rating the NEW plan's own current
  // school strategy still works.
  const newSchoolRow = (newRows ?? []).find((r) => r.content?.title === SCHOOL_TITLE);
  const { error: newRateErr } = await schoolTeacher.client.from("strategy_feedback").insert({
    passport_id: passportId, strategy_content_id: newSchoolRow.id, context: "eod", rating: "helped", rater_role: "teacher", rater_id: schoolTeacherId,
  });
  ok("...while rating the NEW plan's own current strategy still works, as a regression control", !newRateErr, newRateErr?.message);

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log("\nFixture IDs (for teardown / manual inspection):");
  console.log(JSON.stringify({ schoolId: school.id, clinicId: clinic.id, passportId, bspId, revisionId }, null, 2));

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
