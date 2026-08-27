// Disposable fixture for the Phase 6 routing fix. NOT ZZFIXTURE_THUMBTEST.
import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Phase6RoutingVerify-2026!";
const CODE = "P6ROUTE" + Math.floor(Math.random() * 10000);

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
  const { data: inst } = await admin.from("institutions").insert({ name: "P6 Routing Verify School", institution_code: CODE, status: "verified" }).select().single();
  const institutionId = inst.id;
  const teacherId = await createUser("p6routing.teacher@thebehaviourhive.com", "P6R Teacher", "class_teacher");
  const principalId = await createUser("p6routing.principal@thebehaviourhive.com", "P6R Principal", "principal");
  const parentId = await createUser("p6routing.parent@thebehaviourhive.com", "P6R Parent", "parent");
  await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: teacherId, role: "class_teacher" },
    { institution_id: institutionId, user_id: principalId, role: "principal" },
  ]);
  const { data: child } = await admin.from("passports").insert({ user_id: parentId, child_name: "P6R Child", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert({ passport_id: child.id, institution_id: institutionId, approved_by_parent: true });

  const teacher = await signedInClient("p6routing.teacher@thebehaviourhive.com");
  await signedInClient("p6routing.principal@thebehaviourhive.com");
  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();

  const { data: incidentId } = await teacher.rpc("create_incident_stamp", {
    p_institution_id: institutionId, p_occurred_at: new Date().toISOString(), p_location_id: loc.id,
    p_child_passport_ids: [child.id], p_staff: [],
  });
  await teacher.from("incidents").update({ category: "one_party_incident", narrative: "Routing check.", parent_summary: "Routing check parent." }).eq("id", incidentId);
  await teacher.rpc("sign_off_incident", { p_incident_id: incidentId });

  console.log(JSON.stringify({ institutionId, incidentId, teacherEmail: "p6routing.teacher@thebehaviourhive.com", principalEmail: "p6routing.principal@thebehaviourhive.com", password: PASSWORD }, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
