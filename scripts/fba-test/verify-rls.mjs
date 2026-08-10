// Adversarial RLS verification for the FBA module. Signs in as each real
// test account (anon key + password, exactly how the app itself talks to
// Supabase) and queries fba_reports/fba_afls_data/fba_instrument_requests
// directly -- proving the RLS policies themselves block access, not just
// the UI choosing not to show it.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-rls.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));

const service = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function signInAs(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({ email, password: creds.password });
  if (error) throw new Error(`signIn(${email}): ${error.message}`);
  return client;
}

let failures = 0;
function expect(label, condition, detail) {
  if (condition) {
    console.log(`  ✓ ${label}`);
  } else {
    console.log(`  ✗ ${label}${detail ? ` -- ${detail}` : ""}`);
    failures++;
  }
}

async function main() {
  // Find the FBA we created via the browser walkthrough.
  const { data: fbaRow } = await service
    .from("fba_reports")
    .select("id")
    .eq("passport_id", creds.passportId)
    .maybeSingle();
  if (!fbaRow) throw new Error("No fba_reports row found for the test passport -- run the browser walkthrough first.");
  const fbaId = fbaRow.id;
  console.log("Testing against fba_reports.id =", fbaId, "\n");

  console.log("== Teacher: zero rows from every fba_* table ==");
  const teacher = await signInAs(creds.teacher.email);
  const teacherReports = await teacher.from("fba_reports").select("id");
  expect("fba_reports SELECT returns 0 rows", (teacherReports.data ?? []).length === 0, JSON.stringify(teacherReports));
  const teacherAfls = await teacher.from("fba_afls_data").select("id");
  expect("fba_afls_data SELECT returns 0 rows", (teacherAfls.data ?? []).length === 0, JSON.stringify(teacherAfls));
  const teacherRequests = await teacher.from("fba_instrument_requests").select("id");
  expect(
    "fba_instrument_requests SELECT returns 0 rows",
    (teacherRequests.data ?? []).length === 0,
    JSON.stringify(teacherRequests)
  );
  // Direct INSERT attempt should also be rejected (no policy at all for
  // teachers on fba_reports).
  const teacherInsert = await teacher
    .from("fba_reports")
    .insert({ passport_id: creds.passportId, clinician_id: creds.clinician.id, status: "draft", content_data: {} });
  expect("fba_reports INSERT is rejected", Boolean(teacherInsert.error), JSON.stringify(teacherInsert));

  console.log("\n== Parent: zero rows while status != completed ==");
  const parent = await signInAs(creds.parent.email);
  const parentReports = await parent.from("fba_reports").select("id, status");
  expect(
    "fba_reports SELECT returns 0 rows (FBA is in_progress, not completed)",
    (parentReports.data ?? []).length === 0,
    JSON.stringify(parentReports)
  );
  const parentAfls = await parent.from("fba_afls_data").select("id");
  expect("fba_afls_data SELECT returns 0 rows", (parentAfls.data ?? []).length === 0, JSON.stringify(parentAfls));

  console.log("\n== Clinician: full access while actively linked ==");
  const clinician = await signInAs(creds.clinician.email);
  const clinicianReports = await clinician.from("fba_reports").select("id").eq("id", fbaId);
  expect(
    "fba_reports SELECT returns the FBA",
    (clinicianReports.data ?? []).length === 1,
    JSON.stringify(clinicianReports)
  );

  console.log("\n== Revoking clinician_access mid-test ==");
  const { error: revokeError } = await service
    .from("clinician_access")
    .update({ is_active: false })
    .eq("passport_id", creds.passportId)
    .eq("clinician_id", creds.clinician.id);
  if (revokeError) throw new Error(`revoke: ${revokeError.message}`);
  console.log("  clinician_access.is_active = false");

  const revokedReports = await clinician.from("fba_reports").select("id").eq("id", fbaId);
  expect(
    "fba_reports SELECT returns 0 rows while revoked",
    (revokedReports.data ?? []).length === 0,
    JSON.stringify(revokedReports)
  );
  const revokedAfls = await clinician.from("fba_afls_data").select("id");
  expect("fba_afls_data SELECT returns 0 rows while revoked", (revokedAfls.data ?? []).length === 0, JSON.stringify(revokedAfls));

  console.log("\n== Re-linking clinician ==");
  const { error: relinkError } = await service
    .from("clinician_access")
    .update({ is_active: true })
    .eq("passport_id", creds.passportId)
    .eq("clinician_id", creds.clinician.id);
  if (relinkError) throw new Error(`relink: ${relinkError.message}`);

  const relinkedReports = await clinician.from("fba_reports").select("id").eq("id", fbaId);
  expect(
    "fba_reports SELECT returns the FBA again after re-link (row retained)",
    (relinkedReports.data ?? []).length === 1,
    JSON.stringify(relinkedReports)
  );

  console.log("\n== No UPDATE may succeed on a completed row ==");
  // Flip to completed via service role (simulating Stage 3's future
  // finalize action, which doesn't exist client-side yet), then try to
  // update it as the clinician -- should be blocked by the USING clause.
  const { error: completeError } = await service.from("fba_reports").update({ status: "completed" }).eq("id", fbaId);
  if (completeError) throw new Error(`complete: ${completeError.message}`);
  const lockedUpdate = await clinician
    .from("fba_reports")
    .update({ content_data: { hacked: true } })
    .eq("id", fbaId)
    .select();
  expect(
    "UPDATE on completed row affects 0 rows",
    (lockedUpdate.data ?? []).length === 0,
    JSON.stringify(lockedUpdate)
  );

  console.log("\n== Parent: SELECT succeeds now that status = completed ==");
  const parentAfterComplete = await parent.from("fba_reports").select("id, status").eq("id", fbaId);
  expect(
    "fba_reports SELECT returns the FBA now it's completed",
    (parentAfterComplete.data ?? []).length === 1,
    JSON.stringify(parentAfterComplete)
  );

  console.log("\n== activity_log: fba_started excluded from parent + teacher, present for clinician ==");
  const clinicianFeed = await clinician.rpc("get_clinician_activity_feed", { p_limit: 20, p_offset: 0 });
  const clinicianHasFba = (clinicianFeed.data ?? []).some((e) => e.event_type === "fba_started");
  expect("clinician feed includes fba_started", clinicianHasFba, JSON.stringify(clinicianFeed.error));

  const teacherFeed = await teacher.rpc("get_teacher_activity_feed", { p_limit: 20, p_offset: 0 });
  const teacherHasFba = (teacherFeed.data ?? []).some((e) => e.event_type === "fba_started");
  expect("teacher feed excludes fba_started", !teacherHasFba, JSON.stringify(teacherFeed.data));

  const parentActivity = await parent.from("activity_log").select("event_type").eq("passport_id", creds.passportId);
  const parentHasFba = (parentActivity.data ?? []).some((e) => e.event_type === "fba_started");
  expect("parent activity_log excludes fba_started", !parentHasFba, JSON.stringify(parentActivity.data));

  // Revert to in_progress so the browser session (already loaded) doesn't
  // get confused by a completed-status FBA mid-manual-test.
  await service.from("fba_reports").update({ status: "in_progress", completed_at: null }).eq("id", fbaId);

  console.log(`\n${failures === 0 ? "✓ ALL CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
