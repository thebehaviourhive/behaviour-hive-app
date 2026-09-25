import fs from "fs";
const raw = fs.readFileSync(".env.local", "utf8");
for (const line of raw.split("\n")) {
  const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
  if (!m) continue;
  let val = m[2];
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
  process.env[m[1]] = val;
}
const { createClient } = await import("@supabase/supabase-js");
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const f = JSON.parse(fs.readFileSync("/tmp/zz-0303-fixture.json", "utf8"));
const {
  managerEmail, careAEmail, careBEmail, outsiderCareEmail, principalEmail, teacherEmail, parentEmail,
  password, passportId,
  directorId, clinicianId, managerId, careAId, careBId, principalId, teacherId, parentId,
} = f;

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} -- ${name}${detail ? " -- " + JSON.stringify(detail) : ""}`);
}

function idsOf(rows) {
  return (rows ?? []).map((r) => r.recipient_id);
}

const careA = await signIn(careAEmail);
const outsiderCare = await signIn(outsiderCareEmail);
const teacher = await signIn(teacherEmail);
const principal = await signIn(principalEmail);
const clinician = await signIn(f.clinicianEmail);
const parent = await signIn(parentEmail);

const { data: handoverCat } = await careA.from("message_categories").select("id").eq("label", "Handover").single();
const handoverCategoryId = handoverCat?.id;
const { data: scheduleCat } = await teacher.from("message_categories").select("id").eq("label", "Schedule change").single();
const scheduleCategoryId = scheduleCat?.id;

// =====================================================================
// 1. THE CONFIRMED LIVE BUG -- a respite care_staff's own candidate
// list must no longer contain the unrelated clinic's director, and
// must still contain their own centre's colleagues.
// =====================================================================
const { data: candidatesForCareA } = await careA.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
const careACandidateIds = idsOf(candidatesForCareA);

check("care_staff's candidates do NOT include the unrelated clinic's director", !careACandidateIds.includes(directorId), { careACandidateIds });
check("care_staff's candidates do NOT include the unrelated school's principal", !careACandidateIds.includes(principalId), { careACandidateIds });
check("care_staff's candidates do NOT include the unrelated school's teacher", !careACandidateIds.includes(teacherId), { careACandidateIds });
check("care_staff's candidates DO include their own centre's manager", careACandidateIds.includes(managerId), { careACandidateIds });
check("care_staff's candidates DO include their own centre's colleague (care_staff B)", careACandidateIds.includes(careBId), { careACandidateIds });
check("care_staff's candidates DO include the engaged clinician (relationship-based, cross-institution by design)", careACandidateIds.includes(clinicianId), { careACandidateIds });
check("care_staff's candidates DO include the parent (ownership-based, cross-institution by design)", careACandidateIds.includes(parentId), { careACandidateIds });

// The write path: a raw send_message() call naming the clinic director
// directly, bypassing whatever the UI picker would ever have shown --
// this is the actual security boundary, not just the display list.
const { error: leakSendErr } = await careA.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: handoverCategoryId,
  p_body: "This should never reach the clinic director.",
  p_response_required: false,
  p_recipient_ids: [directorId],
});
check("send_message() itself REFUSES a raw attempt naming the unrelated clinic director", !!leakSendErr, { leakSendErr: leakSendErr?.message });

const { count: leakedRecipientCount } = await admin
  .from("message_recipients")
  .select("id", { count: "exact", head: true })
  .eq("recipient_id", directorId);
check("no message_recipients row was ever created for the clinic director from this passport", (leakedRecipientCount ?? 0) === 0, { leakedRecipientCount });

// Regression: a legitimate same-institution send still works.
const { data: legitMessageId, error: legitSendErr } = await careA.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: handoverCategoryId,
  p_body: "A real handover, same centre.",
  p_response_required: false,
  p_recipient_ids: [careBId],
});
check("care_staff can still send a legitimate handover to their own centre colleague", !legitSendErr && Boolean(legitMessageId), { legitSendErr: legitSendErr?.message });

// =====================================================================
// 2. THE GENERALISED SHAPE -- the SAME leak, from the school side.
// =====================================================================
const { data: candidatesForTeacher } = await teacher.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
const teacherCandidateIds = idsOf(candidatesForTeacher);

check("class_teacher's candidates do NOT include the unrelated clinic's director", !teacherCandidateIds.includes(directorId), { teacherCandidateIds });
check("class_teacher's candidates do NOT include the unrelated centre's manager", !teacherCandidateIds.includes(managerId), { teacherCandidateIds });
check("class_teacher's candidates do NOT include the unrelated centre's care_staff", !teacherCandidateIds.includes(careAId), { teacherCandidateIds });
check("class_teacher's candidates DO include their own school's principal", teacherCandidateIds.includes(principalId), { teacherCandidateIds });
check("class_teacher's candidates DO include the engaged clinician (cross-institution by design)", teacherCandidateIds.includes(clinicianId), { teacherCandidateIds });
check("class_teacher's candidates DO include the parent (cross-institution by design)", teacherCandidateIds.includes(parentId), { teacherCandidateIds });

const { error: teacherLeakSendErr } = await teacher.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: scheduleCategoryId,
  p_body: "This should never reach the respite centre manager.",
  p_response_required: false,
  p_recipient_ids: [managerId],
});
check("send_message() refuses a class_teacher's raw attempt naming the unrelated centre manager", !!teacherLeakSendErr, { teacherLeakSendErr: teacherLeakSendErr?.message });

const { data: teacherLegitMessageId, error: teacherLegitSendErr } = await teacher.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: scheduleCategoryId,
  p_body: "A real schedule note, own school, own principal.",
  p_response_required: false,
  p_recipient_ids: [principalId],
});
check("class_teacher can still send to their own school's principal (legitimate, same-institution)", !teacherLegitSendErr && Boolean(teacherLegitMessageId), { teacherLegitSendErr: teacherLegitSendErr?.message });

// =====================================================================
// 3. THE INSTITUTION-MEMBERSHIP PRINCIPAL ARM, BOTH SIDES -- the
// clinic director (also institution-membership-based, via the
// "principal" route) must likewise be scoped to their own institution
// only, confirming the fix isn't accidentally one-directional.
// =====================================================================
const director = await signIn(f.directorEmail);
const { data: candidatesForDirector } = await director.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
const directorCandidateIds = idsOf(candidatesForDirector);
check("the clinic director's candidates do NOT include the respite centre's manager", !directorCandidateIds.includes(managerId), { directorCandidateIds });
check("the clinic director's candidates do NOT include the school's principal", !directorCandidateIds.includes(principalId), { directorCandidateIds });
check("the clinic director's candidates DO include their own clinic's clinician", directorCandidateIds.includes(clinicianId), { directorCandidateIds });

// =====================================================================
// 4. POSITIVE CONTROLS -- the two deliberately cross-institution routes
// (parent, clinician) must see EVERYONE genuinely linked to the child,
// unrestricted by institution, exactly as before this fix.
// =====================================================================
const { data: candidatesForClinician } = await clinician.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
const clinicianCandidateIds = idsOf(candidatesForClinician);
check("the engaged clinician's candidates DO include the respite manager (cross-institution reach preserved)", clinicianCandidateIds.includes(managerId), { clinicianCandidateIds });
check("the engaged clinician's candidates DO include the school principal (cross-institution reach preserved)", clinicianCandidateIds.includes(principalId), { clinicianCandidateIds });
check("the engaged clinician's candidates DO include the parent", clinicianCandidateIds.includes(parentId), { clinicianCandidateIds });

const { data: candidatesForParent } = await parent.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
const parentCandidateIds = idsOf(candidatesForParent);
check("the parent's candidates DO include the respite manager (cross-institution reach preserved)", parentCandidateIds.includes(managerId), { parentCandidateIds });
check("the parent's candidates DO include the school principal (cross-institution reach preserved)", parentCandidateIds.includes(principalId), { parentCandidateIds });
check("the parent's candidates DO include the clinic director (cross-institution reach preserved)", parentCandidateIds.includes(directorId), { parentCandidateIds });

// =====================================================================
// 5. UNCHANGED, RE-CONFIRMED -- a wholly unrelated outsider (never
// linked to this passport by any institution) still sees and can send
// nothing at all. Not the bug this migration fixes, but a regression
// control worth having in the same run.
// =====================================================================
const { data: candidatesForOutsider } = await outsiderCare.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
check("an outsider (unrelated institution entirely) has no candidates at all", (candidatesForOutsider ?? []).length === 0, { candidatesForOutsider });

const { error: outsiderSendErr } = await outsiderCare.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: handoverCategoryId,
  p_body: "Should never send.",
  p_response_required: false,
  p_recipient_ids: [careAId],
});
check("an outsider still cannot send anything at all about this child", !!outsiderSendErr, { outsiderSendErr: outsiderSendErr?.message });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}
