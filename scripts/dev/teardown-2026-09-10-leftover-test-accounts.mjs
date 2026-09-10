/* One-off teardown for 16 leftover test accounts found live in production
   10 Sept 2026 -- none created under the "zzfixture" convention
   scripts/dev/teardown.mjs enforces, so that script refuses all of them
   outright (wrong prefix, by design). Investigated first, not assumed:
   all 16 have zero institution_staff rows (institution-side teardown
   already happened for whichever schools they joined), zero incidents
   in any role (created_by/teacher_signed_by/countersigned_by), zero
   messages sent, zero message_recipients, zero clinician_access, zero
   app_events, zero enrolments. Four are self-created parent passports
   (1 passport + 1 passport_guardians row each, no other guardians).
   Nine have exactly one consents row. Simple, isolated leftovers -- not
   a scaled-down version of scripts/dev/teardown.mjs's own institution
   mode, because there is no institution left to tear down for any of
   them.

   Run with: node --env-file=.env.local scripts/dev/teardown-2026-09-10-leftover-test-accounts.mjs
*/

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

// Exact emails, not a prefix pattern -- confirmed against a fresh
// listUsers() call below, not assumed from the earlier investigation.
const TARGET_EMAILS = [
  "navsupport.principal@thebehaviourhive.com",
  "navsupport.teachera@thebehaviourhive.com",
  "navsupport.teacherb@thebehaviourhive.com",
  "p0152.parent@thebehaviourhive.com",
  "p0152.principal@thebehaviourhive.com",
  "p0152.teachera@thebehaviourhive.com",
  "p0152.teacherb@thebehaviourhive.com",
  "pincident.principal@thebehaviourhive.com",
  "p0151b.parent3@thebehaviourhive.com",
  "zzbulk.parent6@thebehaviourhive.com",
  "zzbulk.parent3@thebehaviourhive.com",
  "mcclasscheck.principal@thebehaviourhive.com",
  "mcclasscheck.teacher@thebehaviourhive.com",
  "p0150b.principal@thebehaviourhive.com",
  "p0150b.teacherbeta@thebehaviourhive.com",
  "p0150b.teacheralpha@thebehaviourhive.com",
];

const KEEP_EMAILS = new Set([
  "daniel@dunvaris.co.uk",
  "daniel@thebehaviourhive.com",
  "dcasey28@outlook.com",
]);

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

async function del(table, applyFilter) {
  const query = applyFilter(admin.from(table).delete({ count: "exact" }));
  if (query === null) return 0;
  const { error, count } = await query;
  if (error) fail(`Deleting from ${table} failed: ${error.message}`);
  return count ?? 0;
}

