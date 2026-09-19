/* PRD 9 Stage 1 -- migration 0255 verification: director-set
   workspace_email, clinic-wide scheduling settings, get_bookable_clinician_details(),
   the bookings table's own CHECK constraints + RLS + reconciliation
   RPCs. Real signed-in sessions throughout for every RPC/RLS assertion;
   service-role only for fixture bootstrap and for the bookings table's
   CHECK-constraint proofs (that table has no client INSERT policy at
   all in Stage 1 -- Stage 2 owns every mutation -- so the constraints
   themselves are exercised directly, which is legitimate: a CHECK
   applies regardless of which role performs the write).

   NOT covered here, deliberately: the actual Google Calendar/Freebusy
   round trip (needs GOOGLE_SERVICE_ACCOUNT_KEY in Vercel + Domain-Wide
   Delegation granted in Workspace Admin, neither confirmed yet), and
   the "school principal never sees the Workspace email field" claim
   at the RENDER level (that's a client-component gate, proven live in
   the browser once this is deployed -- what IS proven here is the
   RPC-level twin of that claim: a genuinely verified, active school
   principal is refused by every clinic-only RPC on the institution-type
   check alone).

   Institutions: ZZPRD9CLINIC (the clinic under test), ZZPRD9CLINICB (an
   UNRELATED second clinic, for cross-clinic isolation), ZZPRD9SCHOOL (a
   school, for the clinic-only-gate refusal proofs).

   Run: node --env-file=.env.local scripts/dev/zz-prd9-stage1-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd9-stage1-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd9Stage1Verify-2026!";
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
  // Institutions, users.
  // =====================================================================
  const { data: clinic } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD9 Stage1 Clinic", institution_code: "ZZPRD9CLINIC", status: "verified", type: "clinic" })
    .select("id")
    .single();
  const { data: clinicB } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD9 Stage1 Clinic B (unrelated)", institution_code: "ZZPRD9CLINICB", status: "verified", type: "clinic" })
    .select("id")
    .single();
  const { data: school } = await admin
    .from("institutions")
    .insert({ name: "ZZ PRD9 Stage1 School", institution_code: "ZZPRD9SCHOOL", status: "verified", type: "school" })
    .select("id")
    .single();
  console.log(`Clinic: ${clinic.id} | ClinicB: ${clinicB.id} | School: ${school.id}`);

  const clinicDirectorId = await createUser("zzprd9stage1.clinicdirector@thebehaviourhive.com");
  const clinicPractitionerId = await createUser("zzprd9stage1.practitioner@thebehaviourhive.com");
  const clinicPractitionerBId = await createUser("zzprd9stage1.practitionerb@thebehaviourhive.com");
  const clinicLeadId = await createUser("zzprd9stage1.clinicallead@thebehaviourhive.com");
  const clinicAdminId = await createUser("zzprd9stage1.clinicadmin@thebehaviourhive.com");
  const clinicBDirectorId = await createUser("zzprd9stage1.clinicbdirector@thebehaviourhive.com");
  const schoolPrincipalId = await createUser("zzprd9stage1.schoolprincipal@thebehaviourhive.com");
  const parentId = await createUser("zzprd9stage1.parent@thebehaviourhive.com");
  const outsiderParentId = await createUser("zzprd9stage1.outsiderparent@thebehaviourhive.com");

  await admin.auth.admin.updateUserById(clinicDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(clinicPractitionerId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicPractitionerBId, { app_metadata: { role: "clinician" } });
  await admin.auth.admin.updateUserById(clinicLeadId, { app_metadata: { role: "clinical_lead" } });
  await admin.auth.admin.updateUserById(clinicAdminId, { app_metadata: { role: "clinic_admin" } });
  await admin.auth.admin.updateUserById(clinicBDirectorId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(schoolPrincipalId, { app_metadata: { role: "principal" } });
  await admin.auth.admin.updateUserById(parentId, { app_metadata: { role: "parent" } });
  await admin.auth.admin.updateUserById(outsiderParentId, { app_metadata: { role: "parent" } });

  const now = new Date().toISOString();
  // Director/lead/admin/school-principal rows: bootstrap-inserted with
  // approved_at set directly -- these accounts exist only to prove the
  // NEW RPCs' own authorization gates (institution_staff + institutions
  // lookups), not to re-prove the join/approval mechanism itself, which
  // earlier PRDs' own fixtures already cover.
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicLeadId, role: "clinical_lead", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicAdminId, role: "clinic_admin", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: clinicB.id, user_id: clinicBDirectorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  await admin.from("institution_staff").insert({ institution_id: school.id, user_id: schoolPrincipalId, role: "principal", approved_at: now, approval_source: "bootstrap" });

  const clinicDirector = await sessionFor("zzprd9stage1.clinicdirector@thebehaviourhive.com");
  const clinicPractitioner = await sessionFor("zzprd9stage1.practitioner@thebehaviourhive.com");
  const clinicPractitionerB = await sessionFor("zzprd9stage1.practitionerb@thebehaviourhive.com");
  const clinicLead = await sessionFor("zzprd9stage1.clinicallead@thebehaviourhive.com");
  const clinicAdmin = await sessionFor("zzprd9stage1.clinicadmin@thebehaviourhive.com");
  const clinicBDirector = await sessionFor("zzprd9stage1.clinicbdirector@thebehaviourhive.com");
  const schoolPrincipal = await sessionFor("zzprd9stage1.schoolprincipal@thebehaviourhive.com");
  const parent = await sessionFor("zzprd9stage1.parent@thebehaviourhive.com");
  const outsiderParent = await sessionFor("zzprd9stage1.outsiderparent@thebehaviourhive.com");

  // clinicPractitioner/B need to be REAL, verified clinicians (a real
  // clinicians row, verification_status='verified') for
  // get_institution_clinicians()'s own is_verified_clinician() filter
  // to include them -- that only happens through the real self-link +
  // approve_staff_join() flow (0222's own clinic branch), not a bare
  // institution_staff bootstrap insert.
  await clinicPractitioner.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicPractitionerId, role: "clinician" });
  await clinicPractitionerB.client.from("institution_staff").insert({ institution_id: clinic.id, user_id: clinicPractitionerBId, role: "clinician" });
  {
    const { data: staffRows } = await admin.from("institution_staff").select("id, user_id").eq("institution_id", clinic.id).in("user_id", [clinicPractitionerId, clinicPractitionerBId]);
    for (const row of staffRows) {
      const { error } = await clinicDirector.client.rpc("approve_staff_join", { p_institution_staff_id: row.id });
      if (error) throw new Error(`approve_staff_join(${row.user_id}): ${error.message}`);
    }
  }

  const { data: verifiedCheck } = await admin.from("clinicians").select("user_id, verification_status, verification_route").in("user_id", [clinicPractitionerId, clinicPractitionerBId]);
  ok("fixture: both practitioners auto-verified via director approval (verification_route='organisation')", (verifiedCheck ?? []).every((r) => r.verification_status === "verified" && r.verification_route === "organisation"), verifiedCheck);

  // The clinic client, and engagement.
  const { data: passportId, error: onboardErr } = await clinicDirector.client.rpc("onboard_clinic_client", {
    p_institution_id: clinic.id,
    p_client_name: "ZZ PRD9 Stage1 Child",
  });
  if (onboardErr) throw new Error(`onboard_clinic_client: ${onboardErr.message}`);
  await admin.from("passport_guardians").insert({ passport_id: passportId, user_id: parentId });

  {
    const { error } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
      p_institution_id: clinic.id, p_passport_ids: [passportId], p_roster_user_id: clinicPractitionerId,
    });
    if (error) throw new Error(`bulk_grant_clinician_access(practitioner): ${error.message}`);
  }
  {
    const { error } = await clinicDirector.client.rpc("bulk_grant_clinician_access", {
      p_institution_id: clinic.id, p_passport_ids: [passportId], p_roster_user_id: clinicPractitionerBId,
    });
    if (error) throw new Error(`bulk_grant_clinician_access(practitionerB): ${error.message}`);
  }

  console.log(`Passport: ${passportId}`);

  // =====================================================================
  // PART A -- set_clinician_workspace_email() and the read-back.
  // =====================================================================
  console.log("\nPART A -- workspace email: set, read back, and every refusal.");

  const PRACTITIONER_EMAIL = "PRACTITIONER.A@ZZPRD9CLINIC-WORKSPACE.example.com"; // deliberately mixed case, to prove lower(trim(...))

  const { error: setEmailErr } = await clinicDirector.client.rpc("set_clinician_workspace_email", {
    p_institution_id: clinic.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: PRACTITIONER_EMAIL,
  });
  ok("the clinic's own director sets a clinician's workspace email", !setEmailErr, setEmailErr?.message);

  {
    const { data: rows, error } = await clinicDirector.client.rpc("get_institution_clinicians", { p_institution_id: clinic.id });
    const row = (rows ?? []).find((r) => r.clinician_id === clinicPractitionerId);
    ok(
      "read back via the widened get_institution_clinicians(): lowercased/trimmed, matches exactly",
      !error && row?.workspace_email === PRACTITIONER_EMAIL.toLowerCase().trim(),
      { error: error?.message, row }
    );
  }

  const { error: blankEmailErr } = await clinicDirector.client.rpc("set_clinician_workspace_email", {
    p_institution_id: clinic.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: "   ",
  });
  ok("a blank/whitespace-only email is refused", !!blankEmailErr, blankEmailErr?.message);

  // Non-director refused: lead, admin, and the practitioner themselves.
  for (const [label, session] of [["a clinical_lead", clinicLead], ["a clinic_admin", clinicAdmin], ["the clinician themselves", clinicPractitioner]]) {
    const { error } = await session.client.rpc("set_clinician_workspace_email", {
      p_institution_id: clinic.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: "irrelevant@example.com",
    });
    ok(`non-director refused: ${label} cannot set a workspace email`, !!error, error?.message);
  }

  // The school-principal proof: a genuinely verified, active, current-
  // standing principal at a REAL verified institution, refused purely
  // on institution TYPE.
  {
    const { error } = await schoolPrincipal.client.rpc("set_clinician_workspace_email", {
      p_institution_id: school.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: "irrelevant@example.com",
    });
    ok(
      "a real, active, verified SCHOOL principal is refused by the clinic-only gate (institution-type check, not an authority check)",
      !!error && /clinical director/i.test(error.message ?? ""),
      error?.message
    );
  }

  // Cross-clinic isolation: clinic B's own director, acting on clinic A.
  {
    const { error } = await clinicBDirector.client.rpc("set_clinician_workspace_email", {
      p_institution_id: clinic.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: "irrelevant@example.com",
    });
    ok("clinic B's own director cannot set clinic A's practitioner's workspace email", !!error, error?.message);
  }
  // ...and the reverse: clinic A's director, targeting a person who
  // isn't AT clinic B, using clinic B's own id.
  {
    const { error } = await clinicDirector.client.rpc("set_clinician_workspace_email", {
      p_institution_id: clinicB.id, p_clinician_user_id: clinicPractitionerId, p_workspace_email: "irrelevant@example.com",
    });
    ok("clinic A's own director cannot act through clinic B's id either (fails the director check there)", !!error, error?.message);
  }

  // Partial unique index: same email for a SECOND clinician.
  {
    const { error } = await clinicDirector.client.rpc("set_clinician_workspace_email", {
      p_institution_id: clinic.id, p_clinician_user_id: clinicPractitionerBId, p_workspace_email: PRACTITIONER_EMAIL,
    });
    ok("a SECOND clinician cannot be given the same workspace email (partial unique index)", !!error, error?.message);
  }
  {
    const { data } = await admin.from("clinicians").select("workspace_email").eq("user_id", clinicPractitionerBId).single();
    ok("...and the failed attempt left practitioner B's own email untouched (still null)", data?.workspace_email === null, data);
  }

  // =====================================================================
  // PART B -- set_clinic_hours / set_booking_buffer_minutes /
  // set_booking_window_days.
  // =====================================================================
  console.log("\nPART B -- clinic-wide scheduling settings.");

  {
    const { data: before } = await admin.from("institutions").select("clinic_hours_start_time, clinic_hours_end_time, booking_buffer_minutes, booking_window_days").eq("id", clinic.id).single();
    ok("defaults: 09:00-17:00, 15 minute buffer, 30 day window", before.clinic_hours_start_time === "09:00:00" && before.clinic_hours_end_time === "17:00:00" && before.booking_buffer_minutes === 15 && before.booking_window_days === 30, before);
  }

  const { error: setHoursErr } = await clinicDirector.client.rpc("set_clinic_hours", { p_institution_id: clinic.id, p_start_time: "08:00:00", p_end_time: "18:00:00" });
  ok("director sets clinic hours (08:00-18:00)", !setHoursErr, setHoursErr?.message);

  const { error: invalidHoursErr } = await clinicDirector.client.rpc("set_clinic_hours", { p_institution_id: clinic.id, p_start_time: "18:00:00", p_end_time: "08:00:00" });
  ok("start >= end is refused", !!invalidHoursErr, invalidHoursErr?.message);

  const { error: leadHoursErr } = await clinicLead.client.rpc("set_clinic_hours", { p_institution_id: clinic.id, p_start_time: "07:00:00", p_end_time: "19:00:00" });
  ok("a clinical_lead cannot set clinic hours", !!leadHoursErr, leadHoursErr?.message);

  const { error: schoolHoursErr } = await schoolPrincipal.client.rpc("set_clinic_hours", { p_institution_id: school.id, p_start_time: "07:00:00", p_end_time: "19:00:00" });
  ok("a school principal cannot set clinic hours (clinic-only gate)", !!schoolHoursErr, schoolHoursErr?.message);

  const { error: setBufferErr } = await clinicDirector.client.rpc("set_booking_buffer_minutes", { p_institution_id: clinic.id, p_minutes: 20 });
  ok("director sets the booking buffer (20 minutes)", !setBufferErr, setBufferErr?.message);

  const { error: bufferTooHighErr } = await clinicDirector.client.rpc("set_booking_buffer_minutes", { p_institution_id: clinic.id, p_minutes: 121 });
  ok("buffer > 120 is refused", !!bufferTooHighErr, bufferTooHighErr?.message);
  const { error: bufferNegativeErr } = await clinicDirector.client.rpc("set_booking_buffer_minutes", { p_institution_id: clinic.id, p_minutes: -1 });
  ok("negative buffer is refused", !!bufferNegativeErr, bufferNegativeErr?.message);

  const { error: adminBufferErr } = await clinicAdmin.client.rpc("set_booking_buffer_minutes", { p_institution_id: clinic.id, p_minutes: 5 });
  ok("a clinic_admin cannot set the booking buffer", !!adminBufferErr, adminBufferErr?.message);

  const { error: setWindowErr } = await clinicDirector.client.rpc("set_booking_window_days", { p_institution_id: clinic.id, p_days: 45 });
  ok("director sets the booking window (45 days)", !setWindowErr, setWindowErr?.message);

  const { error: windowZeroErr } = await clinicDirector.client.rpc("set_booking_window_days", { p_institution_id: clinic.id, p_days: 0 });
  ok("a zero-day window is refused", !!windowZeroErr, windowZeroErr?.message);
  const { error: windowTooLongErr } = await clinicDirector.client.rpc("set_booking_window_days", { p_institution_id: clinic.id, p_days: 366 });
  ok("a 366-day window is refused", !!windowTooLongErr, windowTooLongErr?.message);

  const { error: schoolWindowErr } = await schoolPrincipal.client.rpc("set_booking_window_days", { p_institution_id: school.id, p_days: 60 });
  ok("a school principal cannot set the booking window (clinic-only gate)", !!schoolWindowErr, schoolWindowErr?.message);

  {
    const { data: after } = await admin.from("institutions").select("clinic_hours_start_time, clinic_hours_end_time, booking_buffer_minutes, booking_window_days").eq("id", clinic.id).single();
    ok(
      "only the VALID changes actually persisted: 08:00-18:00, 20 min buffer, 45 day window (every refused attempt above left these untouched)",
      after.clinic_hours_start_time === "08:00:00" && after.clinic_hours_end_time === "18:00:00" && after.booking_buffer_minutes === 20 && after.booking_window_days === 45,
      after
    );
  }

  // =====================================================================
  // PART C -- get_bookable_clinician_details().
  // =====================================================================
  console.log("\nPART C -- get_bookable_clinician_details().");

  {
    const { data, error } = await parent.client.rpc("get_bookable_clinician_details", { p_passport_id: passportId, p_clinician_id: clinicPractitionerId });
    ok(
      "the child's own parent resolves the engaged, workspace-email-set clinician, with the clinic's OWN just-set settings",
      !error && data?.workspace_email === PRACTITIONER_EMAIL.toLowerCase().trim() && data?.clinic_hours_start_time === "08:00:00" && data?.booking_buffer_minutes === 20 && data?.booking_window_days === 45,
      { error: error?.message, data }
    );
  }

  {
    const { error } = await parent.client.rpc("get_bookable_clinician_details", { p_passport_id: passportId, p_clinician_id: clinicPractitionerBId });
    ok("an engaged clinician with NO workspace email set yet is refused with a distinct, actionable message", !!error && /not yet set up/i.test(error.message ?? ""), error?.message);
  }

  {
    const { error } = await outsiderParent.client.rpc("get_bookable_clinician_details", { p_passport_id: passportId, p_clinician_id: clinicPractitionerId });
    ok("an unrelated parent (not this child's guardian) is refused entirely", !!error, error?.message);
  }

  {
    const { error } = await parent.client.rpc("get_bookable_clinician_details", { p_passport_id: passportId, p_clinician_id: clinicBDirectorId });
    ok("a clinician-id that isn't actually engaged on this child's caseload is refused", !!error, error?.message);
  }

  // =====================================================================
  // PART D -- the bookings table's own CHECK constraints. Service-role
  // direct inserts -- this table has no client INSERT policy at all in
  // Stage 1, so this is testing the constraints themselves, which the
  // database enforces regardless of caller.
  // =====================================================================
  console.log("\nPART D -- bookings CHECK constraints.");

  const baseBooking = {
    passport_id: passportId,
    clinician_id: clinicPractitionerId,
    institution_id: clinic.id,
    google_calendar_id: PRACTITIONER_EMAIL.toLowerCase().trim(),
    consented_at: now,
    created_by: clinicDirectorId,
  };

  {
    const { error } = await admin.from("bookings").insert({
      ...baseBooking,
      session_type: "online",
      session_start_at: "2027-01-05T10:00:00Z",
      session_end_at: "2027-01-05T11:00:00Z",
      travel_before_start_at: "2027-01-05T09:30:00Z", // an online booking must carry NO travel columns
      travel_after_end_at: "2027-01-05T11:30:00Z",
    });
    ok("an ONLINE booking carrying travel timestamps is refused (bookings_travel_paired)", !!error, error?.message);
  }

  {
    const { error } = await admin.from("bookings").insert({
      ...baseBooking,
      session_type: "in_person",
      session_start_at: "2027-01-05T10:00:00Z",
      session_end_at: "2027-01-05T11:00:00Z",
      // no travel columns at all -- in_person requires both
    });
    ok("an IN-PERSON booking with NO travel timestamps is refused (bookings_travel_paired)", !!error, error?.message);
  }

  const { data: validOnline, error: validOnlineErr } = await admin
    .from("bookings")
    .insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-05T10:00:00Z", session_end_at: "2027-01-05T11:00:00Z" })
    .select("id")
    .single();
  ok("a VALID online booking (no travel) succeeds", !validOnlineErr, validOnlineErr?.message);

  const { data: validInPerson, error: validInPersonErr } = await admin
    .from("bookings")
    .insert({
      ...baseBooking,
      session_type: "in_person",
      session_start_at: "2027-01-06T10:00:00Z",
      session_end_at: "2027-01-06T11:00:00Z",
      travel_before_start_at: "2027-01-06T09:30:00Z",
      travel_after_end_at: "2027-01-06T11:30:00Z",
    })
    .select("id")
    .single();
  ok("a VALID in-person booking (travel properly bracketing) succeeds", !validInPersonErr, validInPersonErr?.message);

  {
    const { error } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-07T11:00:00Z", session_end_at: "2027-01-07T10:00:00Z" });
    ok("session_end_at <= session_start_at is refused (bookings_session_times_valid)", !!error, error?.message);
  }

  {
    const { error } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-08T10:00:00Z", session_end_at: "2027-01-08T11:00:00Z", cancelled_via: "clinician_google" });
    ok("cancelled_via set without cancelled_at is refused (bookings_cancelled_paired)", !!error, error?.message);
  }
  {
    const { error } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-09T10:00:00Z", session_end_at: "2027-01-09T11:00:00Z", cancelled_at: now });
    ok("cancelled_at set without cancelled_via is refused (bookings_cancelled_paired)", !!error, error?.message);
  }

  // Overlap: validOnline is 2027-01-05 10:00-11:00 for clinicPractitioner.
  // A second, overlapping active booking for the SAME clinician must be
  // refused by the exclude constraint.
  {
    const { error } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-05T10:30:00Z", session_end_at: "2027-01-05T11:30:00Z" });
    ok("a genuinely overlapping ACTIVE booking for the SAME clinician is refused (bookings_no_overlap)", !!error, error?.message);
  }
  await admin.from("bookings").update({ cancelled_at: now, cancelled_by: clinicDirectorId, cancelled_via: "director", cancellation_reason: "test cleanup" }).eq("id", validOnline.id);
  {
    const { data, error } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-01-05T10:30:00Z", session_end_at: "2027-01-05T11:30:00Z" }).select("id").single();
    ok("...but once the original is CANCELLED, the identical overlapping time succeeds (the constraint is scoped to cancelled_at is null)", !error, error?.message);
    if (data) await admin.from("bookings").delete().eq("id", data.id); // tidy this one immediately, not needed past this assertion
  }

  // =====================================================================
  // PART E -- bookings RLS SELECT policies.
  // =====================================================================
  console.log("\nPART E -- bookings RLS.");

  const bookingUnderTest = validInPerson.id;

  {
    const { data } = await parent.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("the child's own parent can read the booking", (data ?? []).length === 1, data);
  }
  {
    const { data } = await outsiderParent.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("an unrelated parent cannot", (data ?? []).length === 0, data);
  }
  {
    const { data } = await clinicPractitioner.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("the owning clinician can read it", (data ?? []).length === 1, data);
  }
  {
    const { data } = await clinicPractitionerB.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("a DIFFERENT clinician at the same clinic cannot", (data ?? []).length === 0, data);
  }
  {
    const { data } = await clinicDirector.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("the director of the owning clinic can read it", (data ?? []).length === 1, data);
  }
  {
    const { data } = await clinicBDirector.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("the director of an UNRELATED clinic cannot (cross-clinic isolation)", (data ?? []).length === 0, data);
  }
  {
    const { data } = await schoolPrincipal.client.from("bookings").select("id").eq("id", bookingUnderTest);
    ok("a school principal cannot read a clinic's own booking at all", (data ?? []).length === 0, data);
  }

  // =====================================================================
  // PART F -- get_my_bookings_needing_attention().
  // =====================================================================
  console.log("\nPART F -- get_my_bookings_needing_attention().");

  const { data: driftedBooking } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-02-01T10:00:00Z", session_end_at: "2027-02-01T11:00:00Z", google_sync_status: "drifted" }).select("id").single();
  const { data: syncFailedBooking } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-02-02T10:00:00Z", session_end_at: "2027-02-02T11:00:00Z", google_sync_status: "sync_failed" }).select("id").single();
  const { data: syncedBooking } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-02-03T10:00:00Z", session_end_at: "2027-02-03T11:00:00Z", google_sync_status: "synced" }).select("id").single();
  const { data: cancelledDriftedBooking } = await admin.from("bookings").insert({ ...baseBooking, session_type: "online", session_start_at: "2027-02-04T10:00:00Z", session_end_at: "2027-02-04T11:00:00Z", google_sync_status: "drifted", cancelled_at: now, cancelled_by: clinicDirectorId, cancelled_via: "director" }).select("id").single();

  {
    const { data, error } = await clinicPractitioner.client.rpc("get_my_bookings_needing_attention");
    const ids = (data ?? []).map((r) => r.booking_id);
    ok(
      "the owning clinician sees drifted + sync_failed, and ONLY those (not synced, not cancelled)",
      !error && ids.includes(driftedBooking.id) && ids.includes(syncFailedBooking.id) && !ids.includes(syncedBooking.id) && !ids.includes(cancelledDriftedBooking.id),
      { error: error?.message, ids }
    );
  }
  {
    const { data } = await clinicPractitionerB.client.rpc("get_my_bookings_needing_attention");
    ok("a DIFFERENT clinician sees none of these (they're not theirs)", (data ?? []).length === 0, data);
  }

  // =====================================================================
  // PART G -- fail_stale_pending_bookings().
  // =====================================================================
  console.log("\nPART G -- fail_stale_pending_bookings().");

  const { data: stalePending } = await admin
    .from("bookings")
    .insert({ ...baseBooking, session_type: "online", session_start_at: "2027-03-01T10:00:00Z", session_end_at: "2027-03-01T11:00:00Z", google_sync_status: "pending" })
    .select("id")
    .single();
  // Backdate created_at directly -- gen_random_uuid()/now() defaults
  // can't be overridden on insert with a plain client call under RLS
  // in a way that matters here anyway (this is a service-role insert),
  // so backdate it explicitly with a second update.
  await admin.from("bookings").update({ created_at: new Date(Date.now() - 10 * 60 * 1000).toISOString() }).eq("id", stalePending.id);

  const { data: freshPending } = await admin
    .from("bookings")
    .insert({ ...baseBooking, session_type: "online", session_start_at: "2027-03-02T10:00:00Z", session_end_at: "2027-03-02T11:00:00Z", google_sync_status: "pending" })
    .select("id")
    .single();

  {
    const { error } = await clinicDirector.client.rpc("fail_stale_pending_bookings", { p_older_than_minutes: 5 });
    ok("an ordinary authenticated caller (even a director) cannot call fail_stale_pending_bookings() -- service_role only", !!error, error?.message);
  }

  {
    const { data: failedCount, error } = await admin.rpc("fail_stale_pending_bookings", { p_older_than_minutes: 5 });
    ok("service-role call succeeds and reports at least the one genuinely stale row", !error && typeof failedCount === "number" && failedCount >= 1, { error: error?.message, failedCount });
  }

  {
    const { data: staleRow } = await admin.from("bookings").select("google_sync_status").eq("id", stalePending.id).single();
    ok("the 10-minute-old pending row is now sync_failed", staleRow.google_sync_status === "sync_failed", staleRow);
    const { data: freshRow } = await admin.from("bookings").select("google_sync_status").eq("id", freshPending.id).single();
    ok("...but the just-created pending row (not yet stale) is untouched", freshRow.google_sync_status === "pending", freshRow);
  }

  {
    const { data } = await clinicPractitioner.client.rpc("get_my_bookings_needing_attention");
    const ids = (data ?? []).map((r) => r.booking_id);
    ok("the newly-failed row now surfaces via the SAME clinician queue -- no separate mechanism needed", ids.includes(stalePending.id), ids);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log("\nFixture IDs (for teardown / manual inspection):");
  console.log(JSON.stringify({ clinicId: clinic.id, clinicBId: clinicB.id, schoolId: school.id, passportId }, null, 2));

  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
