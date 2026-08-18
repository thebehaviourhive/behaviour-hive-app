// Phase 4: full SNA lifecycle + adversarial denial table, run against
// real user JWTs (never service role) for every step that matters --
// mirroring the exact DB operations the real UI performs (ShareBottomSheet's
// approve, AddChildSheet's link, ABCLogger's insert, the clinician's FBA
// send flow, and passport/dashboard's handleRevoke), not a shortcut
// version of them.
//
// Run with: node --env-file=.env.local scripts/messages-test/sna-phase4-verify.mjs

import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "SnaPhase4-2026!";

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

let pass = 0;
let fail = 0;
function check(label, condition, extra) {
  if (condition) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.log(`  ✗ ${label}${extra !== undefined ? ` -- ${JSON.stringify(extra)}` : ""}`);
  }
}

async function clientFor(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

async function createUser(email, fullName, role) {
  const { data, error } = await service.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) throw error;
  return data.user;
}

const EMAILS = {
  parent: "snap4.parent@thebehaviourhive.com",
  teacher: "snap4.teacher@thebehaviourhive.com",
  sna: "snap4.sna@thebehaviourhive.com",
  clinician: "snap4.clinician@thebehaviourhive.com",
};
const INSTITUTION_CODE = "SNAP4-TEST";

