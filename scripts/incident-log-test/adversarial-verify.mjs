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

  // status is derived (0089), not settable -- moving past 'draft' the
  // real way, the same action a teacher takes: request attestations.
  // The old version of this line (`update({ status: "awaiting_attestation" })`)
  // was the exact pattern flagged as the session's own standing violation:
  // a fixture reaching a state no production code path ever reaches on
  // its own. It happened to work only because status used to be a plain,
  // independently-settable column -- once it became derived, every check
  // below that depends on "past draft" visibility (ordinary teacher via
  // passport_access, parent, clinician) started failing for real,
  // because the old line no longer does anything (the derive trigger
  // immediately overwrites it back to 'draft', correctly).
  await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", incidentId);

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
    // -- 0093: get_parent_incidents() now gates on teacher_signed_at, --
    // not status <> 'draft' (the bug piece 4 found and fixed -- status
    // left 'draft' as soon as this session's own earlier setup requested
    // attestations, well before the point in the script where this
    // incident actually gets signed off, in CHECK 7). Both parents
    // correctly see NOTHING here now -- that's the fix working, not a
    // regression. The column-shape check (does the row leak narrative)
    // and the full post-signoff content check both need a REAL signed-
    // off row to mean anything -- that's CHECK S's own dedicated,
    // purpose-built fixture (migration 0093), not this one.
    const { data: p1Rows, error: p1Err2 } = await parent1.rpc("get_parent_incidents", { p_passport_id: child1 });
    record(
      "Parent sees ZERO rows pre-signoff, even though status left 'draft' earlier in this fixture -- the actual redaction boundary is teacher_signed_at, not status",
      (p1Rows?.length ?? 0) === 0,
      `rows=${p1Rows?.length}, err=${p1Err2?.message}`
    );

    const { data: p1Direct, error: p1DirectErr } = await parent1.from("incidents").select("*").eq("id", incidentId);
    record("Parent direct .select() on incidents returns nothing (no policy grants it)", (p1Direct?.length ?? 0) === 0, `rows=${p1Direct?.length}, err=${p1DirectErr?.message}`);

    const { data: p1Children } = await parent1.from("incident_children").select("*").eq("incident_id", incidentId);
    record("Parent direct .select() on incident_children returns nothing", (p1Children?.length ?? 0) === 0, `rows=${p1Children?.length}`);

    const { data: p2Rows } = await parent2.rpc("get_parent_incidents", { p_passport_id: child2 });
    record("Parent 2 (child B) also sees ZERO rows pre-signoff, same reason", (p2Rows?.length ?? 0) === 0, `rows=${p2Rows?.length}`);
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

    // -- 0090: countersigned_role_at_time/countersigned_via are now --
    // DERIVED by derive_countersign_fields() (a trigger), not validated
    // against a client-submitted value in the policy's own WITH CHECK --
    // the old "mismatch rejected" behaviour tested here no longer
    // applies, because there's no longer a client-submitted value to
    // mismatch against. What matters now is that the trigger is
    // authoritative even when a client submits something wrong: a
    // deliberately incorrect role, a deliberately wrong countersigned_by
    // (someone else's id), and a deliberately wrong countersigned_via
    // should all be silently overwritten with the real caller's own
    // identity and role, not trusted and not merely rejected.
    const { error: cleanCountersign } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher", countersigned_via: "grant" })
      .eq("id", incidentId);
    const { data: afterCountersign } = await admin
      .from("incidents")
      .select("narrative, status, countersigned_by, countersigned_role_at_time, countersigned_via")
      .eq("id", incidentId)
      .single();
    record(
      "Principal's countersign succeeds despite deliberately wrong countersigned_by/role/via submitted -- the trigger overwrites them with the real caller's identity and role, not the client's claim",
      !cleanCountersign
        && afterCountersign.countersigned_by === principalId
        && afterCountersign.countersigned_role_at_time === "principal"
        && afterCountersign.countersigned_via === "principal_role",
      `err=${cleanCountersign?.message}, ${JSON.stringify(afterCountersign)}`
    );
    // narrative is untouched by the countersign write (the real thing
    // this checks); status is SUPPOSED to change now (0089) -- it
    // derives to 'finalised' the moment countersigned_at is set, not
    // frozen at whatever it was before, the way it used to be when
    // nothing ever touched it at all.
    record(
      "narrative unchanged by the countersign write, status correctly derives to 'finalised'",
      afterCountersign.narrative === REVISED_NARRATIVE && afterCountersign.status === "finalised",
      JSON.stringify(afterCountersign)
    );
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
    // the existing grant belongs to, only revoke it. Smuggled into a
    // payload that ALSO sets revoked_by = auth.uid() -- an otherwise-
    // legitimate revoke, satisfying "Principal can revoke
    // institution_permissions"'s own WITH CHECK on its own terms.
    // Sending user_id ALONE (the original form of this check) doesn't
    // isolate anything: that policy's WITH CHECK (revoked_by =
    // auth.uid()) already rejects a payload that never sets revoked_by,
    // regardless of whether guard_institution_permissions_immutable_
    // grant() -- the trigger actually built to stop a user_id rewrite --
    // ever runs at all. This version proves the trigger specifically:
    // if it vanished, this write would succeed (RLS is satisfied) and
    // only the trigger stands in the way.
    const { error: rewriteErr } = await principalJ
      .from("institution_permissions")
      .update({ user_id: teacherOrdId, revoked_at: new Date().toISOString(), revoked_by: principalJId })
      .eq("id", grantRow.id);
    record("Principal CANNOT rewrite an existing grant's user_id, even smuggled into an otherwise-legitimate revoke -- only revoked_at/revoked_by may ever change", Boolean(rewriteErr), rewriteErr?.message);
    const { data: grantRowAfterRewriteAttempt } = await admin.from("institution_permissions").select("user_id, revoked_at").eq("id", grantRow.id).single();
    record(
      "...and the whole statement failed together -- the grant is neither rewritten nor accidentally revoked as a side effect",
      grantRowAfterRewriteAttempt.user_id === teacherDPId && grantRowAfterRewriteAttempt.revoked_at === null,
      JSON.stringify(grantRowAfterRewriteAttempt)
    );

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

    // -- O6: immutability freeze-by-exclusion -- the REAL test, not the --
    // false-positive one this suite ran the first time. Using teacherA
    // here (as the original version of this check did) proves nothing:
    // post-signoff, the owning teacher has NO valid RLS policy at all
    // (their edit policy requires teacher_signed_at is null), so any
    // write is rejected by RLS finding zero applicable policies -- the
    // exact same silently-passing-for-the-wrong-reason bug that let
    // 0085's freeze-by-exclusion rewrite go unnoticed as never having
    // actually landed (found and fixed in 0089's own commentary). The
    // only way to test the TRIGGER's own logic is a caller who has a
    // genuinely valid RLS path for the write and tries to smuggle a
    // frozen field in alongside it -- here, the principal, mid-countersign,
    // which is the one write RLS actually allows at this stage.
    const { error: oSneakErr } = await principal
      .from("incidents")
      .update({
        countersigned_at: new Date().toISOString(),
        countersigned_by: principalId,
        countersigned_role_at_time: "principal",
        narrative: "Sneaked in alongside a legitimate countersign write.",
      })
      .eq("id", oCpiId);
    const { data: oAfterSneak } = await admin.from("incidents").select("countersigned_at, narrative, anyone_injured, location_other, party_other").eq("id", oCpiId).single();
    record(
      "O6: a caller with a GENUINELY VALID RLS path (the principal, mid-countersign) still cannot smuggle a frozen field into the same write -- the trigger itself rejects it",
      Boolean(oSneakErr) && oAfterSneak.countersigned_at === null && oAfterSneak.narrative !== "Sneaked in alongside a legitimate countersign write.",
      JSON.stringify({ sneakErr: oSneakErr?.message, oAfterSneak })
    );
    record(
      "O6b: the whole statement failed together -- the countersign did NOT partially apply while rejecting only the narrative",
      oAfterSneak.countersigned_at === null,
      JSON.stringify(oAfterSneak)
    );

    // -- O7: a CLEAN countersign (no sneak) succeeds normally post-signoff --
    // -- the exact concern raised about the teacher_signed_by trigger
    // interfering. It cannot, structurally (countersign never touches
    // teacher_signed_at, so old.teacher_signed_at is null is always false
    // for that write) -- proved here directly rather than left as
    // reasoning.
    const { error: oCountersignErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: principalId, countersigned_role_at_time: "principal" })
      .eq("id", oCpiId);
    const { data: oAfterCountersign } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, updated_at, status").eq("id", oCpiId).single();
    record(
      "O7: countersign succeeds post-signoff, completely unaffected by the teacher_signed_by guard trigger, status derives to 'finalised'",
      !oCountersignErr && oAfterCountersign.countersigned_at != null && oAfterCountersign.countersigned_by === principalId && oAfterCountersign.status === "finalised",
      `err=${oCountersignErr?.message}, ${JSON.stringify(oAfterCountersign)}`
    );

    await admin.from("incidents").delete().eq("id", oCleanId);
    await admin.from("incidents").delete().eq("id", oCpiId);
  }

  console.log(`\n== CHECK P: Phase 4 piece 2 -- per-category staleness, get_my_incident_attestations() (migration 0088) ==`);
  {
    const sameSet = (a, b) => JSON.stringify([...(a ?? [])].sort()) === JSON.stringify([...(b ?? [])].sort());

    const { data: pIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    await teacherA.from("incidents").update({ narrative: "Baseline narrative.", anyone_injured: true }).eq("id", pIncidentId);
    await teacherA.from("incident_children").update({ distress_level: "slightly_distressed" }).eq("incident_id", pIncidentId).eq("passport_id", child1);
    await teacherA.from("incident_actions").insert({ incident_id: pIncidentId, action_type_id: restraintAction.id });
    const { data: pRp } = await teacherA
      .from("restrictive_practices")
      .insert({ incident_id: pIncidentId, passport_id: child1, planning_status: "not_planned", hold_level: "low" })
      .select()
      .single();
    const { data: pInjury } = await teacherA
      .from("incident_injuries")
      .insert({ incident_id: pIncidentId, injured_party_type: "student", passport_id: child1, injury_notes: "Baseline note." })
      .select()
      .single();
    const { data: pMark } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: pInjury.id, view: "front", x: 0.5, y: 0.1, injury_type_id: bruisingType.id, region_id: headRegion.id, side: "centre" })
      .select()
      .single();
    const { data: pStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", pIncidentId).eq("user_id", teacherBId).single();

    // Request attestations the real way -- the explicit teacher toggle
    // (0089), not a hand-set status. Without this, teacherB has no RLS
    // path to the incident at all (can_view_incident's named-staff
    // branch requires status <> 'draft' OR having already attested --
    // neither true yet), so get_my_incident_attestations() below would
    // silently return nothing, for the exact reason CHECK P caught live
    // the first time this suite was run against 0089.
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", pIncidentId);
    const { data: pStatusAfterRequest } = await admin.from("incidents").select("status").eq("id", pIncidentId).single();
    record("P0: requesting attestations derives status to 'awaiting_signoff'", pStatusAfterRequest.status === "awaiting_signoff", pStatusAfterRequest.status);

    // -- P1: baseline attest, category_hashes populated with all six keys. --
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Baseline." });
    const { data: pLatestRow } = await admin
      .from("incident_attestations")
      .select("category_hashes")
      .eq("incident_staff_id", pStaffRow.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    const pKeys = pLatestRow.category_hashes ? Object.keys(pLatestRow.category_hashes).sort() : [];
    record(
      "P1: attest_to_incident() populates category_hashes with all six categories",
      sameSet(pKeys, ["actions", "body_marks", "children", "injuries", "narrative", "restrictive_practices"]),
      JSON.stringify(pKeys)
    );

    // -- P2: freshly attested, nothing changed -- empty, not null. --
    const { data: pStale0 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P2: get_stale_categories() is an empty array immediately after attesting (current, not stale)", Array.isArray(pStale0) && pStale0.length === 0, JSON.stringify(pStale0));

    // -- P3: narrative alone. --
    await teacherA.from("incidents").update({ narrative: "Rewritten narrative." }).eq("id", pIncidentId);
    const { data: pStale1 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P3: editing ONLY the narrative reports exactly ['narrative']", sameSet(pStale1, ["narrative"]), JSON.stringify(pStale1));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after narrative correction." });

    // -- P4: actions alone. --
    const { data: pOtherActionType } = await admin.from("incident_action_types").select("id").eq("value", "Redirected").is("institution_id", null).single();
    await teacherA.from("incident_actions").insert({ incident_id: pIncidentId, action_type_id: pOtherActionType.id });
    const { data: pStale2 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P4: adding an action alone reports exactly ['actions']", sameSet(pStale2, ["actions"]), JSON.stringify(pStale2));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after an action was added." });

    // -- P5: children (distress_level) alone. --
    await teacherA.from("incident_children").update({ distress_level: "yes_definitely" }).eq("incident_id", pIncidentId).eq("passport_id", child1);
    const { data: pStale3 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P5: changing a child's distress_level alone reports exactly ['children']", sameSet(pStale3, ["children"]), JSON.stringify(pStale3));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after distress level was corrected." });

    // -- P6: restrictive_practices alone. --
    await teacherA.from("restrictive_practices").update({ hold_level: "high" }).eq("id", pRp.id);
    const { data: pStale4 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P6: editing hold_level on the saved restrictive practice record alone reports exactly ['restrictive_practices']", sameSet(pStale4, ["restrictive_practices"]), JSON.stringify(pStale4));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after hold_level was corrected." });

    // -- P7: injuries alone. --
    await teacherA.from("incident_injuries").update({ injury_notes: "Revised note." }).eq("id", pInjury.id);
    const { data: pStale5 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P7: editing injury_notes alone reports exactly ['injuries']", sameSet(pStale5, ["injuries"]), JSON.stringify(pStale5));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after the injury note was revised." });

    // -- P8: body_marks alone. --
    await teacherA.from("incident_body_marks").update({ x: 0.15, y: 0.2 }).eq("id", pMark.id);
    const { data: pStale6 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P8: moving a body-map marker alone reports exactly ['body_marks']", sameSet(pStale6, ["body_marks"]), JSON.stringify(pStale6));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after the marker was moved." });

    // -- P9: two categories at once. --
    await teacherA.from("incidents").update({ narrative: "Rewritten a second time." }).eq("id", pIncidentId);
    await teacherA.from("incident_injuries").update({ injury_notes: "Revised a second time." }).eq("id", pInjury.id);
    const { data: pStale7 } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P9: two simultaneous changes report BOTH categories, nothing more", sameSet(pStale7, ["narrative", "injuries"]), JSON.stringify(pStale7));
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming after both corrections." });

    // -- P10: not_attested -- a second, never-attested real staff member. --
    const { data: pSecondStaff } = await teacherA
      .from("incident_staff")
      .insert({ incident_id: pIncidentId, user_id: snaId, involvement: "witnessed" })
      .select()
      .single();
    const { data: pStaleNotAttested } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pSecondStaff.id });
    record("P10: get_stale_categories() is null for a staff member who has never attested", pStaleNotAttested === null, JSON.stringify(pStaleNotAttested));

    // -- P11: withdrawn. --
    await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: pStaffRow.id, p_reason: "Testing withdrawal for CHECK P." });
    const { data: pStaleWithdrawn } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P11: get_stale_categories() is null once withdrawn (nothing to compare against)", pStaleWithdrawn === null, JSON.stringify(pStaleWithdrawn));

    // -- P12: pre-migration-style row -- content_hash set, category_hashes --
    // null, simulating an attestation made before 0088. Status should still
    // read 'stale' off the untouched combined hash; the category breakdown
    // must degrade to null rather than guess.
    const { data: pRenewedAttestationId } = await teacherB.rpc("attest_to_incident", {
      p_incident_staff_id: pStaffRow.id,
      p_addendum: "Renewing after withdrawal, for the next test.",
    });
    // .update().order().limit() does NOT constrain which rows an UPDATE
    // touches (PostgREST/Postgres UPDATE has no LIMIT) -- targeting this
    // one row by the id the RPC itself just returned, not by a query
    // shape that looks scoped but isn't.
    await admin.from("incident_attestations").update({ category_hashes: null }).eq("id", pRenewedAttestationId);
    await teacherA.from("incidents").update({ narrative: "Rewritten a third time, after simulating a pre-migration attestation." }).eq("id", pIncidentId);
    const { data: pStatusPreMigration } = await teacherA.rpc("get_attestation_status", { p_incident_staff_id: pStaffRow.id });
    const { data: pStalePreMigration } = await teacherA.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record(
      "P12: a pre-0088-style attestation (no category_hashes) still correctly reads 'stale' off the untouched combined hash",
      pStatusPreMigration === "stale",
      pStatusPreMigration
    );
    record(
      "P12b: ...but get_stale_categories() degrades honestly to null rather than guessing which parts moved",
      pStalePreMigration === null,
      JSON.stringify(pStalePreMigration)
    );
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: pStaffRow.id, p_addendum: "Re-confirming, category_hashes captured fresh from here." });

    // -- P13: visibility -- a caller with no standing on this incident gets null. --
    const { data: pStaleNoStanding } = await parent1.rpc("get_stale_categories", { p_incident_staff_id: pStaffRow.id });
    record("P13: get_stale_categories() is null for a caller with no standing to view the incident", pStaleNoStanding === null, JSON.stringify(pStaleNoStanding));

    // -- P14/P15: get_my_incident_attestations(). --
    const { data: pMyList } = await teacherB.rpc("get_my_incident_attestations");
    const pMyRow = pMyList?.find((r) => r.incident_id === pIncidentId);
    record(
      "P14: get_my_incident_attestations() includes this incident for the named staff member, status 'current', not closed",
      pMyRow?.status === "current" && pMyRow?.status_label === "Current" && pMyRow?.is_closed === false,
      JSON.stringify(pMyRow)
    );

    const { data: pEmptyList } = await clinician.rpc("get_my_incident_attestations");
    record("P15: an account named on nothing gets an empty list, not an error", Array.isArray(pEmptyList) && pEmptyList.length === 0, JSON.stringify(pEmptyList));

    // -- P16: sign off, then confirm the row is still returned, now closed, --
    // frozen at whatever it was -- the point raised in chat: a staff
    // member's name is on a legal record and they should be able to look
    // it up even after it's closed, not lose access the moment it locks.
    // (pOtherActionType, "Redirected", is not a restraint action and was
    // never touched again after P4 -- nothing here needs to remove it;
    // an earlier draft of this test did, which staled teacherB's own
    // attestation again right before sign-off and blocked it for an
    // unrelated reason.)
    const { error: pSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: pIncidentId });
    record("P16 setup: this incident actually reached sign-off (consistency gates satisfied)", !pSignErr, pSignErr?.message);

    const { data: pMyListAfterSignoff } = await teacherB.rpc("get_my_incident_attestations");
    const pMyRowAfterSignoff = pMyListAfterSignoff?.find((r) => r.incident_id === pIncidentId);
    record(
      "P16: post-signoff, the incident is STILL returned (not restricted to pre-signoff), correctly marked closed",
      pMyRowAfterSignoff?.is_closed === true && pMyRowAfterSignoff?.status === "current",
      JSON.stringify(pMyRowAfterSignoff)
    );

    // SNA's row (P10, never attested, still pre-signoff at that check) is
    // now also frozen post-signoff -- confirm it shows not_attested, closed,
    // not excluded.
    const { data: pSnaListAfterSignoff } = await sna.rpc("get_my_incident_attestations");
    const pSnaRowAfterSignoff = pSnaListAfterSignoff?.find((r) => r.incident_id === pIncidentId);
    record(
      "P16b: a staff member who never attested at all is still listed post-signoff, closed, status not_attested -- not silently dropped",
      pSnaRowAfterSignoff?.is_closed === true && pSnaRowAfterSignoff?.status === "not_attested",
      JSON.stringify(pSnaRowAfterSignoff)
    );

    await admin.from("incidents").delete().eq("id", pIncidentId);
  }

  console.log(`\n== CHECK Q: status derivation, the attestations_requested toggle, visibility persistence, re-request staleness (migration 0089) ==`);
  {
    const { data: qIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: qStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", qIncidentId).eq("user_id", teacherBId).single();

    // -- Q1: fresh incident derives 'draft'; named staff cannot see it yet. --
    const { data: qRow1 } = await admin.from("incidents").select("status, attestations_requested, attestations_requested_at").eq("id", qIncidentId).single();
    record(
      "Q1: a freshly-stamped incident derives status='draft', attestations_requested defaults false",
      qRow1.status === "draft" && qRow1.attestations_requested === false && qRow1.attestations_requested_at === null,
      JSON.stringify(qRow1)
    );
    const { data: qPreVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q2: named staff CANNOT see a draft incident before attestations are requested", (qPreVis?.length ?? 0) === 0, `rows=${qPreVis?.length}`);

    // -- Q3/Q4: the real toggle -- status derives, timestamp stamped, --
    // named staff gains visibility.
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", qIncidentId);
    const { data: qRow2 } = await admin.from("incidents").select("status, attestations_requested_at").eq("id", qIncidentId).single();
    record(
      "Q3: toggling attestations_requested derives status='awaiting_signoff' and stamps attestations_requested_at",
      qRow2.status === "awaiting_signoff" && qRow2.attestations_requested_at !== null,
      JSON.stringify(qRow2)
    );
    const { data: qPostVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q4: named staff CAN see it once attestations are requested", (qPostVis?.length ?? 0) === 1, `rows=${qPostVis?.length}`);

    // -- Q5: attest, then un-toggle -- status reverts, but visibility --
    // PERSISTS for the person who already attested (agreed in chat:
    // that's not a permission the owning teacher gets to revoke).
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: qStaffRow.id, p_addendum: "Confirmed present." });
    await teacherA.from("incidents").update({ attestations_requested: false }).eq("id", qIncidentId);
    const { data: qRow3 } = await admin.from("incidents").select("status").eq("id", qIncidentId).single();
    record("Q5: un-toggling reverts status to 'draft'", qRow3.status === "draft", qRow3.status);

    const { data: qPersistVis } = await teacherB.from("incidents").select("id").eq("id", qIncidentId);
    record("Q6: visibility PERSISTS for teacherB after un-toggle, because they already attested", (qPersistVis?.length ?? 0) === 1, `rows=${qPersistVis?.length}`);
    const { data: qMyListAfterUntoggle } = await teacherB.rpc("get_my_incident_attestations");
    record(
      "Q6b: get_my_incident_attestations() -- the real piece-2 surface -- still lists it too",
      qMyListAfterUntoggle?.some((r) => r.incident_id === qIncidentId),
      qMyListAfterUntoggle?.find((r) => r.incident_id === qIncidentId)
    );

    // -- Q7: a DIFFERENT staff member, named but never attested, loses --
    // visibility while status is back to draft -- the persistence is
    // specifically for people who've engaged, not a blanket reopening.
    await teacherA.from("incident_staff").insert({ incident_id: qIncidentId, user_id: snaId, involvement: "witnessed" });
    const { data: qSnaVis } = await sna.from("incidents").select("id").eq("id", qIncidentId);
    record("Q7: a staff member who never attested CANNOT see it while status is back to draft", (qSnaVis?.length ?? 0) === 0, `rows=${qSnaVis?.length}`);

    // -- Q8/Q9: re-request. Content unchanged -- teacherB's attestation --
    // must NOT silently stay current (agreed in chat: treat re-requesting
    // as the account having moved).
    await teacherA.from("incidents").update({ attestations_requested: true }).eq("id", qIncidentId);
    const { data: qStatusAfterReRequest } = await teacherB.rpc("get_attestation_status", { p_incident_staff_id: qStaffRow.id });
    record(
      "Q8: re-requesting with no content change makes a previously-current attestation STALE, not silently current",
      qStatusAfterReRequest === "stale",
      qStatusAfterReRequest
    );
    const { data: qStaleCats } = await teacherB.rpc("get_stale_categories", { p_incident_staff_id: qStaffRow.id });
    record(
      "Q9: get_stale_categories() reports 'attestation_reset' specifically -- not an empty list that would misleadingly suggest nothing changed",
      Array.isArray(qStaleCats) && qStaleCats.includes("attestation_reset"),
      JSON.stringify(qStaleCats)
    );
    // -- Q10: renew, sign off -- status derives to 'awaiting_principal'. --
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: qStaffRow.id, p_addendum: "Re-confirming after reset." });
    const { error: qSignErr } = await teacherA.rpc("sign_off_incident", { p_incident_id: qIncidentId });
    const { data: qRow4 } = await admin.from("incidents").select("status").eq("id", qIncidentId).single();
    record("Q10: signing off derives status='awaiting_principal'", !qSignErr && qRow4.status === "awaiting_principal", `err=${qSignErr?.message}, status=${qRow4.status}`);

    await admin.from("incidents").delete().eq("id", qIncidentId);
  }

  console.log(`\n== CHECK R: Phase 4 piece 3 -- countersign_incident() RPC, get_countersign_summary(), countersigned_via, amendment-notify trigger (migration 0090) ==`);
  {
    // -- R1: minimal clean incident, teacher-signed via the RPC -- no --
    // staff named, so nothing to attest, no debrief/CPI gate tripped
    // (same minimal recipe CHECK O's oCleanId uses).
    const { data: rIncidentId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rIncidentId });

    // -- R2: teacherB has real, otherwise-unrelated visibility into this --
    // incident via passport_access (established in top-level setup) --
    // confirm that first, so R2b's refusal is provably about
    // can_countersign_incident() specifically, not about lacking any
    // standing at all.
    const { data: rVisibleToTeacherB } = await teacherB.from("incidents").select("id").eq("id", rIncidentId);
    record("R2a: teacherB CAN see the incident (visibility isn't the thing under test)", (rVisibleToTeacherB?.length ?? 0) === 1, `rows=${rVisibleToTeacherB?.length}`);
    const { error: rSummaryDeniedErr } = await teacherB.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record("R2b: get_countersign_summary() refused for a visible-but-non-countersigning caller, for the right reason", Boolean(rSummaryDeniedErr) && /countersign/i.test(rSummaryDeniedErr?.message ?? ""), rSummaryDeniedErr?.message);

    // -- R3: get_countersign_summary() -- correct content for the real principal. --
    const { data: rSummary, error: rSummaryErr } = await principal.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record(
      "R3: get_countersign_summary() succeeds for the principal, reports teacher name/time and not-yet-countersigned",
      !rSummaryErr && rSummary?.already_countersigned === false && rSummary?.teacher_signed_by_name != null && rSummary?.teacher_signed_at != null,
      `err=${rSummaryErr?.message}, ${JSON.stringify(rSummary)}`
    );

    // -- R4: countersign_incident() -- not-yet-signed-off gate. --
    const { data: rUnsignedId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    const { error: rTooEarlyErr } = await principal.rpc("countersign_incident", { p_incident_id: rUnsignedId });
    record("R4: countersign_incident() refused before teacher sign-off", Boolean(rTooEarlyErr) && /not yet.*signed off/i.test(rTooEarlyErr?.message ?? ""), rTooEarlyErr?.message);
    await admin.from("incidents").delete().eq("id", rUnsignedId);

    // -- R5: countersign_incident() -- permission gate, real reason (same --
    // visible-but-unauthorized caller as R2).
    const { error: rNoPermErr } = await teacherB.rpc("countersign_incident", { p_incident_id: rIncidentId });
    record("R5: countersign_incident() refused for a visible-but-non-countersigning caller", Boolean(rNoPermErr) && /permission/i.test(rNoPermErr?.message ?? ""), rNoPermErr?.message);

    // -- R6: countersign_incident() -- clean success via the RPC, derived --
    // fields correct, status finalised.
    const { error: rSignErr } = await principal.rpc("countersign_incident", { p_incident_id: rIncidentId });
    const { data: rAfter } = await admin.from("incidents").select("countersigned_at, countersigned_by, countersigned_role_at_time, countersigned_via, status").eq("id", rIncidentId).single();
    record(
      "R6: countersign_incident() succeeds for the principal, all four fields correctly derived, status='finalised'",
      !rSignErr && rAfter.countersigned_by === principalId && rAfter.countersigned_role_at_time === "principal" && rAfter.countersigned_via === "principal_role" && rAfter.status === "finalised",
      `err=${rSignErr?.message}, ${JSON.stringify(rAfter)}`
    );

    // -- R7: already-countersigned gate. --
    const { error: rTwiceErr } = await principal.rpc("countersign_incident", { p_incident_id: rIncidentId });
    record("R7: countersign_incident() refused a second time on an already-countersigned incident", Boolean(rTwiceErr) && /already/i.test(rTwiceErr?.message ?? ""), rTwiceErr?.message);

    // -- R8: get_countersign_summary() reflects the completed countersign, --
    // so a reload (or a race with another countersigner) is legible.
    const { data: rSummaryAfter } = await principal.rpc("get_countersign_summary", { p_incident_id: rIncidentId });
    record(
      "R8: get_countersign_summary() reports already_countersigned=true with the countersigner's name and role",
      rSummaryAfter?.already_countersigned === true && rSummaryAfter?.countersigned_role_at_time === "principal" && rSummaryAfter?.countersigned_via === "principal_role" && rSummaryAfter?.countersigned_by_name != null,
      JSON.stringify(rSummaryAfter)
    );

    // -- R9: countersigned_via='grant', countersigned_role_at_time is the --
    // grant-holder's REAL role ('class_teacher'), never 'principal' -- on
    // a second, separate incident.
    const { data: rGrantId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rGrantId });
    const { error: rGrantInsertErr } = await principal.from("institution_permissions").insert({ institution_id: institutionId, user_id: teacherBId, permission: "countersign_incident", granted_by: principalId });
    record("R9a: principal CAN grant countersign_incident to teacherB (ordinary class_teacher)", !rGrantInsertErr, rGrantInsertErr?.message);
    const { error: rGrantSignErr } = await teacherB.rpc("countersign_incident", { p_incident_id: rGrantId });
    const { data: rGrantAfter } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via, countersigned_at").eq("id", rGrantId).single();
    record(
      "R9b: grant-holder countersigns successfully, countersigned_via='grant', countersigned_role_at_time is their REAL role ('class_teacher'), never 'principal'",
      !rGrantSignErr && rGrantAfter.countersigned_by === teacherBId && rGrantAfter.countersigned_via === "grant" && rGrantAfter.countersigned_role_at_time === "class_teacher",
      `err=${rGrantSignErr?.message}, ${JSON.stringify(rGrantAfter)}`
    );
    await admin.from("institution_permissions").delete().eq("institution_id", institutionId).eq("user_id", teacherBId).eq("permission", "countersign_incident");

    // -- R10: revoking the grant afterward does not affect the already- --
    // countersigned record (CHECK J already proves this at the raw-update
    // layer; this confirms the same property holds through the RPC too).
    const { data: rGrantAfterRevoke } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via, countersigned_at").eq("id", rGrantId).single();
    record(
      "R10: countersign is unchanged after the grant is revoked -- revocation is not retroactive",
      rGrantAfterRevoke.countersigned_by === teacherBId
        && rGrantAfterRevoke.countersigned_via === "grant"
        && rGrantAfterRevoke.countersigned_at === rGrantAfter.countersigned_at,
      JSON.stringify(rGrantAfterRevoke)
    );

    // -- R11: a raw update deliberately submitting someone else's id and --
    // the wrong role/via is overwritten by the trigger, not rejected and
    // not trusted -- on a third, separate incident.
    const { data: rSpoofId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSpoofId });
    const { error: rSpoofErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), countersigned_by: teacherAId, countersigned_role_at_time: "class_teacher", countersigned_via: "grant" })
      .eq("id", rSpoofId);
    const { data: rSpoofAfter } = await admin.from("incidents").select("countersigned_by, countersigned_role_at_time, countersigned_via").eq("id", rSpoofId).single();
    record(
      "R11: a raw update deliberately submitting someone else's id and the wrong role/via is overwritten by the trigger, not rejected and not trusted",
      !rSpoofErr && rSpoofAfter.countersigned_by === principalId && rSpoofAfter.countersigned_role_at_time === "principal" && rSpoofAfter.countersigned_via === "principal_role",
      `err=${rSpoofErr?.message}, ${JSON.stringify(rSpoofAfter)}`
    );

    // -- R12: wrong-reason-pass discipline -- combine a legitimate --
    // countersign write with a smuggled narrative change in the SAME
    // statement, as the real principal (who genuinely has countersign
    // authority) -- only guard_incident_immutability() should be able to
    // reject this, on a fourth, separate incident so the countersign
    // itself is still live when the guard fires.
    const { data: rSmuggleId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [],
    });
    await teacherA.from("incidents").update({ narrative: "Original narrative." }).eq("id", rSmuggleId);
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSmuggleId });
    const { error: rSmuggleErr } = await principal
      .from("incidents")
      .update({ countersigned_at: new Date().toISOString(), narrative: "Smuggled alongside a legitimate countersign." })
      .eq("id", rSmuggleId);
    const { data: rSmuggleAfter } = await admin.from("incidents").select("countersigned_at, narrative").eq("id", rSmuggleId).single();
    record(
      "R12: guard_incident_immutability() rejects a narrative change smuggled into an otherwise-legitimate countersign write, from a caller who genuinely has countersign authority",
      Boolean(rSmuggleErr) && /immutable/i.test(rSmuggleErr?.message ?? "") && rSmuggleAfter.countersigned_at === null && rSmuggleAfter.narrative === "Original narrative.",
      `err=${rSmuggleErr?.message}, ${JSON.stringify(rSmuggleAfter)}`
    );

    // -- R13/R14/R15: amendment-notify trigger -- principal's amendment --
    // notifies the owning teacher; the owning teacher's OWN amendment
    // does not notify themselves; teacherB (visible via passport_access,
    // but no countersign authority left after R9's grant was revoked, and
    // not creator/owning teacher/clinician) cannot add one at all.
    const { data: rNoticesBefore } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    const { error: rPrincipalAmendErr } = await principal.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: principalId, reason: "Disagreement", content: "I was not present for this but the record raises a concern." });
    const { data: rNoticesAfterPrincipal } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    record(
      "R13: principal's amendment raises exactly one incident_amendment_added notice",
      !rPrincipalAmendErr && (rNoticesBefore?.length ?? 0) === 0 && (rNoticesAfterPrincipal?.length ?? 0) === 1,
      `err=${rPrincipalAmendErr?.message}, before=${rNoticesBefore?.length}, after=${rNoticesAfterPrincipal?.length}`
    );

    const { error: rTeacherAmendErr } = await teacherA.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: teacherAId, reason: "Clarification", content: "Adding detail the principal asked about." });
    const { data: rNoticesAfterTeacher } = await admin.from("school_notices").select("id").eq("incident_id", rSmuggleId).eq("notice_type", "incident_amendment_added");
    record(
      "R14: the owning teacher's OWN amendment does not raise a self-notice -- still exactly one notice total",
      !rTeacherAmendErr && (rNoticesAfterTeacher?.length ?? 0) === 1,
      `err=${rTeacherAmendErr?.message}, notices=${rNoticesAfterTeacher?.length}`
    );

    const { error: rTeacherBAmendErr } = await teacherB.from("incident_amendments").insert({ incident_id: rSmuggleId, author_id: teacherBId, reason: "Uninvited", content: "I can see this incident but have no standing to amend it." });
    record("R15: a caller who can SEE the incident but is not creator/owning teacher/countersigner/clinician CANNOT add an amendment", Boolean(rTeacherBAmendErr), rTeacherBAmendErr?.message);

    await admin.from("incidents").delete().eq("id", rIncidentId);
    await admin.from("incidents").delete().eq("id", rGrantId);
    await admin.from("incidents").delete().eq("id", rSpoofId);
    await admin.from("incidents").delete().eq("id", rSmuggleId);

    // -- R16: get_countersign_summary() surfaces addendum/withdrawal --
    // reason in full, attributed, plus involvement -- not just a status
    // label (migration 0092). teacherB attests with an addendum,
    // withdraws with a reason, then re-attests with a different
    // addendum -- both the attested and withdrawn timestamps should be
    // present at once (both genuinely happened), attested_at AFTER
    // withdrawn_at, so the client can render it as a sequence rather
    // than two contradictory current states.
    const { data: rSeqId } = await teacherA.rpc("create_incident_stamp", {
      p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1], p_staff: [{ user_id: teacherBId, involvement: "witnessed" }],
    });
    const { data: rSeqStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", rSeqId).eq("user_id", teacherBId).single();
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: rSeqStaffRow.id, p_addendum: "First attestation." });
    await teacherB.rpc("withdraw_attestation", { p_incident_staff_id: rSeqStaffRow.id, p_reason: "Need to check something first." });
    await teacherB.rpc("attest_to_incident", { p_incident_staff_id: rSeqStaffRow.id, p_addendum: "Checked -- confirming now." });
    await teacherA.rpc("sign_off_incident", { p_incident_id: rSeqId });

    const { data: rSeqSummary, error: rSeqSummaryErr } = await principal.rpc("get_countersign_summary", { p_incident_id: rSeqId });
    const rSeqEntry = rSeqSummary?.staff_attestations?.find((s) => s.incident_staff_id === rSeqStaffRow.id);
    record(
      "R16a: get_countersign_summary() reports involvement, the CURRENT addendum ('Checked -- confirming now.'), and status='current'",
      !rSeqSummaryErr && rSeqEntry?.involvement === "witnessed" && rSeqEntry?.addendum === "Checked -- confirming now." && rSeqEntry?.status === "current",
      `err=${rSeqSummaryErr?.message}, ${JSON.stringify(rSeqEntry)}`
    );
    record(
      "R16b: the EARLIER withdrawal is still reported (reason + timestamp) alongside the later re-attestation -- both genuinely happened, attested_at AFTER withdrawn_at (a sequence, not two contradictory current states)",
      rSeqEntry?.withdrawal_reason === "Need to check something first."
        && rSeqEntry?.withdrawn_at != null
        && rSeqEntry?.attested_at != null
        && new Date(rSeqEntry.attested_at).getTime() > new Date(rSeqEntry.withdrawn_at).getTime(),
      JSON.stringify(rSeqEntry)
    );

    await admin.from("incidents").delete().eq("id", rSeqId);
  }

  console.log(`\n== CHECK S: Phase 4 piece 4 (part 1) -- two-stage parent notification, dormant-account handling, get_parent_incidents() draft fix, mark_parent_called() (migration 0093) ==`);
  {
    // -- Dedicated fixture: two children, two DIFFERENT parents, so --
    // cross-child isolation is a genuine two-account test, not just a
    // single-passport sanity check. parent1S signs in immediately
    // (active); parent2S is created but deliberately never signed in
    // yet (last_sign_in_at stays null -- dormant by construction) until
    // explicitly signed in later in this block, to prove the
    // independent re-check at stage 2.
    const { data: instS } = await admin
      .from("institutions")
      .insert({ name: "Check S Institution", institution_code: "CHECKS" + Math.floor(Math.random() * 10000), status: "verified" })
      .select()
      .single();
    const institutionSId = instS.id;

    const teacherSId = await createUser("checks.teacher@thebehaviourhive.com", "Check S Teacher", "class_teacher");
    const snaSId = await createUser("checks.sna@thebehaviourhive.com", "Check S SNA", "sna");
    const parent1SId = await createUser("checks.parent1@thebehaviourhive.com", "Check S Parent One", "parent");
    const parent2SId = await createUser("checks.parent2@thebehaviourhive.com", "Check S Parent Two", "parent");

    await admin.from("institution_staff").insert([
      { institution_id: institutionSId, user_id: teacherSId, role: "class_teacher" },
      { institution_id: institutionSId, user_id: snaSId, role: "sna" },
    ]);

    const { data: child1S } = await admin.from("passports").insert({ user_id: parent1SId, child_name: "Check S Child One", passport_status: "complete" }).select().single();
    const { data: child2S } = await admin.from("passports").insert({ user_id: parent2SId, child_name: "Check S Child Two", passport_status: "complete" }).select().single();
    await admin.from("passport_institution_links").insert([
      { passport_id: child1S.id, institution_id: institutionSId, approved_by_parent: true },
      { passport_id: child2S.id, institution_id: institutionSId, approved_by_parent: true },
    ]);

    const teacherS = await signedInClient("checks.teacher@thebehaviourhive.com");
    const snaS = await signedInClient("checks.sna@thebehaviourhive.com");
    const parent1S = await signedInClient("checks.parent1@thebehaviourhive.com"); // signs in -> active
    // parent2S deliberately NOT signed in yet.

    // -- S1: the stamp itself -- two-child incident, both children --
    // inserted atomically. teacherS is named staff too (self-witnessed),
    // not required for the test, just realistic.
    const { data: sIncidentId } = await teacherS.rpc("create_incident_stamp", {
      p_institution_id: institutionSId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1S.id, child2S.id],
      p_staff: [{ user_id: snaSId, involvement: "witnessed" }],
    });

    const { data: sChildRows } = await admin.from("incident_children").select("id, passport_id, parent_notified_at, parent_notified_by, parent_notification_blocked_reason").eq("incident_id", sIncidentId);
    const sChild1Row = sChildRows.find((r) => r.passport_id === child1S.id);
    const sChild2Row = sChildRows.find((r) => r.passport_id === child2S.id);

    record(
      "S1a: stage 1 -- active parent (child1) gets notified immediately, attributed to the real teacher",
      sChild1Row.parent_notified_at !== null && sChild1Row.parent_notified_by === teacherSId && sChild1Row.parent_notification_blocked_reason === null,
      JSON.stringify(sChild1Row)
    );
    record(
      "S1b: stage 1 -- dormant parent (child2, never signed in) is BLOCKED, not silently skipped -- a real, staff-visible reason is recorded instead of a notification",
      sChild2Row.parent_notified_at === null && sChild2Row.parent_notification_blocked_reason === "dormant_account",
      JSON.stringify(sChild2Row)
    );

    // -- S2: cross-child isolation, parent_incident_notices -- parent1S --
    // sees exactly their own child's stage-1 notice and NOTHING for
    // child2, through any field, via direct RLS-scoped select (not an
    // RPC -- proving the table's own policy, not a function's filtering).
    const { data: sParent1Notices } = await parent1S.from("parent_incident_notices").select("*");
    record(
      "S2a: parent1S sees exactly one notice, for child1, notice_type='incident_recorded'",
      sParent1Notices.length === 1 && sParent1Notices[0].passport_id === child1S.id && sParent1Notices[0].notice_type === "incident_recorded",
      JSON.stringify(sParent1Notices)
    );
    record(
      "S2b: NO row in parent1S's own result set references child2's passport_id, anywhere",
      !sParent1Notices.some((n) => n.passport_id === child2S.id),
      JSON.stringify(sParent1Notices)
    );
    const { data: sParent1CrossAttempt } = await parent1S.from("parent_incident_notices").select("*").eq("passport_id", child2S.id);
    record("S2c: parent1S explicitly querying for child2's passport_id gets zero rows (RLS, not client-side filtering)", (sParent1CrossAttempt?.length ?? 0) === 0, `rows=${sParent1CrossAttempt?.length}`);

    // -- S3: draft-incident non-exposure, BOTH channels. Status has left --
    // 'draft' (toggle attestations_requested) but teacher has NOT signed
    // off -- get_parent_incidents() must still return nothing (the fix
    // under test), proving the gate is teacher_signed_at, not status.
    await teacherS.from("incidents").update({ attestations_requested: true }).eq("id", sIncidentId);
    const { data: sStatusRow } = await admin.from("incidents").select("status").eq("id", sIncidentId).single();
    record("S3a: status has genuinely left draft (setup check)", sStatusRow.status === "awaiting_signoff", sStatusRow.status);
    const { data: sPrematureRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child1S.id });
    record(
      "S3b: get_parent_incidents() returns ZERO rows pre-signoff even though status <> 'draft' -- the actual fix, proven live not just read from source",
      (sPrematureRead?.length ?? 0) === 0,
      `rows=${sPrematureRead?.length}`
    );

    // -- S4: parent2S signs in BETWEEN stage 1 (blocked) and stage 2 -- --
    // proving the dormant check re-runs independently at each stage,
    // not cached from stage 1's result.
    const parent2S = await signedInClient("checks.parent2@thebehaviourhive.com"); // this sign-in itself sets last_sign_in_at, making them active from here on

    const { error: sSignErr } = await teacherS.rpc("sign_off_incident", { p_incident_id: sIncidentId });
    record("S4a: teacher sign-off succeeds", !sSignErr, sSignErr?.message);

    const { data: sChildRowsAfter } = await admin.from("incident_children").select("id, passport_id, parent_notified_at, parent_notification_blocked_reason").eq("incident_id", sIncidentId);
    const sChild1RowAfter = sChildRowsAfter.find((r) => r.passport_id === child1S.id);
    const sChild2RowAfter = sChildRowsAfter.find((r) => r.passport_id === child2S.id);
    record(
      "S4b: stage 2 -- child2's parent, now active (signed in since stage 1), IS notified this time -- blocked_reason cleared, parent_notified_at now set",
      sChild2RowAfter.parent_notified_at !== null && sChild2RowAfter.parent_notification_blocked_reason === null,
      JSON.stringify(sChild2RowAfter)
    );
    record("S4c: child1's parent also gets stage 2 (already active both times)", sChild1RowAfter.parent_notified_at !== null, JSON.stringify(sChild1RowAfter));

    // -- S5: post-signoff -- both parents now have their own, --
    // correctly-scoped notice history; still zero cross-child leakage.
    const { data: sParent1NoticesAfter } = await parent1S.from("parent_incident_notices").select("notice_type, passport_id");
    record(
      "S5a: parent1S now has BOTH stage notices, both for child1, still none for child2",
      sParent1NoticesAfter.length === 2
        && sParent1NoticesAfter.every((n) => n.passport_id === child1S.id)
        && sParent1NoticesAfter.some((n) => n.notice_type === "incident_recorded")
        && sParent1NoticesAfter.some((n) => n.notice_type === "incident_summary_ready"),
      JSON.stringify(sParent1NoticesAfter)
    );
    const { data: sParent2Notices } = await parent2S.from("parent_incident_notices").select("notice_type, passport_id");
    record(
      "S5b: parent2S has exactly ONE notice (stage 1 was blocked, never created) -- stage 2 only, for child2 only",
      sParent2Notices.length === 1 && sParent2Notices[0].notice_type === "incident_summary_ready" && sParent2Notices[0].passport_id === child2S.id,
      JSON.stringify(sParent2Notices)
    );

    // -- S6: get_parent_incidents() post-signoff -- full content now --
    // visible, correctly scoped; a cross-passport call (parent1S asking
    // for child2's data) still returns nothing, RLS-level.
    const { data: sFullRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child1S.id });
    record(
      "S6a: post-signoff, get_parent_incidents() returns the full parent_summary for the real owner",
      sFullRead?.length === 1 && sFullRead[0].parent_summary !== undefined,
      JSON.stringify(sFullRead)
    );
    const { data: sCrossPassportRead } = await parent1S.rpc("get_parent_incidents", { p_passport_id: child2S.id });
    record("S6b: parent1S calling get_parent_incidents() for child2's passport_id gets nothing (owns_passport fails)", (sCrossPassportRead?.length ?? 0) === 0, `rows=${sCrossPassportRead?.length}`);
    const sLeaksNarrative = sFullRead?.[0] && Object.prototype.hasOwnProperty.call(sFullRead[0], "narrative");
    record(
      "S6c: get_parent_incidents() column set excludes narrative entirely, even on a real signed-off row (moved here from CHECK 6, which no longer has a signed-off row to check by this point in its own fixture)",
      !sLeaksNarrative,
      `keys=${sFullRead?.[0] ? Object.keys(sFullRead[0]).join(",") : "none"}`
    );

    // -- S7: mark_parent_called() -- authorization, real reason. snaS is --
    // named staff with genuine standing on this incident (can view it),
    // but is neither creator/owning teacher nor principal.
    const { error: sSnaCallErr } = await snaS.rpc("mark_parent_called", { p_incident_children_id: sChild1Row.id });
    record("S7a: mark_parent_called() refused for named staff with real visibility but no owner/principal standing", Boolean(sSnaCallErr) && /permission/i.test(sSnaCallErr?.message ?? ""), sSnaCallErr?.message);

    const { error: sTeacherCallErr } = await teacherS.rpc("mark_parent_called", { p_incident_children_id: sChild1Row.id });
    const { data: sCalledRow } = await admin.from("incident_children").select("parent_called_at, parent_called_by").eq("id", sChild1Row.id).single();
    record(
      "S7b: mark_parent_called() succeeds for the owning teacher, records who and when",
      !sTeacherCallErr && sCalledRow.parent_called_at !== null && sCalledRow.parent_called_by === teacherSId,
      `err=${sTeacherCallErr?.message}, ${JSON.stringify(sCalledRow)}`
    );

    // -- S8: manual parent_call_required toggle + restrictive-practice --
    // auto-raise (CHECK 9 already proved the injury path; this proves
    // the other two, on child2's fresh, still-unflagged row).
    const { data: sPreToggle } = await admin.from("incident_children").select("id").eq("incident_id", sIncidentId).eq("passport_id", child2S.id).single();
    const { data: sNoticesBeforeManual } = await admin.from("school_notices").select("id").eq("incident_id", sIncidentId).eq("notice_type", "incident_parent_call");
    record("S8a setup: no incident_parent_call notice yet on this incident", (sNoticesBeforeManual?.length ?? 0) === 0, `rows=${sNoticesBeforeManual?.length}`);

    // Manual toggle only works pre-signoff; this incident is already
    // signed off from S4, so use the RP trigger instead (fires on
    // insert regardless of sign-off state -- restrictive_practices has
    // its own insert policy, not gated on this) to prove the SECOND of
    // the two auto-raise paths.
    const { error: sRpInsertErr } = await admin.from("restrictive_practices").insert({ incident_id: sIncidentId, passport_id: child2S.id, planning_status: "not_planned" });
    record("S8a-bis: restrictive_practices insert itself succeeds (planning_status is required, not omitted this time)", !sRpInsertErr, sRpInsertErr?.message);
    const { data: sChild2AfterRp } = await admin.from("incident_children").select("parent_call_required").eq("id", sPreToggle.id).single();
    record("S8b: restrictive-practice insert auto-flips parent_call_required (the second of the two auto-raise paths, not yet exercised this session)", sChild2AfterRp.parent_call_required === true, JSON.stringify(sChild2AfterRp));
    const { data: sNoticesAfterRp } = await admin.from("school_notices").select("id").eq("incident_id", sIncidentId).eq("notice_type", "incident_parent_call");
    record("S8c: exactly one incident_parent_call notice raised from the RP path", (sNoticesAfterRp?.length ?? 0) === 1, `rows=${sNoticesAfterRp?.length}`);

    // -- S9: clinician_incident_notices (migration 0094) -- a fresh --
    // incident so the signoff transition is clean. Child1S gets a
    // linked, verified clinician; child2S deliberately gets none, to
    // prove no orphaned row is created when nobody can see it.
    const clinicianSId = await createUser("checks.clinician@thebehaviourhive.com", "Check S Clinician", "clinician");
    await admin.from("clinicians").insert({ user_id: clinicianSId, specialty: "behavioural_psychologist", verification_status: "verified" });
    await admin.from("clinician_access").insert({ passport_id: child1S.id, clinician_id: clinicianSId, is_active: true });
    const clinicianS = await signedInClient("checks.clinician@thebehaviourhive.com");

    const { data: sClinIncidentId } = await teacherS.rpc("create_incident_stamp", {
      p_institution_id: institutionSId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [child1S.id, child2S.id], p_staff: [],
    });

    const { data: sClinPreSignoff } = await clinicianS.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId);
    record("S9a: clinician gets NOTHING pre-signoff (not before, per spec)", (sClinPreSignoff?.length ?? 0) === 0, `rows=${sClinPreSignoff?.length}`);

    await teacherS.rpc("sign_off_incident", { p_incident_id: sClinIncidentId });

    const { data: sClinPostSignoff } = await clinicianS.from("clinician_incident_notices").select("notice_type, passport_id");
    record(
      "S9b: clinician notified at teacher sign-off, exactly one notice, for child1S only (their own case), never child2S",
      sClinPostSignoff.length === 1 && sClinPostSignoff[0].passport_id === child1S.id && sClinPostSignoff[0].notice_type === "incident_summary_ready",
      JSON.stringify(sClinPostSignoff)
    );

    const { data: sOrphanCheck } = await admin.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId).eq("passport_id", child2S.id);
    record("S9c: no row at all for child2S (no linked clinician to notify) -- not an invisible orphaned row, genuinely absent", (sOrphanCheck?.length ?? 0) === 0, `rows=${sOrphanCheck?.length}`);

    const { data: sSnaClinAttempt } = await snaS.from("clinician_incident_notices").select("id").eq("incident_id", sClinIncidentId);
    record("S9d: ordinary staff (SNA, not a clinician) sees nothing via this table's own RLS", (sSnaClinAttempt?.length ?? 0) === 0, `rows=${sSnaClinAttempt?.length}`);

    await admin.from("incidents").delete().eq("id", sClinIncidentId);
    await admin.auth.admin.deleteUser(clinicianSId);

    await admin.from("institutions").delete().eq("id", institutionSId);
    for (const id of [teacherSId, snaSId, parent1SId, parent2SId]) {
      await admin.auth.admin.deleteUser(id);
    }
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
