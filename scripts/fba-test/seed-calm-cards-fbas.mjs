// Seeds two fba_reports for the standard fbatest passport -- one draft,
// one completed -- with real triggers/setting events/target behaviours/
// recommendations content, so the Calm Card authoring UI (Stage 1B) can
// be live-verified on both a draft FBA (normal authoring) and a
// completed one (the retro-add path).
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-calm-cards-fbas.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function id() {
  return crypto.randomUUID();
}

function buildContent() {
  const triggerId = id();
  const settingEventId = id();
  const targetBehaviourId = id();
  return {
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
}

async function main() {
  const draftContent = buildContent();
  const completedContent = buildContent();

  const { data: draft, error: draftError } = await supabase
    .from("fba_reports")
    .insert({
      passport_id: creds.passportId,
      clinician_id: creds.clinician.id,
      status: "in_progress",
      content_data: draftContent,
    })
    .select("id")
    .single();
  if (draftError) throw draftError;

  const { data: completed, error: completedError } = await supabase
    .from("fba_reports")
    .insert({
      passport_id: creds.passportId,
      clinician_id: creds.clinician.id,
      status: "completed",
      content_data: completedContent,
    })
    .select("id")
    .single();
  if (completedError) throw completedError;

  console.log("Draft FBA id:", draft.id);
  console.log("Completed FBA id:", completed.id);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
