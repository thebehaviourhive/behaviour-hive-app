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
  const { data: bruisingType } = await admin.from("incident_injury_types").select("id").eq("value", "Bruising").is("institution_id", null).single();
  const { data: rednessType } = await admin.from("incident_injury_types").select("id").eq("value", "Redness").is("institution_id", null).single();
  // Fetched here (not just down at CHECK K/L/M/N, which also use these)
  // because CHECK D's own pre-existing body-mark inserts need region_id/
  // side too -- both columns became NOT NULL in migration 0080, after
  // CHECK D was originally written; this suite hadn't been run end to
  // end since, so that gap was invisible until now.
  const { data: biteType } = await admin.from("incident_injury_types").select("id").eq("value", "Bite").is("institution_id", null).single();
  const { data: restraintAction } = await admin.from("incident_action_types").select("id").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();
  const { data: nonRestraintAction } = await admin.from("incident_action_types").select("id").eq("value", "Gently blocked further attempts").is("institution_id", null).single();
  const { data: headRegion } = await admin.from("incident_body_regions").select("id").eq("value", "head").is("institution_id", null).single();

  console.log(`\n== CHECK B: incident for a child whose parent has never opened the app ==`);
  // A passport_institution_links row can only ever be INSERTED by the
  // parent themselves (RLS-restricted, "Parents can insert links for
  // their own passport") -- so "the school's roster includes this
  // child" necessarily implies some link already exists; there is no
  // path to a child appearing on the roster with literally zero link at
  // all. The realistic version of "a parent who's never opened the
  // app" is this: the link exists (created once, at minimal
  // registration) but was never approved and nothing about it has been
  // touched since -- approved_by_parent stays false throughout. That's
  // what's set up here for child2, created directly (service role,
  // simulating whatever one-time flow produced it) rather than via the
  // parent's own session, since this parent is being modelled as never
  // having done anything beyond that.
  await admin.from("passport_institution_links").insert({ passport_id: child2, institution_id: institutionId, approved_by_parent: false });

  console.log(`\n== Building the incident (create_incident_stamp, as Teacher A, real session) ==`);

  const { data: incidentId, error: stampErr } = await teacherA.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [child1, child2],
    p_staff: [{ user_id: teacherBId, involvement: "witnessed" }, { free_text_name: "Bus Escort Jane", involvement: "witnessed" }],
  });
  record("create_incident_stamp succeeds for a child whose parent has never approved the link", !stampErr, stampErr?.message);
  console.log("Incident created (atomic stamp):", incidentId);

  {
    const { data: children } = await admin.from("incident_children").select("passport_id, child_index").eq("incident_id", incidentId);
    record("Incident has exactly 2 children immediately after the stamp (never a childless window)", (children?.length ?? 0) === 2, JSON.stringify(children));
    const { data: owningCheck } = await admin.from("incidents").select("owning_teacher_id").eq("id", incidentId).single();
    record("Class-teacher creator auto-assigned as owning teacher by the stamp RPC", owningCheck.owning_teacher_id === teacherAId, owningCheck.owning_teacher_id);
  }

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

  console.log(`\n== CHECK F: roster RPCs for the stamp UI (migration 0074) ==`);
  {
    const { data: childRoster, error: childRosterErr } = await teacherA.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("Institution staff can call get_institution_child_roster()", !childRosterErr, childRosterErr?.message);
    const rosterIds = (childRoster ?? []).map((r) => r.passport_id);
    record("Roster includes child1 (approved link)", rosterIds.includes(child1), JSON.stringify(rosterIds));
    record("Roster includes child2 too -- NO approved_by_parent gate (decision 1/5)", rosterIds.includes(child2), JSON.stringify(rosterIds));

    const { data: clinicianRoster } = await clinician.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("A caller who is NOT institution_staff (clinician) gets zero roster rows", (clinicianRoster?.length ?? 0) === 0, `rows=${clinicianRoster?.length}`);
    const { data: parentRoster } = await parent1.rpc("get_institution_child_roster", { p_institution_id: institutionId });
    record("A parent gets zero roster rows either", (parentRoster?.length ?? 0) === 0, `rows=${parentRoster?.length}`);

    const { data: staffRoster, error: staffRosterErr } = await teacherA.rpc("get_institution_staff_roster", { p_institution_id: institutionId });
    record("Institution staff can call get_institution_staff_roster()", !staffRosterErr, staffRosterErr?.message);
    const staffIds = (staffRoster ?? []).map((r) => r.user_id);
    record("Staff roster includes colleagues (teacherB, principal, sna), not just the caller", [teacherBId, principalId, snaId].every((id) => staffIds.includes(id)), JSON.stringify(staffRoster));

    const { data: otherInstForRoster } = await admin.from("institutions").insert({ name: "Roster Cross-Check School", institution_code: CODE + "C", status: "verified" }).select().single();
    const { data: crossInstChildRoster } = await teacherA.rpc("get_institution_child_roster", { p_institution_id: otherInstForRoster.id });
    record("Own institution's staff member gets zero rows for a DIFFERENT institution's child roster", (crossInstChildRoster?.length ?? 0) === 0, `rows=${crossInstChildRoster?.length}`);
    const { data: crossInstStaffRoster } = await teacherA.rpc("get_institution_staff_roster", { p_institution_id: otherInstForRoster.id });
    record("Own institution's staff member gets zero rows for a DIFFERENT institution's staff roster", (crossInstStaffRoster?.length ?? 0) === 0, `rows=${crossInstStaffRoster?.length}`);
    await admin.from("institutions").delete().eq("id", otherInstForRoster.id);
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

  console.log(`\n== CHECK D: attestation -- append-only, staleness, withdrawal (migration 0070) ==`);
  // Deliberately BEFORE check 7's sign-off, not after -- attest_to_incident/
  // withdraw_attestation both require teacher_signed_at is null, matching
  // the brief's own stated lifecycle (stamp -> stage two -> attestation ->
  // debrief -> teacher sign-off -> principal countersign). This whole
  // block ends by leaving teacherB's attestation CURRENT again, on purpose
  // -- check 7 right after this needs a clean sign-off to actually go
  // through, now that the sign-off gate is genuinely DB-enforced.
  //
  // The narrative gets rewritten mid-block (to prove staleness), so the
  // "revised" text below is what check 7's own assertions have to expect
  // afterwards -- not the original "Staff-facing narrative text."
  const REVISED_NARRATIVE = "Staff-facing narrative text, revised after initial attestation.";
  let teacherBStaffId;
  let snaStaffId;
  {
    const { data: teacherBStaffRow } = await admin
      .from("incident_staff")
      .select("id")
      .eq("incident_id", incidentId)
      .eq("user_id", teacherBId)
      .single();
    teacherBStaffId = teacherBStaffRow.id;

    // -- Not named on the incident cannot attest via someone else's row. --
    // The RPC itself checks st.user_id = auth.uid(), not just RLS, so this
    // should come back as a raised exception, not a silent no-op.
    const { error: clinicianAttestErr } = await clinician.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Clinician should not be able to write this.",
    });
    record("A staff member NOT named on the incident cannot attest via attest_to_incident()", Boolean(clinicianAttestErr), clinicianAttestErr?.message);

    // -- Named staff member CAN attest. --
    const { error: attest1Err } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Confirmed, accurate.",
    });
    record("Named staff member CAN attest via attest_to_incident()", !attest1Err, attest1Err?.message);

    const { data: statusAfterFirst } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'current' immediately after a fresh attestation", statusAfterFirst === "current", statusAfterFirst);

    // -- get_attestation_status() has its own can_view_incident() gate. --
    // It's SECURITY DEFINER, so without this check anyone with a valid
    // (guessed or leaked) incident_staff_id could learn attestation
    // status for an incident they have no standing to see at all. Parent
    // 1 has no can_view_incident() branch at all (parents only ever get
    // data through the separate redacted get_parent_incidents()) -- real
    // status is 'current' at this exact moment, so 'unknown' here can
    // only be the visibility gate doing its job, not a coincidence.
    const { data: statusViaUnrelatedParent } = await parent1.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("A caller with no standing to view the incident gets 'unknown', not the real status", statusViaUnrelatedParent === "unknown", statusViaUnrelatedParent);

    // -- Append-only: re-attesting adds a new row, never overwrites. --
    const { error: attest2Err } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-attesting, still confirmed.",
    });
    record("Re-attesting (still pre-signoff, narrative unchanged) succeeds", !attest2Err, attest2Err?.message);

    const { data: historyAfterTwo } = await admin
      .from("incident_attestations")
      .select("action, addendum, content_hash")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "History has BOTH attestations as separate rows -- the first is untouched, not overwritten",
      historyAfterTwo?.length === 2 && historyAfterTwo[0].addendum === "Confirmed, accurate." && historyAfterTwo[1].addendum === "Re-attesting, still confirmed.",
      JSON.stringify(historyAfterTwo)
    );

    // -- Staleness: editing the narrative stales every existing attestation, computed live. --
    await teacherA.from("incidents").update({ narrative: REVISED_NARRATIVE }).eq("id", incidentId);
    const { data: statusAfterEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' the moment the owning teacher edits the narrative", statusAfterEdit === "stale", statusAfterEdit);

    // -- Sign-off is blocked while any named staff member is stale. --
    const { error: staleSignErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", incidentId);
    record("Sign-off REJECTED by the DB while teacherB's attestation is stale", Boolean(staleSignErr), staleSignErr?.message);
    const { data: stillUnsignedAfterStale } = await admin.from("incidents").select("teacher_signed_at").eq("id", incidentId).single();
    record("teacher_signed_at genuinely still null after the rejected attempt", stillUnsignedAfterStale.teacher_signed_at === null, stillUnsignedAfterStale.teacher_signed_at);

    // -- Withdrawal requires a non-empty reason. --
    const { error: emptyReasonErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: "   " });
    record("withdraw_attestation() REJECTS a blank/whitespace-only reason", Boolean(emptyReasonErr), emptyReasonErr?.message);

    // -- Withdrawal, with a real reason, succeeds and is append-only too. --
    const WITHDRAWAL_REASON = "I was not present for the second half of what's now described and no longer stand over my account.";
    const { error: withdrawErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: WITHDRAWAL_REASON });
    record("Named staff member CAN withdraw with a required reason", !withdrawErr, withdrawErr?.message);

    const { data: statusAfterWithdraw } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'withdrawn' after withdrawal", statusAfterWithdraw === "withdrawn", statusAfterWithdraw);

    const { data: historyAfterWithdraw } = await admin
      .from("incident_attestations")
      .select("action, addendum, withdrawal_reason")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "Withdrawal APPENDS a third row -- both prior attestations still in the log",
      historyAfterWithdraw?.length === 3 && historyAfterWithdraw[2].action === "withdrawn" && historyAfterWithdraw[2].withdrawal_reason === WITHDRAWAL_REASON,
      JSON.stringify(historyAfterWithdraw)
    );

    // -- Withdrawal surfaces to the principal via school_notices. --
    const { data: withdrawalNotices } = await admin.from("school_notices").select("*").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Exactly one attestation_withdrawn notice raised", (withdrawalNotices?.length ?? 0) === 1, `rows=${withdrawalNotices?.length}`);
    const { data: withdrawalNoticeByPrincipal } = await principal.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice visible to principal", (withdrawalNoticeByPrincipal?.length ?? 0) === 1, `rows=${withdrawalNoticeByPrincipal?.length}`);
    const { data: withdrawalNoticeByOwner } = await teacherA.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice visible to owning teacher", (withdrawalNoticeByOwner?.length ?? 0) === 1, `rows=${withdrawalNoticeByOwner?.length}`);
    const { data: withdrawalNoticeByParent } = await parent1.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "attestation_withdrawn");
    record("Withdrawal notice INVISIBLE to parent", (withdrawalNoticeByParent?.length ?? 0) === 0, `rows=${withdrawalNoticeByParent?.length}`);

    // -- Sign-off is blocked while withdrawn, same as while stale. --
    const { error: withdrawnSignErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", incidentId);
    record("Sign-off REJECTED by the DB while teacherB's attestation is withdrawn", Boolean(withdrawnSignErr), withdrawnSignErr?.message);

    // -- Renewing: a fresh attestation against the CURRENT narrative clears both stale and withdrawn. --
    const { error: renewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after reviewing the revised narrative.",
    });
    record("Named staff member CAN renew with a fresh attestation after withdrawing", !renewErr, renewErr?.message);
    const { data: statusAfterRenew } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status is 'current' again after renewal", statusAfterRenew === "current", statusAfterRenew);

    const { data: fullHistory } = await admin
      .from("incident_attestations")
      .select("action")
      .eq("incident_staff_id", teacherBStaffId)
      .order("created_at", { ascending: true });
    record(
      "Full append-only history is attested, attested, withdrawn, attested -- 4 rows, nothing ever overwritten",
      JSON.stringify(fullHistory?.map((r) => r.action)) === JSON.stringify(["attested", "attested", "withdrawn", "attested"]),
      JSON.stringify(fullHistory)
    );

    // -- The corrected behaviour: a MISSING attestation does not block. --
    // A second real staff member, named on the incident, who NEVER
    // attests at all -- proving get_attestation_status() correctly
    // reports 'not_attested' for them, and (checked in CHECK 7 below,
    // where sign-off is actually attempted) that this status does NOT
    // block sign-off the way 'stale'/'withdrawn' do.
    const { data: snaStaffRow, error: snaNameErr } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: incidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    record("Owning teacher can name a second real staff member on the incident", !snaNameErr, snaNameErr?.message);
    snaStaffId = snaStaffRow.id;

    const { data: snaStatusNeverAttested } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("A newly-named staff member who has never attested reads as 'not_attested', not an error", snaStatusNeverAttested === "not_attested", snaStatusNeverAttested);

    // -- Broadened hash: staleness also fires on non-narrative material --
    // facts (decision 3) -- a child's distress_level here, not the
    // narrative text at all.
    await teacherA.from("incident_children").update({ distress_level: "yes_definitely" }).eq("incident_id", incidentId).eq("passport_id", child1);
    const { data: statusAfterChildEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' again from a child's distress_level changing -- the hash covers more than the narrative", statusAfterChildEdit === "stale", statusAfterChildEdit);

    // -- Restrictive practice fields are hashed too, and specifically --
    // EDITING A SAVED record (not just adding a new one) must stale an
    // existing attestation. This is the direct answer to "does changing
    // hold_level or planning_status on a saved record invalidate
    // attestations" -- isolated per field, not inferred from the
    // migration text.
    const { data: rpRow, error: rpInsertErr } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: incidentId, passport_id: child1, planning_status: "not_planned", hold_level: "low" })
      .select()
      .single();
    record("Owning teacher can record a restrictive practice pre-signoff", !rpInsertErr, rpInsertErr?.message);

    // The real UI only ever gets here by ticking CPI/restraint first (that's
    // what opens this section) -- match that here too, now that migration
    // 0083's sign-off gate checks the two are consistent (CHECK N below
    // exercises that gate directly; this is just keeping this incident's
    // own eventual sign-off in CHECK 7 clean).
    await teacherA.from("incident_actions").insert({ incident_id: incidentId, action_type_id: restraintAction.id });

    const { data: statusAfterRpInsert } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' when a restrictive practice record is added", statusAfterRpInsert === "stale", statusAfterRpInsert);

    const { error: rpBaselineRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming with the restrictive practice record in place.",
    });
    record("Renewal with the restrictive practice record in place succeeds", !rpBaselineRenewErr, rpBaselineRenewErr?.message);
    const { data: statusBeforeHoldLevelEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' with the restrictive practice record in place", statusBeforeHoldLevelEdit === "current", statusBeforeHoldLevelEdit);

    // Edit hold_level ONLY, on the SAVED (already-has-an-id) record.
    const { error: holdLevelEditErr } = await teacherA
      .from("restrictive_practices")
      .update({ hold_level: "high" })
      .eq("id", rpRow.id);
    record("Owning teacher can edit hold_level on a saved restrictive practice record pre-signoff", !holdLevelEditErr, holdLevelEditErr?.message);
    const { data: statusAfterHoldLevelEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record(
      "Status flips to 'stale' purely from editing hold_level on a SAVED record -- whether force escalated changes underneath an existing attestation",
      statusAfterHoldLevelEdit === "stale",
      statusAfterHoldLevelEdit
    );

    const { error: preStatusEditRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after hold_level was corrected.",
    });
    record("Renewal after the hold_level edit succeeds", !preStatusEditRenewErr, preStatusEditRenewErr?.message);

    // Edit planning_status ONLY -- the field the whole decision is about:
    // was this pre-authorised in the BSP, or an unplanned response.
    const { error: planningStatusEditErr } = await teacherA
      .from("restrictive_practices")
      .update({ planning_status: "in_bsp" })
      .eq("id", rpRow.id);
    record("Owning teacher can edit planning_status on a saved restrictive practice record pre-signoff", !planningStatusEditErr, planningStatusEditErr?.message);
    const { data: statusAfterPlanningStatusEdit } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record(
      "Status flips to 'stale' purely from editing planning_status on a SAVED record -- an attestation cannot survive whether force was pre-authorised changing underneath it",
      statusAfterPlanningStatusEdit === "stale",
      statusAfterPlanningStatusEdit
    );

    // Renew, then prove the hash covers body-map markers too (migration
    // 0072) -- a marker's position/view/injury_type, not just the
    // injury row it hangs off.
    const { error: preMarkRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the distress level was recorded.",
    });
    record("Renewal (after the distress_level change) succeeds", !preMarkRenewErr, preMarkRenewErr?.message);
    const { data: statusBeforeMark } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' again before the body-mark is added", statusBeforeMark === "current", statusBeforeMark);

    const { data: injuryRow, error: injuryInsertErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child1, injury_types: ["Bruising"] })
      .select()
      .single();
    record("Owning teacher can record an injury pre-signoff", !injuryInsertErr, injuryInsertErr?.message);

    // -- Migration 0076: a marker with no type, or an invalid type, is --
    // structurally impossible now, not just discouraged by the UI.
    // region_id/side supplied on every insert below (migration 0080 made
    // both NOT NULL) so each test isolates the ONE constraint it's
    // actually named for, rather than tripping the region_id constraint
    // first and reporting a pass for the wrong reason.
    const { error: nullTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: null, region_id: headRegion.id, side: "centre" });
    record("A body mark with NO injury_type_id is REJECTED (not null constraint)", Boolean(nullTypeErr), nullTypeErr?.message);

    const { error: bogusTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: "00000000-0000-0000-0000-000000000000", region_id: headRegion.id, side: "centre" });
    record("A body mark with an injury_type_id NOT in the vocabulary is REJECTED (foreign key)", Boolean(bogusTypeErr), bogusTypeErr?.message);

    const { data: markRow, error: markInsertErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" })
      .select()
      .single();
    record("Owning teacher can place a body-map marker pre-signoff", !markInsertErr, markInsertErr?.message);

    const { data: statusAfterMark } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' when a body-map marker is added -- the hash covers markers too (migration 0072)", statusAfterMark === "stale", statusAfterMark);

    // Renew with the marker in place, THEN move it -- proves position
    // specifically is hashed, not just marker presence/absence (the
    // exact scenario behind this decision: a marker moving from a
    // forearm to a throat).
    const { error: preMoveRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming with the marker at its original position.",
    });
    record("Renewal with the marker in place succeeds", !preMoveRenewErr, preMoveRenewErr?.message);
    const { data: statusBeforeMove } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' with the marker at its original position", statusBeforeMove === "current", statusBeforeMove);

    const { error: markMoveErr } = await teacherA
      .from("incident_body_marks")
      .update({ x: 0.1, y: 0.05, view: "front" })
      .eq("injury_id", injuryRow.id);
    record("Owning teacher can move a body-map marker pre-signoff", !markMoveErr, markMoveErr?.message);

    const { data: statusAfterMove } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' again purely from MOVING the marker -- position is hashed, not just presence", statusAfterMove === "stale", statusAfterMove);

    // Renew, then change the TYPE alone ("Change type" in the proposal) --
    // proves injury_type_id itself is hashed, not just position.
    const { error: preTypeChangeRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the marker was moved.",
    });
    record("Renewal after the marker move succeeds", !preTypeChangeRenewErr, preTypeChangeRenewErr?.message);
    const { error: typeChangeErr } = await teacherA
      .from("incident_body_marks")
      .update({ injury_type_id: rednessType.id })
      .eq("id", markRow.id);
    record("Owning teacher can change a marker's injury type pre-signoff", !typeChangeErr, typeChangeErr?.message);
    const { data: statusAfterTypeChange } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("Status flips to 'stale' purely from changing a marker's injury type", statusAfterTypeChange === "stale", statusAfterTypeChange);

    // Final renewal so teacherB is clean going into CHECK 7's sign-off.
    const { error: finalRenewErr } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: teacherBStaffId,
      p_addendum: "Re-confirming after the marker's type was corrected.",
    });
    record("Final renewal (after the marker's type change) succeeds", !finalRenewErr, finalRenewErr?.message);
    const { data: statusFinal } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: teacherBStaffId });
    record("teacherB is 'current' again going into sign-off", statusFinal === "current", statusFinal);

    const { data: snaStatusStillMissing } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("SNA's status is STILL 'not_attested' -- untouched by any of the above, exactly as it should be", snaStatusStillMissing === "not_attested", snaStatusStillMissing);
  }

  console.log(`\n== CHECK 7: immutability after teacher sign-off ==`);
  {
    const { data: snaStatusRightBeforeSignoff } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: snaStaffId });
    record("Right before sign-off, SNA is still 'not_attested' (a real, named, never-attested staff member)", snaStatusRightBeforeSignoff === "not_attested", snaStatusRightBeforeSignoff);

    const { error: signErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", incidentId);
    record(
      "Sign-off succeeds DESPITE SNA never having attested -- a missing attestation does not block (the corrected behaviour); only 'stale'/'withdrawn' do, per CHECK D",
      !signErr,
      signErr?.message
    );

    await teacherA.from("incidents").update({ narrative: "Tampered narrative" }).eq("id", incidentId);
    const { data: afterTamperAttempt } = await admin.from("incidents").select("narrative").eq("id", incidentId).single();
    record("Post-signoff edit by the SAME teacher who signed did NOT persist", afterTamperAttempt.narrative === REVISED_NARRATIVE, `narrative now: ${afterTamperAttempt.narrative}`);

    // -- Attestations are frozen post-signoff too, same as everything else. --
    const { error: postSignoffAttestErr } = await teacherB.rpc("attest_to_incident", { p_incident_staff_id: teacherBStaffId, p_addendum: "Trying to attest after signoff." });
    record("attest_to_incident() REJECTS a post-signoff attempt -- attestations freeze along with the rest of the record", Boolean(postSignoffAttestErr), postSignoffAttestErr?.message);
    const { error: postSignoffWithdrawErr } = await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: teacherBStaffId, p_reason: "Trying to withdraw after signoff." });
    record("withdraw_attestation() REJECTS a post-signoff attempt too", Boolean(postSignoffWithdrawErr), postSignoffWithdrawErr?.message);

    // -- Countersign authority now goes through can_countersign_incident() --
    // (migration 0073), not an inlined principal-role check -- confirm
    // the function itself agrees with what the policy allows/rejects,
    // and that a non-principal (the owning teacher, who has every OTHER
    // authority on this incident) still cannot countersign.
    const { data: canPrincipalCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: principalId, p_institution_id: institutionId });
    record("can_countersign_incident() returns true for the real principal", canPrincipalCountersign === true, canPrincipalCountersign);
    const { data: canTeacherCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherAId, p_institution_id: institutionId });
    record("can_countersign_incident() returns false for the owning teacher (not a principal)", canTeacherCountersign === false, canTeacherCountersign);

    const { error: teacherCountersignErr } = await teacherA
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentId);
    const { data: stillUncountersigned } = await admin.from("incidents").select("countersigned_at").eq("id", incidentId).single();
    record("Owning teacher CANNOT countersign despite every other authority on the incident", stillUncountersigned.countersigned_at === null, `err=${teacherCountersignErr?.message}, countersigned_at=${stillUncountersigned.countersigned_at}`);

    // countersigned_role_at_time must match the caller's REAL institution_staff.role
    // (verified server-side by the policy's own WITH CHECK) -- a mismatched claim
    // should be rejected even though the caller genuinely can countersign.
    const { error: mismatchedRoleErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: principalId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentId);
    const { data: stillUncountersignedAfterMismatch } = await admin.from("incidents").select("countersigned_at").eq("id", incidentId).single();
    record(
      "Principal's countersign REJECTED if countersigned_role_at_time doesn't match their real role",
      stillUncountersignedAfterMismatch.countersigned_at === null,
      `err=${mismatchedRoleErr?.message}, countersigned_at=${stillUncountersignedAfterMismatch.countersigned_at}`
    );

    const { error: cleanCountersign } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: principalId, countersigned_role_at_time: "principal" })
      .eq("id", incidentId);
    record("Principal countersign with the correct role recorded succeeds", !cleanCountersign, cleanCountersign?.message);

    const { data: afterCountersign } = await admin.from("incidents").select("narrative, status").eq("id", incidentId).single();
    record("narrative/status unchanged by the countersign write", afterCountersign.narrative === REVISED_NARRATIVE && afterCountersign.status === "awaiting_attestation", JSON.stringify(afterCountersign));
  }

  console.log(`\n== CHECK I: debrief sign-off gate (migration 0077) -- own incidents, self-contained ==`);
  {
    // -- (a) debrief_required = true, no debrief at all -- sign-off is --
    // rejected outright. p_staff: [] so there's nothing for the
    // attestation gate to have an opinion about -- this incident is
    // testing the debrief gate alone.
    const { data: reqIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ debrief_required: true }).eq("id", reqIncidentId);

    const { error: signNoDebriefErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    const { data: stillUnsignedNoDebrief } = await admin.from("incidents").select("teacher_signed_at").eq("id", reqIncidentId).single();
    record(
      "Sign-off REJECTED when debrief_required is true and no debrief exists at all",
      stillUnsignedNoDebrief.teacher_signed_at === null,
      `err=${signNoDebriefErr?.message}, teacher_signed_at=${stillUnsignedNoDebrief.teacher_signed_at}`
    );

    // -- (b) the owning TEACHER, not the principal, not another teacher --
    // -- completes the debrief. Both non-owning attempts rejected by
    // incident_debriefs' own RLS before the gate is even relevant.
    const { error: principalDebriefErr } = await principal
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01" });
    record("Principal CANNOT record the debrief (owning teacher only)", Boolean(principalDebriefErr), principalDebriefErr?.message);

    const { error: teacherBDebriefErr } = await teacherB
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01" });
    record("A different teacher (not the owner) CANNOT record the debrief either", Boolean(teacherBDebriefErr), teacherBDebriefErr?.message);

    // -- (c) a debrief row exists but isn't completed -- still rejected. --
    const { data: debriefRow, error: debriefInsertErr } = await teacherA
      .from("incident_debriefs")
      .insert({ incident_id: reqIncidentId, debrief_date: "2026-01-01", staff_present: ["Teacher A Owning"], notes: "Discussed with the team." })
      .select()
      .single();
    record("Owning teacher CAN record the debrief", !debriefInsertErr, debriefInsertErr?.message);

    const { error: signIncompleteErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    const { data: stillUnsignedIncomplete } = await admin.from("incidents").select("teacher_signed_at").eq("id", reqIncidentId).single();
    record(
      "Sign-off still REJECTED -- a debrief row exists but isn't marked complete",
      stillUnsignedIncomplete.teacher_signed_at === null,
      `err=${signIncompleteErr?.message}, teacher_signed_at=${stillUnsignedIncomplete.teacher_signed_at}`
    );

    // -- (d) mark complete -- sign-off now succeeds. --
    const { error: completeErr } = await teacherA
      .from("incident_debriefs")
      .update({ completed_at: new Date().toISOString(), completed_by: teacherAId })
      .eq("id", debriefRow.id);
    record("Owning teacher can mark the debrief complete", !completeErr, completeErr?.message);

    const { error: signCompleteErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", reqIncidentId);
    record("Sign-off SUCCEEDS once the debrief is marked complete", !signCompleteErr, signCompleteErr?.message);

    await admin.from("incidents").delete().eq("id", reqIncidentId);

    // -- (e) debrief_required = false -- proceeds without one, full stop. --
    const { data: notReqIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: notReqRow } = await admin.from("incidents").select("debrief_required").eq("id", notReqIncidentId).single();
    record("debrief_required defaults to false", notReqRow.debrief_required === false, notReqRow.debrief_required);

    const { error: signNotRequiredErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", notReqIncidentId);
    record("Sign-off SUCCEEDS with no debrief at all when debrief_required is false", !signNotRequiredErr, signNotRequiredErr?.message);

    await admin.from("incidents").delete().eq("id", notReqIncidentId);
  }

  console.log(`\n== CHECK J: institution_permissions -- countersign as a grant (migration 0078), own institution, self-contained ==`);
  {
    const jCode = "PERMVERIFY" + Math.floor(Math.random() * 10000);
    const { data: instJ, error: instJErr } = await admin
      .from("institutions")
      .insert({ name: "Permissions Verify Test School", institution_code: jCode, status: "verified" })
      .select()
      .single();
    if (instJErr) throw instJErr;
    const institutionJId = instJ.id;

    const principalJId = await createUser("permverify.principal@thebehaviourhive.com", "Principal J", "principal");
    const teacherDPId = await createUser("permverify.teacherdp@thebehaviourhive.com", "Teacher DP", "class_teacher");
    const teacherOrdId = await createUser("permverify.teacherord@thebehaviourhive.com", "Teacher Ordinary", "class_teacher");
    const parentJId = await createUser("permverify.parent@thebehaviourhive.com", "Parent J", "parent");

    const { error: jStaffErr } = await admin.from("institution_staff").insert([
      { institution_id: institutionJId, user_id: principalJId, role: "principal" },
      { institution_id: institutionJId, user_id: teacherDPId, role: "class_teacher" },
      { institution_id: institutionJId, user_id: teacherOrdId, role: "class_teacher" },
    ]);
    if (jStaffErr) throw jStaffErr;

    const { data: childJ } = await admin
      .from("passports")
      .insert({ user_id: parentJId, child_name: "Perm Verify Child", passport_status: "complete" })
      .select()
      .single();
    await admin.from("passport_institution_links").insert({ passport_id: childJ.id, institution_id: institutionJId, approved_by_parent: true });

    const { data: locJ } = await admin.from("incident_locations").insert({ institution_id: institutionJId, value: "J Test Room" }).select().single();

    const principalJ = await signedInClient("permverify.principal@thebehaviourhive.com");
    const teacherDP = await signedInClient("permverify.teacherdp@thebehaviourhive.com");
    const teacherOrd = await signedInClient("permverify.teacherord@thebehaviourhive.com");

    // -- (a) principal grants countersign_incident to teacherDP. --
    const { data: grantRow, error: grantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: teacherDPId, permission: "countersign_incident", granted_by: principalJId })
      .select()
      .single();
    record("Principal CAN grant countersign_incident to a real teacher", !grantErr, grantErr?.message);

    const { data: canDPCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherDPId, p_institution_id: institutionJId });
    record("can_countersign_incident() returns true for the granted DP", canDPCountersign === true, canDPCountersign);
    const { data: canOrdCountersign } = await admin.rpc("can_countersign_incident", { p_user_id: teacherOrdId, p_institution_id: institutionJId });
    record("can_countersign_incident() returns false for an ungranted, ordinary teacher", canOrdCountersign === false, canOrdCountersign);

    // -- (b) grant attempted on a non-staff user (a parent) -- REJECTED --
    // by the grantee-is-staff trigger, unconditionally, database-level.
    const { error: nonStaffGrantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: parentJId, permission: "countersign_incident", granted_by: principalJId });
    record("Grant to a NON-STAFF user (a parent) REJECTED by the database, not just the UI", Boolean(nonStaffGrantErr), nonStaffGrantErr?.message);

    // -- (c) principal attempting self-grant (and so, self-revoke) --
    // REJECTED -- there is no row a principal's own automatic authority
    // could ever appear as, because they can never create one for
    // themselves in the first place.
    const { error: selfGrantErr } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: principalJId, permission: "countersign_incident", granted_by: principalJId });
    record("Principal attempting to GRANT THEMSELVES the permission REJECTED -- nothing exists for a self-revoke to act on", Boolean(selfGrantErr), selfGrantErr?.message);

    // -- (d) incident A: owning teacher (ungranted) cannot self-countersign; --
    // the granted DP, a completely different person, CAN countersign it.
    const { data: incidentAId } = await teacherOrd.rpc("create_incident_stamp", {
      p_institution_id: institutionJId, p_occurred_at: new Date().toISOString(), p_location_id: locJ.id,
      p_child_passport_ids: [childJ.id], p_staff: [],
    });
    await teacherOrd.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherOrdId }).eq("id", incidentAId);

    // RLS on UPDATE silently filters, it doesn't error -- a blocked write
    // returns { error: null } with zero rows touched, not a thrown
    // error. Re-query via admin, don't trust the client-visible error.
    const { error: ordCountersignErr } = await teacherOrd
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherOrdId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentAId);
    const { data: incidentAAfterOrdAttempt } = await admin.from("incidents").select("countersigned_at").eq("id", incidentAId).single();
    record(
      "Ungranted owning teacher CANNOT countersign their own incident",
      incidentAAfterOrdAttempt.countersigned_at === null,
      `err=${ordCountersignErr?.message}, countersigned_at=${incidentAAfterOrdAttempt.countersigned_at}`
    );

    const { error: dpCountersignErr } = await teacherDP
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherDPId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentAId);
    const { data: incidentAAfter } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time").eq("id", incidentAId).single();
    record(
      "Granted DP CAN countersign someone else's incident, recorded with their REAL role (class_teacher, not principal)",
      !dpCountersignErr && incidentAAfter.countersigned_by === teacherDPId && incidentAAfter.countersigned_role_at_time === "class_teacher",
      `err=${dpCountersignErr?.message}, ${JSON.stringify(incidentAAfter)}`
    );

    // -- (e) immutable grant record -- the principal cannot rewrite WHO --
    // the existing grant belongs to, only revoke it.
    const { error: rewriteErr } = await principalJ
      .from("institution_permissions")
      .update({ user_id: teacherOrdId })
      .eq("id", grantRow.id);
    record("Principal CANNOT rewrite an existing grant's user_id -- only revoked_at/revoked_by may ever change", Boolean(rewriteErr), rewriteErr?.message);

    // -- (f) revoke the DP's grant, then confirm the EARLIER countersign --
    // (incident A, signed while the grant was active) is UNTOUCHED --
    // revocation is not retroactive.
    const { error: revokeErr } = await principalJ
      .from("institution_permissions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: principalJId })
      .eq("id", grantRow.id);
    record("Principal CAN revoke the DP's grant", !revokeErr, revokeErr?.message);

    const { data: canDPCountersignAfterRevoke } = await admin.rpc("can_countersign_incident", { p_user_id: teacherDPId, p_institution_id: institutionJId });
    record("can_countersign_incident() now returns false for the revoked DP", canDPCountersignAfterRevoke === false, canDPCountersignAfterRevoke);

    const { data: incidentAStillAfterRevoke } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time").eq("id", incidentAId).single();
    record(
      "Incident A's countersign is UNCHANGED after the DP's grant was revoked -- revocation is not retroactive",
      incidentAStillAfterRevoke.countersigned_by === teacherDPId
        && incidentAStillAfterRevoke.countersigned_at === incidentAAfter.countersigned_at
        && incidentAStillAfterRevoke.countersigned_role_at_time === "class_teacher",
      JSON.stringify(incidentAStillAfterRevoke)
    );

    // -- (g) incident B: the now-revoked DP attempts to countersign a --
    // FRESH incident -- REJECTED.
    const { data: incidentBId } = await teacherOrd.rpc("create_incident_stamp", {
      p_institution_id: institutionJId, p_occurred_at: new Date().toISOString(), p_location_id: locJ.id,
      p_child_passport_ids: [childJ.id], p_staff: [],
    });
    await teacherOrd.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherOrdId }).eq("id", incidentBId);

    const { error: revokedDpCountersignErr } = await teacherDP
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherDPId, countersigned_role_at_time: "class_teacher" })
      .eq("id", incidentBId);
    const { data: incidentBAfter } = await admin.from("incidents").select("countersigned_at").eq("id", incidentBId).single();
    record(
      "Revoked DP CANNOT countersign a fresh incident",
      incidentBAfter.countersigned_at === null,
      `err=${revokedDpCountersignErr?.message}, countersigned_at=${incidentBAfter.countersigned_at}`
    );

    // -- (h) last-holder guard, as a real backstop, not just an RLS --
    // convenience -- an authenticated principal can never actually
    // trigger this (revoking always leaves at least themselves, since
    // the revoke policy itself requires an active principal to call it).
    // The real exposure is a service-role/admin path that bypasses RLS
    // entirely -- grant teacherOrd the permission, then remove
    // principalJ's OWN principal role via service role (simulating the
    // principal leaving without a role change going through this
    // migration), leaving teacherOrd's grant as the ONLY countersign
    // authority left at this institution -- then attempt to revoke it,
    // via service role, bypassing RLS's own principal-only gate entirely.
    // The trigger must still refuse, because it runs on every write
    // regardless of how RLS was satisfied or bypassed.
    const { data: secondGrant } = await principalJ
      .from("institution_permissions")
      .insert({ institution_id: institutionJId, user_id: teacherOrdId, permission: "countersign_incident", granted_by: principalJId })
      .select()
      .single();

    await admin.from("institution_staff").update({ role: "class_teacher" }).eq("institution_id", institutionJId).eq("user_id", principalJId);
    const { data: canAnyoneCountersignNow } = await admin.rpc("can_countersign_incident", { p_user_id: principalJId, p_institution_id: institutionJId });
    record("Setup for (h): former principal (now demoted) no longer counts as countersign authority", canAnyoneCountersignNow === false, canAnyoneCountersignNow);

    const { error: lastHolderRevokeErr } = await admin
      .from("institution_permissions")
      .update({ revoked_at: new Date().toISOString(), revoked_by: teacherOrdId })
      .eq("id", secondGrant.id);
    record(
      "Last-holder guard REJECTS revoking the only remaining countersign authority at an institution, even via service role bypassing RLS entirely",
      Boolean(lastHolderRevokeErr),
      lastHolderRevokeErr?.message
    );
    const { data: secondGrantAfter } = await admin.from("institution_permissions").select("revoked_at").eq("id", secondGrant.id).single();
    record("That grant's revoked_at is still null -- the rejected revoke did not partially apply", secondGrantAfter.revoked_at === null, secondGrantAfter.revoked_at);

    await admin.from("institutions").delete().eq("id", institutionJId);
    for (const id of [principalJId, teacherDPId, teacherOrdId, parentJId]) {
      await admin.auth.admin.deleteUser(id);
    }
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

    // Filtered to notice_type -- CHECK D already raised one
    // attestation_withdrawn notice for this same incident, so a bare
    // count here would over-count; each notice_type is independently
    // exactly-one for its own trigger.
    const { data: notices } = await admin.from("school_notices").select("*").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Exactly one incident_parent_call notice raised", (notices?.length ?? 0) === 1, `rows=${notices?.length}`);

    const { data: byPrincipalNotice } = await principal.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice visible to principal", (byPrincipalNotice?.length ?? 0) === 1, `rows=${byPrincipalNotice?.length}`);
    const { data: byOwnerNotice } = await teacherA.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice visible to owning teacher", (byOwnerNotice?.length ?? 0) === 1, `rows=${byOwnerNotice?.length}`);
    const { data: byParentNotice } = await parent1.from("school_notices").select("id").eq("incident_id", incidentId).eq("notice_type", "incident_parent_call");
    record("Notice INVISIBLE to parent", (byParentNotice?.length ?? 0) === 0, `rows=${byParentNotice?.length}`);
  }

  console.log(`\n== CHECK H: parent RPC excludes staff injury records entirely (asked three times -- live proof, not a re-quote of the SQL) ==`);
  {
    const { data: staffInjury, error: staffInjuryErr } = await admin
      .from("incident_injuries")
      .insert({ incident_id: incidentId, injured_party_type: "staff", free_text_name: "SNA Test (injured)" })
      .select()
      .single();
    record("Fixture: a staff injury record exists on this same incident", !staffInjuryErr, staffInjuryErr?.message);

    const { data: p1Rows } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1 });
    const row = p1Rows?.[0];
    const injuriesJson = JSON.stringify(row?.injuries ?? []);
    record(
      "Parent's own get_parent_incidents() injuries array does NOT contain the staff injury's name anywhere in it",
      !injuriesJson.includes("SNA Test (injured)"),
      injuriesJson
    );
    record(
      "Parent's injuries array STILL contains their own child's student injury (exclusion isn't just blanket-empty)",
      (row?.injuries?.length ?? 0) >= 1,
      injuriesJson
    );

    const { data: directStaffInjury } = await parent1.from("incident_injuries").select("*").eq("id", staffInjury.id);
    record(
      "Parent direct .select() on the staff injury row returns nothing (no policy grants it, defence in depth)",
      (directStaffInjury?.length ?? 0) === 0,
      `rows=${directStaffInjury?.length}`
    );
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

  // biteType/restraintAction/nonRestraintAction/headRegion were all
  // fetched up in Setup, alongside loc/bruisingType/rednessType --
  // CHECK D above needs them too now that region_id/side are NOT NULL.

  console.log(`\n== CHECK K: Part 2 schema (migration 0080) -- party array, body regions, linked people ==`);
  {
    // -- (a) party: non-empty array required, allowed-values set enforced. --
    const { data: p3 } = await admin.from("passports").insert({ user_id: parent3Id, child_name: "Verify Child K", passport_status: "complete" }).select().single();
    const { data: kIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { error: partyEmptyErr } = await teacherA.from("incidents").update({ party: [] }).eq("id", kIncidentId);
    record("party = [] (empty array) REJECTED -- required field, not silently satisfied by an empty selection", Boolean(partyEmptyErr), partyEmptyErr?.message);

    const { error: partyBogusErr } = await teacherA.from("incidents").update({ party: ["bystander"] }).eq("id", kIncidentId);
    record("party containing a value outside the allowed set REJECTED", Boolean(partyBogusErr), partyBogusErr?.message);

    const { error: partyGoodErr } = await teacherA.from("incidents").update({ party: ["self", "other"], party_other: "Playground supervisor" }).eq("id", kIncidentId);
    const { data: partyAfter } = await admin.from("incidents").select("party, party_other").eq("id", kIncidentId).single();
    record(
      "party as a genuine multi-select, with 'other' + party_other, persists correctly",
      !partyGoodErr && JSON.stringify(partyAfter.party) === JSON.stringify(["self", "other"]) && partyAfter.party_other === "Playground supervisor",
      `err=${partyGoodErr?.message}, ${JSON.stringify(partyAfter)}`
    );

    // -- (b) incident_body_marks: region_id/side are NOT NULL, region_id is a real FK. --
    const { data: kInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();

    const { error: noRegionErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, side: "centre" });
    record("A body mark with NO region_id is REJECTED (not null constraint)", Boolean(noRegionErr), noRegionErr?.message);

    const { error: bogusRegionErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: "00000000-0000-0000-0000-000000000000", side: "centre" });
    record("A body mark with a region_id NOT in the vocabulary is REJECTED (foreign key)", Boolean(bogusRegionErr), bogusRegionErr?.message);

    const { error: bogusSideErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "diagonal" });
    record("A body mark with a side outside left/right/centre is REJECTED (check constraint)", Boolean(bogusSideErr), bogusSideErr?.message);

    const { error: goodMarkErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: kInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" });
    record("A body mark with region_id + side both valid succeeds", !goodMarkErr, goodMarkErr?.message);

    const { data: regionSeed } = await admin.from("incident_body_regions").select("value").is("institution_id", null);
    const expectedRegions = ["head", "chest", "stomach", "upper_arm", "lower_arm", "hand", "upper_back", "lower_back", "upper_leg", "lower_leg"].sort();
    record(
      "Global incident_body_regions seed is EXACTLY the ten regions.json slugs -- no more, no fewer",
      JSON.stringify((regionSeed ?? []).map((r) => r.value).sort()) === JSON.stringify(expectedRegions),
      JSON.stringify(regionSeed?.map((r) => r.value))
    );

    // -- (c) injured party must be named on THIS incident. --
    const { error: unnamedChildErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "student", passport_id: p3.id });
    record("Injured party's passport_id NOT among this incident's children is REJECTED", Boolean(unnamedChildErr), unnamedChildErr?.message);

    const { error: unnamedStaffErr } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: kIncidentId, injured_party_type: "staff", staff_user_id: snaId });
    record("Injured party's staff_user_id NOT among this incident's staff is REJECTED (SNA never named on this incident)", Boolean(unnamedStaffErr), unnamedStaffErr?.message);

    // -- (d) CPI staff links: real accounts only, same incident only. --
    const { data: kFreeTextStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kIncidentId, free_text_name: "Cover Supervisor No Account", involvement: "witnessed" })
      .select()
      .single();
    const { data: kRealStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kIncidentId, user_id: teacherBId, involvement: "witnessed" })
      .select()
      .single();
    const { data: kRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: kIncidentId, passport_id: child1, planning_status: "not_planned" })
      .select()
      .single();

    const { error: freeTextLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kFreeTextStaff.id });
    record("Linking a free-text-only (no-account) staff entry to a restrictive practice record is REJECTED", Boolean(freeTextLinkErr), freeTextLinkErr?.message);

    // A genuinely separate, still-open incident -- not the main
    // incidentId, which is already signed+countersigned by this point
    // and would reject the staff insert outright, never actually
    // exercising the cross-incident mismatch this is meant to test.
    const { data: kOtherIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: otherIncidentStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: kOtherIncidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    const { error: crossIncidentLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: otherIncidentStaff.id });
    record("Linking a staff row named on a DIFFERENT incident is REJECTED (incident mismatch, real session not a bypass)", Boolean(crossIncidentLinkErr), crossIncidentLinkErr?.message);
    await admin.from("incidents").delete().eq("id", kOtherIncidentId);

    const { error: realLinkErr } = await teacherA
      .from("restrictive_practice_staff")
      .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kRealStaff.id });
    record("Linking a real-account staff member named on the SAME incident succeeds", !realLinkErr, realLinkErr?.message);

    const { data: linkVisibleToPrincipal } = await principal.from("restrictive_practice_staff").select("id").eq("restrictive_practice_id", kRp.id);
    record("The link is visible to the principal (follows the parent incident's own visibility)", (linkVisibleToPrincipal?.length ?? 0) >= 1, `rows=${linkVisibleToPrincipal?.length}`);
    const { data: linkVisibleToParent } = await parent1.from("restrictive_practice_staff").select("id").eq("restrictive_practice_id", kRp.id);
    record("The link is INVISIBLE to an unrelated parent", (linkVisibleToParent?.length ?? 0) === 0, `rows=${linkVisibleToParent?.length}`);

    // -- (e) after sign-off, linking/unlinking is rejected by RLS's own gate. --
    // A restrictive_practices record now exists (kRp) with no restraint
    // action ticked -- would trip 0083's own CPI-consistency gate first
    // and never reach a genuine post-signoff state, so tick one here
    // purely to let sign-off through; 0083 itself is covered on its own
    // terms in CHECK N below.
    await teacherA.from("incident_actions").insert({ incident_id: kIncidentId, action_type_id: restraintAction.id });
    await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", kIncidentId);
    const { data: kSignedCheck } = await admin.from("incidents").select("teacher_signed_at").eq("id", kIncidentId).single();
    if (kSignedCheck.teacher_signed_at) {
      const { error: postSignLinkErr } = await teacherA
        .from("restrictive_practice_staff")
        .insert({ restrictive_practice_id: kRp.id, incident_staff_id: kFreeTextStaff.id });
      record("Post-signoff link attempt REJECTED (RLS's own teacher_signed_at is null gate)", Boolean(postSignLinkErr), postSignLinkErr?.message);
    } else {
      record("Post-signoff link attempt REJECTED (RLS's own teacher_signed_at is null gate)", false, "fixture did not reach sign-off -- see anyone_injured/CPI consistency, expected for this minimal fixture");
    }

    await admin.from("incidents").delete().eq("id", kIncidentId);
    await admin.from("passports").delete().eq("id", p3.id);
  }

  console.log(`\n== CHECK L: three-way Yes/No fields -- 'answered No' is not 'not recorded' (migration 0081) ==`);
  {
    const { data: lIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });

    const { data: lIncidentRow } = await admin.from("incidents").select("anyone_injured").eq("id", lIncidentId).single();
    record("incidents.anyone_injured defaults to null (not false) on a freshly-stamped incident", lIncidentRow.anyone_injured === null, lIncidentRow.anyone_injured);

    const { data: lRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: lIncidentId, passport_id: child1, planning_status: "not_planned" })
      .select()
      .single();
    record("restrictive_practices.ncse_report_complete defaults to null (not false)", lRp.ncse_report_complete === null, lRp.ncse_report_complete);

    const { data: lInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: lIncidentId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    record(
      "incident_injuries.first_aider_called / doctor_ambulance_called both default to null (not false)",
      lInjury.first_aider_called === null && lInjury.doctor_ambulance_called === null,
      JSON.stringify({ first_aider_called: lInjury.first_aider_called, doctor_ambulance_called: lInjury.doctor_ambulance_called })
    );

    await teacherA.from("incident_injuries").update({ first_aider_called: false, doctor_ambulance_called: true }).eq("id", lInjury.id);
    const { data: lInjuryAfter } = await admin.from("incident_injuries").select("first_aider_called, doctor_ambulance_called").eq("id", lInjury.id).single();
    record(
      "An explicit 'No' (false) persists distinctly from null -- not coerced back to unanswered",
      lInjuryAfter.first_aider_called === false && lInjuryAfter.doctor_ambulance_called === true,
      JSON.stringify(lInjuryAfter)
    );

    const { data: lMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: lInjury.id, view: "front", x: 0.3, y: 0.4, injury_type_id: biteType.id, region_id: headRegion.id, side: "left" })
      .select()
      .single();
    record("A fresh Bite mark's skin_broken defaults to null (not asked yet)", lMark.skin_broken === null, lMark.skin_broken);

    await teacherA.from("incident_body_marks").update({ skin_broken: false }).eq("id", lMark.id);
    const { data: lMarkAfter } = await admin.from("incident_body_marks").select("skin_broken").eq("id", lMark.id).single();
    record("skin_broken = false persists distinctly from null (skin explicitly NOT broken, not unanswered)", lMarkAfter.skin_broken === false, lMarkAfter.skin_broken);

    await admin.from("incidents").delete().eq("id", lIncidentId);
  }

  console.log(`\n== CHECK M: incident_actions UPDATE policy (migration 0082) ==`);
  {
    const { data: mIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: otherActionType } = await admin.from("incident_action_types").select("id").eq("value", "Other").is("institution_id", null).single();
    const { data: mAction } = await teacherA
      .from("incident_actions")
      .insert({ incident_id: mIncidentId, action_type_id: otherActionType.id })
      .select()
      .single();

    const { error: ownerUpdateErr } = await teacherA
      .from("incident_actions")
      .update({ other_detail: "Called a parent to collect early." })
      .eq("id", mAction.id);
    const { data: mActionAfterOwner } = await admin.from("incident_actions").select("other_detail").eq("id", mAction.id).single();
    record(
      "Owning teacher CAN update other_detail on an existing action (the bug 0082 fixed -- previously silently wrote nothing)",
      !ownerUpdateErr && mActionAfterOwner.other_detail === "Called a parent to collect early.",
      `err=${ownerUpdateErr?.message}, other_detail=${mActionAfterOwner.other_detail}`
    );

    const { error: strangerUpdateErr } = await teacherB
      .from("incident_actions")
      .update({ other_detail: "Teacher B should not be able to write this." })
      .eq("id", mAction.id);
    const { data: mActionAfterStranger } = await admin.from("incident_actions").select("other_detail").eq("id", mAction.id).single();
    record(
      "A teacher with no standing on this incident CANNOT update its action (silently, RLS-filtered -- re-queried, not trusted from the client-visible error)",
      mActionAfterStranger.other_detail === "Called a parent to collect early.",
      `err=${strangerUpdateErr?.message}, other_detail now=${mActionAfterStranger.other_detail}`
    );

    await admin.from("incidents").delete().eq("id", mIncidentId);
  }

  console.log(`\n== CHECK N: sign-off consistency gate -- all four cases, both directions where symmetric (migration 0083) ==`);
  {
    // -- N1: anyone_injured = true, zero injury records -- rejected, --
    // then fixed by adding one.
    const { data: nAId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ anyone_injured: true }).eq("id", nAId);
    const { error: nAErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nAId);
    const { data: nAAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nAId).single();
    record(
      "N1a: Sign-off REJECTED -- anyone_injured=true but zero incident_injuries rows exist",
      nAAfter1.teacher_signed_at === null,
      `err=${nAErr1?.message}, teacher_signed_at=${nAAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_injuries").insert({ incident_id: nAId, injured_party_type: "student", passport_id: child1 });
    const { error: nAErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nAId);
    const { data: nAAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nAId).single();
    record(
      "N1b: Sign-off SUCCEEDS once an injury record is added, resolving the inconsistency",
      !nAErr2 && nAAfter2.teacher_signed_at !== null,
      `err=${nAErr2?.message}, teacher_signed_at=${nAAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nAId);

    // -- N2: anyone_injured = false, but an injury record exists -- --
    // rejected, then fixed by removing it.
    const { data: nBId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ anyone_injured: false }).eq("id", nBId);
    const { data: nBInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: nBId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    const { error: nBErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nBId);
    const { data: nBAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nBId).single();
    record(
      "N2a: Sign-off REJECTED -- anyone_injured=false but an incident_injuries row still exists",
      nBAfter1.teacher_signed_at === null,
      `err=${nBErr1?.message}, teacher_signed_at=${nBAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_injuries").delete().eq("id", nBInjury.id);
    const { error: nBErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nBId);
    const { data: nBAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nBId).single();
    record(
      "N2b: Sign-off SUCCEEDS once the orphaned injury record is removed",
      !nBErr2 && nBAfter2.teacher_signed_at !== null,
      `err=${nBErr2?.message}, teacher_signed_at=${nBAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nBId);

    // -- N3: anyone_injured = null (never answered) -- passes through --
    // untouched, even with an injury row present (agreed in chat: a
    // missing answer is not forced, matching the attestation precedent).
    const { data: nCId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_injuries").insert({ incident_id: nCId, injured_party_type: "student", passport_id: child1 });
    const { data: nCRow } = await admin.from("incidents").select("anyone_injured").eq("id", nCId).single();
    record("N3 setup: anyone_injured is genuinely null on this incident (never answered)", nCRow.anyone_injured === null, nCRow.anyone_injured);
    const { error: nCErr } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nCId);
    const { data: nCAfter } = await admin.from("incidents").select("teacher_signed_at").eq("id", nCId).single();
    record(
      "N3: Sign-off SUCCEEDS with anyone_injured left null -- an unanswered gate is not forced, unlike an inconsistent one",
      !nCErr && nCAfter.teacher_signed_at !== null,
      `err=${nCErr?.message}, teacher_signed_at=${nCAfter.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nCId);

    // -- N4: skin_broken set on a mark whose type is no longer Bite -- --
    // the exact "type was changed away from Bite after skin_broken was
    // set" scenario, forced via service role since the app's own client
    // clears skin_broken on the same write that changes type -- the
    // trigger is the structural backstop for a state the UI itself tries
    // to prevent, not a UI-only guarantee.
    const { data: nDId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { data: nDInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: nDId, injured_party_type: "student", passport_id: child1 })
      .select()
      .single();
    const { data: nDMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: nDInjury.id, view: "front", x: 0.5, y: 0.2, injury_type_id: biteType.id, region_id: headRegion.id, side: "left", skin_broken: true })
      .select()
      .single();
    await admin.from("incident_body_marks").update({ injury_type_id: bruisingType.id }).eq("id", nDMark.id);
    const { data: nDMarkAfter } = await admin.from("incident_body_marks").select("injury_type_id, skin_broken").eq("id", nDMark.id).single();
    record(
      "N4 setup: mark's type is now Bruising while skin_broken is still true (bypassing the client's own clear-on-change)",
      nDMarkAfter.injury_type_id === bruisingType.id && nDMarkAfter.skin_broken === true,
      JSON.stringify(nDMarkAfter)
    );
    const { error: nDErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nDId);
    const { data: nDAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nDId).single();
    record(
      "N4a: Sign-off REJECTED -- skin_broken is recorded but the mark's type is no longer Bite",
      nDAfter1.teacher_signed_at === null,
      `err=${nDErr1?.message}, teacher_signed_at=${nDAfter1.teacher_signed_at}`
    );

    await teacherA.from("incident_body_marks").update({ skin_broken: null }).eq("id", nDMark.id);
    const { error: nDErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nDId);
    const { data: nDAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nDId).single();
    record(
      "N4b: Sign-off SUCCEEDS once skin_broken is cleared to null, matching the now-non-Bite type",
      !nDErr2 && nDAfter2.teacher_signed_at !== null,
      `err=${nDErr2?.message}, teacher_signed_at=${nDAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nDId);

    // -- N5: CPI ticked (a restraint action present), no restrictive_ --
    // practices record at all -- the fourth case, found live in
    // already-shipped Part 4 code. Rejected, then fixed by adding one.
    const { data: nEId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_actions").insert({ incident_id: nEId, action_type_id: restraintAction.id });
    const { error: nEErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nEId);
    const { data: nEAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nEId).single();
    record(
      "N5a: Sign-off REJECTED -- CPI/restraint action ticked but no restrictive_practices record exists",
      nEAfter1.teacher_signed_at === null,
      `err=${nEErr1?.message}, teacher_signed_at=${nEAfter1.teacher_signed_at}`
    );

    await teacherA.from("restrictive_practices").insert({ incident_id: nEId, passport_id: child1, planning_status: "not_planned" });
    const { error: nEErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nEId);
    const { data: nEAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nEId).single();
    record(
      "N5b: Sign-off SUCCEEDS once a restrictive_practices record is added to match the ticked action",
      !nEErr2 && nEAfter2.teacher_signed_at !== null,
      `err=${nEErr2?.message}, teacher_signed_at=${nEAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nEId);

    // -- N6: the original case -- a restrictive_practices record exists, --
    // but CPI/restraint is NOT ticked (unticked after the record was
    // saved). Rejected, then fixed by ticking it.
    const { data: nFId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("restrictive_practices").insert({ incident_id: nFId, passport_id: child1, planning_status: "not_planned" });
    const { error: nFErr1 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter1 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6a: Sign-off REJECTED -- a restrictive_practices record exists but CPI/restraint is not ticked",
      nFAfter1.teacher_signed_at === null,
      `err=${nFErr1?.message}, teacher_signed_at=${nFAfter1.teacher_signed_at}`
    );

    // A non-restraint action alone must NOT satisfy the gate -- proves
    // the check is keyed on is_restraint specifically, not "any action
    // exists".
    await teacherA.from("incident_actions").insert({ incident_id: nFId, action_type_id: nonRestraintAction.id });
    const { error: nFErr1b } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter1b } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6a-bis: A NON-restraint action present is still REJECTED -- the gate is keyed on is_restraint, not merely 'some action exists'",
      nFAfter1b.teacher_signed_at === null,
      `err=${nFErr1b?.message}, teacher_signed_at=${nFAfter1b.teacher_signed_at}`
    );

    await teacherA.from("incident_actions").insert({ incident_id: nFId, action_type_id: restraintAction.id });
    const { error: nFErr2 } = await teacherA.from("incidents").update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId }).eq("id", nFId);
    const { data: nFAfter2 } = await admin.from("incidents").select("teacher_signed_at").eq("id", nFId).single();
    record(
      "N6b: Sign-off SUCCEEDS once the restraint action is ticked to match the existing record",
      !nFErr2 && nFAfter2.teacher_signed_at !== null,
      `err=${nFErr2?.message}, teacher_signed_at=${nFAfter2.teacher_signed_at}`
    );
    await admin.from("incidents").delete().eq("id", nFId);
  }

  console.log(`\n== CHECK O: Phase 4 piece 1 -- sign_off_incident() RPC, get_incident_signoff_summary(), teacher_signed_by guard (migrations 0085/0086) ==`);
  {
    // -- O1: teacher_signed_by spoofing REJECTED (the bug 0086 fixed). --
    const { data: oSpoofId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: spoofErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherBId })
      .eq("id", oSpoofId);
    const { data: afterSpoof } = await admin.from("incidents").select("teacher_signed_at, teacher_signed_by").eq("id", oSpoofId).single();
    record(
      "O1: teacher_signed_by spoofed to someone other than the caller is REJECTED, and does not persist",
      afterSpoof.teacher_signed_at === null && afterSpoof.teacher_signed_by === null,
      `err=${spoofErr?.message}, ${JSON.stringify(afterSpoof)}`
    );

    // -- O1b: correct self-attribution via raw update still works (the --
    // guard is scoped to a MISMATCH, not to touching the column at all).
    const { error: selfAttribErr } = await teacherA
      .from("incidents")
      .update({ teacher_signed_at: new Date().toISOString(), teacher_signed_by: teacherAId })
      .eq("id", oSpoofId);
    const { data: afterSelfAttrib } = await admin.from("incidents").select("teacher_signed_at, teacher_signed_by").eq("id", oSpoofId).single();
    record(
      "O1b: correct self-attribution (teacher_signed_by = caller) still succeeds via raw update",
      !selfAttribErr && afterSelfAttrib.teacher_signed_by === teacherAId,
      `err=${selfAttribErr?.message}, ${JSON.stringify(afterSelfAttrib)}`
    );
    await admin.from("incidents").delete().eq("id", oSpoofId);

    // -- O2: sign_off_incident() RPC -- clean, distinct error paths. --
    const { error: notFoundErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: "00000000-0000-0000-0000-000000000000" });
    record("O2a: sign_off_incident() on a nonexistent id gives a clean 'not found' error", Boolean(notFoundErr) && /not found|permission/i.test(notFoundErr?.message ?? ""), notFoundErr?.message);

    const { data: oCleanId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: notOwnerErr } = await teacherB.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2b: sign_off_incident() called by someone who can VIEW but isn't creator/owning teacher gives a distinct 'not permitted' error",
      Boolean(notOwnerErr) && /permission|creator|owning/i.test(notOwnerErr?.message ?? ""),
      notOwnerErr?.message
    );

    const { data: oSignResult, error: oSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2c: sign_off_incident() succeeds for the real creator/owning teacher, teacher_signed_by correctly self-attributed",
      !oSignErr && oSignResult?.teacher_signed_by === teacherAId && oSignResult?.teacher_signed_at != null,
      `err=${oSignErr?.message}, ${JSON.stringify(oSignResult)}`
    );

    const { error: alreadySignedErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCleanId });
    record(
      "O2d: sign_off_incident() called again on an already-signed incident gives a distinct 'already signed off' error",
      Boolean(alreadySignedErr) && /already/i.test(alreadySignedErr?.message ?? ""),
      alreadySignedErr?.message
    );

    // -- O3: the three shared-function-backed gates still block via the RPC --
    // (not just via raw .update(), which CHECK N already covers) -- one
    // pass each confirms the trigger rewrites are correctly wired.
    const { data: oDebriefId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ debrief_required: true }).eq("id", oDebriefId);
    const { error: oDebriefErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oDebriefId });
    record("O3a: debrief gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oDebriefErr) && /debrief/i.test(oDebriefErr?.message ?? ""), oDebriefErr?.message);
    await admin.from("incidents").delete().eq("id", oDebriefId);

    const { data: oAttestId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: oAttestStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", oAttestId).eq("user_id", teacherBId).single();
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: oAttestStaffRow.id, p_addendum: "Confirmed." });
    await teacherA.from("incidents").update({ narrative: "Edited after attestation." }).eq("id", oAttestId);
    const { error: oAttestErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oAttestId });
    record("O3b: attestation staleness gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oAttestErr) && /stale|attestation/i.test(oAttestErr?.message ?? ""), oAttestErr?.message);
    await admin.from("incidents").delete().eq("id", oAttestId);

    const { data: oCpiId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incident_actions").insert({ incident_id: oCpiId, action_type_id: restraintAction.id });
    const { error: oCpiErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCpiId });
    record("O3c: CPI-consistency gate still blocks sign_off_incident() (via the refactored trigger)", Boolean(oCpiErr) && /restrictive practice/i.test(oCpiErr?.message ?? ""), oCpiErr?.message);

    // -- O4: get_incident_signoff_summary() -- content correctness. --
    const { data: oSummary1, error: oSummary1Err } = await teacherA.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    record("O4a: get_incident_signoff_summary() callable, no longer 'permission denied for table users'", !oSummary1Err, oSummary1Err?.message);
    record(
      "O4b: summary correctly reports can_sign_off = false with the matching blocking issue when CPI is ticked but no RP record exists",
      oSummary1?.can_sign_off === false && oSummary1?.blocking_issues?.some((i) => i.code === "cpi_ticked_no_record"),
      JSON.stringify(oSummary1)
    );
    record(
      "O4c: unanswered anyone_injured reported as {value: null, note: 'not recorded'}, NOT in blocking_issues",
      oSummary1?.anyone_injured?.value === null && oSummary1?.anyone_injured?.note === "not recorded" && !oSummary1?.blocking_issues?.some((i) => i.code?.startsWith("anyone_injured")),
      JSON.stringify(oSummary1?.anyone_injured)
    );

    await teacherA.from("restrictive_practices").insert({ incident_id: oCpiId, passport_id: child1, planning_status: "not_planned" });
    const { data: oFreeTextStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: oCpiId, free_text_name: "Cover Supervisor No Account", involvement: "witnessed" })
      .select()
      .single();
    const { data: oRealStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: oCpiId, user_id: teacherBId, involvement: "witnessed" })
      .select()
      .single();
    const { data: oSummary2 } = await teacherA.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    const oFreeTextEntry = oSummary2?.staff_attestations?.find((s) => s.incident_staff_id === oFreeTextStaff.id);
    const oRealEntry = oSummary2?.staff_attestations?.find((s) => s.incident_staff_id === oRealStaff.id);
    record(
      "O4d: free-text (no-account) staff labelled 'Not attested -- no account', never blocking",
      oFreeTextEntry?.status_label === "Not attested -- no account" && oFreeTextEntry?.has_account === false && oFreeTextEntry?.blocks_signoff === false,
      JSON.stringify(oFreeTextEntry)
    );
    record(
      "O4e: real-account staff who hasn't attested yet labelled 'Not attested', never blocking",
      oRealEntry?.status_label === "Not attested" && oRealEntry?.has_account === true && oRealEntry?.blocks_signoff === false,
      JSON.stringify(oRealEntry)
    );
    record("O4f: can_sign_off now true once the CPI/RP mismatch is resolved (RP record added)", oSummary2?.can_sign_off === true, JSON.stringify(oSummary2?.blocking_issues));

    // -- O4g: restricted to creator/owning teacher -- a principal who can --
    // VIEW the incident (but isn't its creator/owning teacher) is refused.
    const { error: oSummaryPrincipalErr } = await principal.rpc("get_incident_signoff_summary", { p_incident_id: oCpiId });
    record("O4g: get_incident_signoff_summary() refused to a principal (view access, not creator/owning teacher)", Boolean(oSummaryPrincipalErr), oSummaryPrincipalErr?.message);

    // -- O5: the drift-proof check -- summary.can_sign_off must agree with --
    // what sign_off_incident() actually does, on the SAME incident, in the
    // SAME state. Now genuinely guaranteed by sharing incident_signoff_
    // issues(), not just hoped for -- this exercises that the WIRING (not
    // just the shared function itself) is correct on both paths.
    const { data: oSignAfterFix, error: oSignAfterFixErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: oCpiId });
    record(
      "O5: summary said can_sign_off=true, and sign_off_incident() agrees -- succeeds",
      oSummary2?.can_sign_off === true && !oSignAfterFixErr && oSignAfterFix?.teacher_signed_at != null,
      `summary.can_sign_off=${oSummary2?.can_sign_off}, err=${oSignAfterFixErr?.message}`
    );

    // -- O6: immutability freeze-by-exclusion, re-confirmed post-0086 -- --
    // the three previously-missed columns, plus a regression check on an
    // already-frozen one, plus the allow-list actually working.
    const { error: oAnyoneInjuredErr } = await teacherA.from("incidents").update({ anyone_injured: true }).eq("id", oCpiId);
    const { error: oLocationOtherErr } = await teacherA.from("incidents").update({ location_other: "Should not persist" }).eq("id", oCpiId);
    const { error: oPartyOtherErr } = await teacherA.from("incidents").update({ party_other: "Should not persist" }).eq("id", oCpiId);
    const { error: oNarrativeErr } = await teacherA.from("incidents").update({ narrative: "Should not persist either" }).eq("id", oCpiId);
    const { data: oFrozenAfter } = await admin.from("incidents").select("anyone_injured, location_other, party_other, narrative").eq("id", oCpiId).single();
    record(
      "O6a: post-signoff, anyone_injured/location_other/party_other (the three 0080/0081 columns 0085 caught up) all still frozen",
      oFrozenAfter.anyone_injured === null && oFrozenAfter.location_other === null && oFrozenAfter.party_other === null,
      JSON.stringify({ errs: [oAnyoneInjuredErr, oLocationOtherErr, oPartyOtherErr].map((e) => e?.message), oFrozenAfter })
    );
    record("O6b: narrative (already frozen pre-0085) still frozen -- no regression from the freeze-by-exclusion rewrite", oFrozenAfter.narrative === null, `err=${oNarrativeErr?.message}, narrative=${oFrozenAfter.narrative}`);

    // -- O7: countersign still works post-signoff -- the exact concern --
    // raised about the teacher_signed_by trigger interfering. It cannot,
    // structurally (countersign never touches teacher_signed_at, so
    // old.teacher_signed_at is null is always false for that write) --
    // proved here directly rather than left as reasoning.
    const { error: oCountersignErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: principalId, countersigned_role_at_time: "principal" })
      .eq("id", oCpiId);
    const { data: oAfterCountersign } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, updated_at").eq("id", oCpiId).single();
    record(
      "O7: countersign succeeds post-signoff, completely unaffected by the teacher_signed_by guard trigger",
      !oCountersignErr && oAfterCountersign.countersigned_at != null && oAfterCountersign.countersigned_by === principalId,
      `err=${oCountersignErr?.message}, ${JSON.stringify(oAfterCountersign)}`
    );

    await admin.from("incidents").delete().eq("id", oCleanId);
    await admin.from("incidents").delete().eq("id", oCpiId);
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
