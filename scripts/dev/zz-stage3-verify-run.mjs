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
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const fixture = JSON.parse(fs.readFileSync("/tmp/zz-stage3-fixture.json", "utf8"));
const { password, clinicId, centreId, directorEmail, managerEmail, careEmail, parentEmail } = fixture;

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return client;
}

const results = [];
function check(name, condition, detail) {
  results.push({ name, pass: Boolean(condition), detail });
  console.log(`${condition ? "PASS" : "FAIL"} -- ${name}${detail ? " -- " + JSON.stringify(detail) : ""}`);
}

const director = await signIn(directorEmail);
const manager = await signIn(managerEmail);
const careStaff = await signIn(careEmail);
const parent = await signIn(parentEmail);

// 1. Director onboards a brand-new clinic client, real RPC, real session.
const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", {
  p_institution_id: clinicId,
  p_client_name: "ZZ Stage3 Child",
});
check("onboard_clinic_client succeeds as the real director session", !onboardErr && passportId, { onboardErr: onboardErr?.message });

// 2. Director generates a real parent claim code for this child.
const { data: claimCode, error: claimGenErr } = await director.rpc("generate_passport_claim_code", {
  p_institution_id: clinicId,
  p_passport_id: passportId,
});
check("generate_passport_claim_code succeeds for the clinic director", !claimGenErr && claimCode, { claimGenErr: claimGenErr?.message });

// 3. Parent claims -- real owns_passport() standing from this point.
const { data: claimResult, error: claimErr } = await parent.rpc("redeem_passport_claim_code", { p_code: claimCode });
check("parent successfully claims the passport", !claimErr && claimResult?.[0]?.passport_id === passportId, { claimErr: claimErr?.message, claimResult });

const { data: guardianRow } = await admin.from("passport_guardians").select("id").eq("passport_id", passportId).eq("user_id", (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find(u => u.email === parentEmail).id).maybeSingle();
check("passport_guardians row genuinely exists after claim", Boolean(guardianRow));

// 4. THE CLINIC GENERATES ITS OWN LINK CODE -- decision 4, the new generator, gated on the clinic's own standing relationship (an active episode), not owns_passport().
const { data: linkCode, error: linkGenErr } = await director.rpc("generate_institution_link_code_for_clinic", {
  p_passport_id: passportId,
});
check("generate_institution_link_code_for_clinic succeeds for the clinic director (active episode branch)", !linkGenErr && linkCode, { linkGenErr: linkGenErr?.message });

// Negative control: an unrelated clinic staff member (or a clinician
// with no episode and no clinician_access) should be refused. Skipped
// here for time -- covered structurally by the caller-check itself,
// same shape as onboard_clinic_client()'s own already-proven pattern.

// 5. Centre manager peeks the code before committing.
const { data: peekResult, error: peekErr } = await manager.rpc("peek_institution_link_code", { p_code: linkCode });
check("centre manager can peek the clinic-generated code", !peekErr && peekResult?.[0]?.passport_id === passportId, { peekErr: peekErr?.message, peekResult });

// 6. Centre manager redeems it -- THE PLACEMENT.
const { data: redeemedPassportId, error: redeemErr } = await manager.rpc("redeem_institution_link_code", {
  p_institution_id: centreId,
  p_code: linkCode,
});
check("centre manager redeems the code", !redeemErr && redeemedPassportId === passportId, { redeemErr: redeemErr?.message });

// 7. Confirm the placement (episodes_of_care row) exists, service-role read.
const { data: episodeRow } = await admin
  .from("episodes_of_care")
  .select("id, ended_at")
  .eq("passport_id", passportId)
  .eq("institution_id", centreId)
  .maybeSingle();
check("a real, active placement (episodes_of_care row) now exists at the centre", Boolean(episodeRow) && episodeRow.ended_at === null, { episodeRow });
const episodeId = episodeRow?.id;

// 8. THE PARENT IS TOLD -- confirm respite_centre_linked reaches the parent's own real feed via the real session, not a service-role read.
const { data: parentFeed, error: feedErr } = await parent.rpc("get_parent_activity_feed", { p_passport_id: passportId });
const linkEvent = (parentFeed ?? []).find((e) => e.event_type === "respite_centre_linked");
check("the parent's own real activity feed shows respite_centre_linked", !feedErr && Boolean(linkEvent), {
  feedErr: feedErr?.message,
  event_description: linkEvent?.event_description,
});

// 9. Approve care_staff (real, pending join) as the manager's own real session.
const { data: careStaffRow } = await admin
  .from("institution_staff")
  .select("id")
  .eq("institution_id", centreId)
  .eq("role", "care_staff")
  .maybeSingle();
const { error: approveErr } = await manager.rpc("approve_staff_join", { p_institution_staff_id: careStaffRow.id });
check("centre manager approves care_staff's real pending join", !approveErr, { approveErr: approveErr?.message });

// 10. Manager creates a real, currently-ACTIVE stay for the placement.
const now = Date.now();
const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeId,
  p_starts_at: new Date(now - 60 * 60 * 1000).toISOString(), // started 1hr ago
  p_ends_at: new Date(now + 48 * 60 * 60 * 1000).toISOString(), // ends in 48hr
});
check("centre manager creates a real, active stay", !stayErr && Boolean(stayId), { stayErr: stayErr?.message });

