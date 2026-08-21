// Video-specific demo-world adjustments, layered on top of the existing
// scripts/demo/seed.mjs pipeline rather than forking it. Run AFTER
// seed.mjs. Idempotent -- safe to re-run any number of times.
//
// Two corrections seed.mjs's own output doesn't give us for free:
//
// 1. seed.mjs's core phase gives 4 of the 5 non-hero pupils (Zara,
//    Noah, Mia, Cian -- not Ruby) a morning check-in dated TODAY, so
//    their daily-card states have something to show in screenshots.
//    The video needs the opposite: every non-hero pupil's row must sit
//    completely still today, so Alfie's is the only one that visibly
//    changes when the sync beats land. This deletes just those 4
//    rows -- nothing else about the five siblings' history.
//
// 2. Dr. Emma Walsh is seeded with clinicians.verification_status =
//    'pending' (seed.mjs:319-328) -- deliberately, so
//    capture-clinician.mjs can screenshot the real "getting verified"
//    flow. That flow is destructive (deletes and fully re-creates the
//    clinicians row via a live specialty-select -> credentials-form UI
//    walk) and isn't meant to be reused as a setup step. This calls
//    the same approve_clinician RPC the app already exposes for this,
//    directly against the row seed.mjs already created -- no UI, no
//    row deletion, no risk of clobbering the county/operating-area
//    data the feature-guide phase sets separately.
//
// Run with: node --env-file=.env.local scripts/demo/video/prepare.mjs

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const creds = JSON.parse(readFileSync(new URL("../.demo-credentials.json", import.meta.url)));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function todayStartIso() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}

async function main() {
  console.log("== Clearing today's check-ins for the 5 non-hero pupils ==");
  const nonHeroPassportIds = creds.otherParents.map((p) => p.passportId);
  const { data: deleted, error: deleteError } = await supabase
    .from("morning_checkins")
    .delete()
    .in("passport_id", nonHeroPassportIds)
    .gte("checked_in_at", todayStartIso())
    .select("id, passport_id");
  if (deleteError) throw deleteError;
  console.log(`  deleted ${deleted?.length ?? 0} today check-in(s) among the 5 siblings`);

  console.log("== Verifying Dr. Emma Walsh (approve_clinician RPC, no UI) ==");
  const { data: clinicianRow, error: clinicianLookupError } = await supabase
    .from("clinicians")
    .select("id, verification_status")
    .eq("user_id", creds.clinician.id)
    .maybeSingle();
  if (clinicianLookupError) throw clinicianLookupError;
  if (!clinicianRow) {
    throw new Error("No clinicians row for the demo clinician -- run seed.mjs first.");
  }
  if (clinicianRow.verification_status === "verified") {
    console.log("  (already verified, skipping)");
  } else {
    const { error: approveError } = await supabase.rpc("approve_clinician", {
      clinician_email: creds.clinician.email,
    });
    if (approveError) throw approveError;
    console.log("  verified");
  }

  console.log("\n== Verification ==");
  const { data: access, error: accessError } = await supabase
    .from("passport_access")
    .select("passport_id")
    .eq("teacher_id", creds.teacher.id);
  if (accessError) throw accessError;
  console.log(`  teacher passport_access rows: ${access?.length ?? 0} (expect 6)`);

  const { data: clinicianAccess, error: clinicianAccessError } = await supabase
    .from("clinician_access")
    .select("passport_id")
    .eq("clinician_id", creds.clinician.id)
    .eq("passport_id", creds.parentHero.passportId);
  if (clinicianAccessError) throw clinicianAccessError;
  console.log(`  Alfie <-> clinician link present: ${(clinicianAccess?.length ?? 0) > 0}`);

  const allSixPassportIds = [creds.parentHero.passportId, ...nonHeroPassportIds];
  const { data: todayCheckins, error: todayError } = await supabase
    .from("morning_checkins")
    .select("passport_id")
    .in("passport_id", allSixPassportIds)
    .gte("checked_in_at", todayStartIso());
  if (todayError) throw todayError;
  console.log(`  check-ins dated today across all 6: ${todayCheckins?.length ?? 0} (expect 0)`);

  const { data: todayAbc, error: todayAbcError } = await supabase
    .from("abc_logs")
    .select("id")
    .eq("passport_id", creds.parentHero.passportId)
    .gte("created_at", todayStartIso());
  if (todayAbcError) throw todayAbcError;
  console.log(`  Alfie's ABC logs dated today: ${todayAbc?.length ?? 0} (expect 0)`);

  const { data: todayEod, error: todayEodError } = await supabase
    .from("teacher_updates")
    .select("id")
    .eq("passport_id", creds.parentHero.passportId)
    .gte("submitted_at", todayStartIso());
  if (todayEodError) throw todayEodError;
  console.log(`  Alfie's EOD updates dated today: ${todayEod?.length ?? 0} (expect 0)`);

  const { data: finalClinicianRow, error: finalClinicianError } = await supabase
    .from("clinicians")
    .select("verification_status")
    .eq("user_id", creds.clinician.id)
    .maybeSingle();
  if (finalClinicianError) throw finalClinicianError;
  console.log(`  clinician verification_status: ${finalClinicianRow?.verification_status} (expect verified)`);

  console.log("\n== Done ==");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
