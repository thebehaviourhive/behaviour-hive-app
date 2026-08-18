// Throwaway verified institution for the Phase 2 onboarding live
// verification. Not part of the messages-test rig's own cleanup (its
// filter is msgtest.* users only) -- deleted by this suite's own
// counterpart, sna-onboarding-cleanup.mjs.
//
// Run with: node --env-file=.env.local scripts/messages-test/sna-onboarding-create-institution.mjs

import { createClient } from "@supabase/supabase-js";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const CODE = "SNAOB-TEST";

const { data: existing } = await supabase
  .from("institutions")
  .select("id")
  .eq("institution_code", CODE)
  .maybeSingle();

if (existing) {
  console.log(`institution already exists: ${existing.id} (code ${CODE})`);
} else {
  const { data, error } = await supabase
    .from("institutions")
    .insert({ name: "SNA Onboarding Test School", institution_code: CODE, status: "verified" })
    .select("id")
    .single();
  if (error) throw error;
  console.log(`institution created: ${data.id} (code ${CODE})`);
}