async function teardownUser(user) {
  console.log(`\n=== ${user.email} (${user.id}) ===`);
  const userId = user.id;

  // Hard-block precheck, same posture as scripts/dev/teardown.mjs:
  // refuse rather than touch a non-cascading incident-log FK. Expected
  // to find nothing (confirmed in the investigation pass), checked
  // again here so this script is safe to hand to someone else too.
  const blockChecks = [
    ["incident_children.added_by", "incident_children", "added_by"],
    ["incident_amendments.author_id", "incident_amendments", "author_id"],
    ["incident_attestations.created_by", "incident_attestations", "created_by"],
    ["incident_injuries.staff_user_id", "incident_injuries", "staff_user_id"],
    ["restrictive_practices.ncse_completed_by", "restrictive_practices", "ncse_completed_by"],
    ["incident_debriefs.completed_by", "incident_debriefs", "completed_by"],
    ["school_notices.acknowledged_by", "school_notices", "acknowledged_by"],
    ["incidents.created_by", "incidents", "created_by"],
    ["incidents.teacher_signed_by", "incidents", "teacher_signed_by"],
    ["incidents.countersigned_by", "incidents", "countersigned_by"],
  ];
  for (const [label, table, col] of blockChecks) {
    const { data, error } = await admin.from(table).select("id").eq(col, userId);
    if (error) fail(`Checking ${table}.${col} failed: ${error.message}`);
    if ((data ?? []).length > 0) {
      fail(`Refusing: ${user.email} is referenced on ${label} (${data.length} row(s)) -- not the simple leftover this script expects. Investigate before touching.`);
    }
  }

  const report = [];
  report.push(["passport_guardians (pre)", await del("passport_guardians", (t) => t.eq("user_id", userId))]);
  report.push(["consents", await del("consents", (t) => t.eq("user_id", userId))]);
  report.push(["passports (owned)", await del("passports", (t) => t.eq("user_id", userId))]);
  report.push(["passport_guardians (post-cascade check)", await del("passport_guardians", (t) => t.eq("user_id", userId))]);
  report.push(["institution_staff", await del("institution_staff", (t) => t.eq("user_id", userId))]);
  report.push(["passport_access", await del("passport_access", (t) => t.eq("teacher_id", userId))]);
  report.push([
    "clinician_access",
    await del("clinician_access", (t) => t.or(`clinician_id.eq.${userId},granted_by.eq.${userId},revoked_by.eq.${userId}`)),
  ]);
  report.push(["message_recipients", await del("message_recipients", (t) => t.eq("recipient_id", userId))]);
  report.push(["messages (sent)", await del("messages", (t) => t.eq("sender_id", userId))]);
  report.push(["app_events", await del("app_events", (t) => t.eq("user_id", userId))]);

  for (const [table, count] of report) {
    if (count > 0) console.log(`  ${table.padEnd(32)} ${count}`);
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(userId);
  if (delErr) fail(`auth.users deletion failed for ${user.email}: ${delErr.message}`);

  const { data: verifyUser } = await admin.auth.admin.getUserById(userId);
  if (verifyUser?.user) fail(`${user.email} still exists after deleteUser -- stop here.`);
  console.log(`  auth.users                      deleted, verified gone`);

  // Same functional check scripts/dev/teardown.mjs uses: auth.identities
  // isn't reachable via PostgREST, so proving the email is genuinely
  // free again means actually reclaiming it, then tearing the probe
  // back down.
  const probePassword = `Probe-${Date.now()}-${Math.random().toString(36).slice(2)}!`;
  const { data: probe, error: probeErr } = await admin.auth.admin.createUser({
    email: user.email,
    password: probePassword,
    email_confirm: true,
  });
  if (probeErr) {
    fail(`WARNING: could not re-claim ${user.email} after deletion (${probeErr.message}) -- a stale auth.identities row is still blocking it.`);
  }
  const { error: probeDelErr } = await admin.auth.admin.deleteUser(probe.user.id);
  if (probeDelErr) fail(`Probe cleanup failed for ${user.email}: ${probeDelErr.message}`);
  console.log(`  auth.identities                 released (probe re-claim + cleanup ok)`);
}

async function main() {
  const { data: listData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listErr) fail(`listUsers failed: ${listErr.message}`);

  const byEmail = new Map(listData.users.map((u) => [(u.email ?? "").toLowerCase(), u]));

  for (const email of KEEP_EMAILS) {
    if (!byEmail.has(email.toLowerCase())) {
      fail(`Refusing to proceed: expected to keep ${email} but it wasn't found at all -- listUsers result looks wrong, stopping before touching anything.`);
    }
  }

  const targets = [];
  for (const email of TARGET_EMAILS) {
    const u = byEmail.get(email.toLowerCase());
    if (!u) {
      console.log(`Not found (already gone?): ${email}`);
      continue;
    }
    if (KEEP_EMAILS.has((u.email ?? "").toLowerCase())) {
      fail(`Refusing: ${email} is in KEEP_EMAILS but also in TARGET_EMAILS -- this is a bug in this script, stop.`);
    }
    targets.push(u);
  }

  console.log(`Tearing down ${targets.length} account(s).`);
  for (const u of targets) {
    await teardownUser(u);
  }

  console.log(`\n=== DONE: ${targets.length} account(s) removed ===`);
}

main();