async function main() {
  console.log("== SETUP ==");
  const { data: inst, error: instErr } = await service
    .from("institutions")
    .insert({ name: "SNA Phase 4 Test School", institution_code: INSTITUTION_CODE, status: "verified" })
    .select("id")
    .single();
  if (instErr) throw instErr;

  const parent = await createUser(EMAILS.parent, "Phase4 Parent", "parent");
  const teacher = await createUser(EMAILS.teacher, "Phase4 Teacher", "class_teacher");
  const sna = await createUser(EMAILS.sna, "Phase4 SNA", "sna");
  const clinician = await createUser(EMAILS.clinician, "Dr. Phase4 Clinician", "clinician");

  const { error: clinErr } = await service.from("clinicians").insert({
    user_id: clinician.id,
    full_name: "Dr. Phase4 Clinician",
    specialty: "behavioural_psychologist",
    verification_status: "verified",
    clinician_code: "P4DOC001",
  });
  if (clinErr) throw clinErr;

  const { data: passport, error: passErr } = await service
    .from("passports")
    .insert({
      user_id: parent.id,
      child_name: "Phase4 Child",
      diagnoses: ["Autism"],
      passport_code: "P4CODE01",
      passport_code_active: true,
    })
    .select("id")
    .single();
  if (passErr) throw passErr;

  // School EMPLOYMENT (institution_staff) is seeded directly -- this is
  // not part of what this phase re-verifies (Phase 2 already fully
  // live-verified the join-institution flow for both roles). What
  // matters here is everything downstream of it: parent approval,
  // linking to THIS CHILD specifically, and revocation.
  for (const [userId, role] of [[teacher.id, "class_teacher"], [sna.id, "sna"]]) {
    const { error } = await service
      .from("institution_staff")
      .insert({ user_id: userId, institution_id: inst.id, role });
    if (error) throw error;
  }

  console.log(`institution=${inst.id} passport=${passport.id}`);
  console.log(`parent=${parent.id} teacher=${teacher.id} sna=${sna.id} clinician=${clinician.id}`);

  const parentClient = await clientFor(EMAILS.parent);
  const teacherClient = await clientFor(EMAILS.teacher);
  const snaClient = await clientFor(EMAILS.sna);
  const clinicianClient = await clientFor(EMAILS.clinician);

  // =====================================================================
  console.log("\n== LIFECYCLE 1: parent approves the institution (ShareBottomSheet's real logic, via parent JWT) ==");
  const { error: approveErr } = await parentClient.from("passport_institution_links").insert({
    passport_id: passport.id,
    institution_id: inst.id,
    approved_by_parent: true,
    parent_approved_at: new Date().toISOString(),
  });
  check("parent approve-institution insert succeeds under RLS", !approveErr, approveErr);

  console.log("\n== LIFECYCLE 2: SNA links to the child via passport code (AddChildSheet's real logic, via SNA JWT) ==");
  const { data: lookupRows, error: lookupErr } = await snaClient.rpc("lookup_passport_by_code", {
    code: "P4CODE01",
  });
  check("SNA can look up the passport by code", !lookupErr && lookupRows?.[0]?.id === passport.id, lookupErr);

  const { error: linkErr } = await snaClient.from("passport_access").insert({
    passport_id: passport.id,
    teacher_id: sna.id,
    institution_id: inst.id,
    is_active: true,
    actor_role: "sna",
  });
  check(
    "SNA's passport_access self-insert succeeds with actor_role='sna' (the §12 mechanism, live)",
    !linkErr,
    linkErr
  );

  // Also confirm the §12 fail-closed direction: an SNA CANNOT insert a
  // row claiming actor_role='class_teacher' for themselves
  // (current_user_role() mismatch) -- passports are one-per-parent
  // (unique on user_id), so this needs its own second parent + child to
  // prove the check is real, not just permissive-by-accident.
  const parent2 = await createUser("snap4.parent2@thebehaviourhive.com", "Phase4 Parent Two", "parent");
  const { data: passport2 } = await service
    .from("passports")
    .insert({ user_id: parent2.id, child_name: "Phase4 Child Two", passport_code: "P4CODE02", passport_code_active: true })
    .select("id")
    .single();
  const parent2Client = await clientFor("snap4.parent2@thebehaviourhive.com");
  await parent2Client.from("passport_institution_links").insert({
    passport_id: passport2.id,
    institution_id: inst.id,
    approved_by_parent: true,
    parent_approved_at: new Date().toISOString(),
  });
  const { error: spoofErr } = await snaClient.from("passport_access").insert({
    passport_id: passport2.id,
    teacher_id: sna.id,
    institution_id: inst.id,
    is_active: true,
    actor_role: "class_teacher",
  });
  check("SNA CANNOT self-insert actor_role='class_teacher' (fails closed)", !!spoofErr, spoofErr);

  // The class_teacher also links to child 1 (byte-identical AddChildSheet
  // flow, actor_role='class_teacher') -- this is what makes the
  // institution-wide revoke in LIFECYCLE 9 a genuine test of "touches
  // both roles at once", not just the SNA in isolation.
  const { error: teacherLinkErr } = await teacherClient.from("passport_access").insert({
    passport_id: passport.id,
    teacher_id: teacher.id,
    institution_id: inst.id,
    is_active: true,
    actor_role: "class_teacher",
  });
  check("class_teacher also links to child 1 (setup for the institution-wide revoke test)", !teacherLinkErr, teacherLinkErr);

  console.log("\n== LIFECYCLE 3: SNA's Passports-home query returns the child ==");
  const { data: snaAccessRows } = await snaClient
    .from("passport_access")
    .select("passport_id")
    .eq("teacher_id", sna.id)
    .eq("is_active", true);
  check("SNA sees exactly 1 active passport_access row (child 1 only)", snaAccessRows?.length === 1, snaAccessRows);

  console.log("\n== LIFECYCLE 4: SNA logs an ABC incident (ABCLogger's real insert, via SNA JWT) ==");
  const { data: snaLog, error: snaLogErr } = await snaClient
    .from("abc_logs")
    .insert({
      passport_id: passport.id,
      logged_by: sna.id,
      logged_by_role: "sna",
      incident_date: "2026-08-18",
      incident_time: "13:00",
      intensity: 4,
      antecedents: ["Other"],
      antecedent_other: "phase4 test",
      behaviours: ["Other"],
      behaviour_other: "phase4 test",
      consequences: ["Other"],
      consequence_other: "phase4 test",
      general_notes: "Logged by SNA during Phase 4 lifecycle verification.",
    })
    .select("id")
    .single();
  check("SNA's ABC log insert succeeds", !snaLogErr && !!snaLog, snaLogErr);

  console.log("\n== LIFECYCLE 5: parent sees the log tagged SNA, and Your Team card shows '[Name], SNA' ==");
  const { data: parentLogs } = await parentClient.rpc("get_abc_logs", { p_passport_id: passport.id });
  const parentSeesSnaLog = (parentLogs ?? []).find((r) => r.id === snaLog?.id);
  check(
    "parent's get_abc_logs shows the SNA log with logged_by_role='sna'",
    parentSeesSnaLog?.logged_by_role === "sna",
    parentSeesSnaLog
  );

  const { data: team } = await parentClient.rpc("get_passport_team", { p_passport_id: passport.id });
  const snaTeamRow = (team ?? []).find((r) => r.teacher_id === sna.id);
  check(
    "get_passport_team returns the SNA with role='sna' and the right name (the exact data YourTeamCard renders as '[Name], SNA')",
    snaTeamRow?.role === "sna" && snaTeamRow?.full_name === "Phase4 SNA",
    snaTeamRow
  );

  console.log("\n== LIFECYCLE 6: clinician sends a QABF questionnaire to the SNA ==");
  const { error: clinAccessErr } = await service.from("clinician_access").insert({
    passport_id: passport.id,
    clinician_id: clinician.id,
    is_active: true,
    linked_at: new Date().toISOString(),
  });
  check("clinician_access link succeeds (setup, service role)", !clinAccessErr, clinAccessErr);

  const { data: fbaReport, error: fbaErr } = await clinicianClient
    .from("fba_reports")
    .insert({ passport_id: passport.id, clinician_id: clinician.id, status: "in_progress" })
    .select("id")
    .single();
  check("clinician creates the FBA report (via clinician JWT)", !fbaErr && !!fbaReport, fbaErr);

  const { data: candidates, error: candErr } = await clinicianClient.rpc("get_fba_recipient_candidates", {
    p_fba_id: fbaReport?.id,
  });
  const snaCandidate = (candidates ?? []).find((c) => c.recipient_id === sna.id);
  check(
    "get_fba_recipient_candidates lists the SNA with the correct role label (not mislabeled 'class_teacher')",
    snaCandidate?.role === "sna",
    { candidates, candErr }
  );

  const { data: instrumentRequest, error: sendErr } = await clinicianClient
    .from("fba_instrument_requests")
    .insert({
      fba_id: fbaReport?.id,
      passport_id: passport.id,
      instrument_type: "qabf",
      recipient_id: sna.id,
      status: "sent",
    })
    .select("id")
    .single();
  check("clinician sends the QABF request to the SNA", !sendErr && !!instrumentRequest, sendErr);

  console.log("\n== LIFECYCLE 7: SNA sees and completes the questionnaire blind ==");
  const { data: myRequests, error: myReqErr } = await snaClient.rpc("get_my_instrument_requests");
  const mine = (myRequests ?? []).find((r) => r.id === instrumentRequest?.id);
  check("SNA's get_my_instrument_requests shows the pending QABF", !myReqErr && !!mine, { myRequests, myReqErr });

  const { error: completeErr } = await snaClient
    .from("fba_instrument_requests")
    .update({ responses_data: { "qabf-1": "2", "qabf-2": "0" }, status: "completed" })
    .eq("id", instrumentRequest?.id);
  check("SNA completes the questionnaire (recipient-scoped update)", !completeErr, completeErr);

  console.log("\n== LIFECYCLE 8: clinician sees the SNA's completed response ==");
  const { data: reqAfter } = await clinicianClient
    .from("fba_instrument_requests")
    .select("status, responses_data")
    .eq("id", instrumentRequest?.id)
    .maybeSingle();
  check(
    "clinician sees status='completed' with the SNA's answers",
    reqAfter?.status === "completed" && Object.keys(reqAfter?.responses_data ?? {}).length === 2,
    reqAfter
  );

  // =====================================================================
  console.log("\n== ADVERSARIAL DENIAL TABLE (SNA still actively linked at this point) ==");

  console.log("\n-- Messages --");
  const { data: msgCandidates } = await snaClient.rpc("get_message_recipient_candidates", {
    p_passport_id: passport.id,
  });
  check("get_message_recipient_candidates: SNA gets ZERO candidates", (msgCandidates ?? []).length === 0, msgCandidates);

  const { data: teacherMsg } = await service
    .from("messages")
    .insert({
      passport_id: passport.id,
      sender_id: teacher.id,
      sender_role: "class_teacher",
      category_id: (
        await service.from("message_categories").select("id").eq("label", "Other").maybeSingle()
      ).data.id,
      body: "phase4 adversarial test message",
      response_required: false,
      status: "open",
    })
    .select("id")
    .single();
  await service.from("message_recipients").insert({
    message_id: teacherMsg.id,
    recipient_id: parent.id,
    recipient_role: "parent",
  });
  const { data: canView } = await snaClient.rpc("can_view_message", { p_message_id: teacherMsg.id });
  check("can_view_message: SNA cannot view a teacher<->parent message", canView === false, canView);

  const { error: sendMsgErr } = await snaClient.rpc("send_message", {
    p_passport_id: passport.id,
    p_category_id: (await service.from("message_categories").select("id").eq("label", "Other").maybeSingle()).data.id,
    p_body: "SNA attempting to send a message",
    p_response_required: false,
    p_recipient_ids: [parent.id],
  });
  check("send_message: SNA is rejected ('not authorized to message about this child')", !!sendMsgErr, sendMsgErr?.message);

  const { data: awaitingCount } = await snaClient.rpc("get_messages_awaiting_action_count");
  check("get_messages_awaiting_action_count: SNA's count is 0", awaitingCount === 0, awaitingCount);

  console.log("\n-- EOD (teacher_updates) --");
  const { error: eodErr } = await snaClient.from("teacher_updates").insert({
    passport_id: passport.id,
    teacher_id: sna.id,
    settled_state: "settled",
    energy_level: 3,
  });
  check("teacher_updates insert: SNA is rejected by RLS", !!eodErr, eodErr?.message);

  console.log("\n-- FBA (fba_reports) --");
  const { data: fbaSelect } = await snaClient.from("fba_reports").select("id").eq("passport_id", passport.id);
  check("fba_reports select: SNA gets ZERO rows (no policy admits class_teacher or sna at all)", (fbaSelect ?? []).length === 0, fbaSelect);

  console.log("\n-- Progress (get_abc_trend_data) --");
  const { data: trendData } = await snaClient.rpc("get_abc_trend_data", { p_passport_id: passport.id });
  check("get_abc_trend_data: SNA gets ZERO rows, including their own logged incident", (trendData ?? []).length === 0, trendData);

  console.log("\n-- Activity feed (get_teacher_activity_feed) --");
  const { data: feedData } = await snaClient.rpc("get_teacher_activity_feed");
  const feedHasThisPassport = (feedData ?? []).some((r) => r.passport_id === passport.id);
  check("get_teacher_activity_feed: SNA sees nothing for this passport", !feedHasThisPassport, feedData?.length);

  console.log("\n-- strategy_ledger --");
  const { error: ledgerErr } = await snaClient.from("strategy_ledger").insert({
    passport_id: passport.id,
    submitted_by: sna.id,
    entry_type: "observation",
    description: "SNA attempting a ledger entry",
  });
  check("strategy_ledger insert: SNA is rejected by RLS", !!ledgerErr, ledgerErr?.message);

  console.log("\n-- strategy_feedback_prompts --");
  const { error: feedbackErr } = await snaClient.from("strategy_feedback_prompts").insert({
    passport_id: passport.id,
    teacher_id: sna.id,
  });
  check("strategy_feedback_prompts insert: SNA is rejected by RLS", !!feedbackErr, feedbackErr?.message);

  // =====================================================================
  console.log("\n== LIFECYCLE 9: parent revokes the institution (handleRevoke's real logic, via parent JWT) ==");
  const { data: linkRevoke, error: linkRevokeErr } = await parentClient
    .from("passport_institution_links")
    .update({ approved_by_parent: false })
    .eq("passport_id", passport.id)
    .eq("institution_id", inst.id)
    .select("id");
  const { data: accessRevoke, error: accessRevokeErr } = await parentClient
    .from("passport_access")
    .update({ is_active: false })
    .eq("passport_id", passport.id)
    .eq("institution_id", inst.id)
    .select("id");
  check(
    "revoke: both passport_institution_links and passport_access rows updated",
    !linkRevokeErr && !accessRevokeErr && linkRevoke?.length === 1 && accessRevoke?.length === 2,
    { linkRevoke, accessRevoke, linkRevokeErr, accessRevokeErr }
  );

  console.log("\n== LIFECYCLE 10: SNA's access is severed mid-flight ==");
  const { data: snaAccessAfter } = await snaClient
    .from("passport_access")
    .select("passport_id")
    .eq("teacher_id", sna.id)
    .eq("is_active", true);
  check("SNA's Passports-home query now returns ZERO active rows", (snaAccessAfter ?? []).length === 0, snaAccessAfter);

  const { data: scopedGuard } = await snaClient
    .from("passport_access")
    .select("is_active")
    .eq("passport_id", passport.id)
    .eq("teacher_id", sna.id)
    .maybeSingle();
  check(
    "the scoped passport view's own access guard now sees is_active=false (triggers the 'no access' state)",
    scopedGuard?.is_active === false,
    scopedGuard
  );

  console.log("\n== LIFECYCLE 11: the SNA's ABC log persists after revocation ==");
  const { data: logStillThere } = await service.from("abc_logs").select("id, logged_by_role").eq("id", snaLog?.id).maybeSingle();
  check("the SNA-authored log still exists, unchanged, after revocation", logStillThere?.logged_by_role === "sna", logStillThere);

  const { data: parentLogsAfter } = await parentClient.rpc("get_abc_logs", { p_passport_id: passport.id });
  const parentStillSeesIt = (parentLogsAfter ?? []).find((r) => r.id === snaLog?.id);
  check("parent can still see that historical log after the SNA's access was revoked", !!parentStillSeesIt, parentStillSeesIt);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
