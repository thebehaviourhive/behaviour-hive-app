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
const f = JSON.parse(fs.readFileSync("/tmp/zz-e2e-respite-fixture.json", "utf8"));

const client = createClient(SUPABASE_URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { error: signInErr } = await client.auth.signInWithPassword({ email: f.managerEmail, password: f.password });
if (signInErr) throw signInErr;

const { data: messages, error } = await client.from("messages").select("id, sender_role, status, body").eq("passport_id", f.passportId);
console.log("messages visible to manager:", messages, error?.message);

const admin = createClient(SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const { data: activations } = await admin.from("respite_activations").select("*").eq("passport_id", f.passportId);
console.log("activations (service role):", activations);
const { data: allMessages } = await admin.from("messages").select("id, sender_role, status, body, sender_id").eq("passport_id", f.passportId);
console.log("all messages (service role):", allMessages);
