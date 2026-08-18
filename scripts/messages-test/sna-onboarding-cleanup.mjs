// Deletes everything created by sna-onboarding-create-users.mjs and
// sna-onboarding-create-institution.mjs.
//
// Run with: node --env-file=.env.local scripts/messages-test/sna-onboarding-cleanup.mjs

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

console.log("== Finding snaonboardtest users ==");
const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
if (listError) throw listError;
const testUsers = list.users.filter((u) => u.email && u.email.startsWith("snaonboardtest."));
console.log(`Found ${testUsers.length} test users.`);

for (const user of testUsers) {
  const { error } = await supabase.auth.admin.deleteUser(user.id);
  if (error) throw error;
  console.log(`  ✓ deleted ${user.email}`);
}

console.log("\n== Deleting test institution ==");
const { error: instError, count } = await supabase
  .from("institutions")
  .delete({ count: "exact" })
  .eq("institution_code", "SNAOB-TEST");
if (instError) throw instError;
console.log(`  ✓ deleted institution SNAOB-TEST (${count} row)`);

console.log("\n✓ Verified clean.");
