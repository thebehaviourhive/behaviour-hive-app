// Post-launch refinements RPC-level verification: sender-only closure
// (Change 2) and the waiting-count RPC (Change 3), including the
// clinician viewing-only exclusion. Run after seed.mjs + seed-messages.mjs.
//
// Also links clinician1 to passport2 (a second, purely read-only case
// for them -- no clinician-authored traffic on it) so the caseload-wide
// grouping (Change 1) and the "viewing-only never contributes to the
// badge" claim (Change 3) can both be checked live in the browser
// afterwards.
//
// Run with: node --env-file=.env.local scripts/messages-test/verify-refinements.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const PASSWORD = "MsgTest-2026!";

const seed = JSON.parse(readFileSync(new URL("./seed-output.json", import.meta.url)));
const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

let pass = 0, fail = 0;
function check(label, condition, extra) {
  if (condition) { pass++; console.log(`  ✓ ${label}`); }
  else { fail++; console.log(`  ✗ ${label}${extra !== undefined ? ` -- ${JSON.stringify(extra)}` : ""}`); }
}

async function clientFor(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

async function main() {
  const parent1 = await clientFor(seed.parent.email);
  const teacher1 = await clientFor(seed.teacher1.email);
  const teacher2 = await clientFor(seed.teacher2.email);
  const clinician1 = await clientFor(seed.clinician1.email);

  console.log("== Link clinician1 to passport2 (pure viewing-only case: no clinician traffic there) ==");
  const { error: linkError } = await service.from("clinician_access").upsert(
    { passport_id: seed.passportId2, clinician_id: seed.clinician1.id, is_active: true, linked_at: new Date().toISOString() },
    { onConflict: "passport_id,clinician_id" }
  );
  if (linkError) throw linkError;
  console.log("  linked.");

  console.log("\n== Find the RR message (parent1 -> teacher1, 'morning routine') ==");
  const { data: rrMessage, error: rrFindError } = await service
    .from("messages")
    .select("id, sender_id, status")
    .eq("passport_id", seed.passportId)
    .eq("response_required", true)
    .eq("sender_id", seed.parent.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (rrFindError || !rrMessage) throw new Error(`RR message not found: ${rrFindError?.message}`);
  check("RR message found, currently open", rrMessage.status !== "closed", rrMessage);

  console.log("\n== Awaiting-action counts BEFORE any reply/close ==");
  const { data: teacher1CountBefore } = await teacher1.rpc("get_messages_awaiting_action_count");
  const { data: parent1CountBefore } = await parent1.rpc("get_messages_awaiting_action_count");
  const { data: clinician1CountBefore } = await clinician1.rpc("get_messages_awaiting_action_count");
  console.log(`  teacher1=${teacher1CountBefore} parent1=${parent1CountBefore} clinician1=${clinician1CountBefore}`);
  check("teacher1 count = 6 (3 Other + 1 RR on passport1, 2 Other on passport2, all unacked recipient rows)", teacher1CountBefore === 6, teacher1CountBefore);
  check("parent1 count = 0 (sender of the RR thread, no reply yet -- ball isn't in their court)", parent1CountBefore === 0, parent1CountBefore);
  check(
    "clinician1 count = 1 (only their own direct unacked message from parent1 -- the passport1 parent<->teacher stream AND all of passport2's traffic are viewing-only, excluded)",
    clinician1CountBefore === 1,
    clinician1CountBefore
  );

  console.log("\n== Change 2 adversarial: recipient (teacher1) attempts close_message on the RR thread ==");
  const { error: recipientCloseError } = await teacher1.rpc("close_message", { p_message_id: rrMessage.id });
  check("rejected: recipient is not the sender", !!recipientCloseError, recipientCloseError);
  const { data: stillOpenRow } = await service.from("messages").select("status").eq("id", rrMessage.id).single();
  check("message still open server-side (recipient's attempt had no effect)", stillOpenRow.status !== "closed", stillOpenRow);

  console.log("\n== teacher1 replies (ball moves to parent1's court) ==");
  const { error: replyError } = await teacher1.rpc("reply_to_message", { p_message_id: rrMessage.id, p_body: "Sure, how about Thursday after drop-off?" });
  if (replyError) throw replyError;
  const { data: parent1CountAfterReply } = await parent1.rpc("get_messages_awaiting_action_count");
  check("parent1 count = 1 after teacher1's reply (latest reply isn't theirs -- ball in their court)", parent1CountAfterReply === 1, parent1CountAfterReply);
  const { data: teacher1CountAfterReply } = await teacher1.rpc("get_messages_awaiting_action_count");
  check("teacher1 count unchanged at 6 (still unacked as recipient -- replying isn't acknowledging)", teacher1CountAfterReply === 6, teacher1CountAfterReply);

  console.log("\n== Change 2: sender (parent1) closes normally ==");
  const { error: senderCloseError } = await parent1.rpc("close_message", { p_message_id: rrMessage.id });
  check("sender's close_message succeeds", !senderCloseError, senderCloseError);
  const { data: closedRow } = await service.from("messages").select("status").eq("id", rrMessage.id).single();
  check("message is now closed", closedRow.status === "closed", closedRow);

  const { data: parent1CountAfterClose } = await parent1.rpc("get_messages_awaiting_action_count");
  check("parent1 count back to 0 after closing (closed threads never count)", parent1CountAfterClose === 0, parent1CountAfterClose);
  const { data: teacher1CountAfterClose } = await teacher1.rpc("get_messages_awaiting_action_count");
  check("teacher1 count drops to 5 (the now-closed RR thread no longer counts as unacked-recipient)", teacher1CountAfterClose === 5, teacher1CountAfterClose);

  console.log("\n== Adversarial: sender attempts to close an already-closed message again ==");
  const { error: reCloseError } = await parent1.rpc("close_message", { p_message_id: rrMessage.id });
  check("rejected: already closed", !!reCloseError, reCloseError);

  console.log("\n== Spot-check Stage 1's walls are unaffected: teacher2 (non-participant) sees zero rows for passport1 ==");
  const { data: teacher2Rows } = await teacher2.from("messages").select("id").eq("passport_id", seed.passportId);
  check("teacher2 sees 0 messages on passport1 (never linked to it)", (teacher2Rows ?? []).length === 0, teacher2Rows);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
