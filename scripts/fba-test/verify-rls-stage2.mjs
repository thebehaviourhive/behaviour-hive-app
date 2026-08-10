// Adversarial RLS verification for FBA Stage 2 (questionnaire engine +
// ABC integration). Signs in as each real test account (anon key +
// password) and probes the new surfaces from migration 0041 directly.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-rls-stage2.mjs

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
  const { data: fbaRow } = await service
    .from("fba_reports")
    .select("id")
    .eq("passport_id", creds.passportId)
    .maybeSingle();
  if (!fbaRow) throw new Error("No fba_reports row found -- run the browser walkthrough first.");
  const fbaId = fbaRow.id;

  const { data: requests } = await service
    .from("fba_instrument_requests")
    .select("id, instrument_type, recipient_id, status")
    .eq("fba_id", fbaId);
  const qabfRequest = requests.find((r) => r.instrument_type === "qabf");
  const masRequest = requests.find((r) => r.instrument_type === "mas");
  console.log(`Testing against fba_id=${fbaId}, qabf=${qabfRequest.id}, mas=${masRequest.id}\n`);

  const parent = await signInAs(creds.parent.email);
  const teacher = await signInAs(creds.teacher.email);
  const clinician = await signInAs(creds.clinician.email);

  console.log("== Recipient cannot read another recipient's request ==");
  const parentReadingMas = await parent.from("fba_instrument_requests").select("id, responses_data").eq("id", masRequest.id);
  expect(
    "parent SELECT on teacher's MAS request returns 0 rows",
    (parentReadingMas.data ?? []).length === 0,
    JSON.stringify(parentReadingMas)
  );
  const teacherReadingQabf = await teacher.from("fba_instrument_requests").select("id, responses_data").eq("id", qabfRequest.id);
  expect(
    "teacher SELECT on parent's QABF request returns 0 rows",
    (teacherReadingQabf.data ?? []).length === 0,
    JSON.stringify(teacherReadingQabf)
  );

  console.log("\n== Recipient cannot see any other request via bulk SELECT ==");
  const parentAll = await parent.from("fba_instrument_requests").select("id");
  expect(
    "parent's unfiltered SELECT returns only their own rows (<=2: qabf+open_ended)",
    (parentAll.data ?? []).length <= 2 && (parentAll.data ?? []).every((r) => r.id !== masRequest.id),
    JSON.stringify(parentAll.data)
  );

  console.log("\n== get_my_instrument_requests() is strictly self-scoped ==");
  const parentMine = await parent.rpc("get_my_instrument_requests");
  const hasOnlyOwn = (parentMine.data ?? []).every((r) => r.instrument_type !== "mas");
  expect("parent's get_my_instrument_requests never includes the MAS (teacher's) row", hasOnlyOwn, JSON.stringify(parentMine.data));

  console.log("\n== Recipient cannot modify another recipient's responses ==");
  const teacherWritingParentQabf = await teacher
    .from("fba_instrument_requests")
    .update({ responses_data: { hacked: true } })
    .eq("id", qabfRequest.id)
    .select();
  expect(
    "teacher UPDATE on parent's QABF request affects 0 rows",
    (teacherWritingParentQabf.data ?? []).length === 0,
    JSON.stringify(teacherWritingParentQabf)
  );

  console.log("\n== Completed request is locked against the recipient (judgment call #7) ==");
  const parentEditingCompletedQabf = await parent
    .from("fba_instrument_requests")
    .update({ responses_data: { "qabf-1": "Never" }, status: "in_progress" })
    .eq("id", qabfRequest.id)
    .select();
  expect(
    "parent UPDATE on their own COMPLETED QABF request affects 0 rows",
    (parentEditingCompletedQabf.data ?? []).length === 0,
    JSON.stringify(parentEditingCompletedQabf)
  );
  const { data: qabfStillIntact } = await service
    .from("fba_instrument_requests")
    .select("status, responses_data")
    .eq("id", qabfRequest.id)
    .single();
  expect(
    "QABF responses_data untouched by the blocked update attempt",
    qabfStillIntact.status === "completed" && qabfStillIntact.responses_data["qabf-1"] === "Sometimes",
    JSON.stringify(qabfStillIntact)
  );

  console.log("\n== Neither recipient can touch the instrument item bank ==");
  const parentInsertInstrument = await parent
    .from("fba_instruments")
    .insert({ instrument_type: "qabf", version: 99, items: [] });
  expect("parent INSERT on fba_instruments is rejected", Boolean(parentInsertInstrument.error), JSON.stringify(parentInsertInstrument));
  const parentUpdateInstrument = await parent
    .from("fba_instruments")
    .update({ items: [] })
    .eq("instrument_type", "qabf")
    .select();
  expect(
    "parent UPDATE on fba_instruments affects 0 rows",
    (parentUpdateInstrument.data ?? []).length === 0,
    JSON.stringify(parentUpdateInstrument)
  );
  const clinicianUpdateInstrument = await clinician
    .from("fba_instruments")
    .update({ items: [] })
    .eq("instrument_type", "qabf")
    .select();
  expect(
    "clinician UPDATE on fba_instruments also affects 0 rows (service-role only)",
    (clinicianUpdateInstrument.data ?? []).length === 0,
    JSON.stringify(clinicianUpdateInstrument)
  );

  console.log("\n== Teacher still gets zero rows from fba_reports (Stage 1 invariant) ==");
  const teacherReports = await teacher.from("fba_reports").select("id");
  expect("teacher fba_reports SELECT returns 0 rows", (teacherReports.data ?? []).length === 0, JSON.stringify(teacherReports));

  console.log("\n== Recipients cannot call clinician-only RPCs usefully ==");
  const parentAsClinicianCandidates = await parent.rpc("get_fba_recipient_candidates", { p_fba_id: fbaId });
  expect(
    "parent calling get_fba_recipient_candidates gets 0 rows",
    (parentAsClinicianCandidates.data ?? []).length === 0,
    JSON.stringify(parentAsClinicianCandidates)
  );
  const parentAsClinicianRequests = await parent.rpc("get_fba_instrument_requests", { p_fba_id: fbaId });
  expect(
    "parent calling get_fba_instrument_requests gets 0 rows",
    (parentAsClinicianRequests.data ?? []).length === 0,
    JSON.stringify(parentAsClinicianRequests)
  );

  console.log("\n== Recipient cannot send reminders (clinician-only column) ==");
  const parentSelfReminder = await parent
    .from("fba_instrument_requests")
    .update({ last_reminded_at: new Date().toISOString() })
    .eq("id", qabfRequest.id)
    .select();
  // Column grant is broad (documented caveat in the migration), but the
  // completed-row lock (judgment call #7) still blocks this specific
  // attempt since the QABF request is already completed.
  expect(
    "parent cannot set last_reminded_at on their own completed request",
    (parentSelfReminder.data ?? []).length === 0,
    JSON.stringify(parentSelfReminder)
  );

  console.log(`\n${failures === 0 ? "✓ ALL STAGE 2 CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
