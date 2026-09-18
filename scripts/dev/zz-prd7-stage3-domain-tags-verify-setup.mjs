/* PRD 7 Stage 3 verification -- migrations 0235/0236, the clinical
   artefact model: silos, domain tags, school-visibility type defaults.

   Real signed-in sessions throughout, service-role only for fixture
   setup and confirming persisted state.

   Clinic 1 (ZZPRD7S3CLINIC): director, three clinicians (A author, B
   colleague, C colleague) all sharing one MDT case -- a real,
   multi-practitioner caseload, the actual scenario domain tags exist
   for. Clinic 2 (ZZPRD7S3OTHER): director, one clinician (D) --
   genuinely unrelated, zero clinician_access to clinic 1's client at
   all, the negative control that proves a domain tag can never grant
   reach to a child nobody has any other standing with.

   Run: node --env-file=.env.local scripts/dev/zz-prd7-stage3-domain-tags-verify-setup.mjs
   Teardown: node --env-file=.env.local scripts/dev/zz-prd7-stage3-domain-tags-verify-teardown.mjs */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "Prd7S3Verify-2026!";
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

async function buildClinic(code, directorEmailPrefix) {
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: `ZZ ${code}`, institution_code: code, status: "verified", type: "clinic" })
    .select("id")
    .single();
  if (instErr) throw new Error(`institution ${code}: ${instErr.message}`);

  const directorId = await createUser(`${directorEmailPrefix}.director@thebehaviourhive.com`);
  const now = new Date().toISOString();
  await admin.auth.admin.updateUserById(directorId, { app_metadata: { role: "principal" } });
  await admin
    .from("institution_staff")
    .insert({ institution_id: inst.id, user_id: directorId, role: "principal", approved_at: now, approval_source: "bootstrap" });
  const director = await sessionFor(`${directorEmailPrefix}.director@thebehaviourhive.com`);

  return { institutionId: inst.id, director };
}

