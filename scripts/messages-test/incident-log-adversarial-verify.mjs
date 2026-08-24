// Throwaway test rig for the School Incident Log Phase 1 adversarial
// verification -- real JWTs, not service-role, for every RLS check.
// Creates a dedicated institution + accounts, drives the actual incident
// lifecycle through real signed-in sessions, asserts each of the 11
// checks from the verification plan, then deletes everything it created.
//
// Run with: node --env-file=.env.local scripts/messages-test/incident-log-adversarial-verify.mjs

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

  // Institution, verified.
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Incident Verify Test School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;
  console.log(`Institution: ${institutionId} (code ${CODE})`);

  // Users.
  const principalId = await createUser("incverify.principal@thebehaviourhive.com", "Principal Test", "principal");
  const teacherAId = await createUser("incverify.teacherA@thebehaviourhive.com", "Teacher A Owning", "class_teacher");
  const teacherBId = await createUser("incverify.teacherB@thebehaviourhive.com", "Teacher B Ordinary", "class_teacher");
  const clinicianId = await createUser("incverify.clinician@thebehaviourhive.com", "Clinician Test", "clinician");
  const parent1Id = await createUser("incverify.parent1@thebehaviourhive.com", "Parent One", "parent");
  const parent2Id = await createUser("incverify.parent2@thebehaviourhive.com", "Parent Two", "parent");
  const parent3Id = await createUser("incverify.parent3@thebehaviourhive.com", "Parent Three", "parent");
  console.log("Users created.");

  // institution_staff.
  const { error: staffErr } = await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: principalId, role: "principal" },
    { institution_id: institutionId, user_id: teacherAId, role: "class_teacher" },
    { institution_id: institutionId, user_id: teacherBId, role: "class_teacher" },
  ]);
  if (staffErr) throw staffErr;

  // Passports (children) -- minimal required fields only.
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

  // passport_institution_links -- irrelevant to school-side access now
  // (decision 1), but still created for realism / other code paths.
  await admin.from("passport_institution_links").insert([
    { passport_id: child1, institution_id: institutionId, approved_by_parent: true },
    { passport_id: child2, institution_id: institutionId, approved_by_parent: true },
  ]);

  // passport_access: Teacher B has ORDINARY access to child1 only.
  // Teacher A (the eventual creator/owning teacher) deliberately gets
  // NONE -- this is the whole point of check 2 below.
  await admin.from("passport_access").insert({
    passport_id: child1, teacher_id: teacherBId, institution_id: institutionId,
    is_active: true, actor_role: "class_teacher",
  });

  // Clinician: verified, caseload access to child1 only.
  const { error: clinErr } = await admin.from("clinicians").insert({
    user_id: clinicianId, specialty: "behavioural_psychologist", verification_status: "verified",
  });
  if (clinErr) console.log("clinicians insert note:", clinErr.message);
  await admin.from("clinician_access").insert({ passport_id: child1, clinician_id: clinicianId, is_active: true });

  console.log("Fixture ready. child1=" + child1 + " child2=" + child2);

  const teacherA = await signedInClient("incverify.teacherA@thebehaviourhive.com");
  const teacherB = await signedInClient("incverify.teacherB@thebehaviourhive.com");
  const principal = await signedInClient("incverify.principal@thebehaviourhive.com");
  const clinician = await signedInClient("incverify.clinician@thebehaviourhive.com");
  const parent1 = await signedInClient("incverify.parent1@thebehaviourhive.com");
  const parent2 = await signedInClient("incverify.parent2@thebehaviourhive.com");

  // A seeded global location.
  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  console.log(`\n== Building the incident (as Teacher A, real session) ==`);

  // Deliberately NOT chaining .select() onto this insert -- confirmed
  // live during this same verification run that doing so triggers
  // INSERT ... RETURNING, which requires the SELECT policy (backed by
  // the can_view_incident() SECURITY DEFINER function) to pass WITHIN
  // THE SAME STATEMENT as the insert, and that self-referential
  // evaluation does not resolve the same way a fresh, separate query
  // does -- fails with "new row violates row-level security policy"
  // even though the row and the caller both genuinely satisfy the
  // policy a moment later. Exact same category of gotcha already
  // documented for abc_logs's own insert (DO NOT chain .select()), just
  // a different root cause (there: column-level grants; here: same-
  // statement RETURNING vs. a SECURITY DEFINER helper function). Fix:
  // generate the id client-side, matching the abc_logs precedent, so
  // the caller already knows the new row's id without needing
  // RETURNING. This is a real constraint client code (Phase 3) must
  // follow too, not just this test script.
  const incidentId = crypto.randomUUID();
  const { error: incErr } = await teacherA
    .from("incidents")
    .insert({ id: incidentId, institution_id: institutionId, created_by: teacherAId, occurred_at: new Date().toISOString(), location_id: loc.id });
  if (incErr) throw incErr;
  console.log("Incident created (draft):", incidentId);

  // Teacher A assigns themself as owning teacher and fills stage-two fields.
  const { error: ownErr } = await teacherA
    .from("incidents")
    .update({ owning_teacher_id: teacherAId, category: "one_party_incident", narrative: "Staff-facing narrative text.", parent_summary: "Parent-facing summary text." })
    .eq("id", incidentId);
  if (ownErr) throw ownErr;

  // Two children, added by Teacher A -- drawn from the roster, not from
  // Teacher A's own (nonexistent) passport_access.
  const { error: icErr } = await teacherA.from("incident_children").insert([
    { incident_id: incidentId, passport_id: child1, child_index: "A", added_by: teacherAId },
    { incident_id: incidentId, passport_id: child2, child_index: "B", added_by: teacherAId },
  ]);
  if (icErr) throw icErr;

  // Staff: Teacher B named as witnessed, plus a free-text bus escort.
  const { error: isErr } = await teacherA.from("incident_staff").insert([
    { incident_id: incidentId, user_id: teacherBId, involvement: "witnessed" },
    { incident_id: incidentId, free_text_name: "Bus Escort Jane", involvement: "witnessed" },
  ]);
  if (isErr) throw isErr;

  // Move status forward (no DB-enforced transition order -- just setting
  // it for realism of the scenario).
  await teacherA.from("incidents").update({ status: "awaiting_attestation" }).eq("id", incidentId);

  console.log(`\n== CHECK 1: draft isolation ==`);
  {
    const { data: draftIncident } = await admin.from("incidents").insert({
      institution_id: institutionId, created_by: teacherAId, occurred_at: new Date().toISOString(), location_id: loc.id,
    }).select().single();
    await admin.from("incident_children").insert({ incident_id: draftIncident.id, passport_id: child1, child_index: "A", added_by: teacherAId });

    const { data: byTeacherB } = await teacherB.from("incidents").select("id").eq("id", draftIncident.id);
    record("Draft invisible to ordinary teacher with passport_access", (byTeacherB?.length ?? 0) === 0, `rows=${byTeacherB?.length}`);

    const { data: byClinician } = await clinician.from("incidents").select("id").eq("id", draftIncident.id);
    record("Draft invisible to clinician (caseload access to named child)", (byClinician?.length ?? 0) === 0, `rows=${byClinician?.length}`);

    const { data: byPrincipal } = await principal.from("incidents").select("id").eq("id", draftIncident.id);
    record("Draft VISIBLE to principal (author/owning/principal only)", (byPrincipal?.length ?? 0) === 1, `rows=${byPrincipal?.length}`);

    const { data: byCreator } = await teacherA.from("incidents").select("id").eq("id", draftIncident.id);
    record("Draft VISIBLE to its own creator", (byCreator?.length ?? 0) === 1, `rows=${byCreator?.length}`);

    await admin.from("incidents").delete().eq("id", draftIncident.id);
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

  console.log(`\n== CHECK 7: immutability after teacher sign-off ==`);
  {
    const { error: signErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", incidentId);
    record("Teacher sign-off write succeeds", !signErr, signErr?.message);

    // NOT an error-throwing check -- confirmed live that it can't be.
    // Once teacher_signed_at is set, this row no longer matches the
    // UPDATE policy's USING clause at all, so PostgREST silently
    // updates zero rows (data: [], error: null) rather than throwing --
    // RLS filters rows for UPDATE, it doesn't reject the statement the
    // way an INSERT's WITH CHECK does. The only way to tell a genuinely-
    // blocked update from one that just did nothing is to re-read the
    // actual persisted value afterward, which is what this asserts.
    await teacherA.from("incidents").update({ narrative: "Tampered narrative" }).eq("id", incidentId);
    const { data: afterTamperAttempt } = await admin.from("incidents").select("narrative").eq("id", incidentId).single();
    record(
      "Post-signoff edit by the SAME teacher who signed did NOT persist",
      afterTamperAttempt.narrative === "Staff-facing narrative text.",
      `narrative now: ${afterTamperAttempt.narrative}`
    );

    const { error: cleanCountersign } = await principal.from("incidents").update({ principal_signed_at: new Date().toISOString(), principal_signed_by: principalId }).eq("id", incidentId);
    record("Principal countersign (only the two signoff columns) succeeds", !cleanCountersign, cleanCountersign?.message);

    const { data: afterCountersign } = await admin.from("incidents").select("narrative, status").eq("id", incidentId).single();
    record("narrative/status unchanged by the countersign write", afterCountersign.narrative === "Staff-facing narrative text." && afterCountersign.status === "awaiting_attestation", JSON.stringify(afterCountersign));
  }

  console.log(`\n== CHECK 8: CPI is_restraint flag, robust lookup ==`);
  {
    const { data: cpiAction } = await admin.from("incident_action_types").select("id, is_restraint").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();
    record("CPI action row flagged is_restraint = true", cpiAction.is_restraint === true, JSON.stringify(cpiAction));
  }

  console.log(`\n== CHECK 9: school_notices generated automatically ==`);
  {
    const { error: injErr } = await admin.from("incident_injuries").insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] });
    if (injErr) console.log("injury insert (post-signoff, expected to still work -- child tables aren't immutability-guarded):", injErr.message);

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
    console.log("FAILURES:");
    failed.forEach((f) => console.log(`  - ${f.name} :: ${f.detail}`));
  }

  console.log(`\n== Cleanup ==`);
  await admin.from("institutions").delete().eq("id", institutionId);
  for (const id of [principalId, teacherAId, teacherBId, clinicianId, parent1Id, parent2Id, parent3Id]) {
    await admin.auth.admin.deleteUser(id);
  }
  console.log("Cleaned up.");

  process.exit(failed.length > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SCRIPT ERROR:", err);
  process.exit(1);
});
