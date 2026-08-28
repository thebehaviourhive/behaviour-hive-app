// Disposable browser-verification fixture, ABC logger reactive-message
// check specifically -- the one interaction Stage 3's own browser pass
// hadn't closed. NOT ZZFIXTURE_THUMBTEST -- torn down same session,
// confirmed gone by direct query.

import { createClient } from "@supabase/supabase-js";

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const admin = createClient(URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Stage3AbcVerify-2026!";
const CODE = "S3ABC" + Math.floor(Math.random() * 10000);

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
  const { data: inst, error: instErr } = await admin
    .from("institutions")
    .insert({ name: "Stage 3 ABC Browser Verify", institution_code: CODE, status: "verified" })
    .select()
    .single();
  if (instErr) throw instErr;
  const institutionId = inst.id;

  const principalId = await createUser("s3abc.principal@thebehaviourhive.com", "S3ABC Principal", "principal");
  const snaId = await createUser("s3abc.sna@thebehaviourhive.com", "S3ABC SNA", "sna");
  const parentId = await createUser("s3abc.parent@thebehaviourhive.com", "S3ABC Parent", "parent");

  await admin.from("institution_staff").insert([
    { institution_id: institutionId, user_id: principalId, role: "principal", approved_at: new Date().toISOString(), approved_by: principalId },
  ]);

  const principal = await signedInClient("s3abc.principal@thebehaviourhive.com");

  const { data: child, error: childErr } = await admin.from("passports").insert({ user_id: parentId, child_name: "S3ABC Child", passport_status: "complete" }).select().single();
  if (childErr) throw childErr;
  await admin.from("passport_institution_links").insert({ passport_id: child.id, institution_id: institutionId, approved_by_parent: true });

  const { data: classId } = await principal.rpc("create_class", { p_institution_id: institutionId, p_name: "S3ABC Room" });
  await principal.rpc("add_class_child", { p_class_id: classId, p_passport_id: child.id });

  const nowDublin = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin" }).format(new Date());
  const { data: grantId, error: grantErr } = await principal.rpc("grant_temporary_access", {
    p_class_id: classId,
    p_user_id: snaId,
    p_date: nowDublin,
    p_reason: "S3ABC: reactive lapsed-save message check.",
  });
  if (grantErr) throw grantErr;

  // Comfortably-ahead cutoff so the SNA can actually reach the ABC
  // logger and confirm a WORKING submit first, before it gets revoked.
  const nowParts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Dublin", hour12: false, hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date());
  const p = Object.fromEntries(nowParts.map((x) => [x.type, x.value]));
  let cutoffMinutes = Number(p.hour) * 60 + Number(p.minute) + 60;
  cutoffMinutes = Math.min(23 * 60 + 59, cutoffMinutes);
  const cutoffTime = `${String(Math.floor(cutoffMinutes / 60)).padStart(2, "0")}:${String(cutoffMinutes % 60).padStart(2, "0")}:00`;
  await principal.rpc("set_temporary_access_cutoff", { p_institution_id: institutionId, p_cutoff_time: cutoffTime });

  console.log(JSON.stringify(
    {
      institutionId,
      classId,
      grantId,
      childPassportId: child.id,
      childName: child.child_name,
      password: PASSWORD,
      snaEmail: "s3abc.sna@thebehaviourhive.com",
      principalEmail: "s3abc.principal@thebehaviourhive.com",
    },
    null,
    2
  ));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