async function addClinician(clinic, emailPrefix, label) {
  const email = `${emailPrefix}.${label}@thebehaviourhive.com`;
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

async function main() {
  console.log("Building clinic 1 (the MDT case)...");
  const clinic1 = await buildClinic("ZZPRD7S3CLINIC", "zzprd7s3");
  const A = await addClinician(clinic1, "zzprd7s3", "a"); // author
  const B = await addClinician(clinic1, "zzprd7s3", "b"); // colleague, will match domain
  const C = await addClinician(clinic1, "zzprd7s3", "c"); // colleague, will NOT match domain

  console.log("Building clinic 2 (the cross-clinic negative control)...");
  const clinic2 = await buildClinic("ZZPRD7S3OTHER", "zzprd7s3other");
  const D = await addClinician(clinic2, "zzprd7s3other", "d"); // entirely unrelated

  console.log("Onboarding the client and granting A/B/C real caseload access...");
  const { data: passportId, error: onboardErr } = await clinic1.director.client.rpc("onboard_clinic_client", {
    p_institution_id: clinic1.institutionId,
    p_client_name: "ZZ S3 MDT Client",
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

  console.log("A creates a WISC-V assessment (real chained insert+select, 0234's own pattern) and an FBA...");
  const { data: wiscV } = await admin.from("assessment_instruments").select("id").eq("name", "WISC-V").single();
  const { data: assessment, error: assessErr } = await A.session.client
    .from("assessments")
    .insert({ passport_id: passportId, clinician_id: A.userId, instrument_id: wiscV.id })
    .select("id, domain_tags")
    .single();
  if (assessErr) throw new Error(`assessment insert: ${assessErr.message}`);

  const { data: fba, error: fbaErr } = await A.session.client
    .from("fba_reports")
    .insert({ passport_id: passportId, clinician_id: A.userId })
    .select("id, domain_tags")
    .single();
  if (fbaErr) throw new Error(`fba insert: ${fbaErr.message}`);

  const BUCKET = "clinical-attachments";
  const TINY_PDF = Buffer.from("%PDF-1.1\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\ntrailer<</Root 1 0 R>>", "utf-8");
  const storagePath = `assessment/${assessment.id}/${crypto.randomUUID()}-report.pdf`;
  await A.session.client.storage.from(BUCKET).upload(storagePath, TINY_PDF, { contentType: "application/pdf" });
  await A.session.client.from("attachments").insert({
    artefact_type: "assessment",
    artefact_id: assessment.id,
    storage_path: storagePath,
    original_filename: "report.pdf",
    content_type: "application/pdf",
    size_bytes: TINY_PDF.length,
    uploaded_by: A.userId,
  });

  console.log(`\nFixture built.`);
  console.log(`Clinic 1: ${clinic1.institutionId} | Clinic 2: ${clinic2.institutionId}`);
  console.log(`Client: ${passportId}`);
  console.log(`Assessment: ${assessment.id} | seeded domain_tags: ${JSON.stringify(assessment.domain_tags)}`);
  console.log(`FBA: ${fba.id} | seeded domain_tags: ${JSON.stringify(fba.domain_tags)}`);

  // =====================================================================
  // PART A -- day one. Nobody has declared anything yet (all three
  // clinicians' own clinicians.domain_tags are '{}', the real default).
  // The artefacts themselves carry real seeded defaults (WISC-V ->
  // cognition, FBA -> behaviour_analysis) -- so this specifically
  // proves the COLLEAGUE-untagged half of the fallback, the actual
  // day-one scenario every organisation-verified practitioner is in.
  // =====================================================================
  console.log("\nPART A -- day one: B and C are colleagues on the same case, neither has declared domain tags yet.");

  const { data: assessByB_partA } = await B.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("B (untagged colleague, live access) reads A's tagged assessment via the fallback", (assessByB_partA ?? []).length === 1, assessByB_partA);

  const { data: fbaByC_partA } = await C.session.client.from("fba_reports").select("id").eq("id", fba.id);
  ok("C (untagged colleague, live access) reads A's tagged FBA via the fallback", (fbaByC_partA ?? []).length === 1, fbaByC_partA);

  // =====================================================================
  // PART B -- the cross-clinic negative control, run BEFORE anyone
  // declares anything, and again AFTER D declares a matching domain
  // (below) -- the guarantee has to hold in both states, since it's
  // never supposed to depend on domain tags at all.
  // =====================================================================
  console.log("\nPART B -- cross-clinic negative control, before any declaration.");

  const { data: assessByD_before } = await D.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("D (different clinic entirely, zero clinician_access) is refused the assessment, untagged state", (assessByD_before ?? []).length === 0, assessByD_before);

  // =====================================================================
  // PART C -- real declarations. B declares matching (cognition, the
  // assessment's own seeded domain); C declares genuinely non-matching
  // (adaptive_living); D (cross-clinic) declares an EXACT match
  // (cognition) -- deliberately, to prove overlap alone is never
  // sufficient without underlying reach.
  // =====================================================================
  console.log("\nPART C -- real declarations via the self-declaration screen's own write path.");

  const { error: bTagErr } = await B.session.client.from("clinicians").update({ domain_tags: ["cognition"] }).eq("user_id", B.userId);
  ok("B declares matching domain tags (direct client write, scoped grant)", !bTagErr, bTagErr?.message);

  const { error: cTagErr } = await C.session.client.from("clinicians").update({ domain_tags: ["adaptive_living"] }).eq("user_id", C.userId);
  ok("C declares non-matching domain tags", !cTagErr, cTagErr?.message);

  const { error: dTagErr } = await D.session.client.from("clinicians").update({ domain_tags: ["cognition"] }).eq("user_id", D.userId);
  ok("D declares a domain tag that WOULD match, for the negative control below", !dTagErr, dTagErr?.message);

  // =====================================================================
  // PART D -- the real gate, now that both sides carry real tags. This
  // is what actually distinguishes the domain match from the fallback:
  // B (matching) still succeeds; C (genuinely tagged, genuinely
  // non-overlapping) is now REFUSED -- proving the gate does something,
  // not just that it never blocks anyone.
  // =====================================================================
  console.log("\nPART D -- the real gate: matching succeeds, non-matching is refused.");

  const { data: assessByB_partD } = await B.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("B (now tagged cognition, matching) still reads A's assessment -- via the real domain match this time", (assessByB_partD ?? []).length === 1, assessByB_partD);

  const { data: assessByC_partD } = await C.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("*** THE REAL GATE *** C (tagged adaptive_living, genuinely non-matching) is now REFUSED the assessment", (assessByC_partD ?? []).length === 0, assessByC_partD);

  const { data: fbaByC_partD } = await C.session.client.from("fba_reports").select("id").eq("id", fba.id);
  ok("*** THE REAL GATE, fba_reports too *** C is refused the FBA (behaviour_analysis, non-matching)", (fbaByC_partD ?? []).length === 0, fbaByC_partD);

  const { data: fbaByB_partD } = await B.session.client.from("fba_reports").select("id").eq("id", fba.id);
  ok("B (cognition) is refused the FBA (behaviour_analysis) -- correctly domain-specific, not a blanket colleague pass", (fbaByB_partD ?? []).length === 0, fbaByB_partD);

  // =====================================================================
  // PART E -- THE GUARANTEE. D now carries a domain tag that would
  // match (cognition), and is a real, verified, currently-standing
  // clinician -- everything except an actual relationship to this
  // child. Still refused. A domain tag can never grant access to a
  // child someone cannot already reach.
  // =====================================================================
  console.log("\nPART E -- the guarantee: D's matching domain tag still grants nothing without underlying reach.");

  const { data: assessByD_after } = await D.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("*** THE GUARANTEE *** D (matching domain, zero clinician_access) is STILL refused the assessment", (assessByD_after ?? []).length === 0, assessByD_after);

  const { data: fbaByD_after } = await D.session.client.from("fba_reports").select("id").eq("id", fba.id);
  ok("*** THE GUARANTEE *** D is STILL refused the FBA too", (fbaByD_after ?? []).length === 0, fbaByD_after);

  // =====================================================================
  // PART F -- the author's own read is unconditional throughout, and
  // the director's read is unconditional and domain-blind.
  // =====================================================================
  console.log("\nPART F -- author and director reads, unaffected by any of the above.");

  const { data: assessByA } = await A.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("A (the author) still reads her own assessment regardless of anyone's domain tags", (assessByA ?? []).length === 1, assessByA);

  const { data: assessByDirector } = await clinic1.director.client.from("assessments").select("id").eq("id", assessment.id);
  ok("The director reads the assessment unconditionally, domain-blind", (assessByDirector ?? []).length === 1, assessByDirector);

  const { data: fbaByDirector } = await clinic1.director.client.from("fba_reports").select("id").eq("id", fba.id);
  ok(
    "The director does NOT read the FBA (fba_reports has no director branch -- 0233 found it didn't need one, and this migration didn't add one by analogy)",
    (fbaByDirector ?? []).length === 0,
    fbaByDirector
  );

  // =====================================================================
  // PART G -- the attachments bridge, deliberately left untouched. B
  // (a genuine domain-matched colleague who can read the assessment's
  // own interpretation/scores) is still refused the attached file --
  // the known, flagged asymmetry, proven directly rather than assumed.
  // =====================================================================
  console.log("\nPART G -- the attachments bridge was NOT extended to domain-matched colleagues.");

  const { data: attByB } = await B.session.client.from("attachments").select("id").eq("artefact_id", assessment.id);
  ok("B (domain-matched colleague, reads the assessment row) is still refused the attachment row itself", (attByB ?? []).length === 0, attByB);

  const { data: signByB, error: signByBErr } = await B.session.client.storage.from(BUCKET).createSignedUrl(storagePath, 300);
  ok("...and cannot even generate a signed URL for the file", !!signByBErr || !signByB?.signedUrl, { err: signByBErr?.message, gotUrl: !!signByB?.signedUrl });

  // =====================================================================
  // PART H -- discharge interaction. A (the author) is discharged from
  // this specific child; A's own read should now be refused (0233's
  // rule, a quick regression check), while B's colleague-branch read
  // (which only ever depended on B's OWN live access, never A's) stays
  // completely unaffected.
  // =====================================================================
  console.log("\nPART H -- discharging the author; the colleague branch is independent of the author's own standing.");

  // clinician_access has had no client-facing UPDATE policy at all since
  // 0123 -- a raw .update() here would silently touch zero rows and
  // report no error, the exact "RLS on UPDATE silently filters" trap.
  // The real production path is revoke_clinician_access(), which the
  // director calls as the granting institution's own principal.
  const { data: caRow } = await admin
    .from("clinician_access")
    .select("id")
    .eq("passport_id", passportId)
    .eq("clinician_id", A.userId)
    .single();
  const { error: revokeErr } = await clinic1.director.client.rpc("revoke_clinician_access", {
    p_clinician_access_id: caRow.id,
    p_reason: "ZZ test discharge",
  });
  ok("Director revokes A's own clinician_access to this child via revoke_clinician_access()", !revokeErr, revokeErr?.message);

  const { data: caAfter } = await admin.from("clinician_access").select("is_active").eq("id", caRow.id).single();
  ok("...confirmed via service-role read: A's own access to this child is genuinely inactive now", caAfter?.is_active === false, caAfter);

  const { data: assessByA_after } = await A.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("A (discharged) can no longer read her own assessment -- 0233's rule, still holding", (assessByA_after ?? []).length === 0, assessByA_after);

  const { data: assessByB_afterDischarge } = await B.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok(
    "B's own colleague-branch read is completely unaffected by A's discharge -- it never depended on A's standing",
    (assessByB_afterDischarge ?? []).length === 1,
    assessByB_afterDischarge
  );

  const { data: assessByDirector_afterDischarge } = await clinic1.director.client.from("assessments").select("id").eq("id", assessment.id);
  ok("The director still reads it too, permanently, unaffected", (assessByDirector_afterDischarge ?? []).length === 1, assessByDirector_afterDischarge);

  // =====================================================================
  // PART I -- the raw helper predicate, direct unit-level proof that
  // an explicitly empty-both-sides state falls all the way through
  // (no real artefact can ever actually reach this today, since every
  // seeded instrument now has a real default -- but the helper's own
  // logic should still handle it correctly if a future artefact type
  // is ever seeded with no default at all).
  // =====================================================================
  console.log("\nPART I -- the raw helper, both sides forced empty (a state no real seeded artefact reaches today).");

  await admin.from("assessments").update({ domain_tags: [] }).eq("id", assessment.id);
  await admin.from("clinicians").update({ domain_tags: [] }).eq("user_id", B.userId);

  const { data: assessByB_bothEmpty } = await B.session.client.from("assessments").select("id").eq("id", assessment.id);
  ok("Both artefact and colleague forced empty -- falls through to reachability alone, still succeeds", (assessByB_bothEmpty ?? []).length === 1, assessByB_bothEmpty);

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log(`clinic1: ${clinic1.institutionId} | clinic2: ${clinic2.institutionId}`);
  console.log(`passport: ${passportId} | assessment: ${assessment.id} | fba: ${fba.id}`);
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
