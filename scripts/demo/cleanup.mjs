// Deletes every demo account (and, via ON DELETE CASCADE across the
// schema, all data owned by them: passports and every child table,
// institution_staff, passport_access, clinician_access, abc_logs,
// strategy_ledger, activity_log, etc.) plus the two demo institutions,
// which aren't owned by any single user so cascade alone won't reach
// them.
//
// Run with: node --env-file=.env.local scripts/demo/cleanup.mjs
import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("== Finding demo users ==");
  const { data: list, error: listError } = await supabase.auth.admin.listUsers({ perPage: 200 });
  if (listError) throw listError;
  const demoUsers = list.users.filter((u) => u.email && u.email.includes("demo"));
  console.log(`Found ${demoUsers.length} demo users:`);
  demoUsers.forEach((u) => console.log(" -", u.email));

  console.log("\n== Deleting demo users (cascades to all owned data) ==");
  for (const u of demoUsers) {
    const { error } = await supabase.auth.admin.deleteUser(u.id);
    if (error) {
      console.error(`  FAILED to delete ${u.email}:`, error.message);
    } else {
      console.log(`  ✓ deleted ${u.email}`);
    }
  }

  console.log("\n== Deleting demo institutions ==");
  for (const code of ["ELMW-DEMO", "GRNF-DEMO"]) {
    const { data, error } = await supabase
      .from("institutions")
      .delete()
      .eq("institution_code", code)
      .select();
    if (error) {
      console.error(`  FAILED to delete institution ${code}:`, error.message);
    } else {
      console.log(`  ✓ deleted institution ${code} (${data.length} row${data.length === 1 ? "" : "s"})`);
    }
  }

  console.log("\n== Verifying clean ==");
  const { data: remainingUsers } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const stillDemo = remainingUsers.users.filter((u) => u.email && u.email.includes("demo"));
  console.log("Remaining demo users:", stillDemo.length);

  const { data: remainingInstitutions } = await supabase
    .from("institutions")
    .select("institution_code")
    .in("institution_code", ["ELMW-DEMO", "GRNF-DEMO"]);
  console.log("Remaining demo institutions:", remainingInstitutions.length);

  const { count: passportCount } = await supabase
    .from("passports")
    .select("id", { count: "exact", head: true })
    .ilike("child_name", "%Byrne%");
  console.log("Any remaining 'Byrne' passports:", passportCount);

  if (stillDemo.length === 0 && remainingInstitutions.length === 0) {
    console.log("\n✓ Verified clean — no demo data remains.");
  } else {
    console.log("\n⚠ Some demo data may remain — see above.");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