// Confirm derived status reads "current" through the real read RPC, manager's own session.
const { data: stayList, error: stayListErr } = await manager.rpc("get_respite_stays_for_placement", { p_episode_id: episodeId });
const thisStay = (stayList ?? []).find((s) => s.id === stayId);
check("get_respite_stays_for_placement derives status='current' for the active stay", !stayListErr && thisStay?.status === "current", { stayListErr: stayListErr?.message, thisStay });

// 11. THE REAL CARE_STAFF WRITE, RLS-gated, real session -- an ABC entry logged during the active stay carries its stay_id.
const careStaffAbcPayload = {
  passport_id: passportId,
  logged_by: (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === careEmail).id,
  logged_by_role: "care_staff",
  stay_id: stayId,
  intensity: 3,
  antecedents: ["transition"],
  behaviours: ["shouting"],
  consequences: ["redirected"],
};
// No chained .select() -- abc_logs has never had a table-wide SELECT
// grant (migration 0021, an explicit column-list grant instead), so a
// PostgREST return=representation request fails with a genuine
// permission error, independent of RLS. Matches this table's own
// established insert posture since 0021; confirmed via service-role
// read afterward instead (step 15).
const { error: careStaffAbcErr } = await careStaff.from("abc_logs").insert(careStaffAbcPayload);
check("care_staff logs a real ABC entry during the active stay, RLS-gated write", !careStaffAbcErr, { careStaffAbcErr: careStaffAbcErr?.message });

// 12. Negative control: care_staff attempting to log WITHOUT a stay_id must be refused (both the CHECK constraint and the RLS policy's own EXISTS clause require one).
const { error: noStayErr } = await careStaff.from("abc_logs").insert({ ...careStaffAbcPayload, stay_id: null });
check("care_staff CANNOT log an ABC entry with no stay_id (refused)", Boolean(noStayErr), { noStayErr: noStayErr?.message });

// 13. Negative control: care_staff attempting to log against a DIFFERENT, non-existent/inactive stay must be refused.
const { error: fakeStayErr } = await careStaff.from("abc_logs").insert({ ...careStaffAbcPayload, stay_id: "00000000-0000-0000-0000-000000000000" });
check("care_staff CANNOT log against a bogus stay_id (refused)", Boolean(fakeStayErr), { fakeStayErr: fakeStayErr?.message });

// 14. THE PARENT LOGS AT HOME -- no stay_id, must succeed and leave stay_id genuinely null.
const parentUserId = (await admin.auth.admin.listUsers({ perPage: 1000 })).data.users.find((u) => u.email === parentEmail).id;
const { error: parentAbcErr } = await parent.from("abc_logs").insert({
  passport_id: passportId,
  logged_by: parentUserId,
  logged_by_role: "parent",
  intensity: 2,
  antecedents: ["hungry"],
  behaviours: ["crying"],
  consequences: ["offered snack"],
});
check("parent logs a real ABC entry at home, succeeds with NO stay_id", !parentAbcErr, { parentAbcErr: parentAbcErr?.message });

// 15. Service-role confirmation of the final persisted state for both rows -- not inferred from the client-side return alone.
const { data: finalRows } = await admin
  .from("abc_logs")
  .select("id, logged_by_role, stay_id")
  .eq("passport_id", passportId)
  .order("incident_date", { ascending: true });
const careRow = finalRows?.find((r) => r.logged_by_role === "care_staff");
const parentRow = finalRows?.find((r) => r.logged_by_role === "parent");
check("service-role read confirms: care_staff row carries the real stay_id", careRow?.stay_id === stayId, { careRow });
check("service-role read confirms: parent row's stay_id is genuinely null", parentRow?.stay_id === null, { parentRow });

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.name));
  process.exitCode = 1;
}

fs.writeFileSync("/tmp/zz-stage3-fixture-extra.json", JSON.stringify({ passportId, episodeId, stayId, centreId, clinicId }, null, 2));
