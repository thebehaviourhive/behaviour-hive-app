// Populates messages for Stage 2 live verification (triage grouping,
// batch-ack, Clinical File read-only stream) using REAL signed-in
// sessions, since send_message requires auth.uid() (service role has
// none). Run after seed.mjs.
//
// Run with: node --env-file=.env.local scripts/messages-test/seed-messages.mjs

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

async function clientFor(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in ${email}: ${error.message}`);
  return client;
}

async function main() {
  const parent1 = await clientFor(seed.parent.email);
  const parent2 = await clientFor(seed.parent2.email);
  const teacher1 = await clientFor(seed.teacher1.email);

  const { data: categories } = await service.from("message_categories").select("id, label");
  const cat = (label) => categories.find((c) => c.label === label).id;

  console.log("== Parent1 -> Teacher1: 3 open messages (child 1) ==");
  for (const body of ["Forgot lunchbox today.", "Running 10 mins late for pickup.", "New shoes, might rub a bit."]) {
    const { error } = await parent1.rpc("send_message", {
      p_passport_id: seed.passportId,
      p_category_id: cat("Other"),
      p_body: body,
      p_response_required: false,
      p_recipient_ids: [seed.teacher1.id],
    });
    if (error) throw new Error(`parent1 send: ${error.message}`);
  }

  console.log("== Parent1 -> Teacher1: 1 response-required message (child 1) ==");
  {
    const { error } = await parent1.rpc("send_message", {
      p_passport_id: seed.passportId,
      p_category_id: cat("Contact me when you can"),
      p_body: "Could we talk about the morning routine?",
      p_response_required: true,
      p_recipient_ids: [seed.teacher1.id],
    });
    if (error) throw new Error(`parent1 RR send: ${error.message}`);
  }

  console.log("== Parent1 -> Clinician1: direct message (clinician's own traffic) ==");
  {
    const { error } = await parent1.rpc("send_message", {
      p_passport_id: seed.passportId,
      p_category_id: cat("Wellbeing note"),
      p_body: "Wanted to flag a rough weekend.",
      p_response_required: false,
      p_recipient_ids: [seed.clinician1.id],
    });
    if (error) throw new Error(`parent1->clinician send: ${error.message}`);
  }

  console.log("== Parent2 -> Teacher1: 2 open messages (child 2) ==");
  for (const body of ["Change of collection today.", "Please remind her to drink water."]) {
    const { error } = await parent2.rpc("send_message", {
      p_passport_id: seed.passportId2,
      p_category_id: cat("Other"),
      p_body: body,
      p_response_required: false,
      p_recipient_ids: [seed.teacher1.id],
    });
    if (error) throw new Error(`parent2 send: ${error.message}`);
  }

  console.log("== Teacher1 -> Parent1: acknowledged reply-worthy note (child 1) ==");
  {
    const { data: msgId, error } = await teacher1.rpc("send_message", {
      p_passport_id: seed.passportId,
      p_category_id: cat("Schedule change"),
      p_body: "No school Friday, training day.",
      p_response_required: false,
      p_recipient_ids: [seed.parent.id],
    });
    if (error) throw new Error(`teacher1 send: ${error.message}`);
    await parent1.rpc("acknowledge_message", { p_message_id: msgId });
  }

  console.log("\n✓ Seeded messages for Stage 2 verification.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
