import { createClient } from "@supabase/supabase-js";
const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const PASSWORD = "Stage2dDemo-2026!";
const CODE = "STAGE2DDEMO";

const { data: inst, error: instErr } = await admin.from("institutions").insert({ name: "Stage 2d Demo School", institution_code: CODE, status: "verified" }).select().single();
if (instErr) { console.error("institution insert failed:", instErr.message); process.exit(1); }
console.log("Institution:", inst.id, CODE);

async function createUser(email, fullName, role) {
  const { data, error } = await admin.auth.admin.createUser({
    email, password: PASSWORD, email_confirm: true,
    user_metadata: { full_name: fullName }, app_metadata: { role },
  });
  if (error) throw error;
  return data.user.id;
}

const teacherId = await createUser("stage2ddemo.teacher@thebehaviourhive.com", "Demo Teacher", "class_teacher");
const parentId = await createUser("stage2ddemo.parent@thebehaviourhive.com", "Demo Parent", "parent");
console.log("Teacher:", teacherId);

await admin.from("institution_staff").insert([{ institution_id: inst.id, user_id: teacherId, role: "class_teacher" }]);

const { data: p1 } = await admin.from("passports").insert({ user_id: parentId, child_name: "Quinn Demo", passport_status: "complete" }).select().single();
await admin.from("passport_institution_links").insert({ passport_id: p1.id, institution_id: inst.id, approved_by_parent: true });
await admin.from("passport_access").insert({ passport_id: p1.id, teacher_id: teacherId, institution_id: inst.id, is_active: true, actor_role: "class_teacher" });

console.log("Child: Quinn Demo =", p1.id);
console.log("\nLogin: stage2ddemo.teacher@thebehaviourhive.com / " + PASSWORD);
