// Deletes everything created by seed.mjs in this directory (cascades
// cover messages/message_recipients/message_replies via passport_id /
// sender_id / recipient_id -> on delete cascade), plus the MSGT-TEST
// institution which isn't owned by any single user so cascade alone
// won't reach it.
//
// Run with: node --env-file=.env.local scripts/messages-test/cleanup.mjs

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("== Finding msgtest users ==");
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const testUsers = list.users.filter((u) => u.email && u.email.startsWith("msgtest."));
  console.log(`Found ${testUsers.length} test users:`);
  testUsers.forEach((u) => console.log(" -", u.email));

  console.log("\n== Deleting test users (cascades to all owned data) ==");
  for (const u of testUsers) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(`  FAILED to delete ${u.email}:`, error.message);
    } else {
      console.log(`  ✓ deleted ${u.email}`);
    }
  }

  console.log("\n== Deleting test institution ==");
  const { data, error } = await supabase.from("institutions").delete().eq("institution_code", "MSGT-TEST").select();
  if (error) {
    console.error("  FAILED to delete institution MSGT-TEST:", error.message);
  } else {
    console.log(`  ✓ deleted institution MSGT-TEST (${data.length} row${data.length === 1 ? "" : "s"})`);
  }

  console.log("\n== Verifying clean ==");
  const { data: remainingUsers } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const stillTest = remainingUsers.users.filter((u) => u.email && u.email.startsWith("msgtest."));
  console.log("Remaining msgtest users:", stillTest.length);

  const { data: remainingInstitutions } = await supabase
    .from("institutions")
    .select("institution_code")
    .eq("institution_code", "MSGT-TEST");
  console.log("Remaining test institutions:", remainingInstitutions.length);

  const { count: passportCount } = await supabase
    .from("passports")
    .select("id", { count: "exact", head: true })
    .ilike("child_name", "%Test Child Messages%");
  console.log("Any remaining 'Test Child Messages' passports:", passportCount);

  const { count: messageCount } = await supabase
    .from("messages")
    .select("id", { count: "exact", head: true })
    .ilike("body", "%coat%");
  console.log("Any remaining test messages:", messageCount);

  if (stillTest.length === 0 && remainingInstitutions.length === 0 && !passportCount && !messageCount) {
    console.log("\n✓ Verified clean — no messages-test data remains.");
  } else {
    console.log("\n⚠ Some messages-test data may remain — see above.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
