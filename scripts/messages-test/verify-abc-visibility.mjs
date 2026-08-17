// Adversarial verification for the teacher ABC visibility governance
// change (migration 0064). Run after scripts/messages-test/seed.mjs.
//
// Run with: node --env-file=.env.local scripts/messages-test/verify-abc-visibility.mjs

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

const ABC_LOG_BASE = {
  incident_date: "2026-01-05",
  incident_time: "10:00",
  intensity: 3,
  antecedents: ["Other"],
  antecedent_other: "test",
  behaviours: ["Other"],
  behaviour_other: "test",
  consequences: ["Other"],
  consequence_other: "test",
};

async function main() {
  const parent = await clientFor(seed.parent.email);
  const teacher = await clientFor(seed.teacher1.email);
  const clinician = await clientFor(seed.clinician1.email);
  const nonLinkedTeacher = await clientFor(seed.teacher2.email);

  console.log("== Baseline: teacher's visible log count BEFORE any parent/clinician logs exist ==");
  const { data: baselineLogs } = await teacher.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  const baselineIds = new Set((baselineLogs ?? []).map((r) => r.id));
  console.log(`  teacher currently sees ${baselineIds.size} log(s)`);

  console.log("\n== Parent logs an incident (never shared) ==");
  const { data: parentLog, error: parentLogError } = await parent
    .from("abc_logs")
    .insert({ ...ABC_LOG_BASE, passport_id: seed.passportId, logged_by: seed.parent.id, logged_by_role: "parent", perceived_function: "escape", general_notes: "unshared parent log" })
    .select("id")
    .single();
  if (parentLogError) throw parentLogError;
  console.log("  parent log id:", parentLog.id);

  console.log("\n== Clinician logs an incident (never shared) ==");
  const { data: clinicianLog, error: clinicianLogError } = await clinician
    .from("abc_logs")
    .insert({ ...ABC_LOG_BASE, passport_id: seed.passportId, logged_by: seed.clinician1.id, logged_by_role: "clinician", perceived_function: "attention", general_notes: "unshared clinician log" })
    .select("id")
    .single();
  if (clinicianLogError) throw clinicianLogError;
  console.log("  clinician log id:", clinicianLog.id);

  console.log("\n== Teacher logs their own incident ==");
  const { data: teacherLog, error: teacherLogError } = await teacher
    .from("abc_logs")
    .insert({ ...ABC_LOG_BASE, passport_id: seed.passportId, logged_by: seed.teacher1.id, logged_by_role: "class_teacher", general_notes: "teacher's own log" })
    .select("id")
    .single();
  if (teacherLogError) throw teacherLogError;
  console.log("  teacher log id:", teacherLog.id);

  console.log("\n== ADVERSARIAL: teacher direct RPC call — unshared parent/clinician logs must be ABSENT ==");
  const { data: teacherLogsBeforeShare } = await teacher.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  const idsBeforeShare = new Set((teacherLogsBeforeShare ?? []).map((r) => r.id));
  check("teacher does NOT see the unshared parent log", !idsBeforeShare.has(parentLog.id), [...idsBeforeShare]);
  check("teacher does NOT see the unshared clinician log", !idsBeforeShare.has(clinicianLog.id));
  check("teacher DOES see their own log", idsBeforeShare.has(teacherLog.id));

  console.log("\n== ADVERSARIAL: direct table SELECT (not just the RPC) — same result ==");
  const { data: directSelect } = await teacher.from("abc_logs").select("id").eq("passport_id", seed.passportId);
  const directIds = new Set((directSelect ?? []).map((r) => r.id));
  check("direct table read also excludes the unshared parent log", !directIds.has(parentLog.id));
  check("direct table read also excludes the unshared clinician log", !directIds.has(clinicianLog.id));
  check("direct table read includes the teacher's own log", directIds.has(teacherLog.id));

  console.log("\n== ADVERSARIAL: get_abc_trend_data mirrors the same narrowing ==");
  const { data: trendBeforeShare } = await teacher.rpc("get_abc_trend_data", { p_passport_id: seed.passportId });
  const trendIdsBeforeShare = new Set((trendBeforeShare ?? []).map((r) => r.id));
  check("trend data excludes unshared parent log", !trendIdsBeforeShare.has(parentLog.id));
  check("trend data excludes unshared clinician log", !trendIdsBeforeShare.has(clinicianLog.id));
  check("trend data includes teacher's own log", trendIdsBeforeShare.has(teacherLog.id));

  console.log("\n== Parent now shares the log via an incident-note message to the teacher ==");
  const { data: categories } = await service.from("message_categories").select("id, label");
  const incidentCatId = categories.find((c) => c.label === "Incident note").id;
  const { data: shareMsgId, error: shareMsgError } = await parent.rpc("send_message", {
    p_passport_id: seed.passportId,
    p_category_id: incidentCatId,
    p_body: "Sharing this incident with you.",
    p_response_required: false,
    p_recipient_ids: [seed.teacher1.id],
    p_abc_log_id: parentLog.id,
  });
  if (shareMsgError) throw shareMsgError;
  console.log("  share message id:", shareMsgId);

  console.log("\n== Teacher now sees EXACTLY the shared log (plus their own), still NOT the clinician's unshared one ==");
  const { data: teacherLogsAfterShare } = await teacher.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  const idsAfterShare = new Set((teacherLogsAfterShare ?? []).map((r) => r.id));
  check("teacher NOW sees the shared parent log", idsAfterShare.has(parentLog.id));
  check("teacher still does NOT see the unshared clinician log", !idsAfterShare.has(clinicianLog.id));
  check("teacher still sees their own log", idsAfterShare.has(teacherLog.id));
  check("teacher's visible set is EXACTLY {own, shared} -- no extras", idsAfterShare.size === 2, [...idsAfterShare]);

  console.log("\n== Scoped fields still apply to the shared log (sharing widens WHICH logs, never WHAT FIELDS) ==");
  const sharedRow = teacherLogsAfterShare.find((r) => r.id === parentLog.id);
  check("perceived_function is null for teacher even on a shared log", sharedRow.perceived_function === null, sharedRow.perceived_function);
  check("general_notes is still present (not a clinical-gated field)", sharedRow.general_notes === "unshared parent log");

  console.log("\n== Trend data now includes the shared log too ==");
  const { data: trendAfterShare } = await teacher.rpc("get_abc_trend_data", { p_passport_id: seed.passportId });
  const trendIdsAfterShare = new Set((trendAfterShare ?? []).map((r) => r.id));
  check("trend data now includes the shared parent log", trendIdsAfterShare.has(parentLog.id));
  check("trend data still excludes the unshared clinician log", !trendIdsAfterShare.has(clinicianLog.id));

  console.log("\n== Teacher activity feed: abc_logged narrowed to teacher-authored only ==");
  const { data: feedRows, error: feedError } = await teacher.rpc("get_teacher_activity_feed", { p_limit: 50, p_offset: 0 });
  if (feedError) throw feedError;
  const abcFeedEvents = (feedRows ?? []).filter((r) => r.event_type === "abc_logged" && r.passport_id === seed.passportId);
  check("feed's abc_logged events are ALL from the teacher's own logging (their own event_description)", abcFeedEvents.every((e) => e.event_description.includes("Class Teacher") || e.event_description.includes("Teacher")), abcFeedEvents.map((e) => e.event_description));

  console.log("\n== Adversarial: non-linked teacher2 sees nothing on this passport at all ==");
  const { data: teacher2Logs } = await nonLinkedTeacher.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  check("teacher2 (never linked) sees zero logs", (teacher2Logs ?? []).length === 0, teacher2Logs);

  console.log("\n== Parent and clinician visibility unchanged: both still see ALL THREE logs ==");
  const { data: parentLogs } = await parent.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  const parentIds = new Set((parentLogs ?? []).map((r) => r.id));
  check("parent sees all 3 logs (own, teacher's, clinician's)", [parentLog.id, teacherLog.id, clinicianLog.id].every((id) => parentIds.has(id)), [...parentIds]);

  const { data: clinicianLogs } = await clinician.rpc("get_abc_logs", { p_passport_id: seed.passportId });
  const clinicianIds = new Set((clinicianLogs ?? []).map((r) => r.id));
  check("clinician sees all 3 logs too", [parentLog.id, teacherLog.id, clinicianLog.id].every((id) => clinicianIds.has(id)), [...clinicianIds]);
  const clinicianSharedRow = clinicianLogs.find((r) => r.id === clinicianLog.id);
  check("clinician still sees their OWN perceived_function value (unaffected)", clinicianSharedRow.perceived_function === "attention", clinicianSharedRow.perceived_function);

  console.log(`\n== RESULT: ${pass} passed, ${fail} failed ==`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
