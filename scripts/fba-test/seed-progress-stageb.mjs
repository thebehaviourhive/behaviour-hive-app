// Stage B live-verification seed: ABC incidents + two batches of
// passport_clinical_content (strategy marker dates) for the standard
// fbatest passport. Run with:
//   node --env-file=.env.local scripts/fba-test/seed-progress-stageb.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

const PARENT_ANTECEDENTS = ["Asked them to do something", "Change of plan", "Told them no", "Too loud or busy"];
const TEACHER_ANTECEDENTS = ["Task demand placed", "Transition to new activity", "Denied access to item or activity", "Sensory overload"];
const PARENT_BEHAVIOURS = ["Hit, kicked, or bit", "Ran away or hid", "Cried or screamed", "Threw or broke things"];
const TEACHER_BEHAVIOURS = ["Physical aggression", "Elopement (leaving area)", "Vocal outburst", "Property destruction"];
const PARENT_CONSEQUENCES = ["Stopped asking them to do the task", "Comforted them", "Ignored it", "Gave them the item they wanted"];
const TEACHER_CONSEQUENCES = ["Task removed or delayed", "1:1 attention given", "Planned ignoring", "Access to tangible provided"];
const FUNCTIONS = ["escape", "attention", "tangible", "sensory"];

function pick(arr, i) {
  return arr[i % arr.length];
}

async function main() {
  const rows = [];
  // 30 incidents over the last 45 days, alternating parent/teacher/clinician
  // authorship (weekdays only for teacher/clinician, any day for parent),
  // deterministic by index so re-runs are idempotent in shape (not in id).
  for (let i = 0; i < 30; i++) {
    const dayOffset = 2 + i * 1.4; // spreads across ~45 days
    const d = daysAgo(Math.round(dayOffset));
    const dow = d.getDay();
    const roleIdx = i % 3;
    const isWeekday = dow !== 0 && dow !== 6;
    const role = roleIdx === 0 ? "parent" : isWeekday ? (roleIdx === 1 ? "class_teacher" : "clinician") : "parent";
    const authorId = role === "parent" ? creds.parent.id : role === "class_teacher" ? creds.teacher.id : creds.clinician.id;
    const antecedents = role === "parent" ? [pick(PARENT_ANTECEDENTS, i)] : [pick(TEACHER_ANTECEDENTS, i)];
    const behaviours = role === "parent" ? [pick(PARENT_BEHAVIOURS, i)] : [pick(TEACHER_BEHAVIOURS, i)];
    const consequences = role === "parent" ? [pick(PARENT_CONSEQUENCES, i)] : [pick(TEACHER_CONSEQUENCES, i)];
    const perceivedFunction = role === "parent" ? null : pick(FUNCTIONS, i);

    rows.push({
      passport_id: creds.passportId,
      logged_by: authorId,
      logged_by_role: role,
      incident_date: d.toISOString().slice(0, 10),
      incident_time: "10:30:00",
      duration_minutes: 5 + (i % 4) * 5,
      intensity: 1 + (i % 5),
      antecedents,
      behaviours,
      consequences,
      perceived_function: perceivedFunction,
      general_notes: null,
      is_draft: false,
      sync_status: "synced",
    });
  }

  const { error: abcError } = await supabase.from("abc_logs").insert(rows);
  if (abcError) throw abcError;
  console.log(`Seeded ${rows.length} ABC incidents (days ~2-45 ago).`);

  // Two distinct strategy-publication batches, so "multiple dates =
  // multiple markers" is genuinely exercisable: an older batch (~25 days
  // ago, mixed item types including strategy_home which stays
  // parent/clinician-only) and a recent one (~8 days ago, teacher-visible
  // types only).
  const olderDate = daysAgo(25).toISOString();
  const recentDate = daysAgo(8).toISOString();
  const fakeFbaId = "00000000-0000-4000-8000-000000000001";

  const contentRows = [
    {
      passport_id: creds.passportId,
      author_id: creds.clinician.id,
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeFbaId,
      item_type: "strategy_home",
      content: { title: "Offer a 2-minute warning before transitions", description: "Give a visual or verbal countdown before asking them to stop a preferred activity." },
      created_at: olderDate,
    },
    {
      passport_id: creds.passportId,
      author_id: creds.clinician.id,
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeFbaId,
      item_type: "trigger",
      content: { title: "Unplanned transitions", description: "Sudden changes to the expected routine." },
      created_at: olderDate,
    },
    {
      passport_id: creds.passportId,
      author_id: creds.clinician.id,
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeFbaId,
      item_type: "strategy_school",
      content: { title: "Visual transition timer at the front of the classroom", description: "Same countdown cue used at home, adapted for the classroom." },
      created_at: recentDate,
    },
    {
      passport_id: creds.passportId,
      author_id: creds.clinician.id,
      author_role: "clinician",
      source_document_type: "fba_report",
      source_document_id: fakeFbaId,
      item_type: "strategy_shared",
      content: { title: "Consistent countdown language", description: "\"2 more minutes, then...\" used identically at home and school." },
      created_at: recentDate,
    },
  ];

  const { error: contentError } = await supabase.from("passport_clinical_content").insert(contentRows);
  if (contentError) throw contentError;
  console.log(`Seeded ${contentRows.length} passport_clinical_content rows across 2 dates (25 and 8 days ago).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
