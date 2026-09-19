/* PRD 8 Stage 1 -- migration 0245 verification: cross_organisation_grants
   (clinic -> school, proposal + parent confirmation) and incident
   withholding (decided at countersign). Real signed-in sessions
   throughout; service-role only for fixture setup and confirming
   persisted state.

   Institutions: ZZPRD8SCHOOL (receiving), ZZPRD8CLINIC (granting, and
   the passport's own engaged clinic), ZZPRD8CLINICB (an UNRELATED
   second clinic, for the negative controls), ZZPRD8SCHOOLB (an
   UNRELATED second school, ditto). One passport, school-created,
   clinic-linked, one parent guardian.

   Run: node --env-file=.env.local scripts/dev/zz-prd8-stage1-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd8-stage1-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd8Stage1Verify-2026!";
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
  // Institutions, users, the passport.
  // =====================================================================
  const { data: school } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD8 Stage1 School", institution_code: "ZZPRD8SCHOOL", status: "verified", type: "school" })
    .select("id")
    .single();
  const { data: clinic } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD8 Stage1 Clinic", institution_code: "ZZPRD8CLINIC", status: "verified", type: "clinic" })
    .select("id")
    .single();
  const { data: clinicB } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD8 Stage1 Clinic B (unrelated)", institution_code: "ZZPRD8CLINICB", status: "verified", type: "clinic" })
    .select("id")
    .single();
  const { data: schoolB } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD8 Stage1 School B (unrelated)", institution_code: "ZZPRD8SCHOOLB", status: "verified", type: "school" })
    .select("id")
    .single();
  console.log(`School: ${school.id} | Clinic: ${clinic.id} | ClinicB: ${clinicB.id} | SchoolB: ${schoolB.id}`);

  const schoolPrincipalId = await createUser("zzprd8stage1.schoolprincipal@thebehaviourhive.com");
  const schoolTeacherId = await createUser("zzprd8stage1.schoolteacher@thebehaviourhive.com");
  const schoolBTeacherId = await createUser("zzprd8stage1.schoolbteacher@thebehaviourhive.com");
  const clinicDirectorId = await createUser("zzprd8stage1.clinicdirector@thebehaviourhive.com");
  const clinicianAId = await createUser("zzprd8stage1.cliniciana@thebehaviourhive.com");
  const clinicBDirectorId = await createUser("zzprd8stage1.clinicbdirector@thebehaviourhive.com");
  const parentId = await createUser("zzprd8stage1.parent@thebehaviourhive.com");
  const outsiderId = await createUser("zzprd8stage1.outsider@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(schoolPrincipalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(schoolTeacherId, { app_metadata: { role: "class_teacher" } });
  await admin.auth.admin.updateUserById(schoolBTeacherId, { app_metadata: { role: "class_teacher" } });
  await admin.auth.admin.updateUserById(clinicDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicianAId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicBDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(parentId, { app_metadata: { role: "parent" } });
  await admin.auth.admin.updateUserById(outsiderId, { app_metadata: { role: "parent" } });

  const now = new Date().toISOString();
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolPrincipalId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolTeacherId, role: "class_teacher", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: schoolB.id, user_id: schoolBTeacherId, role: "class_teacher", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinicB.id, user_id: clinicBDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });

  const schoolPrincipal = await sessionFor("zzprd8stage1.schoolprincipal@thebehaviourhive.com");
  const schoolTeacher = await sessionFor("zzprd8stage1.schoolteacher@thebehaviourhive.com");
  const schoolBTeacher = await sessionFor("zzprd8stage1.schoolbteacher@thebehaviourhive.com");
  const clinicDirector = await sessionFor("zzprd8stage1.clinicdirector@thebehaviourhive.com");
  const clinicianA = await sessionFor("zzprd8stage1.cliniciana@thebehaviourhive.com");
  const clinicBDirector = await sessionFor("zzprd8stage1.clinicbdirector@thebehaviourhive.com");
  const parent = await sessionFor("zzprd8stage1.parent@thebehaviourhive.com");
  const outsider = await sessionFor("zzprd8stage1.outsider@thebehaviourhive.com");

  await clinicianA.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicianAId, role: "clinician" });
  {
    const { data: staff } = await admin.from("institution_staff").select("id").eq("institution_id", clinic.id).eq("user_id", clinicianAId).single();
    await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: staff.id });
  }

  const { data: passportId, error: passportErr } = await schoolPrincipal.client.rpc("create_school_passport", {
    p_institution_id: school.id,
    p_child_name: "ZZ PRD8 Stage1 Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);

  await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId });
  await admin.from("passport_access").insert({
    passport_id: passportId, teacher_id: schoolTeacherId, institution_id: school.id,
    is_active: true, actor_role: "class_teacher", granted_by: schoolTeacherId,
  });
  await admin.from("passport_institution_links").insert({ passport_id: passportId, institution_id: clinic.id, approved_by_parent: true, parent_approved_at: null });
  await admin.from("episodes_of_care").insert({ passport_id: passportId, institution_id: clinic.id, started_by: clinicDirectorId });

  {
    const { error: grantErr } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
      p_institution_id: clinic.id, p_passport_ids: [passportId], p_roster_user_id: clinicianAId,
    });
    if (grantErr) throw new Error(`bulk_grant_clinician_access: ${grantErr.message}`);
  }

  console.log(`Passport: ${passportId}`);

  // =====================================================================
  // PART A -- an "early" FBA, created before any grant exists, to prove
  // forward-only later. Set up privileged (service role) -- this is pure
  // fixture data, not the path being tested.
  // =====================================================================
  console.log("\nPART A -- baseline: nothing crosses before a grant.");

  const { data: fbaEarly } = await admin
    .from("fba_reports")
    .insert({ passport_id: passportId, clinician_id: clinicianAId, status: "completed", completed_at: now, content_data: { summary: "Early FBA, pre-grant." } })
    .select("id, created_at")
    .single();

  const { data: bspEarly } = await admin
    .from("bsp")
    .insert({ passport_id: passportId, institution_id: clinic.id, clinician_id: clinicianAId, status: "active", signed_at: now, signed_by: clinicianAId })
    .select("id, created_at")
    .single();
  await admin.from("bsp_strategies").insert({ bsp_id: bspEarly.id, placement: "school", why: "Predictability.", how: "Visual schedule." });

  const { data: teacherEarlyFba } = await schoolTeacher.client.from("fba_reports").select("id").eq("id", fbaEarly.id);
  ok("before any grant: the school's own teacher cannot read the completed FBA", (teacherEarlyFba ?? []).length === 0, teacherEarlyFba);
  const { data: teacherEarlyBsp } = await schoolTeacher.client.from("bsp").select("id").eq("id", bspEarly.id);
  ok("...nor the signed BSP", (teacherEarlyBsp ?? []).length === 0, teacherEarlyBsp);

  // =====================================================================
  // PART B -- direction validation: only a clinic may grant, only to a
  // school, and only a director of a clinic actually linked to this
  // child may propose.
  // =====================================================================
  console.log("\nPART B -- direction and authorization checks.");

  // Direct trigger test: attempt the raw insert with the wrong direction.
  const { error: wrongDirectionErr } = await admin.from("cross_organisation_grants").insert({
    passport_id: passportId, granting_institution_id: school.id, receiving_institution_id: clinic.id,
    scope_items: ["fba_report"], proposed_by: schoolPrincipalId,
  });
  ok("a grant FROM a school is refused by the direction trigger", !!wrongDirectionErr, wrongDirectionErr?.message);

  const { error: wrongReceiverErr } = await admin.from("cross_organisation_grants").insert({
    passport_id: passportId, granting_institution_id: clinic.id, receiving_institution_id: clinicB.id,
    scope_items: ["fba_report"], proposed_by: clinicDirectorId,
  });
  ok("a grant proposed TO a clinic is refused by the direction trigger", !!wrongReceiverErr, wrongReceiverErr?.message);

  const { error: nonDirectorProposeErr } = await clinicianA.client.rpc("propose_cross_organisation_grant", {
    p_passport_id: passportId, p_receiving_institution_id: school.id, p_scope_items: ["fba_report"],
  });
  ok("a non-director clinician cannot propose a grant", !!nonDirectorProposeErr, nonDirectorProposeErr?.message);

  const { error: unlinkedDirectorErr } = await clinicBDirector.client.rpc("propose_cross_organisation_grant", {
    p_passport_id: passportId, p_receiving_institution_id: school.id, p_scope_items: ["fba_report"],
  });
  ok("a director of an UNLINKED clinic cannot propose a grant for this child", !!unlinkedDirectorErr, unlinkedDirectorErr?.message);

  // =====================================================================
  // PART C -- the real proposal, scoped to fba_report ONLY (not bsp) --
  // and the parent's own confirmation.
  // =====================================================================
  console.log("\nPART C -- propose, then confirm.");

  const { data: grantId, error: proposeErr } = await clinicDirector.client.rpc("propose_cross_organisation_grant", {
    p_passport_id: passportId, p_receiving_institution_id: school.id, p_scope_items: ["fba_report"],
  });
  ok("the clinic's own director proposes a grant, scoped to fba_report only", !proposeErr && !!grantId, proposeErr?.message);

  const { error: nonGuardianConfirmErr } = await outsider.client.rpc("confirm_cross_organisation_grant", { p_grant_id: grantId });
  ok("a non-guardian cannot confirm the grant", !!nonGuardianConfirmErr, nonGuardianConfirmErr?.message);

  const { data: teacherStillCantRead } = await schoolTeacher.client.from("fba_reports").select("id").eq("id", fbaEarly.id);
  ok("still proposed (not yet confirmed): the teacher still cannot read the FBA", (teacherStillCantRead ?? []).length === 0, teacherStillCantRead);

  const { error: confirmErr } = await parent.client.rpc("confirm_cross_organisation_grant", { p_grant_id: grantId });
  ok("the child's own guardian confirms the grant", !confirmErr, confirmErr?.message);

  const { data: grantRow } = await admin.from("cross_organisation_grants").select("status, confirmed_at").eq("id", grantId).single();
  ok("confirmed: status is 'active' with a real confirmed_at", grantRow.status === "active" && !!grantRow.confirmed_at, grantRow);

  // =====================================================================
  // PART D -- forward-only, proven with BOTH a negative and a positive
  // case on the SAME grant, plus scope enforcement (fba_report only --
  // bsp must stay invisible even for an artefact created after
  // confirmed_at).
  // =====================================================================
  console.log("\nPART D -- forward-only and scope, proven together.");

  const { data: teacherEarlyFbaAfterConfirm } = await schoolTeacher.client.from("fba_reports").select("id").eq("id", fbaEarly.id);
  ok("forward-only (negative): the EARLY FBA, created before confirmed_at, is still invisible even now the grant is active", (teacherEarlyFbaAfterConfirm ?? []).length === 0, teacherEarlyFbaAfterConfirm);

  const { data: fbaLate } = await admin
    .from("fba_reports")
    .insert({ passport_id: passportId, clinician_id: clinicianAId, status: "completed", completed_at: new Date().toISOString(), content_data: { summary: "Late FBA, post-grant." } })
    .select("id")
    .single();

  const { data: teacherLateFba } = await schoolTeacher.client.from("fba_reports").select("id, content_data").eq("id", fbaLate.id);
  ok("forward-only (positive): a FBA created AFTER confirmed_at IS visible to the school", (teacherLateFba ?? []).length === 1, teacherLateFba);

  const { data: principalLateFba } = await schoolPrincipal.client.from("fba_reports").select("id").eq("id", fbaLate.id);
  ok("...visible to the principal too", (principalLateFba ?? []).length === 1, principalLateFba);

  // bspEarly is already status='active' -- supersede it so a fresh,
  // ACTIVE BSP created after confirmed_at exists to test scope against.
  // scope_items on this grant is ['fba_report'] only, so even though the
  // new BSP would pass the forward-only check, it must stay invisible.
  await admin.from("bsp").update({ status: "superseded" }).eq("id", bspEarly.id);
  const { data: bspLate } = await admin
    .from("bsp")
    .insert({ passport_id: passportId, institution_id: clinic.id, clinician_id: clinicianAId, status: "active", signed_at: new Date().toISOString(), signed_by: clinicianAId, supersedes_id: bspEarly.id })
    .select("id")
    .single();
  const { data: teacherLateBsp } = await schoolTeacher.client.from("bsp").select("id").eq("id", bspLate.id);
  ok("scope enforcement: a BSP created AFTER confirmed_at is STILL invisible -- this grant's scope is fba_report only", (teacherLateBsp ?? []).length === 0, teacherLateBsp);

  const { data: schoolBRead } = await schoolBTeacher.client.from("fba_reports").select("id").eq("id", fbaLate.id);
  ok("an UNRELATED second school (not the receiving institution) still cannot read the granted FBA", (schoolBRead ?? []).length === 0, schoolBRead);

  // =====================================================================
  // PART E -- revoke, then a second proposal that the parent declines.
  // =====================================================================
  console.log("\nPART E -- revoke, and a declined proposal.");

  const { error: nonDirectorRevokeErr } = await clinicianA.client.rpc("revoke_cross_organisation_grant", { p_grant_id: grantId, p_reason: "test" });
  ok("a non-director cannot revoke", !!nonDirectorRevokeErr, nonDirectorRevokeErr?.message);

  const { error: emptyReasonRevokeErr } = await clinicDirector.client.rpc("revoke_cross_organisation_grant", { p_grant_id: grantId, p_reason: "" });
  ok("revoke without a reason is refused", !!emptyReasonRevokeErr, emptyReasonRevokeErr?.message);

  const { error: revokeErr } = await clinicDirector.client.rpc("revoke_cross_organisation_grant", { p_grant_id: grantId, p_reason: "Family requested the clinic stop sharing with the school." });
  ok("the granting director revokes the grant, with a reason", !revokeErr, revokeErr?.message);

  const { data: teacherAfterRevoke } = await schoolTeacher.client.from("fba_reports").select("id").eq("id", fbaLate.id);
  ok("after revoke: the previously-visible FBA is invisible again", (teacherAfterRevoke ?? []).length === 0, teacherAfterRevoke);

  const { data: grantId2, error: propose2Err } = await clinicDirector.client.rpc("propose_cross_organisation_grant", {
    p_passport_id: passportId, p_receiving_institution_id: school.id, p_scope_items: ["fba_report", "bsp"],
  });
  ok("a fresh proposal can be raised for the same triple once the prior grant is revoked (not still blocked by the unique-active index)", !propose2Err && !!grantId2, propose2Err?.message);

  const { error: declineErr } = await parent.client.rpc("decline_cross_organisation_grant", { p_grant_id: grantId2, p_reason: "Not ready yet." });
  ok("the guardian declines the second proposal", !declineErr, declineErr?.message);

  const { data: teacherAfterDecline } = await schoolTeacher.client.from("fba_reports").select("id").eq("id", fbaLate.id);
  ok("a declined proposal grants nothing", (teacherAfterDecline ?? []).length === 0, teacherAfterDecline);

  // =====================================================================
  // PART F -- incident withholding, decided at countersign.
  // =====================================================================
  console.log("\nPART F -- incident withholding.");

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  async function newIncident() {
    const { data: id, error } = await schoolTeacher.client.rpc("create_incident_stamp", {
      p_institution_id: school.id,
      p_occurred_at: new Date().toISOString(),
      p_location_id: loc.id,
      p_child_passport_ids: [passportId],
      p_staff: [{ user_id: schoolTeacherId }],
      p_client_opened_at: new Date(Date.now() - 20000).toISOString(),
      p_client_first_input_at: new Date(Date.now() - 15000).toISOString(),
    });
    if (error) throw new Error(`create_incident_stamp: ${error.message}`);
    return id;
  }

  const incident1 = await newIncident();
  const { data: incident1Draft } = await clinicianA.client.rpc("get_clinician_incidents", { p_passport_id: passportId });
  ok("a fresh (draft) incident is invisible to the engaged clinician", !(incident1Draft ?? []).some((i) => i.incident_id === incident1), incident1Draft);

  {
    const { error } = await schoolTeacher.client.rpc("sign_off_incident", { p_incident_id: incident1, p_proceed_without_attestations: true });
    if (error) throw new Error(`sign_off_incident (incident1): ${error.message}`);
  }
  const { data: incident1PostSignoff } = await clinicianA.client.rpc("get_clinician_incidents", { p_passport_id: passportId });
  ok(
    "THE CORE FIX: teacher-signed but not yet countersigned -- still invisible to the clinician (the old gate, status <> 'draft', would have shown it here)",
    !(incident1PostSignoff ?? []).some((i) => i.incident_id === incident1),
    incident1PostSignoff
  );

  const { data: summary1 } = await schoolPrincipal.client.rpc("get_countersign_summary", { p_incident_id: incident1 });
  ok("get_countersign_summary reports an engaged clinician exists", summary1?.has_engaged_clinic === true, summary1);

  const { error: reasonRequiredErr } = await schoolPrincipal.client.rpc("countersign_incident", {
    p_incident_id: incident1, p_withhold_from_clinic: true, p_withhold_reason: null,
  });
  ok("countersigning with withhold=true and no reason is refused", !!reasonRequiredErr, reasonRequiredErr?.message);

  const { error: countersign1Err } = await schoolPrincipal.client.rpc("countersign_incident", {
    p_incident_id: incident1, p_withhold_from_clinic: false, p_withhold_reason: null,
  });
  ok("countersign (not withheld) succeeds", !countersign1Err, countersign1Err?.message);

  const { data: incident1PostCountersign } = await clinicianA.client.rpc("get_clinician_incidents", { p_passport_id: passportId });
  ok("now visible to the clinician, immediately after countersign", (incident1PostCountersign ?? []).some((i) => i.incident_id === incident1), incident1PostCountersign);

  const { data: notice1 } = await admin.from("clinician_incident_notices").select("id").eq("incident_id", incident1);
  ok("a clinician_incident_notices row was created (not withheld)", (notice1 ?? []).length === 1, notice1);

  // Immutability: an update attempt after countersign is silently
  // reverted by derive_countersign_fields, not thrown.
  const { data: tamperAttempt } = await schoolPrincipal.client
    .from("incidents")
    .update({ withheld_from_clinic: true, withheld_from_clinic_reason: "tampered" })
    .eq("id", incident1)
    .select("id");
  const { data: incident1AfterTamper } = await admin.from("incidents").select("withheld_from_clinic, withheld_from_clinic_reason").eq("id", incident1).single();
  ok(
    "the withhold decision is locked after countersign -- a later write attempt leaves it unchanged",
    incident1AfterTamper.withheld_from_clinic === false && incident1AfterTamper.withheld_from_clinic_reason === null,
    { tamperAttempt, incident1AfterTamper }
  );

  // Second incident: countersigned WITH withholding.
  const incident2 = await newIncident();
  {
    const { error } = await schoolTeacher.client.rpc("sign_off_incident", { p_incident_id: incident2, p_proceed_without_attestations: true });
    if (error) throw new Error(`sign_off_incident (incident2): ${error.message}`);
  }
  const WITHHOLD_REASON = "Family asked the school not to share this particular incident with the clinic yet.";
  const { error: countersign2Err } = await schoolPrincipal.client.rpc("countersign_incident", {
    p_incident_id: incident2, p_withhold_from_clinic: true, p_withhold_reason: WITHHOLD_REASON,
  });
  ok("countersign WITH withholding and a real reason succeeds", !countersign2Err, countersign2Err?.message);

  const { data: incident2PostCountersign } = await clinicianA.client.rpc("get_clinician_incidents", { p_passport_id: passportId });
  ok("a withheld incident stays invisible to the clinician even after countersign", !(incident2PostCountersign ?? []).some((i) => i.incident_id === incident2), incident2PostCountersign);

  const { data: notice2 } = await admin.from("clinician_incident_notices").select("id").eq("incident_id", incident2);
  ok("no clinician_incident_notices row was created for the withheld incident", (notice2 ?? []).length === 0, notice2);

  const { data: summary2 } = await schoolPrincipal.client.rpc("get_countersign_summary", { p_incident_id: incident2 });
  ok("get_countersign_summary reports the withheld decision and its reason back to the principal", summary2?.withheld_from_clinic === true && summary2?.withheld_from_clinic_reason === WITHHOLD_REASON, summary2);

  const { data: incident2Row } = await admin.from("incidents").select("withheld_from_clinic_decided_at, withheld_from_clinic_decided_by").eq("id", incident2).single();
  ok("who/when decided is auto-stamped, not client-supplied", !!incident2Row.withheld_from_clinic_decided_at && incident2Row.withheld_from_clinic_decided_by === schoolPrincipalId, incident2Row);

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log("\nFixture IDs (for teardown / manual inspection):");
  console.log(JSON.stringify({ schoolId: school.id, clinicId: clinic.id, clinicBId: clinicB.id, schoolBId: schoolB.id, passportId, incident1, incident2 }, null, 2));

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
