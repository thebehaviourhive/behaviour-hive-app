/* Manually sets app_metadata.role = "clinician" for one real, already
   -registered account -- the manual gate the Sept 2026 onboarding
   model correction requires. THERE IS NO SELF-SERVICE CLINICIAN: every
   clinician belongs to an organisation (joins by its code, same as
   any other staff role) or, for the specialty-then-verify path this
   script exists to unlock, is a specific person Behaviour Hive has
   vetted directly -- the trial school's own psychologist is the first
   real case. /api/set-role's own "clinician" self-service option was
   removed in the same change; this script is the only way that role
   gets assigned now, matching the precedent already established for
   institution creation itself (CLAUDE.md: "institution creation being
   manual is deliberate").

   Once this runs, the person's VERY NEXT sign-in lands them on
   /clinician/specialty automatically -- resolveOnboardingDestination()
   sees role="clinician" with no specialty selected yet and routes them
   there itself, exactly the same gating every other role already goes
   through. No separate UI page, no tile, nothing else to build.

   Usage:
     node scripts/admin/set-clinician-role.mjs <email>

   Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
   the environment (this repo's convention:
   `set -a; source .env.local; set +a` before running).

   Refuses to touch an account that already has a different role set
   -- reassigning an existing teacher/parent/etc. to clinician is a
   different, much bigger operation (their institution_staff/passport
   history doesn't just disappear) and is never what this script is
   for. If that's genuinely needed, it's a deliberate manual decision,
   not something this script automates. */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/admin/set-clinician-role.mjs <email>");
  process.exit(1);
}

const admin = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } });

async function main() {
  const { data, error: listError } = await admin.auth.admin.listUsers({ perPage: 200 });
  if (listError) fail(`Listing users: ${listError.message}`);

  const user = data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
  if (!user) {
    fail(`No account found for ${email}. They need to register and verify their email first.`);
  }

  const existingRole = user.app_metadata?.role;
  if (existingRole && existingRole !== "clinician") {
    fail(
      `${email} already has role "${existingRole}" set. This script only assigns the role to an ` +
        `account that has none yet -- reassigning an existing role is a deliberate manual decision, ` +
        `not something to automate here.`
    );
  }
  if (existingRole === "clinician") {
    console.log(`${email} already has role "clinician" set. Nothing to do.`);
    return;
  }

  const { error: updateError } = await admin.auth.admin.updateUserById(user.id, {
    app_metadata: { role: "clinician" },
  });
  if (updateError) fail(`Setting role: ${updateError.message}`);

  console.log(`${email}: role set to "clinician".`);
  console.log("Their next sign-in will land them on /clinician/specialty automatically.");
}

function fail(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

main();
