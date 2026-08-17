// Stage 3 RPC-level adversarial checks. Run after seed.mjs +
// seed-stage3.mjs.
//
// Run with: node --env-file=.env.local scripts/messages-test/verify-stage3.mjs

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
  else { fail++; console.log(`  ✗ ${label}${extra ? ` -- ${JSON.stringify(extra)}` : ""}`); }
}

async function clientFor(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

async function main() {
  const teacher1 = await clientFor(seed.teacher1.email);
  const parent1 = await clientFor(seed.parent.email);

  const { data: categories } = await service.from("message_categories").select("id, label");
  const strategyUpdateId = categories.find((c) => c.label === "Strategy update").id;
  const incidentNoteId = categories.find((c) => c.label === "Incident note").id;

  console.log("== A teacher sending Strategy update via direct RPC is rejected ==");
  const { error: teacherStrategyError } = await teacher1.rpc("send_message", {
    p_passport_id: seed.passportId,
    p_category_id: strategyUpdateId,
    p_body: "I am not a clinician trying to send a strategy update.",
    p_response_required: false,
    p_recipient_ids: [seed.parent.id],
  });
  check("rejected: category not available to this role", !!teacherStrategyError, teacherStrategyError);

  console.log("\n== strategy_update=true without the Strategy update category is rejected ==");
  const { error: mismatchedFlagError } = await parent1.rpc("send_message", {
    p_passport_id: seed.passportId,
    p_category_id: incidentNoteId,
    p_body: "Trying to sneak the flag onto the wrong category.",
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
    p_strategy_update: true,
  });
  check("rejected: strategy_update requires the Strategy update category", !!mismatchedFlagError, mismatchedFlagError);

  console.log("\n== An abc_log_id from a different passport is rejected at send time ==");
  const { data: orphanLogRow } = await service
    .from("messages")
    .select("abc_log_id")
    .eq("id", seed.orphanRefMessageId)
    .single();
  const { error: crossPassportError } = await parent1.rpc("send_message", {
    p_passport_id: seed.passportId,
    p_category_id: incidentNoteId,
    p_body: "Trying to reference an unrelated child's log.",
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
    p_abc_log_id: orphanLogRow.abc_log_id,
  });
  check("rejected: incident log does not belong to this passport", !!crossPassportError, crossPassportError);

  console.log("\n== The pre-swapped orphan-reference message: log unreachable, message itself still fine ==");
  const { count: orphanVisibleToTeacher1 } = await service
    .from("abc_logs")
    .select("id", { count: "exact", head: true })
    .eq("id", orphanLogRow.abc_log_id);
  check("orphan log genuinely exists in the DB (FK-valid)", (orphanVisibleToTeacher1 ?? 0) === 1);
  const { data: teacher1SeesMessage } = await teacher1.from("messages").select("id").eq("id", seed.orphanRefMessageId);
  check("teacher1 (recipient) still sees the MESSAGE itself", (teacher1SeesMessage ?? []).length === 1);
  const { data: teacher1SeesOrphanLog } = await teacher1.from("abc_logs").select("id").eq("id", orphanLogRow.abc_log_id);
  check("...but teacher1's own RLS returns ZERO rows for the orphan log (this is the 'unavailable' state)", (teacher1SeesOrphanLog ?? []).length === 0);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
