// Live verification for the QABF/MAS respondent-flow refinements:
// label-only answers, hidden categories, and the per-send editable
// instruction line. Signs in as the real clinician/parent/teacher
// accounts (anon key + password, not service role).
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-instruction-line.mjs

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

// Exact replica of getChildDisplayName (src/lib/childDisplayName.ts).
function getChildDisplayName(childName) {
  if (!childName) return "This child";
  const parts = childName.trim().split(/\s+/);
  const first = parts[0];
  if (parts.length === 1) return first;
  const lastInitial = parts[parts.length - 1][0];
  return `${first} ${lastInitial.toUpperCase()}.`;
}

// Exact replica of resolveInstructionText (src/lib/fba/resolveInstruction.ts).
function resolveInstructionText(template, childName) {
  if (!template?.trim()) return null;
  return template.replaceAll("[child name]", childName);
}

// Exact replica of instrumentScoring.ts's exclusion-aware logic.
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

async function main() {
  const clinician = await signInAs(creds.clinician.email);
  const parent = await signInAs(creds.parent.email);
  const teacher = await signInAs(creds.teacher.email);

  const { data: passport } = await service.from("passports").select("child_name").eq("id", creds.passportId).single();
  const childFullName = passport.child_name;
  const childShortName = getChildDisplayName(childFullName);
  console.log(`Testing against child "${childFullName}" (teacher-shortened: "${childShortName}")\n`);

  const { data: qabfV2 } = await service.from("fba_instruments").select("items, default_instruction").eq("instrument_type", "qabf").eq("is_active", true).single();
  const { data: masV2 } = await service.from("fba_instruments").select("items, default_instruction").eq("instrument_type", "mas").eq("is_active", true).single();

  expect(
    "QABF and MAS both have a default_instruction containing the literal token",
    qabfV2.default_instruction?.includes("[child name]") && masV2.default_instruction?.includes("[child name]")
  );

  // ============================================================
  console.log("== QABF: send to parent, EDITING the instruction ==");
  const { data: fbaRow } = await service.from("fba_reports").select("id").eq("passport_id", creds.passportId).maybeSingle();
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

  const customInstruction = "When completing the questionnaire, think specifically about times [child name] refuses to leave the playground.";
  const { data: qabfRequest, error: qabfSendError } = await clinician
    .from("fba_instrument_requests")
    .insert({
      fba_id: fbaId,
      passport_id: creds.passportId,
      instrument_type: "qabf",
      recipient_id: creds.parent.id,
      status: "sent",
      instruction: customInstruction,
    })
    .select()
    .single();
  expect("clinician can send QABF with an edited instruction", !qabfSendError, JSON.stringify(qabfSendError));

  console.log("\n== MAS: send to teacher, LEAVING the default instruction ==");
  const { data: masRequest, error: masSendError } = await clinician
    .from("fba_instrument_requests")
    .insert({
      fba_id: fbaId,
      passport_id: creds.passportId,
      instrument_type: "mas",
      recipient_id: creds.teacher.id,
      status: "sent",
      instruction: masV2.default_instruction,
    })
    .select()
    .single();
  expect("clinician can send MAS with the default instruction", !masSendError, JSON.stringify(masSendError));

  // ============================================================
  console.log("\n== Respondent views: instruction resolves per role's own display rule ==");
  const { data: parentOwnRequests } = await parent.rpc("get_my_instrument_requests");
  const parentQabf = (parentOwnRequests ?? []).find((r) => r.id === qabfRequest.id);
  const parentResolved = resolveInstructionText(parentQabf?.instruction, childFullName);
  expect(
    "parent's own view resolves the instruction with the FULL child name",
    parentResolved === customInstruction.replace("[child name]", childFullName),
    parentResolved
  );

  const { data: teacherOwnRequests } = await teacher.rpc("get_my_instrument_requests");
  const teacherMas = (teacherOwnRequests ?? []).find((r) => r.id === masRequest.id);
  const teacherResolved = resolveInstructionText(teacherMas?.instruction, childShortName);
  expect(
    "teacher's own view resolves the instruction with the SHORTENED child name",
    teacherResolved === masV2.default_instruction.replace("[child name]", childShortName),
    teacherResolved
  );
  expect(
    "teacher's resolved instruction does NOT contain the child's real surname",
    !teacherResolved.includes(childFullName.split(" ").slice(1).join(" ")),
    teacherResolved
  );

  // ============================================================
  console.log("\n== Blind completion + known-pattern scoring spot-check (QABF) ==");
  const attentionIds = qabfV2.items.filter((i) => i.category === "Attention").map((i) => i.id);
  const qabfResponses = {};
  for (const item of qabfV2.items) {
    qabfResponses[item.id] = attentionIds.includes(item.id) ? "3" : "0";
  }
  qabfResponses["header-name"] = "Orla Quinn";
  qabfResponses["header-date"] = "2026-08-11";
  const { error: qabfCompleteError } = await parent
    .from("fba_instrument_requests")
    .update({ responses_data: qabfResponses, status: "completed" })
    .eq("id", qabfRequest.id);
  expect("parent completes QABF blind", !qabfCompleteError, JSON.stringify(qabfCompleteError));

  const { data: completedQabf } = await service.from("fba_instrument_requests").select("responses_data").eq("id", qabfRequest.id).single();
  const totals = scoreByCategory(qabfV2.items, completedQabf.responses_data);
  expect("Attention still totals 15/15 -- scoring identical to before this change", totals.Attention === 15, JSON.stringify(totals));

  console.log("\n== Clinician side: instruction visible above responses, categories/numbers intact ==");
  const { data: clinicianView } = await clinician.rpc("get_fba_instrument_requests", { p_fba_id: fbaId });
  const clinicianQabfRow = (clinicianView ?? []).find((r) => r.id === qabfRequest.id);
  expect(
    "clinician's RPC view includes the stored instruction (raw token, resolved client-side with the full name)",
    clinicianQabfRow?.instruction === customInstruction
  );
  expect(
    "clinician-facing responses_data still stores raw values ('3', '0'), not display labels -- categories/numbers intact",
    completedQabf.responses_data[attentionIds[0]] === "3"
  );

  console.log("\n== Reader/PDF path: same RPC-free direct query the reader uses returns instruction too ==");
  const { data: readerRow } = await service
    .from("fba_instrument_requests")
    .select("id, instruction")
    .eq("id", qabfRequest.id)
    .single();
  expect("direct table query (what ReaderIndirectAssessment uses) includes instruction", readerRow.instruction === customInstruction);

  console.log(`\n${failures === 0 ? "✓ ALL INSTRUCTION-LINE CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
