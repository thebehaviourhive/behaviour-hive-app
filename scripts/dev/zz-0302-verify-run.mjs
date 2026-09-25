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

const f = JSON.parse(fs.readFileSync("/tmp/zz-0302-fixture.json", "utf8"));
const { password, centreId, managerEmail, careAEmail, careBEmail, outsiderCareEmail, passportId, currentStayId } = f;

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

const manager = await signIn(managerEmail);
const careA = await signIn(careAEmail);
const careB = await signIn(careBEmail);
const outsiderCare = await signIn(outsiderCareEmail);

// =====================================================================
// 1. HANDOVER -- care_staff A writes, care_staff B acknowledges.
// =====================================================================
const { data: candidatesForA } = await careA.rpc("get_message_recipient_candidates", { p_passport_id: passportId });
check("care_staff A's candidate list includes care_staff B", (candidatesForA ?? []).some((c) => c.role === "care_staff"), { candidatesForA });

const { data: categories } = await careA.from("message_categories").select("id, label").eq("label", "Handover");
const handoverCategoryId = categories?.[0]?.id;
check("the Handover category exists and is readable", Boolean(handoverCategoryId), { categories });

const careBUserId = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === careBEmail).id;

const { data: messageId, error: sendErr } = await careA.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: handoverCategoryId,
  p_body: "Settled after dinner. Watch for sensitivity to loud noises overnight.",
  p_response_required: false,
  p_recipient_ids: [careBUserId],
});
check("care_staff A sends a real handover message", !sendErr && Boolean(messageId), { sendErr: sendErr?.message });

const { data: sentRow } = await admin.from("messages").select("sender_role, status").eq("id", messageId).single();
check("the message was recorded with sender_role 'care_staff'", sentRow?.sender_role === "care_staff", { sentRow });

// The outsider (a real care_staff, but at a wholly unrelated centre)
// cannot even send -- no activation, no institution relationship.
const { error: outsiderSendErr } = await outsiderCare.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: handoverCategoryId,
  p_body: "Should never land.",
  p_response_required: false,
  p_recipient_ids: [careBUserId],
});
check("an outsider care_staff (unrelated centre) cannot send a handover", !!outsiderSendErr, { outsiderSendErr: outsiderSendErr?.message });

// care_staff B reads it (raw table, can_view_message()-gated) and
// acknowledges -- the record of who knew what.
const { data: readByB, error: readByBErr } = await careB.from("messages").select("id").eq("id", messageId).maybeSingle();
check("care_staff B reads the handover (can_view_message())", !readByBErr && readByB?.id === messageId, { readByBErr: readByBErr?.message });

const { data: readByOutsider } = await outsiderCare.from("messages").select("id").eq("id", messageId).maybeSingle();
check("the outsider cannot read the handover", readByOutsider === null);

const { error: ackErr } = await careB.rpc("acknowledge_message", { p_message_id: messageId });
check("care_staff B acknowledges the handover", !ackErr, { ackErr: ackErr?.message });

const { data: recipientRow } = await admin
  .from("message_recipients")
  .select("acknowledged_at, recipient_role")
  .eq("message_id", messageId)
  .eq("recipient_id", careBUserId)
  .single();
check("acknowledged_at is set, recipient_role is 'care_staff' -- the record of who knew what", Boolean(recipientRow?.acknowledged_at) && recipientRow?.recipient_role === "care_staff", { recipientRow });

const { data: statusRow } = await admin.from("messages").select("status").eq("id", messageId).single();
check("the message status transitioned to 'acknowledged'", statusRow?.status === "acknowledged", { statusRow });

// =====================================================================
// 2. THE ON-CALL INDICATOR.
// =====================================================================
const until = new Date(Date.now() + 8 * 60 * 60 * 1000);
const { error: setOnCallErr } = await manager.rpc("set_on_call", {
  p_institution_id: centreId, p_name: "ZZ 0302 Manager On Call", p_phone: "+353871234567", p_until: until.toISOString(),
});
check("the centre manager sets a real on-call contact", !setOnCallErr, { setOnCallErr: setOnCallErr?.message });

const { error: careOnCallErr } = await careA.rpc("set_on_call", {
  p_institution_id: centreId, p_name: "Should not work", p_phone: "000", p_until: until.toISOString(),
});
check("care_staff cannot set the on-call contact", !!careOnCallErr, { careOnCallErr: careOnCallErr?.message });

