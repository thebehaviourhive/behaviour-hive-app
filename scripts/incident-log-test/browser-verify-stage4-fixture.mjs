// Disposable browser-verification fixture for PRD 1, Stage 4, Step 3.
// NOT ZZFIXTURE_THUMBTEST -- torn down same session, confirmed gone by
// direct query.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Stage4BrowserVerify-2026!";
const CODE = "S4BROWSER" + Math.floor(Math.random() * 10000);

async function signedInClient(email) {
  const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}
async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: fullName }, app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Stage 4 Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;

  const principalId = await createUser("s4browser.principal@thebehaviourhive.com", "S4 Principal", "principal");
  const teacherId = await createUser("s4browser.teacher@thebehaviourhive.com", "S4 Teacher", "class_teacher");
  const parent1Id = await createUser("s4browser.parent1@thebehaviourhive.com", "S4 Parent One", "parent");
  const parent2Id = await createUser("s4browser.parent2@thebehaviourhive.com", "S4 Parent Two", "parent");

  const { data: staffRows, error: staffErr } = await admin
    .from("institution_staff")
    .insert([
      { institution_id: institutionId, user_id: principalId, role: "principal" },
      { institution_id: institutionId, user_id: teacherId, role: "class_teacher" },
    ])
    .select();
  if (staffErr) throw staffErr;

  const principal = await signedInClient("s4browser.principal@thebehaviourhive.com");
  const teacherStaffRow = staffRows.find((r) => r.user_id === teacherId);
  const { error: approveErr } = await principal.rpc("approve_staff_join", { p_institution_staff_id: teacherStaffRow.id });
  if (approveErr) throw approveErr;

  // Child A: no access granted at all -- the "empty state IS the
  // information" child (Daniel's own instruction 2).
  const { data: childA } = await admin.from("passports").insert({ user_id: parent1Id, child_name: "S4 Browser Child No Access", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert({ passport_id: childA.id, institution_id: institutionId, approved_by_parent: true, parent_approved_at: new Date().toISOString() });

  // Child B: UNAPPROVED link -- the reachability test's hardest case,
  // and Step 0's own decision 4 scenario (roster shows it, grant works
  // against it, before any parent approval).
  const { data: childB } = await admin.from("passports").insert({ user_id: parent2Id, child_name: "S4 Browser Child Unapproved", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert({ passport_id: childB.id, institution_id: institutionId, approved_by_parent: false });

  console.log(JSON.stringify(
    {
      institutionId,
      password: PASSWORD,
      accounts: {
        principal: "s4browser.principal@thebehaviourhive.com",
        teacher: "s4browser.teacher@thebehaviourhive.com (starts with zero passport_access grants)",
      },
      children: {
        childA: { id: childA.id, name: childA.child_name, note: "approved link, no access granted -- empty state check" },
        childB: { id: childB.id, name: childB.child_name, note: "UNAPPROVED link -- grant + reachability check" },
      },
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
