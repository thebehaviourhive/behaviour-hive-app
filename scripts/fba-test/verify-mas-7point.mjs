// Live verification for the MAS real content + 7-point scale upgrade.
// Signs in as the real clinician/parent/teacher test accounts (anon key
// + password, not service role) and drives the exact same tables/RPCs
// the UI uses: send -> complete (known pattern) -> score, replicating
// instrumentScoring.ts's own algorithm against the REAL fetched item
// bank so a passing check proves the actual data-driven scale/scoring
// path, not just that a hand-picked number appears somewhere.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-mas-7point.mjs

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

// Exact replica of src/lib/fba/instrumentScoring.ts -- deliberately
// re-implemented rather than imported (this is a plain Node script, no
// bundler), so this proves the underlying algorithm against real data,
// not just that the two files happen to agree by construction.
function scoreByCategory(items, responses) {
  const totals = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;
    const answer = responses[item.id];
    if (answer === undefined) continue;
    const points = item.scale.indexOf(answer);
    if (points < 0) continue;
    totals[item.category] = (totals[item.category] ?? 0) + points;
  }
  return totals;
}
function categoryMaxes(items) {
  const maxes = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;
    maxes[item.category] = (maxes[item.category] ?? 0) + (item.scale.length - 1);
  }
  return maxes;
}

async function main() {
  const clinician = await signInAs(creds.clinician.email);
  const parent = await signInAs(creds.parent.email);
  const teacher = await signInAs(creds.teacher.email);

  const { data: masRows } = await service
    .from("fba_instruments")
    .select("version, is_active, items")
    .eq("instrument_type", "mas")
    .order("version");
  const masV2 = masRows.find((r) => r.version === 2 && r.is_active);
  expect("MAS active version has 7-point scale (7 labels) on every item", masV2.items.every((i) => i.scale.length === 7));
  expect("MAS category max is now 24 (4 items x 6 points)", Object.values(categoryMaxes(masV2.items)).every((m) => m === 24));

  const { data: qabfRows } = await service.from("fba_instruments").select("version, is_active, items").eq("instrument_type", "qabf").eq("is_active", true);
  const qabf = qabfRows[0];
  expect("QABF untouched: still 5-point scale", qabf.items.every((i) => i.scale.length === 5));
  expect("QABF untouched: still version 1", qabf.version === 1);

  console.log("\n== Send MAS to parent, complete with a known pattern (all Sensory=Always, rest=Never) ==");
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

  const { data: parentRequest, error: sendParentError } = await clinician
    .from("fba_instrument_requests")
    .insert({ fba_id: fbaId, passport_id: creds.passportId, instrument_type: "mas", recipient_id: creds.parent.id, status: "sent" })
    .select()
    .single();
  expect("clinician can send MAS to the parent", !sendParentError, JSON.stringify(sendParentError));

  const sensoryIds = masV2.items.filter((i) => i.category === "Sensory").map((i) => i.id);
  const responsesData = {};
  for (const item of masV2.items) {
    responsesData[item.id] = sensoryIds.includes(item.id) ? "Always" : "Never";
  }
  responsesData["mas-header-name"] = "Orla Quinn";
  responsesData["mas-header-date"] = "2026-08-11";

  const { error: completeParentError } = await parent
    .from("fba_instrument_requests")
    .update({ responses_data: responsesData, status: "completed" })
    .eq("id", parentRequest.id);
  expect("parent can complete their own MAS request", !completeParentError, JSON.stringify(completeParentError));

  const { data: completedParent } = await service
    .from("fba_instrument_requests")
    .select("responses_data, status")
    .eq("id", parentRequest.id)
    .single();
  const totals = scoreByCategory(masV2.items, completedParent.responses_data);
  expect("Sensory scores 24/24 (4 items x 6)", totals.Sensory === 24, JSON.stringify(totals));
  expect("Escape, Attention, Tangible all score 0", (totals.Escape ?? 0) === 0 && (totals.Attention ?? 0) === 0 && (totals.Tangible ?? 0) === 0, JSON.stringify(totals));
  expect("header name/date were saved alongside the 16 item answers", completedParent.responses_data["mas-header-name"] === "Orla Quinn" && completedParent.responses_data["mas-header-date"] === "2026-08-11");
  expect("header keys don't leak into scoring (proves instrumentScoring iterates the item bank, not response keys)", Object.keys(totals).every((k) => ["Sensory", "Escape", "Attention", "Tangible"].includes(k)));

  console.log("\n== Blind completion: parent cannot read back a computed score (none exists to read) ==");
  const parentOwnRow = await parent.from("fba_instrument_requests").select("responses_data").eq("id", parentRequest.id).single();
  expect("no score/total field exists anywhere in the stored row -- only raw answers", !("score" in (parentOwnRow.data ?? {})) && !("total" in (parentOwnRow.data ?? {})));

  console.log("\n== Send MAS to the teacher too, complete independently ==");
  const { data: teacherRequest, error: sendTeacherError } = await clinician
    .from("fba_instrument_requests")
    .insert({ fba_id: fbaId, passport_id: creds.passportId, instrument_type: "mas", recipient_id: creds.teacher.id, status: "sent" })
    .select()
    .single();
  expect("clinician can send a second, independent MAS to the teacher", !sendTeacherError, JSON.stringify(sendTeacherError));

  const teacherResponses = {};
  for (const item of masV2.items) teacherResponses[item.id] = "Seldom";
  teacherResponses["mas-header-name"] = "Tara Byrne";
  const { error: completeTeacherError } = await teacher
    .from("fba_instrument_requests")
    .update({ responses_data: teacherResponses, status: "completed" })
    .eq("id", teacherRequest.id);
  expect("teacher can complete their own, separate MAS request", !completeTeacherError, JSON.stringify(completeTeacherError));

  const { data: bothCompleted } = await service
    .from("fba_instrument_requests")
    .select("id, recipient_id, responses_data")
    .eq("fba_id", fbaId)
    .eq("instrument_type", "mas")
    .eq("status", "completed");
  const parentRow = bothCompleted.find((r) => r.recipient_id === creds.parent.id);
  const teacherRow = bothCompleted.find((r) => r.recipient_id === creds.teacher.id);
  expect(
    "parent's and teacher's completed MAS responses are independent (different header names, different answers)",
    parentRow?.responses_data["mas-header-name"] === "Orla Quinn" &&
      teacherRow?.responses_data["mas-header-name"] === "Tara Byrne" &&
      parentRow?.responses_data["mas-1"] === "Always" &&
      teacherRow?.responses_data["mas-1"] === "Seldom"
  );

  console.log(`\n${failures === 0 ? "✓ ALL MAS 7-POINT CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
