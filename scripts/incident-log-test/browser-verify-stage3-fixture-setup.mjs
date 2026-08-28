// Disposable browser-verification fixture for PRD 1, Stage 3 (temporary
// day-scoped access) client code -- Step 3. NOT ZZFIXTURE_THUMBTEST --
// torn down same session, confirmed gone by direct query.
//
// Deliberately sets a cutoff far in the future at creation time -- the
// browser pass itself uses the real SetCutoffSheet control to move it
// close (Golden Brown state) and back, rather than baking a short-lived
// window into the fixture that could lapse before the pass starts.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Stage3BrowserVerify-2026!";
const CODE = "S3BROWSER" + Math.floor(Math.random() * 10000);

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

function dublinNowParts() {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  });
  const p = Object.fromEntries(fmt.formatToParts(new Date()).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
function addMinutesClamped(hhmmss, delta) {
  const [h, m] = hhmmss.split(":").map(Number);
  let total = h * 60 + m + delta;
  total = Math.max(7 * 60 + 31, Math.min(23 * 60 + 59, total));
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}:00`;
}

async function main() {
  const { data: inst } = await admin
    .from("institutions")
    .insert({ name: "Stage 3 Browser Verify School", institution_code: CODE, status: "verified" })
    .select()
    .single();
  const institutionId = inst.id;

  const principalId = await createUser("s3browser.principal@thebehaviourhive.com", "S3 Principal", "principal");
  const teacherId = await createUser("s3browser.teacher@thebehaviourhive.com", "S3 Teacher", "class_teacher");
  const snaId = await createUser("s3browser.sna@thebehaviourhive.com", "S3 SNA", "sna");
  // A genuinely existing account, no institution_staff row here yet --
  // the "new supply teacher, existing account" path (principal grants
  // via email lookup, Decision 3: no invite-by-email).
  const supplyId = await createUser("s3browser.supply@thebehaviourhive.com", "S3 Supply Teacher", "sna");
  const parent1Id = await createUser("s3browser.parent1@thebehaviourhive.com", "S3 Parent One", "parent");
  const parent2Id = await createUser("s3browser.parent2@thebehaviourhive.com", "S3 Parent Two", "parent");
  const parent3Id = await createUser("s3browser.parent3@thebehaviourhive.com", "S3 Parent Three", "parent");
  const parent4Id = await createUser("s3browser.parent4@thebehaviourhive.com", "S3 Parent Four", "parent");

  const { data: staffRows } = await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: principalId, role: "principal" },
    { institution_id: institutionId, user_id: teacherId, role: "class_teacher" },
    { institution_id: institutionId, user_id: snaId, role: "sna" },
  ]).select();

  const principal = await signedInClient("s3browser.principal@thebehaviourhive.com");
  for (const row of staffRows.filter((r) => r.user_id !== principalId)) {
    await principal.rpc("approve_staff_join", { p_institution_staff_id: row.id });
  }
  const teacher = await signedInClient("s3browser.teacher@thebehaviourhive.com");

  // Three children, one per SNA access source -- proves /sna/passports'
  // merge shows all three, "Covering today" distinct from the other two.
  const { data: childPassportAccess } = await admin.from("passports").insert({ user_id: parent1Id, child_name: "S3 Browser Child Passport", passport_status: "complete" }).select().single();
  const { data: childAssigned } = await admin.from("passports").insert({ user_id: parent2Id, child_name: "S3 Browser Child Assigned", passport_status: "complete" }).select().single();
  const { data: childCovered } = await admin.from("passports").insert({ user_id: parent3Id, child_name: "S3 Browser Child Covered", passport_status: "complete" }).select().single();
  await admin.from("passport_institution_links").insert([
    { passport_id: childPassportAccess.id, institution_id: institutionId, approved_by_parent: true },
    { passport_id: childAssigned.id, institution_id: institutionId, approved_by_parent: true },
    { passport_id: childCovered.id, institution_id: institutionId, approved_by_parent: true },
  ]);
  await admin.from("passport_access").insert({
    passport_id: childPassportAccess.id, teacher_id: snaId, institution_id: institutionId, is_active: true, actor_role: "sna",
  });

  const { data: classId } = await principal.rpc("create_class", { p_institution_id: institutionId, p_name: "S3 Room" });
  await principal.rpc("add_class_teacher", { p_class_id: classId, p_user_id: teacherId });
  await principal.rpc("add_class_child", { p_class_id: classId, p_passport_id: childCovered.id });
  await principal.rpc("assign_sna_to_child", { p_passport_id: childAssigned.id, p_user_id: snaId, p_institution_id: institutionId });

  // Comfortably-ahead cutoff (3 hours) -- deliberately NOT the near-term
  // value the browser pass will set live via SetCutoffSheet to check
  // the Golden Brown "finish up soon" state.
  const nowParts = dublinNowParts();
  const cutoffComfortablyAhead = addMinutesClamped(nowParts.time, 180);
  await principal.rpc("set_temporary_access_cutoff", { p_institution_id: institutionId, p_cutoff_time: cutoffComfortablyAhead });

  // A second class + child, purely for the class-teacher-side grant/
  // revoke flow -- kept separate from S3 Room so the /sna/passports
  // "Covering today" check above isn't disturbed by this grant/revoke
  // cycle happening on the same class.
  const { data: classId2 } = await principal.rpc("create_class", { p_institution_id: institutionId, p_name: "S3 Room Two" });
  await principal.rpc("add_class_teacher", { p_class_id: classId2, p_user_id: teacherId });
  const { data: childRoom2, error: childRoom2Err } = await admin.from("passports").insert({ user_id: parent4Id, child_name: "S3 Browser Child Room Two", passport_status: "complete" }).select().single();
  if (childRoom2Err) throw childRoom2Err;
  await admin.from("passport_institution_links").insert({ passport_id: childRoom2.id, institution_id: institutionId, approved_by_parent: true });
  await principal.rpc("add_class_child", { p_class_id: classId2, p_passport_id: childRoom2.id });

  // ---- The lapsed-ownership / inherited-badge scenario ----
  // supplyId gets a real, active grant for S3 Room, creates a real
  // incident while it's active, then the grant is revoked (mirrors
  // CHECK AA's own AA-7/AA-8 technique) -- leaving a real pre-signoff
  // incident owned by someone with no current standing. The principal's
  // OWN page load (dashboard, then incidents) is what should call
  // resolve_lapsed_incident_ownership() and surface the inherited badge
  // -- not baked in by this fixture.
  const { data: supplyGrantId } = await principal.rpc("grant_temporary_access", {
    p_class_id: classId,
    p_user_id: supplyId,
    p_date: nowParts.date,
    p_reason: "S3 browser verify: lapsed-ownership fixture.",
  });
  const supply = await signedInClient("s3browser.supply@thebehaviourhive.com");
  const { data: loc } = await admin.from("incident_locations").select("id").eq("value", "Classroom").is("institution_id", null).single();
  const { data: lapsedIncidentId } = await supply.rpc("create_incident_stamp", {
    p_institution_id: institutionId,
    p_occurred_at: new Date().toISOString(),
    p_location_id: loc.id,
    p_child_passport_ids: [childCovered.id],
    p_staff: [],
  });
  await supply.from("incidents").update({ category: "one_party_incident" }).eq("id", lapsedIncidentId);
  await principal.rpc("revoke_temporary_access", { p_temporary_access_id: supplyGrantId, p_reason: "S3 browser verify: end cover so ownership lapses." });

  // ---- The reactive lapsed-access-save scenario (ABC logger + incident
  // detail page) -- a SEPARATE lapsed supply account so it doesn't
  // interfere with the transfer/badge scenario above. Grant + immediate
  // revoke, leaving passport_access-equivalent standing gone but an
  // ABC-loggable relationship intact via the SAME still-open incident
  // path isn't needed here -- the ABC logger check is driven from
  // /sna/passports itself (the lapsed account has no remaining access
  // source at all once revoked, which is exactly the state that should
  // trigger the friendly message on any write attempt).
  const supplyId2 = await createUser("s3browser.supply2@thebehaviourhive.com", "S3 Supply Teacher Two", "sna");
  const { data: supplyGrant2Id } = await principal.rpc("grant_temporary_access", {
    p_class_id: classId2,
    p_user_id: supplyId2,
    p_date: nowParts.date,
    p_reason: "S3 browser verify: reactive lapsed-save fixture.",
  });
  await principal.rpc("revoke_temporary_access", { p_temporary_access_id: supplyGrant2Id, p_reason: "S3 browser verify: revoke immediately for the reactive-message check." });

  console.log(JSON.stringify(
    {
      institutionId,
      classId,
      classId2,
      lapsedIncidentId,
      password: PASSWORD,
      accounts: {
        principal: "s3browser.principal@thebehaviourhive.com",
        teacher: "s3browser.teacher@thebehaviourhive.com",
        sna: "s3browser.sna@thebehaviourhive.com (existing SNA -- class_teacher grants cover to this account)",
        supply: "s3browser.supply@thebehaviourhive.com (new-supply-by-email lookup target; also now the lapsed-ownership incident's original owner)",
        supply2: "s3browser.supply2@thebehaviourhive.com (grant already revoked -- reactive lapsed-save message check)",
      },
      children: {
        passportAccessChild: childPassportAccess.child_name,
        assignedChild: childAssigned.child_name,
        coveredChild: childCovered.child_name + " (in S3 Room, class-wide temp cover)",
        room2Child: childRoom2.child_name + " (in S3 Room Two, for the class-teacher grant/revoke flow)",
      },
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
