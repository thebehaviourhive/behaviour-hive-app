// Adversarial + RPC-level verification for Messages Stage 1, run against
// the accounts seed.mjs just created. Signs in as each real user (real
// JWTs, not service-role) to prove RLS/RPC behaviour matches the brief.
//
// Run with: node --env-file=.env.local scripts/messages-test/verify.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "MsgTest-2026!";

const seed = JSON.parse(readFileSync(new URL("./seed-output.json", import.meta.url)));

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
    console.log(`  ✗ ${label}${extra ? ` -- ${JSON.stringify(extra)}` : ""}`);
  }
}

async function clientFor(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

async function main() {
  const passportId = seed.passportId;

  console.log("== Signing in as each real user ==");
  const parent = await clientFor(seed.parent.email);
  const teacher1 = await clientFor(seed.teacher1.email);
  const teacher2 = await clientFor(seed.teacher2.email);
  const clinician1 = await clientFor(seed.clinician1.email);
  console.log("  signed in: parent, teacher1, teacher2, clinician1");

  console.log("\n== Categories load from data ==");
  const { data: categories, error: categoriesError } = await service
    .from("message_categories")
    .select("id, label, allowed_sender_roles")
    .eq("is_active", true)
    .order("sort_order");
  // 11, not 10: migration 0062 (Messages Stage 3) added "Incident note"
  // after this suite was first written. Assert the real current set
  // rather than a stale headcount, so a genuine future drift (a
  // category silently added/removed/deactivated) still fails loudly.
  const expectedActiveLabels = [
    "Schedule change", "Collection/drop-off", "Incident note", "Forgotten item",
    "Medication note", "Sleep/morning heads-up", "Wellbeing note", "School supplies",
    "Contact me when you can", "Strategy update", "Other",
  ];
  check(
    "11 active categories seeded, matching the expected set",
    !categoriesError &&
      categories.length === expectedActiveLabels.length &&
      expectedActiveLabels.every((label) => categories.some((c) => c.label === label)),
    categoriesError || categories.map((c) => c.label)
  );
  const scheduleChange = categories.find((c) => c.label === "Schedule change");
  const wellbeingNote = categories.find((c) => c.label === "Wellbeing note");
  const strategyUpdate = categories.find((c) => c.label === "Strategy update");
  check("Strategy update is clinician-only", JSON.stringify(strategyUpdate.allowed_sender_roles) === JSON.stringify(["clinician"]));

  console.log("\n== get_message_recipient_candidates ==");
  const { data: parentCandidates } = await parent.client.rpc("get_message_recipient_candidates", {
    p_passport_id: passportId,
  });
  check(
    "parent sees teacher1 + clinician1 as candidates (not self)",
    parentCandidates?.length === 2 &&
      parentCandidates.some((c) => c.recipient_id === seed.teacher1.id) &&
      parentCandidates.some((c) => c.recipient_id === seed.clinician1.id) &&
      !parentCandidates.some((c) => c.recipient_id === seed.parent.id),
    parentCandidates
  );

  const { data: teacher2Candidates } = await teacher2.client.rpc("get_message_recipient_candidates", {
    p_passport_id: passportId,
  });
  check("non-participant teacher2 gets ZERO candidates (not authorized on this passport)", (teacher2Candidates ?? []).length === 0, teacher2Candidates);

  console.log("\n== send_message: parent -> teacher1 (non-RR) ==");
  const { data: msg1Id, error: send1Error } = await parent.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: scheduleChange.id,
    p_body: "Pickup is 3:30 today instead of 3:00.",
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
  });
  check("send succeeds", !send1Error && !!msg1Id, send1Error);

  console.log("\n== Adversarial: non-participant teacher2 gets ZERO rows for msg1 ==");
  const { data: t2Read, error: t2ReadError } = await teacher2.client.from("messages").select("id").eq("id", msg1Id);
  check("teacher2 select returns 0 rows", !t2ReadError && (t2Read ?? []).length === 0, t2ReadError ?? t2Read);

  console.log("\n== teacher1 (participant) CAN read msg1 ==");
  const { data: t1Read } = await teacher1.client.from("messages").select("id, status").eq("id", msg1Id);
  check("teacher1 select returns 1 row", (t1Read ?? []).length === 1, t1Read);

  console.log("\n== teacher1 acknowledges msg1 -> status flips to acknowledged (sole recipient) ==");
  const { error: ackError } = await teacher1.client.rpc("acknowledge_message", { p_message_id: msg1Id });
  check("acknowledge_message succeeds", !ackError, ackError);
  const { data: afterAck } = await service
    .from("messages")
    .select("status, message_recipients(acknowledged_at)")
    .eq("id", msg1Id)
    .single();
  check("status is 'acknowledged'", afterAck.status === "acknowledged", afterAck);
  check("acknowledged_at stamped", !!afterAck.message_recipients[0]?.acknowledged_at);

  console.log("\n== acknowledge_message is idempotent (retry-safe) ==");
  const { error: ackAgainError } = await teacher1.client.rpc("acknowledge_message", { p_message_id: msg1Id });
  check("second acknowledge call does not error (safe no-op)", !ackAgainError, ackAgainError);

  console.log("\n== Immutability: no one can UPDATE or DELETE a message, including the sender ==");
  const { data: parentUpdateResult, error: parentUpdateErr } = await parent.client
    .from("messages")
    .update({ body: "hacked" })
    .eq("id", msg1Id)
    .select();
  check(
    "parent (sender) cannot UPDATE messages.body",
    (parentUpdateResult ?? []).length === 0,
    { parentUpdateResult, parentUpdateErr }
  );
  const { data: parentDeleteResult } = await parent.client.from("messages").delete().eq("id", msg1Id).select();
  check("parent (sender) cannot DELETE the message", (parentDeleteResult ?? []).length === 0, parentDeleteResult);
  const { data: verifyStillThere } = await service.from("messages").select("id, body").eq("id", msg1Id).single();
  check("message row + original body still intact after attempted tamper", verifyStillThere?.body?.includes("Pickup"), verifyStillThere);

  console.log("\n== send_message: 201-char body rejected (RPC-level guard) ==");
  const { error: tooLongRpcError } = await parent.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: scheduleChange.id,
    p_body: "a".repeat(201),
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
  });
  check("send_message rejects 201-char body", !!tooLongRpcError, tooLongRpcError);

  console.log("\n== 201-char body rejected at the DB level (CHECK constraint, bypassing the RPC) ==");
  const { error: checkConstraintError } = await service.from("messages").insert({
    passport_id: passportId,
    sender_id: seed.parent.id,
    sender_role: "parent",
    category_id: scheduleChange.id,
    body: "b".repeat(201),
    response_required: false,
    status: "open",
  });
  check(
    "direct insert with 201-char body violates messages_body_length CHECK",
    !!checkConstraintError && /messages_body_length|check constraint/i.test(checkConstraintError.message ?? ""),
    checkConstraintError
  );

  console.log("\n== Response Required: reply -> in_discussion -> close ==");
  const { data: rrMsgId, error: rrSendError } = await parent.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: scheduleChange.id,
    p_body: "Can we talk about the transition plan?",
    p_response_required: true,
    p_recipient_ids: [seed.teacher1.id],
  });
  check("RR send succeeds", !rrSendError && !!rrMsgId, rrSendError);

  const { error: replyError } = await teacher1.client.rpc("reply_to_message", {
    p_message_id: rrMsgId,
    p_body: "Yes, let's talk after pickup.",
  });
  check("teacher1 (recipient/participant) can reply", !replyError, replyError);
  const { data: afterReply } = await service.from("messages").select("status").eq("id", rrMsgId).single();
  check("status is 'in_discussion' after first reply", afterReply.status === "in_discussion", afterReply);

  console.log("\n== Clinician read-only mid-day signal on this parent<->teacher RR message ==");
  const { data: clinicianRead } = await clinician1.client.from("messages").select("id").eq("id", rrMsgId);
  check("clinician1 CAN read the parent<->teacher message (read-only signal)", (clinicianRead ?? []).length === 1, clinicianRead);
  const { error: clinicianReplyError } = await clinician1.client.rpc("reply_to_message", {
    p_message_id: rrMsgId,
    p_body: "I'll chime in too",
  });
  check("clinician1 CANNOT reply (not a participant)", !!clinicianReplyError, clinicianReplyError);
  const { error: clinicianAckError } = await clinician1.client.rpc("acknowledge_message", { p_message_id: rrMsgId });
  check("clinician1's acknowledge call is a safe no-op (not a recipient)", !clinicianAckError, clinicianAckError);
  const { data: clinicianAckCheck } = await service
    .from("message_recipients")
    .select("recipient_id")
    .eq("message_id", rrMsgId)
    .eq("recipient_id", seed.clinician1.id);
  check("...and did NOT create a recipient row for the clinician", (clinicianAckCheck ?? []).length === 0, clinicianAckCheck);

  const { error: closeError } = await parent.client.rpc("close_message", { p_message_id: rrMsgId });
  check("participant (parent) can close the RR message", !closeError, closeError);
  const { data: afterClose } = await service.from("messages").select("status").eq("id", rrMsgId).single();
  check("status is 'closed'", afterClose.status === "closed", afterClose);
  const { error: replyAfterCloseError } = await teacher1.client.rpc("reply_to_message", {
    p_message_id: rrMsgId,
    p_body: "one more thing",
  });
  check("reply after close is rejected", !!replyAfterCloseError, replyAfterCloseError);

  console.log("\n== Teacher <-> clinician message: parent (data-subject) can still read it ==");
  const { data: tcMsgId, error: tcSendError } = await teacher1.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: wellbeingNote.id,
    p_body: "Flagging a wobble at lunch today.",
    p_response_required: false,
    p_recipient_ids: [seed.clinician1.id],
  });
  check("teacher1 -> clinician1 send succeeds", !tcSendError && !!tcMsgId, tcSendError);
  const { data: parentReadsTC } = await parent.client.from("messages").select("id").eq("id", tcMsgId);
  check("parent reads teacher<->clinician message (data-subject, not a participant)", (parentReadsTC ?? []).length === 1, parentReadsTC);
  const { data: teacher2ReadsTC } = await teacher2.client.from("messages").select("id").eq("id", tcMsgId);
  check("non-participant teacher2 still gets ZERO rows for this one too", (teacher2ReadsTC ?? []).length === 0, teacher2ReadsTC);

  console.log("\n== Response Required cap: max 3 concurrent open, per sender per child ==");
  const capIds = [];
  for (let i = 0; i < 3; i++) {
    const { data: id, error } = await parent.client.rpc("send_message", {
      p_passport_id: passportId,
      p_category_id: scheduleChange.id,
      p_body: `Cap test message ${i + 1}`,
      p_response_required: true,
      p_recipient_ids: [seed.teacher1.id],
    });
    check(`cap test RR message ${i + 1}/3 sends successfully`, !error && !!id, error);
    if (id) capIds.push(id);
  }
  const { error: fourthError } = await parent.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: scheduleChange.id,
    p_body: "Cap test message 4 (should be rejected)",
    p_response_required: true,
    p_recipient_ids: [seed.teacher1.id],
  });
  check("4th concurrent open RR message is rejected at the RPC level", !!fourthError, fourthError);
  // Close one, confirm the cap frees up (sanity check the cap counts OPEN ones, not all-time).
  if (capIds[0]) {
    await parent.client.rpc("close_message", { p_message_id: capIds[0] });
    const { error: afterCloseSendError } = await parent.client.rpc("send_message", {
      p_passport_id: passportId,
      p_category_id: scheduleChange.id,
      p_body: "Cap test message 5 (should succeed, one was closed)",
      p_response_required: true,
      p_recipient_ids: [seed.teacher1.id],
    });
    check("closing one frees a cap slot for a new RR message", !afterCloseSendError, afterCloseSendError);
  }

  console.log("\n== Revocation: revoking teacher1's passport_access removes access immediately ==");
  await service.from("passport_access").update({ is_active: false }).eq("passport_id", passportId).eq("teacher_id", seed.teacher1.id);
  const { data: revokedRead } = await teacher1.client.from("messages").select("id").eq("id", msg1Id);
  check("revoked teacher1 loses access to a message they were already part of (same JWT, no re-login)", (revokedRead ?? []).length === 0, revokedRead);
  const { data: revokedCandidates } = await teacher1.client.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
  check("revoked teacher1 also loses candidate visibility", (revokedCandidates ?? []).length === 0, revokedCandidates);
  const { error: revokedSendError } = await teacher1.client.rpc("send_message", {
    p_passport_id: passportId,
    p_category_id: scheduleChange.id,
    p_body: "should be rejected",
    p_response_required: false,
    p_recipient_ids: [seed.parent.id],
  });
  check("revoked teacher1 cannot send_message on this passport", !!revokedSendError, revokedSendError);
  // Restore for tidiness (cleanup.mjs deletes everything regardless).
  await service.from("passport_access").update({ is_active: true }).eq("passport_id", passportId).eq("teacher_id", seed.teacher1.id);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
