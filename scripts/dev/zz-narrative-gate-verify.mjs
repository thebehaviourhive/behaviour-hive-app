/* Migration 0254 verification -- narrative blocks sign-off, category
   warns only. Real signed-in session, service-role for fixture setup. */
import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

const PASSWORD = "ZzNarrGate-2026!";
let pass = 0, fail = 0;
function ok(label, cond, detail) {
  if (cond) { pass++; console.log(`  PASS: ${label}`); }
  else { fail++; console.log(`  FAIL: ${label}${detail ? " -- " + JSON.stringify(detail) : ""}`); }
}

async function main() {
  const { data: inst } = await admin.from("institutions").insert({ name: "ZZ Narrative Gate School", institution_code: "ZZNARRGATE", status: "verified", type: "school" }).select("id").single();
  const { data: userRes } = await admin.auth.admin.createUser({ email: "zznarrgate.teacher@thebehaviourhive.com", password: PASSWORD, email_confirm: true });
  const teacherId = userRes.user.id;
  await admin.auth.admin.updateUserById(teacherId, { app_metadata: { role: "class_teacher" } });
  await admin.from("institution_staff").insert({ institution_id: inst.id, user_id: teacherId, role: "class_teacher", approved_at: new Date().toISOString(), approval_source: "bootstrap" });

  const { data: principalRes } = await admin.auth.admin.createUser({ email: "zznarrgate.principal@thebehaviourhive.com", password: PASSWORD, email_confirm: true });
  const principalId = principalRes.user.id;
  await admin.auth.admin.updateUserById(principalId, { app_metadata: { role: "principal" } });
  await admin.from("institution_staff").insert({ institution_id: inst.id, user_id: principalId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" });

  const client = createClient(url, anonKey);
  const { error: signInErr } = await client.auth.signInWithPassword({ email: "zznarrgate.teacher@thebehaviourhive.com", password: PASSWORD });
  if (signInErr) throw new Error(signInErr.message);

  const principalClient = createClient(url, anonKey);
  const { error: pSignInErr } = await principalClient.auth.signInWithPassword({ email: "zznarrgate.principal@thebehaviourhive.com", password: PASSWORD });
  if (pSignInErr) throw new Error(pSignInErr.message);

  const { data: passportId, error: passportErr } = await principalClient.rpc("create_school_passport", {
    p_institution_id: inst.id, p_child_name: "ZZ Narrative Gate Child",
  });
  if (passportErr) throw new Error(`create_school_passport: ${passportErr.message}`);
  await admin.from("passport_access").insert({ passport_id: passportId, teacher_id: teacherId, institution_id: inst.id, is_active: true, actor_role: "class_teacher", granted_by: teacherId });

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  async function newIncident() {
    const { data: id, error } = await client.rpc("create_incident_stamp", {
      p_institution_id: inst.id, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
      p_child_passport_ids: [passportId], p_staff: [{ user_id: teacherId }],
      p_client_opened_at: new Date(Date.now() - 20000).toISOString(), p_client_first_input_at: new Date(Date.now() - 15000).toISOString(),
    });
    if (error) throw new Error(`create_incident_stamp: ${error.message}`);
    return id;
  }

  // Test 1: empty narrative, no category -- summary reports category as
  // non-blocking note, narrative as a real blocking issue, can_sign_off false.
  const inc1 = await newIncident();
  {
    const { data: summary, error } = await client.rpc("get_incident_signoff_summary", { p_incident_id: inc1 });
    ok("summary loads with no error", !error, error?.message);
    ok("can_sign_off is false with empty narrative", summary?.can_sign_off === false, summary);
    ok("blocking_issues contains narrative_required", (summary?.blocking_issues ?? []).some((i) => i.code === "narrative_required"), summary?.blocking_issues);
    ok("category.note is 'not recorded' (non-blocking)", summary?.category?.note === "not recorded", summary?.category);

    const { error: signErr } = await client.rpc("sign_off_incident", { p_incident_id: inc1 });
    ok("sign_off_incident() is REFUSED with an empty narrative", !!signErr && /narrative/i.test(signErr.message), signErr?.message);

    const { data: row } = await admin.from("incidents").select("teacher_signed_at").eq("id", inc1).single();
    ok("teacher_signed_at is still null after the refused attempt", row.teacher_signed_at === null, row);
  }

  // Test 2: whitespace-only narrative is treated the same as empty.
  {
    await admin.from("incidents").update({ narrative: "   " }).eq("id", inc1);
    const { error: signErr } = await client.rpc("sign_off_incident", { p_incident_id: inc1 });
    ok("whitespace-only narrative is ALSO refused (trim() check)", !!signErr && /narrative/i.test(signErr.message), signErr?.message);
  }

  // Test 3: real narrative, still no category -- sign-off succeeds
  // (category never blocks), and category's own note still shows in the
  // summary right up until sign-off (checked pre-signoff, since the
  // summary RPC refuses once teacher_signed_at is set).
  {
    await admin.from("incidents").update({ narrative: "A real account of what happened." }).eq("id", inc1);
    const { data: preSummary } = await client.rpc("get_incident_signoff_summary", { p_incident_id: inc1 });
    ok("pre-signoff, narrative now real: category still 'not recorded', narrative issue now gone", preSummary?.category?.note === "not recorded" && !(preSummary?.blocking_issues ?? []).some((i) => i.code === "narrative_required"), preSummary);

    const { error: signErr } = await client.rpc("sign_off_incident", { p_incident_id: inc1 });
    ok("sign_off_incident() SUCCEEDS with a real narrative, even with no category", !signErr, signErr?.message);

    const { data: row } = await admin.from("incidents").select("teacher_signed_at, category, narrative").eq("id", inc1).single();
    ok("teacher_signed_at is now set", row.teacher_signed_at !== null, row);
    ok("category is still genuinely null (never required)", row.category === null, row);
  }

  // Test 4: existing blocking gates (debrief) still work -- the new
  // check is additive, not a replacement.
  const inc2 = await newIncident();
  {
    await admin.from("incidents").update({ narrative: "Has a narrative.", debrief_required: true }).eq("id", inc2);
    const { error: signErr } = await client.rpc("sign_off_incident", { p_incident_id: inc2 });
    ok("debrief gate still blocks sign-off independently of narrative", !!signErr && /debrief/i.test(signErr.message), signErr?.message);
  }

  console.log(`\n${pass} passed, ${fail} failed.`);
  console.log(JSON.stringify({ institutionId: inst.id, teacherId, principalId, passportId, inc1, inc2 }, null, 2));
  if (fail > 0) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exitCode = 1; });
