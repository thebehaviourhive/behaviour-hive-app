// Live verification for the Open-Ended FAI conversion (sendable ->
// clinician-transcribed). Signs in as the real clinician test account
// (anon key + password, respecting RLS + the new CHECK constraint
// together, not service role) and exercises the exact operations the
// UI performs.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-fai-interview.mjs

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
  const clinician = await signInAs(creds.clinician.email);

  console.log("== Item bank: version 2 is active with the real 24 items ==");
  const { data: instrumentRows } = await clinician
    .from("fba_instruments")
    .select("version, is_active, attribution, items")
    .eq("instrument_type", "open_ended")
    .order("version");
  const v1 = instrumentRows.find((r) => r.version === 1);
  const v2 = instrumentRows.find((r) => r.version === 2);
  expect("version 1 is now inactive", v1?.is_active === false);
  expect("version 2 is active", v2?.is_active === true);
  expect("version 2 has exactly 24 items", v2?.items?.length === 24);
  expect("item 1 is the date type", v2?.items?.[0]?.answer_type === "date" && v2.items[0].id === "fai-1");
  expect(
    "attribution is present and correct",
    v2?.attribution === "Developed by Gregory P. Hanley, Ph.D., BCBA-D (Developed August, 2002; Revised: August, 2009)"
  );
  expect(
    "zero 'Interview Question' placeholder text in the active version",
    !JSON.stringify(v2?.items ?? []).includes("Interview Question")
  );

  console.log("\n== DB-level send restriction: a real clinician cannot create an open_ended request ==");
  const { data: fbaRow } = await service
    .from("fba_reports")
    .select("id")
    .eq("passport_id", creds.passportId)
    .maybeSingle();
  let fbaId = fbaRow?.id;
  if (!fbaId) {
    const { data, error } = await service
      .from("fba_reports")
      .insert({ passport_id: creds.passportId, clinician_id: creds.clinician.id, status: "in_progress" })
      .select()
      .single();
    if (error) throw error;
    fbaId = data.id;
  }

  const directAttempt = await clinician.from("fba_instrument_requests").insert({
    fba_id: fbaId,
    passport_id: creds.passportId,
    instrument_type: "open_ended",
    recipient_id: creds.parent.id,
    status: "sent",
  });
  expect(
    "clinician's direct insert of an open_ended request is rejected",
    Boolean(directAttempt.error),
    JSON.stringify(directAttempt.error)
  );
  expect(
    "rejection is the CHECK constraint, not just RLS",
    directAttempt.error?.message?.includes("check constraint") ?? false,
    directAttempt.error?.message
  );

  const qabfAttempt = await clinician.from("fba_instrument_requests").insert({
    fba_id: fbaId,
    passport_id: creds.passportId,
    instrument_type: "qabf",
    recipient_id: creds.parent.id,
    status: "sent",
  });
  expect("qabf is still sendable (control case)", !qabfAttempt.error, JSON.stringify(qabfAttempt.error));

  console.log("\n== Clinician-completed FAI interviews: two respondents, independently stored ==");
  const interviewA = {
    id: "aaaaaaaa-0000-0000-0000-000000000001",
    answers: {
      "fai-1": "2026-08-11",
      "fai-2": "Test Child FBA, age 9",
      "fai-3": "Orla Quinn",
      "fai-4": "Mother",
      "fai-9": "Screaming and hitting when asked to stop an activity.",
    },
  };
  const interviewB = {
    id: "bbbbbbbb-0000-0000-0000-000000000002",
    answers: {
      "fai-1": "2026-08-11",
      "fai-2": "Test Child FBA, age 9",
      "fai-3": "Tara Byrne",
      "fai-4": "SNA",
      "fai-9": "Vocal outbursts during transitions between activities.",
    },
  };
  const { data: savedReport, error: saveError } = await clinician
    .from("fba_reports")
    .update({ content_data: { faiInterviews: [interviewA, interviewB] } })
    .eq("id", fbaId)
    .select("content_data")
    .single();
  expect("saving two interviews succeeds", !saveError, JSON.stringify(saveError));
  expect(
    "both interviews persisted independently",
    savedReport?.content_data?.faiInterviews?.length === 2,
    JSON.stringify(savedReport?.content_data?.faiInterviews?.length)
  );
  expect(
    "respondent A's answers are intact",
    savedReport?.content_data?.faiInterviews?.[0]?.answers?.["fai-3"] === "Orla Quinn"
  );
  expect(
    "respondent B's answers are intact and distinct from A's",
    savedReport?.content_data?.faiInterviews?.[1]?.answers?.["fai-3"] === "Tara Byrne"
  );

  console.log("\n== Force-quit/resume proof: re-reading the row shows the same two interviews ==");
  const { data: reread } = await clinician.from("fba_reports").select("content_data").eq("id", fbaId).single();
  expect(
    "fresh read (simulating app reopen) returns both interviews unchanged",
    reread?.content_data?.faiInterviews?.length === 2 &&
      reread.content_data.faiInterviews[0].answers["fai-9"]?.includes("Screaming") &&
      reread.content_data.faiInterviews[1].answers["fai-9"]?.includes("Vocal outbursts")
  );

  console.log("\n== Legacy completed open_ended response still resolves to its OWN (v1) item text ==");
  const { data: legacyRequests } = await service
    .from("fba_instrument_requests")
    .select("id, responses_data")
    .eq("instrument_type", "open_ended")
    .eq("status", "completed");
  if (legacyRequests?.length) {
    const legacy = legacyRequests[0];
    const answerKeys = Object.keys(legacy.responses_data);
    // Replicates useInstrumentItems' version-resolution logic exactly.
    const matched = instrumentRows.find((row) => row.items.some((item) => answerKeys.includes(item.id)));
    expect(
      "legacy response's answer keys resolve to version 1, not the new version 2",
      matched?.version === 1,
      `resolved version=${matched?.version}, answerKeys=${JSON.stringify(answerKeys)}`
    );
  } else {
    console.log("  (no legacy completed open_ended response found -- skipping, nothing to verify)");
  }

  console.log(`\n${failures === 0 ? "✓ ALL FAI INTERVIEW CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
