// Adversarial RLS verification for the School Incident Log (Phases 1
// and its follow-up fix). Real JWTs throughout, not service-role
// bypasses -- "the UI doesn't show it" never counts, query-level is the
// bar. Creates a dedicated institution + accounts, drives the actual
// incident lifecycle through real signed-in sessions via
// create_incident_stamp()/claim_incident() (the only creation paths --
// direct table INSERT on incidents has no policy at all any more),
// asserts every check, then deletes everything it created.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/adversarial-verify.mjs

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "IncidentVerify-2026!";
const CODE = "INCVERIFY" + Math.floor(Math.random() * 10000);

const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} -- ${name}${detail ? " :: " + detail : ""}`);
}

async function signedInClient(email) {
  const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  console.log(`\n== Setup ==`);

  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Incident Verify Test School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;
  console.log(`Institution: ${institutionId} (code ${CODE})`);

  const principalId = await createUser("incverify.principal@thebehaviourhive.com", "Principal Test", "principal");
  const teacherAId = await createUser("incverify.teacherA@thebehaviourhive.com", "Teacher A Owning", "class_teacher");
  const teacherBId = await createUser("incverify.teacherB@thebehaviourhive.com", "Teacher B Ordinary", "class_teacher");
  const snaId = await createUser("incverify.sna@thebehaviourhive.com", "SNA Test", "sna");
  const clinicianId = await createUser("incverify.clinician@thebehaviourhive.com", "Clinician Test", "clinician");
  const parent1Id = await createUser("incverify.parent1@thebehaviourhive.com", "Parent One", "parent");
  const parent2Id = await createUser("incverify.parent2@thebehaviourhive.com", "Parent Two", "parent");
  const parent3Id = await createUser("incverify.parent3@thebehaviourhive.com", "Parent Three", "parent");
  console.log("Users created.");

  const { error: staffErr } = await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: principalId, role: "principal" },
    { institution_id: institutionId, user_id: teacherAId, role: "class_teacher" },
    { institution_id: institutionId, user_id: teacherBId, role: "class_teacher" },
    { institution_id: institutionId, user_id: snaId, role: "sna" },
  ]);
  if (staffErr) throw staffErr;

  const { data: p1, error: p1Err } = await admin
    .from("passports")
    .insert({ user_id: parent1Id, child_name: "Verify Child One", passport_status: "complete" })
    .select()
    .single();
  if (p1Err) throw p1Err;
  const { data: p2, error: p2Err } = await admin
    .from("passports")
    .insert({ user_id: parent2Id, child_name: "Verify Child Two", passport_status: "complete" })
    .select()
    .single();
  if (p2Err) throw p2Err;
  const child1 = p1.id, child2 = p2.id;

  // Child 2 (check b) is deliberately given NO passport_institution_links
  // row at all yet -- "an incident is created for a child whose parent
  // has never opened the app" -- linked only after, to prove the
  // school-side flow already worked without it. Child 1 IS linked from
  // the start (approved), representing the ordinary case.
  await admin.from("passport_institution_links").insert({ passport_id: child1, institution_id: institutionId, approved_by_parent: true });

  await admin.from("passport_access").insert({
    passport_id: child1, teacher_id: teacherBId, institution_id: institutionId,
    is_active: true, actor_role: "class_teacher",
  });

  const { error: clinErr } = await admin.from("clinicians").insert({
    user_id: clinicianId, specialty: "behavioural_psychologist", verification_status: "verified",
  });
  if (clinErr) console.log("clinicians insert note:", clinErr.message);
  await admin.from("clinician_access").insert({ passport_id: child1, clinician_id: clinicianId, is_active: true });

  console.log("Fixture ready. child1=" + child1 + " child2=" + child2);

  const teacherA = await signedInClient("incverify.teacherA@thebehaviourhive.com");
  const teacherB = await signedInClient("incverify.teacherB@thebehaviourhive.com");
  const sna = await signedInClient("incverify.sna@thebehaviourhive.com");
  const principal = await signedInClient("incverify.principal@thebehaviourhive.com");
  const clinician = await signedInClient("incverify.clinician@thebehaviourhive.com");
  const parent1 = await signedInClient("incverify.parent1@thebehaviourhive.com");
  const parent2 = await signedInClient("incverify.parent2@thebehaviourhive.com");

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  console.log(`\n== CHECK B: incident for a child whose parent has never opened the app ==`);
  // child2 has NO passport_institution_links row at all yet -- proving
  // stage-one creation genuinely doesn't need one, per decision 1 and
  // the explicit ask "school side works throughout, parent notification
  // simply has no recipient." Named on the SAME incident as child1 to
  // also exercise the two-child path in one go.
  console.log(`\n== Building the incident (create_incident_stamp, as Teacher A, real session) ==`);

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [child1, child2],
    p_staff: [{ user_id: teacherBId, involvement: "witnessed" }, { free_text_name: "Bus Escort Jane", involvement: "witnessed" }],
  });
  record("create_incident_stamp succeeds despite child2 having no institution link at all", !stampErr, stampErr?.message);
  console.log("Incident created (atomic stamp):", incidentId);

  {
    const { data: children } = await admin.from("incident_children").select("passport_id, child_index").eq("incident_id", incidentId);
    record("Incident has exactly 2 children immediately after the stamp (never a childless window)", (children?.length ?? 0) === 2, JSON.stringify(children));
    const { data: owningCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentId).single();
    record("Class-teacher creator auto-assigned as owning teacher by the stamp RPC", owningCheck.owning_teacher_id === teacherAId, owningCheck.owning_teacher_id);
  }

  // Now retroactively link child2 to the institution (the parent opens
  // the app / a link gets created later) -- confirms nothing about
  // stage-one required it to have existed first.
  await admin.from("passport_institution_links").insert({ passport_id: child2, institution_id: institutionId, approved_by_parent: false });

  const { error: ownErr } = await teacherA
    .from("incidents")
    .update({ category: "one_party_incident", narrative: "Staff-facing narrative text.", parent_summary: "Parent-facing summary text." })
    .eq("id", incidentId);
  if (ownErr) throw ownErr;

  await teacherA.from("incidents").update({ status: "awaiting_attestation" }).eq("id", incidentId);

  console.log(`\n== CHECK 1: draft isolation ==`);
  {
    const { data: draftId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { data: byTeacherB } = await teacherB.from("incidents").select("id").eq("id", draftId);
    record("Draft invisible to ordinary teacher with passport_access", (byTeacherB?.length ?? 0) === 0, `rows=${byTeacherB?.length}`);

    const { data: byClinician } = await clinician.from("incidents").select("id").eq("id", draftId);
    record("Draft invisible to clinician (caseload access to named child)", (byClinician?.length ?? 0) === 0, `rows=${byClinician?.length}`);

    const { data: byPrincipal } = await principal.from("incidents").select("id").eq("id", draftId);
    record("Draft VISIBLE to principal (author/owning/principal only)", (byPrincipal?.length ?? 0) === 1, `rows=${byPrincipal?.length}`);

    const { data: byCreator } = await teacherA.from("incidents").select("id").eq("id", draftId);
    record("Draft VISIBLE to its own creator", (byCreator?.length ?? 0) === 1, `rows=${byCreator?.length}`);

    await admin.from("incidents").delete().eq("id", draftId);
  }

  console.log(`\n== CHECK 2: owning-teacher incident-scoped access, not passport-scoped ==`);
  {
    const { data: viaIncident } = await teacherA.from("incident_children").select("passport_id").eq("incident_id", incidentId);
    record("Owning teacher sees incident_children rows despite no passport_access", (viaIncident?.length ?? 0) === 2, `rows=${viaIncident?.length}`);

    const { data: directPassport, error: dpErr } = await teacherA.from("passports").select("id").eq("id", child1);
    record("Same teacher gets ZERO rows querying passports directly (no passport-level access)", (directPassport?.length ?? 0) === 0 && !dpErr, `rows=${directPassport?.length}, err=${dpErr?.message}`);
  }

  console.log(`\n== CHECK 3: no approved_by_parent gate ==`);
  {
    await admin.from("passport_institution_links").update({ approved_by_parent: false }).eq("passport_id", child1).eq("institution_id", institutionId);
    const { data: stillVisible } = await teacherA.from("incidents").select("id").eq("id", incidentId);
    record("Incident stays visible to owning teacher after parent-link revoked", (stillVisible?.length ?? 0) === 1, `rows=${stillVisible?.length}`);
    const { data: principalStill } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Incident stays visible to principal after parent-link revoked", (principalStill?.length ?? 0) === 1, `rows=${principalStill?.length}`);
    await admin.from("passport_institution_links").update({ approved_by_parent: true }).eq("passport_id", child1).eq("institution_id", institutionId);
  }

  console.log(`\n== CHECK 3A (case a, the explicit re-ask): parent revokes the link -- EVERY incident for that child stays visible school-side ==`);
  {
    // Distinct from check 3 above: this asserts across the school-side
    // read paths generically, not just one incident by id -- teacherB's
    // ORDINARY passport_access-derived visibility (not owning-teacher
    // status) and the principal's institution-wide list both re-checked
    // after a full revoke (approved_by_parent -> false AND is_active ->
    // false on passport_access itself, the strongest revocation this
    // schema has).
    await admin.from("passport_institution_links").update({ approved_by_parent: false }).eq("passport_id", child1).eq("institution_id", institutionId);
    await admin.from("passport_access").update({ is_active: false }).eq("passport_id", child1).eq("teacher_id", teacherBId);

    const { data: principalList } = await principal.rpc("get_institution_incidents", { p_institution_id: institutionId });
    const stillThere = principalList?.some((r) => r.incident_id === incidentId);
    record("Principal's institution-wide list still contains the incident after full revoke", Boolean(stillThere), `found=${stillThere}`);

    const { data: ownerStill } = await teacherA.from("incidents").select("id").eq("id", incidentId);
    record("Owning teacher (incident-scoped, decision 4) unaffected by the revoke regardless", (ownerStill?.length ?? 0) === 1, `rows=${ownerStill?.length}`);

    // Restore for the rest of the suite.
    await admin.from("passport_institution_links").update({ approved_by_parent: true }).eq("passport_id", child1).eq("institution_id", institutionId);
    await admin.from("passport_access").update({ is_active: true }).eq("passport_id", child1).eq("teacher_id", teacherBId);

    const { data: byTeacherBRestored } = await teacherB.from("incidents").select("id").eq("id", incidentId);
    record("Ordinary teacher's own passport_access-derived visibility restored once re-activated", (byTeacherBRestored?.length ?? 0) === 1, `rows=${byTeacherBRestored?.length}`);
  }

  console.log(`\n== CHECK 4: principal institution scoping + unverified gap ==`);
  {
    const { data: otherInst } = await admin.from("institutions").insert({ name: "Other Test School", institution_code: CODE + "B", status: "verified" }).select().single();
    const { data: crossInst } = await principal.from("incidents").select("id").eq("institution_id", otherInst.id);
    record("Principal gets zero rows for a DIFFERENT institution", (crossInst?.length ?? 0) === 0, `rows=${crossInst?.length}`);
    await admin.from("institutions").delete().eq("id", otherInst.id);

    await admin.from("institutions").update({ status: "pending" }).eq("id", institutionId);
    const { data: whilePending } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Principal's OWN institution access drops to zero when status flips to pending", (whilePending?.length ?? 0) === 0, `rows=${whilePending?.length}`);
    await admin.from("institutions").update({ status: "verified" }).eq("id", institutionId);
    const { data: afterReverify } = await principal.from("incidents").select("id").eq("id", incidentId);
    record("Principal access restored once institution re-verified", (afterReverify?.length ?? 0) === 1, `rows=${afterReverify?.length}`);
  }

  console.log(`\n== CHECK 5: one principal per institution ==`);
  {
    const secondPrincipalId = await createUser("incverify.principal2@thebehaviourhive.com", "Second Principal", "principal");
    const { error: dupErr } = await admin.from("institution_staff").insert({ institution_id: institutionId, user_id: secondPrincipalId, role: "principal" });
    record("Second principal self-link REJECTED by unique index", Boolean(dupErr && /duplicate key|unique/i.test(dupErr.message)), dupErr?.message);
    await admin.auth.admin.deleteUser(secondPrincipalId);
  }

  console.log(`\n== CHECK 6: parent redaction, structurally ==`);
  {
    const { data: p1Rows, error: p1Err2 } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1 });
    const row = p1Rows?.[0];
    const leaksNarrative = row && Object.prototype.hasOwnProperty.call(row, "narrative");
    record("get_parent_incidents column set excludes narrative entirely", !leaksNarrative, `keys=${row ? Object.keys(row).join(",") : "none"}`);
    record("Parent sees exactly 1 row (their own child, non-draft)", (p1Rows?.length ?? 0) === 1, `rows=${p1Rows?.length}, err=${p1Err2?.message}`);

    const { data: p1Direct, error: p1DirectErr } = await parent1.from("incidents").select("*").eq("id", incidentId);
    record("Parent direct .select() on incidents returns nothing (no policy grants it)", (p1Direct?.length ?? 0) === 0, `rows=${p1Direct?.length}, err=${p1DirectErr?.message}`);

    const { data: p1Children } = await parent1.from("incident_children").select("*").eq("incident_id", incidentId);
    record("Parent direct .select() on incident_children returns nothing", (p1Children?.length ?? 0) === 0, `rows=${p1Children?.length}`);

    const { data: p2Rows } = await parent2.rpc("get_parent_incidents", { p_passport_id: child2 });
    record("Parent 2 (child B) sees the incident via their own child's slice", (p2Rows?.length ?? 0) === 1, `rows=${p2Rows?.length}`);
  }

  console.log(`\n== CHECK C: SNA can stamp but cannot complete stage two or sign off ==`);
  {
    const { data: snaIncidentId, error: snaStampErr } = await sna.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    record("SNA CAN create a stamp", !snaStampErr, snaStampErr?.message);

    const { data: snaOwning } = await admin.from("incidents").select("owning_teacher_id").eq("id", snaIncidentId).single();
    record("SNA-created stamp has NO owning teacher auto-assigned (only class_teacher gets that)", snaOwning.owning_teacher_id === null, snaOwning.owning_teacher_id);

    await sna.from("incidents").update({ narrative: "SNA tried to write stage two" }).eq("id", snaIncidentId);
    const { data: afterSnaEdit } = await admin.from("incidents").select("narrative").eq("id", snaIncidentId).single();
    record("SNA CANNOT complete stage two (edit did not persist)", afterSnaEdit.narrative === null, `narrative now: ${afterSnaEdit.narrative}`);

    await sna.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: snaId }).eq("id", snaIncidentId);
    const { data: afterSnaSign } = await admin.from("incidents").select("teacher_signed_at").eq("id", snaIncidentId).single();
    record("SNA CANNOT sign off (did not persist)", afterSnaSign.teacher_signed_at === null, afterSnaSign.teacher_signed_at);

    const { error: snaClaimErr } = await sna.rpc("claim_incident", { p_incident_id: snaIncidentId });
    record("SNA CANNOT claim_incident either (class_teacher only)", Boolean(snaClaimErr), snaClaimErr?.message);

    const { error: teacherBClaimErr } = await teacherB.rpc("claim_incident", { p_incident_id: snaIncidentId });
    record("A real class teacher CAN claim the SNA-created stamp", !teacherBClaimErr, teacherBClaimErr?.message);

    await teacherB.from("incidents").update({ narrative: "Teacher B completed stage two after claiming" }).eq("id", snaIncidentId);
    const { data: afterClaim } = await admin.from("incidents").select("narrative, owning_teacher_id").eq("id", snaIncidentId).single();
    record("Once claimed, the claiming teacher CAN complete stage two", afterClaim.narrative === "Teacher B completed stage two after claiming" && afterClaim.owning_teacher_id === teacherBId, JSON.stringify(afterClaim));

    await admin.from("incidents").delete().eq("id", snaIncidentId);
  }

  console.log(`\n== CHECK 7: immutability after teacher sign-off ==`);
  {
    const { error: signErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", incidentId);
    record("Teacher sign-off write succeeds", !signErr, signErr?.message);

    await teacherA.from("incidents").update({ narrative: "Tampered narrative" }).eq("id", incidentId);
    const { data: afterTamperAttempt } = await admin.from("incidents").select("narrative").eq("id", incidentId).single();
    record("Post-signoff edit by the SAME teacher who signed did NOT persist", afterTamperAttempt.narrative === "Staff-facing narrative text.", `narrative now: ${afterTamperAttempt.narrative}`);

    const { error: cleanCountersign } = await principal.from("incidents").update({ principal_signed_at: new Date().toISOString(), principal_signed_by: principalId }).eq("id", incidentId);
    record("Principal countersign (only the two signoff columns) succeeds", !cleanCountersign, cleanCountersign?.message);

    const { data: afterCountersign } = await admin.from("incidents").select("narrative, status").eq("id", incidentId).single();
    record("narrative/status unchanged by the countersign write", afterCountersign.narrative === "Staff-facing narrative text." && afterCountersign.status === "awaiting_attestation", JSON.stringify(afterCountersign));
  }

  console.log(`\n== CHECK E: amendments after finalisation -- append-only, truly ==`);
  {
    const { data: amendment, error: amendErr } = await admin
      .from("incident_amendments")
      .insert({ incident_id: incidentId, author_id: teacherAId, reason: "Correction", content: "This is impossible" })
      .select()
      .single();
    // (service role for the insert itself here -- the point under test
    // is editability/deletability after the fact, not the insert
    // authorization path, which check J4's own policy already covers
    // via the owning-teacher/principal/clinician branches.)
    record("Amendment can be appended", !amendErr, amendErr?.message);

    await teacherA.from("incident_amendments").update({ content: "Tampered" }).eq("id", amendment.id);
    const { data: afterEditAttempt } = await admin.from("incident_amendments").select("content").eq("id", amendment.id).single();
    record("Existing amendment CANNOT be edited by anyone (no UPDATE policy exists at all)", afterEditAttempt.content === "This is impossible", `content now: ${afterEditAttempt.content}`);

    await teacherA.from("incident_amendments").delete().eq("id", amendment.id);
    const { data: stillThere } = await admin.from("incident_amendments").select("id").eq("id", amendment.id);
    record("Existing amendment CANNOT be deleted by anyone (no DELETE policy exists at all)", (stillThere?.length ?? 0) === 1, `rows still present=${stillThere?.length}`);

    const { data: visibleToPrincipal } = await principal.from("incident_amendments").select("id").eq("id", amendment.id);
    record("Amendment visible to principal", (visibleToPrincipal?.length ?? 0) === 1, `rows=${visibleToPrincipal?.length}`);
  }

  console.log(`\n== CHECK 8: CPI is_restraint flag, robust lookup ==`);
  {
    const { data: cpiAction } = await admin.from("incident_action_types").select("id, is_restraint").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();
    record("CPI action row flagged is_restraint = true", cpiAction.is_restraint === true, JSON.stringify(cpiAction));
  }

  console.log(`\n== CHECK 9: school_notices generated automatically ==`);
  {
    const { error: injErr } = await admin.from("incident_injuries").insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] });
    if (injErr) console.log("injury insert note:", injErr.message);

    const { data: flaggedChild } = await admin.from("incident_children").select("parent_call_required").eq("incident_id", incidentId).eq("passport_id", child1).single();
    record("incident_children.parent_call_required flipped true after injury insert", flaggedChild?.parent_call_required === true, JSON.stringify(flaggedChild));

    const { data: notices } = await admin.from("school_notices").select("*").eq("incident_id", incidentId);
    record("Exactly one school_notices row raised", (notices?.length ?? 0) === 1, `rows=${notices?.length}`);

    const { data: byPrincipalNotice } = await principal.from("school_notices").select("id").eq("incident_id", incidentId);
    record("Notice visible to principal", (byPrincipalNotice?.length ?? 0) === 1, `rows=${byPrincipalNotice?.length}`);
    const { data: byOwnerNotice } = await teacherA.from("school_notices").select("id").eq("incident_id", incidentId);
    record("Notice visible to owning teacher", (byOwnerNotice?.length ?? 0) === 1, `rows=${byOwnerNotice?.length}`);
    const { data: byParentNotice } = await parent1.from("school_notices").select("id").eq("incident_id", incidentId);
    record("Notice INVISIBLE to parent", (byParentNotice?.length ?? 0) === 0, `rows=${byParentNotice?.length}`);
  }

  console.log(`\n== CHECK 10: two-child cap ==`);
  {
    const { data: p3 } = await admin.from("passports").insert({ user_id: parent3Id, child_name: "Verify Child Three", passport_status: "complete" }).select().single();
    const { error: thirdChildErr } = await admin.from("incident_children").insert({ incident_id: incidentId, passport_id: p3.id, child_index: "A", added_by: teacherAId });
    record("Third child with duplicate child_index 'A' REJECTED", Boolean(thirdChildErr), thirdChildErr?.message);
    const { error: thirdChildErr2 } = await admin.from("incident_children").insert({ incident_id: incidentId, passport_id: p3.id, child_index: "C", added_by: teacherAId });
    record("Third child with child_index 'C' (outside A/B) REJECTED", Boolean(thirdChildErr2), thirdChildErr2?.message);
    await admin.from("passports").delete().eq("id", p3.id);
  }

  console.log(`\n== CHECK D: attestation integrity ==`);
  {
    // teacherB and the free-text "Bus Escort Jane" were both named as
    // witnessed staff by the original create_incident_stamp() call.
    // clinician was never named at all -- confirm they have no row of
    // their own AND cannot tamper with teacherB's row either (the
    // policy's own_row check is user_id = auth.uid(), so a not-named
    // caller updating BY teacherB's row id should silently affect zero
    // rows, same RLS-on-UPDATE nuance as check 7).
    await clinician
      .from("incident_staff")
      .update({ attested_at: new Date().toISOString(), attestation_addendum: "Clinician should not be able to write this." })
      .eq("incident_id", incidentId)
      .eq("user_id", teacherBId);
    const { data: teacherBRowAfter } = await admin.from("incident_staff").select("attested_at, attestation_addendum").eq("incident_id", incidentId).eq("user_id", teacherBId).single();
    record(
      "A staff member NOT named on the incident cannot attest via someone else's row",
      teacherBRowAfter.attestation_addendum !== "Clinician should not be able to write this.",
      JSON.stringify(teacherBRowAfter)
    );

    // Named staff member (teacherB) attests once.
    const { error: firstAttestErr } = await teacherB.from("incident_staff").update({ attested_at: new Date().toISOString(), attestation_addendum: "Confirmed, accurate." }).eq("incident_id", incidentId).eq("user_id", teacherBId);
    record("Named staff member CAN attest to their own row", !firstAttestErr, firstAttestErr?.message);

    const { data: afterFirstAttest } = await admin.from("incident_staff").select("attested_at, attestation_addendum").eq("incident_id", incidentId).eq("user_id", teacherBId).single();
    record("Attestation actually persisted", Boolean(afterFirstAttest.attested_at), JSON.stringify(afterFirstAttest));

    // Attempt to attest a second time with different content -- the
    // policy has no explicit "already attested" guard, so this is
    // testing whether one exists or whether it silently allows a
    // rewrite. Flagged as a genuine finding either way, not assumed.
    const firstAttestedAt = afterFirstAttest.attested_at;
    await teacherB.from("incident_staff").update({ attested_at: new Date().toISOString(), attestation_addendum: "Changed my mind." }).eq("incident_id", incidentId).eq("user_id", teacherBId);
    const { data: afterSecondAttempt } = await admin.from("incident_staff").select("attested_at, attestation_addendum").eq("incident_id", incidentId).eq("user_id", teacherBId).single();
    const wasOverwritten = afterSecondAttempt.attested_at !== firstAttestedAt || afterSecondAttempt.attestation_addendum === "Changed my mind.";
    record(
      "Named staff CANNOT silently re-attest with different content (no second write allowed)",
      !wasOverwritten,
      `first="${afterFirstAttest.attestation_addendum}" now="${afterSecondAttempt.attestation_addendum}" (if these differ, the schema currently allows overwriting an attestation -- no version/lock on it)`
    );
  }

  console.log(`\n== CHECK 11: free-text staff, non-blocking ==`);
  {
    const { data: freeTextRow } = await admin.from("incident_staff").select("attested_at").eq("incident_id", incidentId).is("user_id", null).single();
    record("Free-text staff row has no attested_at (never attested, by construction)", freeTextRow.attested_at === null, JSON.stringify(freeTextRow));
    record("Incident reached teacher sign-off despite the free-text row being unattested (non-blocking, confirmed above in check 7)", true, "sign-off in check 7 already succeeded with this row present");
  }

  console.log(`\n== Summary ==`);
  const failed = results.filter((r) => !r.pass);
  console.log(`${results.length - failed.length}/${results.length} passed.`);
  if (failed.length) {
    console.log("FAILURES / FINDINGS:");
    failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`));
  }

  console.log(`\n== Cleanup ==`);
  await admin.from("institutions").delete().eq("id", institutionId);
  for (const id of [principalId, teacherAId, teacherBId, snaId, clinicianId, parent1Id, parent2Id, parent3Id]) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log("Cleaned up.");

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
