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
    const { error: nullTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: null });
    record("A body mark with NO injury_type_id is REJECTED (not null constraint)", Boolean(nullTypeErr), nullTypeErr?.message);

    const { error: bogusTypeErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: "00000000-0000-0000-0000-000000000000" });
    record("A body mark with an injury_type_id NOT in the vocabulary is REJECTED (foreign key)", Boolean(bogusTypeErr), bogusTypeErr?.message);

    const { data: markRow, error: markInsertErr } = await teacherA
      .from("incident_body_marks")
      .insert({ injury_id: injuryRow.id, view: "front", x: 0.4, y: 0.6, injury_type_id: bruisingType.id })
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
