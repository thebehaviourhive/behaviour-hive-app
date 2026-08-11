// Live verification for the PARENT EXPERIENCE UPGRADE, Step 0 + WS1's
// data layer: get_child_clinical_document_status through all four FBA
// card states, plus the adversarial check. Signs in as the real parent
// test account (anon key + password, not service role) for every read;
// service role is used only to arrange each state's underlying data.
//
// Run with: node --env-file=.env.local scripts/fba-test/verify-clinical-support.mjs

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
  const parent = await signInAs(creds.parent.email);

  // ============================================================
  console.log("== State A: no clinician connected ==");
  await service.from("clinician_access").update({ is_active: false }).eq("passport_id", creds.passportId);
  const clinicianRowsA = await parent.rpc("get_passport_clinicians", { p_passport_id: creds.passportId });
  const statusRowsA = await parent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  expect("no clinicians returned (state A signal)", (clinicianRowsA.data ?? []).length === 0, JSON.stringify(clinicianRowsA));
  expect("no document status returned", (statusRowsA.data ?? []).length === 0, JSON.stringify(statusRowsA));

  // ============================================================
  console.log("\n== State B: clinician connected, no FBA ==");
  await service.from("clinician_access").update({ is_active: true }).eq("passport_id", creds.passportId);
  const clinicianRowsB = await parent.rpc("get_passport_clinicians", { p_passport_id: creds.passportId });
  const statusRowsB = await parent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  expect("clinician now returned", (clinicianRowsB.data ?? []).length === 1, JSON.stringify(clinicianRowsB));
  expect("still no document status (no FBA started yet)", (statusRowsB.data ?? []).length === 0, JSON.stringify(statusRowsB));

  // ============================================================
  console.log("\n== State C: draft/in-progress FBA ==");
  const { data: fbaRow, error: fbaInsertError } = await service
    .from("fba_reports")
    .insert({ passport_id: creds.passportId, clinician_id: creds.clinician.id, status: "in_progress" })
    .select()
    .single();
  if (fbaInsertError) throw fbaInsertError;

  const statusRowsC = await parent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  const rowC = (statusRowsC.data ?? [])[0];
  expect("status = in_progress", rowC?.status === "in_progress", JSON.stringify(rowC));
  expect("started_at is set", Boolean(rowC?.started_at), JSON.stringify(rowC));
  expect("completed_at is null", rowC?.completed_at === null, JSON.stringify(rowC));
  expect("is_approved is false", rowC?.is_approved === false, JSON.stringify(rowC));
  expect(
    "no content_data, no other clinical fields leaked -- only the documented columns",
    rowC &&
      Object.keys(rowC).sort().join(",") ===
        ["document_type", "status", "fba_id", "started_at", "completed_at", "is_approved"].sort().join(","),
    JSON.stringify(rowC && Object.keys(rowC))
  );

  // ============================================================
  console.log("\n== State D (pending): completed FBA, not yet approved ==");
  await service.from("fba_reports").update({ status: "completed" }).eq("id", fbaRow.id);
  const statusRowsDPending = await parent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  const rowDPending = (statusRowsDPending.data ?? [])[0];
  expect("status = completed", rowDPending?.status === "completed", JSON.stringify(rowDPending));
  expect("is_approved is false (pending)", rowDPending?.is_approved === false, JSON.stringify(rowDPending));
  expect("completed_at is now set", Boolean(rowDPending?.completed_at), JSON.stringify(rowDPending));

  // ============================================================
  console.log("\n== State D (approved): passport_clinical_content exists for this FBA ==");
  await service.from("passport_clinical_content").insert({
    passport_id: creds.passportId,
    author_id: creds.clinician.id,
    author_role: "clinician",
    item_type: "trigger",
    content: { title: "Test trigger", description: "For verification only." },
    source_document_type: "fba_report",
    source_document_id: fbaRow.id,
  });
  const statusRowsDApproved = await parent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  const rowDApproved = (statusRowsDApproved.data ?? [])[0];
  expect("is_approved flips to true once passport_clinical_content exists", rowDApproved?.is_approved === true, JSON.stringify(rowDApproved));

  // ============================================================
  console.log("\n== Adversarial: an unrelated parent's JWT gets nothing for this passport ==");
  const otherParentEmail = "fbatest.otherparent@thebehaviourhive.com";
  const { data: existingUsers } = await service.auth.admin.listUsers({ perPage: 200 });
  let otherUser = existingUsers?.users?.find((u) => u.email === otherParentEmail);
  if (!otherUser) {
    const { data, error } = await service.auth.admin.createUser({
      email: otherParentEmail,
      password: creds.password,
      email_confirm: true,
      user_metadata: { full_name: "Other Parent" },
      app_metadata: { role: "parent" },
    });
    if (error) throw error;
    otherUser = data.user;
  }
  const otherParent = await signInAs(otherParentEmail);
  const strangerStatus = await otherParent.rpc("get_child_clinical_document_status", { p_passport_id: creds.passportId });
  expect(
    "unrelated parent's call returns zero rows despite the FBA genuinely existing",
    (strangerStatus.data ?? []).length === 0,
    JSON.stringify(strangerStatus)
  );
  const strangerClinicians = await otherParent.rpc("get_passport_clinicians", { p_passport_id: creds.passportId });
  expect(
    "unrelated parent also gets zero rows from the reused clinician-name RPC",
    (strangerClinicians.data ?? []).length === 0,
    JSON.stringify(strangerClinicians)
  );

  console.log(`\n${failures === 0 ? "✓ ALL CLINICAL SUPPORT CHECKS PASSED" : `✗ ${failures} CHECK(S) FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
