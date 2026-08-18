// Throwaway roleless accounts for live-verifying the Phase 2 onboarding
// restructure (role-select -> School Staff sub-select -> consent ->
// join-institution). Deliberately create with NO app_metadata.role so
// they land on /role-select exactly like a fresh signup would.
//
// Run with: node --env-file=.env.local scripts/messages-test/sna-onboarding-create-users.mjs

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

export const PASSWORD = "SnaOnboardTest-2026!";
const emails = [
  "snaonboardtest.teacher@thebehaviourhive.com",
  "snaonboardtest.sna@thebehaviourhive.com",
];

for (const email of emails) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: email.split("@")[0] },
  });
  if (error) {
    if (error.status === 422 || error.message?.includes("already been registered")) {
      console.log(`${email}: already exists, skipping`);
      continue;
    }
    throw error;
  }
  console.log(`${email}: created ${data.user.id}`);
}
