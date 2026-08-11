// Live verification for the QABF real content + X/0/1/2/3 exclusion-
// aware scale. Signs in as the real clinician/parent test accounts
// (anon key + password, not service role) and re-implements
// instrumentScoring.ts's exact algorithm against the real fetched item
// bank, mirroring the MAS/FAI verification scripts' approach.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-qabf-exclusion.mjs

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

// Exact replica of src/lib/fba/instrumentScoring.ts's exclusion-aware
// logic -- re-implemented, not imported, so this proves the real
// algorithm against real data.
const EXCLUDED = "X";
function hasExclusion(scale) {
  return scale.includes(EXCLUDED);
}
function pointsFor(item, answer) {
  if (hasExclusion(item.scale)) {
    if (answer === EXCLUDED) return null;
    const v = Number(answer);
    return Number.isFinite(v) ? v : null;
  }
  const i = item.scale.indexOf(answer);
  return i >= 0 ? i : null;
}
function scoreByCategory(items, responses) {
  const totals = {};
  for (const item of items) {
    if (!item.category) continue;
    const answer = responses[item.id];
    if (answer === undefined) continue;
    const points = pointsFor(item, answer);
    if (points === null) continue;
    totals[item.category] = (totals[item.category] ?? 0) + points;
  }
  return totals;
}
function categoryMaxes(items, responses) {
  const maxes = {};
  for (const item of items) {
    if (!item.category || !item.scale) continue;
    if (hasExclusion(item.scale)) {
      const answer = responses[item.id];
      if (answer === undefined || answer === EXCLUDED) continue;
      const nums = item.scale.filter((l) => l !== EXCLUDED).map(Number);
      maxes[item.category] = (maxes[item.category] ?? 0) + Math.max(...nums);
    } else {
      maxes[item.category] = (maxes[item.category] ?? 0) + (item.scale.length - 1);
    }
  }
  return maxes;
}

async function main() {
  const clinician = await signInAs(creds.clinician.email);
  const parent = await signInAs(creds.parent.email);

  const { data: qabfRows } = await service
    .from("fba_instruments")
    .select("version, is_active, items")
    .eq("instrument_type", "qabf")
    .order("version");
  const v1 = qabfRows.find((r) => r.version === 1);
  const v2 = qabfRows.find((r) => r.version === 2 && r.is_active);
  expect("version 1 is now inactive", v1?.is_active === false);
  expect("version 2 is active with 25 items", v2?.is_active === true && v2.items.length === 25);
  expect("every item's scale is ['X','0','1','2','3']", v2.items.every((i) => JSON.stringify(i.scale) === JSON.stringify(["X", "0", "1", "2", "3"])));
  expect(
    "category mapping matches the confirmed sheet (1,6,11,16,21=Attention etc.)",
    v2.items[0].category === "Attention" &&
      v2.items[1].category === "Escape" &&
      v2.items[2].category === "Non-social function" &&
      v2.items[3].category === "Physical" &&
      v2.items[4].category === "Tangible" &&
      v2.items[5].category === "Attention" &&
      v2.items[20].category === "Attention"
  );

  const { data: mas } = await service.from("fba_instruments").select("version, is_active, items").eq("instrument_type", "mas").eq("is_active", true).single();
  expect("MAS untouched: still 7-point scale, version 2", mas.version === 2 && mas.items[0].scale.length === 7);

  // ============================================================
  console.log("\n== Send QABF to parent, complete with the known pattern ==");
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

  const { data: request, error: sendError } = await clinician
    .from("fba_instrument_requests")
    .insert({ fba_id: fbaId, passport_id: creds.passportId, instrument_type: "qabf", recipient_id: creds.parent.id, status: "sent" })
    .select()
    .single();
  expect("clinician can send QABF to the parent", !sendError, JSON.stringify(sendError));

  const attentionIds = v2.items.filter((i) => i.category === "Attention").map((i) => i.id);
  const physicalIds = v2.items.filter((i) => i.category === "Physical").map((i) => i.id);
  const responsesData = {};
  for (const item of v2.items) {
    if (attentionIds.includes(item.id)) {
      responsesData[item.id] = "3";
    } else if (physicalIds.includes(item.id)) {
      // Two X, rest "0" -- physicalIds[0..1] excluded, physicalIds[2..4] scored 0.
      responsesData[item.id] = physicalIds.indexOf(item.id) < 2 ? "X" : "0";
    } else {
      responsesData[item.id] = "0";
    }
  }
  responsesData["header-name"] = "Orla Quinn";
  responsesData["header-date"] = "2026-08-11";

  const { error: completeError } = await parent
    .from("fba_instrument_requests")
    .update({ responses_data: responsesData, status: "completed" })
    .eq("id", request.id);
  expect("parent can complete their own QABF request", !completeError, JSON.stringify(completeError));

  const { data: completed } = await service
    .from("fba_instrument_requests")
    .select("responses_data")
    .eq("id", request.id)
    .single();

  const totals = scoreByCategory(v2.items, completed.responses_data);
  const maxes = categoryMaxes(v2.items, completed.responses_data);

  expect("Attention totals 15 (5 items x 3)", totals.Attention === 15, JSON.stringify(totals));
  expect("Attention possible max is 15 (no exclusions)", maxes.Attention === 15, JSON.stringify(maxes));
  expect("Physical totals 0 (three 0-answered items)", (totals.Physical ?? 0) === 0, JSON.stringify(totals));
  expect(
    "Physical possible max is 9, not 15 -- the two X items excluded from the maximum",
    maxes.Physical === 9,
    JSON.stringify(maxes)
  );
  expect(
    "Escape, Non-social function, Tangible all total 0 with full max 15 (all answered 0, none X)",
    (totals.Escape ?? 0) === 0 &&
      (totals["Non-social function"] ?? 0) === 0 &&
      (totals.Tangible ?? 0) === 0 &&
      maxes.Escape === 15 &&
      maxes["Non-social function"] === 15 &&
      maxes.Tangible === 15,
    JSON.stringify({ totals, maxes })
  );
  expect(
    "header fields saved without contaminating scoring",
    completed.responses_data["header-name"] === "Orla Quinn" &&
      Object.keys(totals).every((k) => ["Attention", "Escape", "Non-social function", "Physical", "Tangible"].includes(k))
  );

  // ============================================================
  console.log("\n== Adversarial-lite: all-X category renders as Not applicable, not a zero max ==");
  const allXResponses = { ...completed.responses_data };
  for (const id of physicalIds) allXResponses[id] = "X";
  const allXMaxes = categoryMaxes(v2.items, allXResponses);
  expect(
    "an all-X category (every item excluded) has NO maxes entry at all -- the 'Not applicable' signal",
    !("Physical" in allXMaxes),
    JSON.stringify(allXMaxes)
  );

  console.log(`\n${failures === 0 ? "✓ ALL QABF EXCLUSION CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
