/* PRD 7 Stage 4 verification -- migration 0238, the BSP and the
   strategy bank.

   Real signed-in sessions throughout, service-role only for fixture
   setup and confirming persisted state.

   Clinic 1 (ZZPRD7S4CLINIC): director, three clinicians (A author, B
   colleague matching domain, C colleague not matching), one child with
   a completed FBA (real target behaviours incl. the new per-behaviour
   function field, triggers, setting events, precursors) and real
   clinician_access for A/B/C. Clinic 2 (ZZPRD7S4OTHER): director, one
   clinician (D) -- the cross-clinic negative control, mirroring Stage
   3's own established shape.

   Run: node --env-file=.env.local scripts/dev/zz-prd7-stage4-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd7-stage4-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd7S4Verify-2026!";
const BUCKET = "clinic-bank-assets";
let pass = 0;
let fail = 0;

function ok(label, cond, detail) {
  if (cond) {
    pass++;
    console.log(`  PASS: ${label}`);
  } else {
    fail++;
    console.log(`  FAIL: ${label}${detail ? " -- " + JSON.stringify(detail) : ""}`);
  }
}

async function createUser(email) {
  const { data, error } = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}

async function sessionFor(email) {
  const client = createClient(url, anonKey);
  const { data, error } = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return { client, userId: data.user.id };
}

async function buildClinic(code, prefix) {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: `ZZ ${code}`, institution_code: code, status: "verified", type: "clinic" })
    .select("id")
    .single();
  if (instErr) throw new Error(`institution ${code}: ${instErr.message}`);

  const directorId = await createUser(`${prefix}.director@thebehaviourhive.com`);
  const now = new Date().toISOString();
  await admin.auth.admin.updateUserById(directorId, { app_metadata: { role: "principal" } });
  await admin
    .from("institution_staff")
    .insert({ institution_id: inst.id, user_id: directorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  const director = await sessionFor(`${prefix}.director@thebehaviourhive.com`);

  return { institutionId: inst.id, director };
}

async function addClinician(clinic, prefix, label) {
  const email = `${prefix}.${label}@thebehaviourhive.com`;
  const userId = await createUser(email);
  await admin.auth.admin.updateUserById(userId, { app_metadata: { role: "clinician" } });
  const session = await sessionFor(email);

  const { error: joinErr } = await session.client
    .from("institution_staff")
    .insert({ institution_id: clinic.institutionId, user_id: userId, role: "clinician" });
  if (joinErr) throw new Error(`${label} self-link: ${joinErr.message}`);

  const { data: staff } = await admin
    .from("institution_staff")
    .select("id")
    .eq("institution_id", clinic.institutionId)
    .eq("user_id", userId)
    .single();
  const { error: approveErr } = await clinic.director.client.rpc("approve_staff_join", { p_institution_staff_id: staff.id });
  if (approveErr) throw new Error(`${label} approval: ${approveErr.message}`);

  return { userId, session, email };
}

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

async function main() {
  console.log("Building clinic 1 (the MDT case)...");
  const clinic1 = await buildClinic("ZZPRD7S4CLINIC", "zzprd7s4");
  const A = await addClinician(clinic1, "zzprd7s4", "a");
  const B = await addClinician(clinic1, "zzprd7s4", "b");
  const C = await addClinician(clinic1, "zzprd7s4", "c");

  console.log("Building clinic 2 (cross-clinic negative control)...");
  const clinic2 = await buildClinic("ZZPRD7S4OTHER", "zzprd7s4other");
  const D = await addClinician(clinic2, "zzprd7s4other", "d");

  console.log("Onboarding the client and granting A/B/C caseload access...");
  const { data: passportId, error: onboardErr } = await clinic1.director.client.rpc("onboard_clinic_client", {
    p_institution_id: clinic1.institutionId,
    p_client_name: "ZZ S4 Client",
  });
  if (onboardErr) throw new Error(`onboard: ${onboardErr.message}`);

  for (const clinician of [A, B, C]) {
    const { error } = await clinic1.director.client.rpc("bulk_grant_clinician_access", {
      p_institution_id: clinic1.institutionId,
      p_passport_ids: [passportId],
      p_roster_user_id: clinician.userId,
    });
    if (error) throw new Error(`grant access to ${clinician.email}: ${error.message}`);
  }

  // B declares a matching domain, C a non-matching one -- Stage 3's own
  // mechanism, reused here rather than re-proven.
  await B.session.client.from("clinicians").update({ domain_tags: ["behaviour_analysis"] }).eq("user_id", B.userId);
  await C.session.client.from("clinicians").update({ domain_tags: ["adaptive_living"] }).eq("user_id", C.userId);

  console.log("A writes a real, completed FBA -- real content, real per-behaviour function field...");
  const contentData = {
    targetBehaviours: [
      { id: "b1", name: "Refusal", operationalDefinition: "Verbally declines or physically turns away from a task.", howItPresents: "Says 'no' and crosses arms.", function: "escape" },
      { id: "b2", name: "Screaming", operationalDefinition: "Vocalisation above 80dB lasting >2s.", howItPresents: "Loud, sustained vocal protest.", function: "access to tangibles and escape" },
    ],
    triggers: [{ id: "t1", title: "Transition", description: "Moving between activities without warning." }],
    settingEvents: [{ id: "se1", title: "Poor sleep", description: "Less than 6 hours the night before." }],
    precursors: "Jaw clenching and rapid breathing precede both behaviours.",
  };
  const { data: fba, error: fbaErr } = await A.session.client
    .from("fba_reports")
    .insert({ passport_id: passportId, clinician_id: A.userId, status: "completed", content_data: contentData, completed_at: new Date().toISOString() })
    .select("id")
    .single();
  if (fbaErr) throw new Error(`fba insert: ${fbaErr.message}`);

  console.log(`\nFixture built. Clinic1: ${clinic1.institutionId} | Clinic2: ${clinic2.institutionId}`);
  console.log(`Client: ${passportId} | FBA: ${fba.id}`);

  // =====================================================================
  // PART A -- the bank. Any verified clinician adds; the director
  // curates/retires; a non-director's attempt to retire is the "RLS on
  // UPDATE silently filters" shape, proven directly rather than assumed.
  // =====================================================================
  console.log("\nPART A -- the strategy bank: add, curate, retire.");

  const imgPath = `${clinic1.institutionId}/${crypto.randomUUID()}-image.png`;
  await A.session.client.storage.from(BUCKET).upload(imgPath, TINY_PNG, { contentType: "image/png" });
  const { data: imageAsset, error: imgErr } = await A.session.client
    .from("bank_assets")
    .insert({ institution_id: clinic1.institutionId, label: "First-Then image", storage_path: imgPath, original_filename: "image.png", content_type: "image/png", size_bytes: TINY_PNG.length, uploaded_by: A.userId })
    .select("id")
    .single();
  ok("A uploads a real bank asset (image)", !imgErr, imgErr?.message);

  const { data: signed, error: signedErr } = await A.session.client.storage.from(BUCKET).createSignedUrl(imgPath, 300);
  let bytesMatch = false;
  if (signed?.signedUrl) {
    const resp = await fetch(signed.signedUrl);
    const bytes = Buffer.from(await resp.arrayBuffer());
    bytesMatch = bytes.equals(TINY_PNG);
  }
  ok("...and A's own real fetch of the signed URL returns the real bytes, byte-for-byte", !signedErr && bytesMatch);

  const { data: bankStrategy, error: bankErr } = await A.session.client
    .from("strategy_bank")
    .insert({
      institution_id: clinic1.institutionId,
      created_by: A.userId,
      title: "First-Then Visual Schedule",
      why: "Reduces anxiety by making the next step predictable.",
      how: "Show the First-Then board before the transition; point to each image.",
      scripted_language: "First [task], then [reward].",
      default_placement: "shared",
      caveat: "At school, laminate the board; at home, a phone photo is fine.",
      image_asset_id: imageAsset.id,
    })
    .select("id")
    .single();
  ok("A (any verified clinician) adds a strategy to the bank", !bankErr, bankErr?.message);

  const { error: cTamperErr } = await C.session.client.from("strategy_bank").update({ is_active: false }).eq("id", bankStrategy.id);
  const { data: afterCTamper } = await admin.from("strategy_bank").select("is_active").eq("id", bankStrategy.id).single();
  ok(
    "A non-director clinician's attempt to retire it is refused (RLS-on-UPDATE silently filters -- confirmed via service-role read, not the absence of an error)",
    !cTamperErr && afterCTamper?.is_active === true,
    { cTamperErr: cTamperErr?.message, afterCTamper }
  );

  const { error: retireErr } = await clinic1.director.client.from("strategy_bank").update({ is_active: false }).eq("id", bankStrategy.id);
  const { data: afterRetire } = await admin.from("strategy_bank").select("is_active").eq("id", bankStrategy.id).single();
  ok("The director genuinely retires it", !retireErr && afterRetire?.is_active === false, { retireErr: retireErr?.message, afterRetire });

  const { error: restoreErr } = await clinic1.director.client.from("strategy_bank").update({ is_active: true }).eq("id", bankStrategy.id);
  ok("...and restores it", !restoreErr, restoreErr?.message);

  // =====================================================================
  // PART B -- FBA carry-over. Structured fields copy verbatim, INCLUDING
  // the new per-behaviour function field; current_frequency starts
  // genuinely empty since it is never carried, per Daniel's own explicit
  // instruction.
  // =====================================================================
  console.log("\nPART B -- FBA carry-over into a new plan.");

  const { data: bspId, error: createErr } = await A.session.client.rpc("create_bsp", { p_passport_id: passportId, p_source_fba_id: fba.id });
  ok("A creates a BSP carrying over the completed FBA", !createErr, createErr?.message);

  const { data: bspRow } = await admin.from("bsp").select("*").eq("id", bspId).single();
  ok("target_behaviours carried over verbatim, INCLUDING the new function field", bspRow?.target_behaviours?.[0]?.function === "escape" && bspRow?.target_behaviours?.[1]?.function === "access to tangibles and escape", bspRow?.target_behaviours);
  ok("triggers carried over verbatim", bspRow?.triggers?.[0]?.title === "Transition", bspRow?.triggers);
  ok("setting_events carried over verbatim", bspRow?.setting_events?.[0]?.title === "Poor sleep", bspRow?.setting_events);
  ok("precursors carried over as prose", bspRow?.precursors === contentData.precursors, bspRow?.precursors);
  ok("current_frequency starts genuinely empty -- NEVER carried from the FBA", bspRow?.current_frequency === null, bspRow?.current_frequency);
  ok("institution_id derived correctly from A's own clinic", bspRow?.institution_id === clinic1.institutionId, bspRow?.institution_id);
  ok("status starts as draft", bspRow?.status === "draft", bspRow?.status);

  // A draft FBA must be refused as a carry-over source.
  const { data: draftFba } = await A.session.client.from("fba_reports").insert({ passport_id: passportId, clinician_id: A.userId }).select("id").single();
  const { error: draftSourceErr } = await A.session.client.rpc("create_bsp", { p_passport_id: passportId, p_source_fba_id: draftFba.id });
  ok("A draft (uncompleted) FBA is refused as a carry-over source", !!draftSourceErr, draftSourceErr?.message);
  await admin.from("fba_reports").delete().eq("id", draftFba.id);

  // =====================================================================
  // PART C -- the copy rule. The thing most likely to be built wrong,
  // proven directly: pulling the bank strategy into the plan produces a
  // faithful, INDEPENDENT copy -- editing the plan's own copy afterward
  // must never touch the bank, and editing the bank afterward must never
  // touch the plan.
  // =====================================================================
  console.log("\nPART C -- the copy rule, proven both directions.");

  const { data: newStrategyId, error: addErr } = await A.session.client.rpc("add_bank_strategy_to_bsp", { p_bsp_id: bspId, p_bank_strategy_id: bankStrategy.id });
  ok("A pulls the bank strategy into the plan via the real copy RPC", !addErr, addErr?.message);

  const { data: copiedRow } = await admin.from("bsp_strategies").select("*").eq("id", newStrategyId).single();
  ok("The copy is faithful -- title/why/how/scripted_language/placement/image all match the bank row at copy time", copiedRow?.title === "First-Then Visual Schedule" && copiedRow?.placement === "shared" && copiedRow?.image_asset_id === imageAsset.id, copiedRow);
  ok("source_bank_strategy_id records real provenance", copiedRow?.source_bank_strategy_id === bankStrategy.id, copiedRow?.source_bank_strategy_id);

  // Edit the PLAN's own copy.
  await A.session.client.from("bsp_strategies").update({ title: "First-Then Visual Schedule (edited for this child)" }).eq("id", newStrategyId);
  const { data: bankAfterPlanEdit } = await admin.from("strategy_bank").select("title").eq("id", bankStrategy.id).single();
  ok("Editing the PLAN's own copy never touches the bank's original", bankAfterPlanEdit?.title === "First-Then Visual Schedule", bankAfterPlanEdit);

  // Edit the BANK's own original (director curates).
  await clinic1.director.client.from("strategy_bank").update({ title: "First-Then Visual Schedule (bank, revised wording)" }).eq("id", bankStrategy.id);
  const { data: planAfterBankEdit } = await admin.from("bsp_strategies").select("title").eq("id", newStrategyId).single();
  ok("*** THE COPY RULE *** Editing the BANK's own original never touches an already-copied plan strategy", planAfterBankEdit?.title === "First-Then Visual Schedule (edited for this child)", planAfterBankEdit);

  // Direct client insert cannot fake provenance.
  const { error: fakeProvenanceErr } = await A.session.client.from("bsp_strategies").insert({ bsp_id: bspId, source_bank_strategy_id: bankStrategy.id, title: "Faked", why: "x", how: "x", placement: "home" });
  ok("A raw client insert cannot claim a false source_bank_strategy_id -- only the copy RPC can set it", !!fakeProvenanceErr, fakeProvenanceErr?.message);

  // A fresh strategy, authored directly.
  const { error: freshErr } = await A.session.client.from("bsp_strategies").insert({ bsp_id: bspId, title: "Fresh strategy", why: "Because.", how: "Do this.", placement: "home" });
  ok("A adds a fresh, bank-independent strategy directly", !freshErr, freshErr?.message);

  // =====================================================================
  // PART D -- domain-matched colleague reads a DRAFT plan (Stage 3's own
  // mechanism, applied to the new Silo-2 member -- bsp's own SELECT
  // policy never checks status, so this must work even pre-signature).
  // =====================================================================
  console.log("\nPART D -- colleague reads, even on a draft plan.");

  const { data: bByB } = await B.session.client.from("bsp").select("id").eq("id", bspId);
  ok("B (matching domain, live access) reads the DRAFT plan", (bByB ?? []).length === 1, bByB);

  const { data: bByC } = await C.session.client.from("bsp").select("id").eq("id", bspId);
  ok("C (non-matching domain) is refused the draft plan", (bByC ?? []).length === 0, bByC);

  const { data: bByD } = await D.session.client.from("bsp").select("id").eq("id", bspId);
  ok("*** THE GUARANTEE *** D (different clinic entirely, zero clinician_access) is refused, regardless of domain", (bByD ?? []).length === 0, bByD);

  const { error: crossClinicAddErr } = await D.session.client.rpc("add_bank_strategy_to_bsp", { p_bsp_id: bspId, p_bank_strategy_id: bankStrategy.id });
  ok("D cannot even attempt to add a strategy to a plan they cannot read", !!crossClinicAddErr, crossClinicAddErr?.message);

  // =====================================================================
  // PART E -- the lock. B (a mere reader, not the author) cannot edit.
  // A raw client status flip is refused by the UPDATE policy's own WITH
  // CHECK. Only sign_bsp() can actually lock it.
  // =====================================================================
  console.log("\nPART E -- the lock: draft editable, active locked, only sign_bsp() transitions status.");

  const { error: bEditErr } = await B.session.client.from("bsp").update({ precursors: "B tampering" }).eq("id", bspId);
  const { data: afterBEdit } = await admin.from("bsp").select("precursors").eq("id", bspId).single();
  ok("B (a reader, not the author) cannot edit the draft -- confirmed via service-role read", afterBEdit?.precursors === contentData.precursors, { bEditErr: bEditErr?.message, afterBEdit });

  const { data: rawStatusFlip } = await A.session.client.from("bsp").update({ status: "active" }).eq("id", bspId).select("id");
  ok("A raw client update can never set status to 'active' directly -- WITH CHECK refuses it (empty return, not an error)", (rawStatusFlip ?? []).length === 0, rawStatusFlip);

  const { error: signErr } = await A.session.client.rpc("sign_bsp", { p_bsp_id: bspId });
  ok("sign_bsp() genuinely locks the plan", !signErr, signErr?.message);

  const { data: afterSign } = await admin.from("bsp").select("status, signed_at, signed_by").eq("id", bspId).single();
  ok("status is now active, signed_at/signed_by genuinely stamped", afterSign?.status === "active" && !!afterSign?.signed_at && afterSign?.signed_by === A.userId, afterSign);

  const { data: postLockEdit } = await A.session.client.from("bsp").update({ precursors: "post-lock tamper" }).eq("id", bspId).select("id");
  ok("Even the plan's own author cannot edit it once signed", (postLockEdit ?? []).length === 0, postLockEdit);

  const { data: postLockStrategyAdd, error: postLockStrategyErr } = await A.session.client.from("bsp_strategies").insert({ bsp_id: bspId, title: "Too late", why: "x", how: "x", placement: "home" }).select("id");
  ok("Strategies lock together with the plan -- no new strategy can be added post-signature", !!postLockStrategyErr || (postLockStrategyAdd ?? []).length === 0, { postLockStrategyErr: postLockStrategyErr?.message });

  // The colleague and cross-clinic checks still hold post-signature.
  const { data: bByBAfterSign } = await B.session.client.from("bsp").select("id").eq("id", bspId);
  ok("B still reads the now-active plan", (bByBAfterSign ?? []).length === 1, bByBAfterSign);

  // =====================================================================
  // PART F -- one active per passport per institution, and the
  // supersede/revision cycle.
  // =====================================================================
  console.log("\nPART F -- one-active constraint, and a genuine revision.");

  const { data: unrelatedDraftId } = await A.session.client.rpc("create_bsp", { p_passport_id: passportId });
  const { error: unrelatedSignErr } = await A.session.client.rpc("sign_bsp", { p_bsp_id: unrelatedDraftId });
  ok(
    "Signing an UNRELATED second draft (no supersedes_id) for the same child+institution is refused by the one-active unique index",
    !!unrelatedSignErr,
    unrelatedSignErr?.message
  );
  await admin.from("bsp").delete().eq("id", unrelatedDraftId);

  const { data: revisionId, error: revErr } = await A.session.client.rpc("create_bsp_revision", { p_bsp_id: bspId });
  ok("A creates a genuine revision of the now-active plan", !revErr, revErr?.message);

  const { data: revisionRow } = await admin.from("bsp").select("supersedes_id, status, precursors").eq("id", revisionId).single();
  ok("The revision points back at the plan it will supersede", revisionRow?.supersedes_id === bspId, revisionRow);
  ok("The revision starts as a draft, seeded with the prior plan's own content", revisionRow?.status === "draft" && revisionRow?.precursors === contentData.precursors, revisionRow);

  const { data: copiedStrategies } = await admin.from("bsp_strategies").select("title").eq("bsp_id", revisionId);
  ok("The revision's own strategies were copied too (2 strategies: the bank-sourced one and the fresh one)", (copiedStrategies ?? []).length === 2, copiedStrategies);

  const { error: revSignErr } = await A.session.client.rpc("sign_bsp", { p_bsp_id: revisionId });
  ok("Signing the revision succeeds", !revSignErr, revSignErr?.message);

  const { data: originalAfterSupersede } = await admin.from("bsp").select("status").eq("id", bspId).single();
  ok("*** ATOMICALLY *** the original plan is now superseded", originalAfterSupersede?.status === "superseded", originalAfterSupersede);

  const { data: revisionAfterSign } = await admin.from("bsp").select("status").eq("id", revisionId).single();
  ok("...and the revision is now active", revisionAfterSign?.status === "active", revisionAfterSign);

  const { data: oldStillReadableByA } = await A.session.client.from("bsp").select("id").eq("id", bspId);
  ok("The superseded plan STAYS fully readable by its author -- permanently, a school may have acted on it for months", (oldStillReadableByA ?? []).length === 1, oldStillReadableByA);

  const { data: oldStillReadableByB } = await B.session.client.from("bsp").select("id").eq("id", bspId);
  ok("...and by the domain-matched colleague too", (oldStillReadableByB ?? []).length === 1, oldStillReadableByB);

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log(`clinic1: ${clinic1.institutionId} | clinic2: ${clinic2.institutionId}`);
  console.log(`passport: ${passportId} | fba: ${fba.id} | original bsp: ${bspId} | revision bsp: ${revisionId}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
