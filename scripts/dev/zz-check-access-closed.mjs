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
const f = JSON.parse(fs.readFileSync("/tmp/zz-e2e-respite-fixture.json", "utf8"));

async function signIn(email) {
  const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { error } = await client.auth.signInWithPassword({ email, password: f.password });
  if (error) throw error;
  return client;
}

const careA = await signIn(f.careAEmail);
const { data: activeForCareA } = await careA.rpc("get_my_centre_active_children", { p_institution_id: f.centreId });
console.log("care_staff A's active-children list after finalize:", activeForCareA);

const { data: activations } = await admin.from("respite_activations").select("*").eq("passport_id", f.passportId);
console.log("activation state (service role):", activations);

const manager = await signIn(f.managerEmail);
const { data: activeForManager } = await manager.rpc("get_my_centre_active_children", { p_institution_id: f.centreId });
console.log("manager's placement-scoped list still includes child:", activeForManager);