const { data: onCallForCare, error: onCallReadErr } = await careA
  .from("respite_on_call_designations")
  .select("name, phone, on_call_until")
  .eq("institution_id", centreId)
  .order("set_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check("care_staff reads the real on-call name, number, and expiry", !onCallReadErr && onCallForCare?.name === "ZZ 0302 Manager On Call" && onCallForCare?.phone === "+353871234567", { onCallForCare, onCallReadErr: onCallReadErr?.message });

// Overwrite semantics: a second designation becomes "current".
const until2 = new Date(Date.now() + 4 * 60 * 60 * 1000);
await manager.rpc("set_on_call", { p_institution_id: centreId, p_name: "ZZ 0302 Second Manager", p_phone: "+353879999999", p_until: until2.toISOString() });
const { data: latestOnCall } = await careA
  .from("respite_on_call_designations")
  .select("name")
  .eq("institution_id", centreId)
  .order("set_at", { ascending: false })
  .limit(1)
  .maybeSingle();
check("the latest designation by set_at is the one that reads as 'current'", latestOnCall?.name === "ZZ 0302 Second Manager", { latestOnCall });

const { data: onCallForOutsider } = await outsiderCare
  .from("respite_on_call_designations")
  .select("id")
  .eq("institution_id", centreId);
check("an outsider at a different centre reads none of this centre's on-call rows", (onCallForOutsider ?? []).length === 0);

// =====================================================================
// 3. CHECK-INS -- across a genuine multi-day stay.
// =====================================================================
const { data: checkinsSoFar } = await careA.from("respite_stay_checkins").select("check_in_type, check_in_date").eq("stay_id", currentStayId);
check("the backdated 'yesterday' morning + end-of-day rows are readable", (checkinsSoFar ?? []).length === 2, { checkinsSoFar });

const { data: todayMorningId, error: todayMorningErr } = await careA.rpc("record_respite_stay_checkin", {
  p_stay_id: currentStayId, p_check_in_type: "morning", p_note: "Woke calm, ate breakfast fine.",
});
check("care_staff records a real morning check-in for today", !todayMorningErr && Boolean(todayMorningId), { todayMorningErr: todayMorningErr?.message });

const { error: duplicateErr } = await careA.rpc("record_respite_stay_checkin", {
  p_stay_id: currentStayId, p_check_in_type: "morning", p_note: "Should be refused.",
});
check("a second morning check-in on the same day is refused", !!duplicateErr, { duplicateErr: duplicateErr?.message });

const { data: allCheckins } = await manager.from("respite_stay_checkins").select("check_in_type, check_in_date").eq("stay_id", currentStayId).order("checked_in_at", { ascending: true });
const distinctDays = new Set((allCheckins ?? []).map((c) => c.check_in_date));
check("the centre manager reads all 3 check-ins spanning 2 distinct days -- the multi-day span", (allCheckins ?? []).length === 3 && distinctDays.size === 2, { allCheckins });

const { data: outsiderCheckins } = await outsiderCare.from("respite_stay_checkins").select("id").eq("stay_id", currentStayId);
check("the outsider reads none of this stay's check-ins", (outsiderCheckins ?? []).length === 0);

// =====================================================================
// 4. THE FIRST-FIVE-MINUTES DATA -- get_respite_child_summary() and
// get_my_centre_active_children(), the two support RPCs.
// =====================================================================
const { data: summary, error: summaryErr } = await careA.rpc("get_respite_child_summary", { p_passport_id: passportId });
check("care_staff reads the child's real name and date of birth", !summaryErr && summary?.[0]?.date_of_birth === "2015-06-15", { summary, summaryErr: summaryErr?.message });

const { data: outsiderSummary, error: outsiderSummaryErr } = await outsiderCare.rpc("get_respite_child_summary", { p_passport_id: passportId });
check("an outsider cannot read the child's name/DOB", !!outsiderSummaryErr, { outsiderSummaryErr: outsiderSummaryErr?.message, outsiderSummary });

const { data: activeForCareA } = await careA.rpc("get_my_centre_active_children", { p_institution_id: centreId });
check("care_staff A's active-children list includes this child", (activeForCareA ?? []).some((c) => c.passport_id === passportId), { activeForCareA });

const { data: activeForManager } = await manager.rpc("get_my_centre_active_children", { p_institution_id: centreId });
check("the manager's active-children list also includes this child (placement-scoped)", (activeForManager ?? []).some((c) => c.passport_id === passportId), { activeForManager });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}
