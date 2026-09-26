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
const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });

const stamp = Date.now();
const PW = `ZzClosure-${stamp}!`;

function client() {
  return createClient(SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
}
async function createUser(email, role) {
  const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true, password: PW, app_metadata: role ? { role } : undefined });
  if (error) throw new Error(`createUser ${email}: ${error.message}`);
  return data.user.id;
}
async function signIn(email) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password: PW });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

const results = [];
function record(label, pass, detail) {
  results.push({ label, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"} -- ${label}${detail ? " -- " + JSON.stringify(detail) : ""}`);
}

// ---------------------------------------------------------------------
// Setup: a real clinic (director), a real respite centre (manager +
// care_staff, reusing the existing zz-centre-messages fixture's own
// institution so the closure test lives alongside the already-proven
// 8-child grouping/unread/capping fixture, not a third throwaway
// institution), and a real parent -- the only way to genuinely test
// "does a parent retain read access after the activation closes" is a
// child with a REAL passport_guardians row, which onboard_clinic_client()
// never creates on its own. Modelled the real supported path: a clinic
// onboards + a parent claims, THEN the child is separately linked into
// the respite centre via the real link-code mechanism -- not a shortcut.
// ---------------------------------------------------------------------
const existingFixture = JSON.parse(fs.readFileSync("scripts/dev/zz-centre-messages-fixture.json", "utf8"));
const centreId = existingFixture.centre.id;
const managerEmail = existingFixture.manager.email;
const managerPw = existingFixture.password;
const careAEmail = existingFixture.careA.email;
const careAPw = existingFixture.password;

// The existing fixture's own accounts were created under a DIFFERENT
// password/stamp -- sign in with THEIR own saved password, not this
// script's PW.
async function signInExisting(email, password) {
  const c = client();
  const { error } = await c.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`signIn ${email}: ${error.message}`);
  return c;
}

const { data: clinic, error: clinicErr } = await admin
  .from("institutions")
  .insert({ name: "ZZ Closure Proof Clinic", institution_code: `ZZCLOSURE${stamp}`, status: "verified", type: "clinic" })
  .select("id")
  .single();
if (clinicErr) throw clinicErr;

const directorEmail = `zzclosure.director.${stamp}@thebehaviourhive.com`;
const parentEmail = `zzclosure.parent.${stamp}@thebehaviourhive.com`;
const directorId = await createUser(directorEmail, "principal");
const parentId = await createUser(parentEmail, "parent");

await admin.from("institution_staff").insert([
  { institution_id: clinic.id, user_id: directorId, role: "principal", approved_at: new Date().toISOString(), approval_source: "bootstrap" },
]).throwOnError();

const director = await signIn(directorEmail);
const manager = await signInExisting(managerEmail, managerPw);
const careA = await signInExisting(careAEmail, careAPw);
const parent = await signIn(parentEmail);

console.log("Onboarding a clinic client (director)...");
const { data: passportId, error: onboardErr } = await director.rpc("onboard_clinic_client", {
  p_institution_id: clinic.id,
  p_client_name: "ZZ Closure Proof Child",
});
if (onboardErr) throw onboardErr;

console.log("Generating a parent claim code (director) and redeeming it (parent)...");
const { data: claimCode, error: claimGenErr } = await director.rpc("generate_passport_claim_code", {
  p_institution_id: clinic.id,
  p_passport_id: passportId,
});
if (claimGenErr) throw claimGenErr;
const { error: claimRedeemErr } = await parent.rpc("redeem_passport_claim_code", { p_code: claimCode });
if (claimRedeemErr) throw claimRedeemErr;

// Confirm a REAL passport_guardians row exists -- the whole point.
const { data: guardianRow } = await admin.from("passport_guardians").select("passport_id, user_id").eq("passport_id", passportId).eq("user_id", parentId).maybeSingle();
record("Real passport_guardians row created for the parent", Boolean(guardianRow), guardianRow);

console.log("Generating a respite link code (director) and redeeming it at the centre (manager)...");
const { data: linkCode, error: linkGenErr } = await director.rpc("generate_institution_link_code_for_clinic", { p_passport_id: passportId });
if (linkGenErr) throw linkGenErr;
const { error: linkRedeemErr } = await manager.rpc("redeem_institution_link_code", { p_institution_id: centreId, p_code: linkCode });
if (linkRedeemErr) throw linkRedeemErr;

const { data: episodeRow } = await admin.from("episodes_of_care").select("id").eq("passport_id", passportId).eq("institution_id", centreId).is("ended_at", null).maybeSingle();
record("Real active episode at the respite centre", Boolean(episodeRow), episodeRow);

console.log("Creating and activating a real stay (manager)...");
const nowMs = Date.now();
const { data: stayId, error: stayErr } = await manager.rpc("create_respite_stay", {
  p_episode_id: episodeRow.id,
  p_starts_at: new Date(nowMs - 60 * 60 * 1000).toISOString(),
  p_ends_at: new Date(nowMs + 24 * 60 * 60 * 1000).toISOString(),
});
if (stayErr) throw stayErr;
const { data: activationId, error: actErr } = await manager.rpc("activate_respite_stay", { p_stay_id: stayId });
if (actErr) throw actErr;
// activate_respite_stay's own return shape -- confirm it directly rather
// than assume, since some respite RPCs return the row id and some
// return void; fetch the real activation id either way.
const { data: activationRow } = await admin.from("respite_activations").select("id").eq("stay_id", stayId).is("closed_at", null).single();
const realActivationId = activationRow.id;

console.log("Sending a real handover (manager -> careA)...");
const { data: categories } = await admin.from("message_categories").select("id").eq("label", "Handover").single();
const handoverBody = "CLOSURE PROOF: settled after lunch, watch for the 3pm transition.";
const { error: sendErr } = await manager.rpc("send_message", {
  p_passport_id: passportId,
  p_category_id: categories.id,
  p_body: handoverBody,
  p_response_required: false,
  p_recipient_ids: [existingFixture.careA.id],
});
if (sendErr) throw sendErr;
const { data: messageRow } = await admin.from("messages").select("id").eq("passport_id", passportId).eq("body", handoverBody).single();
const messageId = messageRow.id;

// -----------------------------------------------------------------
// BEFORE closing the activation -- confirm every real party can read
// it, through the SAME query shape useMessageThread (the report
// screen's own read path) actually uses: a raw select against
// `messages`, gated purely by can_view_message() via RLS, plus the
// RPC itself for a clean boolean.
// -----------------------------------------------------------------
async function canRead(session, label) {
  const { data: viaTable } = await session.from("messages").select("id, body").eq("id", messageId).maybeSingle();
  const { data: viaRpc } = await session.rpc("can_view_message", { p_message_id: messageId });
  return { label, viaTable: Boolean(viaTable), viaRpc: Boolean(viaRpc) };
}

console.log("\n--- BEFORE closing the activation ---");
const beforeManager = await canRead(manager, "manager (report author)");
const beforeCareA = await canRead(careA, "careA (recipient)");
const beforeParent = await canRead(parent, "parent (guardian)");
record("Manager can read the handover BEFORE closing", beforeManager.viaTable && beforeManager.viaRpc, beforeManager);
record("careA can read the handover BEFORE closing", beforeCareA.viaTable && beforeCareA.viaRpc, beforeCareA);
record("Parent can read the handover BEFORE closing", beforeParent.viaTable && beforeParent.viaRpc, beforeParent);

// -----------------------------------------------------------------
// Close the activation MANUALLY, as the manager, BEFORE any report is
// written -- exactly the early-closure path close_respite_activation()
// exists for. Not the finalize_respite_stay_report() poka-yoke.
// -----------------------------------------------------------------
console.log("\nClosing the activation manually (manager), before writing any report...");
const { error: closeErr } = await manager.rpc("close_respite_activation", { p_activation_id: realActivationId });
if (closeErr) throw closeErr;
const { data: closedRow } = await admin.from("respite_activations").select("closed_at, closed_reason").eq("id", realActivationId).single();
record("Activation genuinely closed (manual)", Boolean(closedRow.closed_at) && closedRow.closed_reason === "manual", closedRow);

console.log("\n--- AFTER closing the activation, BEFORE the report is written ---");
const afterManager = await canRead(manager, "manager (report author)");
const afterCareA = await canRead(careA, "careA (recipient)");
const afterParent = await canRead(parent, "parent (guardian)");
record("Manager LOSES read access to the handover they are about to summarise", !afterManager.viaTable && !afterManager.viaRpc, afterManager);
record("careA LOSES read access to the handover", !afterCareA.viaTable && !afterCareA.viaRpc, afterCareA);
record("Parent RETAINS read access to the handover, unaffected by closure", afterParent.viaTable && afterParent.viaRpc, afterParent);

// -----------------------------------------------------------------
// Now actually try to write the report, as the manager, and confirm
// the SAME query the report screen (useMessageThread) runs for this
// passport returns the handover thread as empty/missing -- not a
// contrived single-message check, the real screen's own read shape.
// -----------------------------------------------------------------
console.log("\nManager finalising the post-stay report, and checking what they can see of the thread while doing it...");
const { data: threadForManager } = await manager
  .from("messages")
  .select("id, body")
  .eq("passport_id", passportId);
record(
  "The report screen's own thread query returns ZERO messages for the manager post-closure (writing blind)",
  (threadForManager ?? []).length === 0,
  threadForManager
);

const { data: finalizeResult, error: finalizeErr } = await manager.rpc("finalize_respite_stay_report", {
  p_stay_id: stayId,
  p_body: "Report written with the handover already unreadable to its own author.",
});
record("Report finalises successfully regardless (no read-back check inside the RPC)", !finalizeErr, { finalizeResult, finalizeErr });

// -----------------------------------------------------------------
// (c) -- after the report is finalised, is there ANY route back in?
// Re-check the manager, careA, and the parent one more time.
// -----------------------------------------------------------------
console.log("\n--- AFTER the report is finalised ---");
const postManager = await canRead(manager, "manager, post-finalisation");
const postCareA = await canRead(careA, "careA, post-finalisation");
const postParent = await canRead(parent, "parent, post-finalisation");
record("Manager still cannot read it post-finalisation", !postManager.viaTable && !postManager.viaRpc, postManager);
record("careA still cannot read it post-finalisation", !postCareA.viaTable && !postCareA.viaRpc, postCareA);
record("Parent can STILL read it post-finalisation -- the one standing route back in", postParent.viaTable && postParent.viaRpc, postParent);

// Confirm the row itself is still genuinely in the database (never
// deleted) -- "permanently unreadable while still stored" vs "gone".
const { data: rowStillExists } = await admin.from("messages").select("id, body").eq("id", messageId).maybeSingle();
record("The message row is still stored, never deleted, just unreadable to former staff", Boolean(rowStillExists), rowStillExists);

console.log("\n=== SUMMARY ===");
const failed = results.filter((r) => !r.pass);
console.log(`${results.length - failed.length}/${results.length} passed.`);
if (failed.length > 0) {
  console.log("FAILED:", failed.map((f) => f.label));
}

const fixture = {
  stamp, password: PW,
  clinic: { id: clinic.id },
  director: { email: directorEmail, id: directorId },
  parent: { email: parentEmail, id: parentId },
  passportId,
  messageId,
  stayId,
  activationId: realActivationId,
};
fs.writeFileSync("scripts/dev/zz-handover-closure-proof-fixture.json", JSON.stringify(fixture, null, 2));
