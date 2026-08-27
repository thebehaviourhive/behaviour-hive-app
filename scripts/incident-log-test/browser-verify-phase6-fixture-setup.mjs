// Disposable browser-verification fixture for Phase 6 (PDF export).
// NOT ZZFIXTURE_THUMBTEST -- torn down same session, confirmed gone by
// direct query.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Phase6BrowserVerify-2026!";
const CODE = "P6BROWSER" + Math.floor(Math.random() * 10000);

async function signedInClient(email) {
  const c = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await c.auth.signInWithPassword({ email, password: PASSWORD });
  if (error) throw new Error(`sign-in failed for ${email}: ${error.message}`);
  return c;
}

async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: fullName }, app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

async function main() {
  const { data: inst } = await admin
    .from("institutions")
    .insert({ name: "Phase 6 Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  const institutionId = inst.id;

  const teacherId = await createUser("p6browser.teacher@thebehaviourhive.com", "P6 Teacher", "class_teacher");
  const principalId = await createUser("p6browser.principal@thebehaviourhive.com", "P6 Principal", "principal");
  const snaId = await createUser("p6browser.sna@thebehaviourhive.com", "P6 SNA", "sna");
  const parentId = await createUser("p6browser.parent@thebehaviourhive.com", "P6 Parent", "parent");

  await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: teacherId, role: "class_teacher" },
    { institution_id: institutionId, user_id: principalId, role: "principal" },
    { institution_id: institutionId, user_id: snaId, role: "sna" },
  ]);

  const { data: child } = await admin.from("passports").insert({ user_id: parentId, child_name: "P6 Browser Child", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert({ passport_id: child.id, institution_id: institutionId, approved_by_parent: true });

  const teacher = await signedInClient("p6browser.teacher@thebehaviourhive.com");
  const principal = await signedInClient("p6browser.principal@thebehaviourhive.com");

  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();
  const { data: bruisingType } = await admin.from("incident_injury_types").select("id").eq("value", "Bruising").is("institution_id", null).single();
  const { data: forearmRegion } = await admin.from("incident_body_regions").select("id").eq("value", "lower_arm").is("institution_id", null).single();
  const { data: restraintAction } = await admin.from("incident_action_types").select("id").eq("value", "Physical restraint (CPI)").is("institution_id", null).single();

  const { data: incidentId } = await teacher.rpc("create_incident_stamp", {
    p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
    p_child_passport_ids: [child.id], p_staff: [{ user_id: snaId, involvement: "witnessed" }],
  });

  await teacher.from("incidents").update({
    category: "behaviour_leading_to_injury",
    party: ["peer"],
    narrative: "During transition, the child became distressed and a peer interaction led to an injury requiring first aid. Staff intervened using de-escalation and, briefly, physical guidance.",
    parent_summary: "Your child was involved in a difficult moment during transition today and received first aid for a minor bruise. Staff supported them to settle afterwards.",
    staff_count_needed: "2",
    staff_distressed: "slightly",
    risk_reduction_future: "Stagger transition times for this group.",
    anyone_injured: true,
    debrief_required: true,
  }).eq("id", incidentId);

  await teacher.from("incident_actions").insert({ incident_id: incidentId, action_type_id: restraintAction.id });
  await teacher.from("restrictive_practices").insert({ incident_id: incidentId, passport_id: child.id, planning_status: "in_bsp", hold_type: "childrens", hold_position: "standing", hold_level: "low", staff_initials: "AB" });

  const { data: injuryRow } = await teacher
    .from("incident_injuries")
    .insert({ incident_id: incidentId, injured_party_type: "student", passport_id: child.id, injury_types: ["Bruising"], first_aider_called: true, first_aider_name: "Jane First-Aid", remained_on_site: true })
    .select()
    .single();
  await teacher.from("incident_body_marks").insert({ injury_id: injuryRow.id, view: "front", x: 0.25, y: 0.55, injury_type_id: bruisingType.id, region_id: forearmRegion.id, side: "left" });

  await teacher.from("incident_debriefs").insert({
    incident_id: incidentId,
    debrief_date: new Date().toISOString().slice(0, 10),
    staff_present: ["P6 Teacher", "P6 SNA"],
    notes: "Discussed the transition timing and agreed a review.",
    actions_for_management: "Trial staggered transitions next week.",
    completed_by: teacherId,
    completed_at: new Date().toISOString(),
  });

  const { data: snaStaffRow } = await admin.from("incident_staff").select("id").eq("incident_id", incidentId).eq("user_id", snaId).single();
  const sna = await signedInClient("p6browser.sna@thebehaviourhive.com");
  await sna.rpc("attest_to_incident", { p_incident_staff_id: snaStaffRow.id, p_addendum: "Confirmed, I witnessed this." });

  await teacher.rpc("sign_off_incident", { p_incident_id: incidentId });
  await principal.rpc("countersign_incident", { p_incident_id: incidentId });

  console.log(JSON.stringify(
    {
      institutionId,
      incidentId,
      teacherEmail: "p6browser.teacher@thebehaviourhive.com",
      principalEmail: "p6browser.principal@thebehaviourhive.com",
      password: PASSWORD,
      printUrl: `/teacher/incidents/${incidentId}/print`,
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
