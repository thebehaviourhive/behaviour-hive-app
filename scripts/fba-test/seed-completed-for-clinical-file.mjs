// One-off: insert a second, COMPLETED fba_report for the standard
// fbatest passport, alongside its existing in_progress one, so the
// Clinical File's FBA tab (Fix 2) has a completed report to render.
// Doesn't touch the existing in_progress row -- the DB's one-active-FBA
// unique index only covers draft/in_progress, not completed.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-completed-for-clinical-file.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function id() {
  return crypto.randomUUID();
}

async function main() {
  const triggerId = id();
  const settingEventId = id();
  const targetBehaviourId = id();
  const content = {
    clinicalOverview: "Elopement risk during unstructured transitions, most acute at home and school pickup.",
    hypothesisedFunctions: "Escape from demand, maintained by adult attention during pursuit.",
    conclusion: "Assessment complete; recommendations below to be trialled across settings for 4 weeks.",
    triggers: [{ id: triggerId, title: "Unplanned transitions", description: "Sudden changes to the expected routine." }],
    settingEvents: [{ id: settingEventId, title: "Poor sleep the night before", description: "Reduced tolerance for demands after a bad night." }],
    targetBehaviours: [
      { id: targetBehaviourId, name: "Elopement", operationalDefinition: "Leaving the designated area without permission.", howItPresents: "Bolting toward the door or playground gate." },
    ],
    recommendationsHome: [
      { id: id(), title: "2-minute transition warning", details: ["Give a visual countdown before ending a preferred activity."] },
    ],
    recommendationsSchool: [
      { id: id(), title: "Visual transition timer", details: ["Same countdown cue used at home, adapted for the classroom."] },
    ],
    recommendationsShared: [],
  };

  const { data: completed, error } = await supabase
    .from("fba_reports")
    .insert({
      passport_id: creds.passportId,
      clinician_id: creds.clinician.id,
      status: "completed",
      content_data: content,
    })
    .select("id")
    .single();
  if (error) throw error;

  console.log("Completed FBA id:", completed.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
