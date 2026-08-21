// Throwaway seed for verifying the AFLS cell colour-coding change
// (traffic-light: peach/red/light-green/dark-green). Targets the
// CURRENT schema (migration 0060's afls_assessments.scores, numeric
// per-task 0..maxScore or "NA") -- unlike the stale
// seed-afls-results.mjs in this same folder, which still targets the
// long-dropped fba_afls_data table.
//
// Deliberately covers every state the hand-check needs: a 0-2 task
// scored 0/1/2 and a 0-4 task scored 0/1/2/3/4, plus NA and unscored,
// all within the first domain (Self-Management) so one screenshot at
// 375px shows every colour at once.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-afls-cell-colors.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function main() {
  console.log("== FBA report ==");
  const { data: existingFba } = await supabase
    .from("fba_reports")
    .select("id")
    .eq("passport_id", creds.passportId)
    .eq("status", "in_progress")
    .maybeSingle();
  let fbaId = existingFba?.id;
  if (!fbaId) {
    const { data, error } = await supabase
      .from("fba_reports")
      .insert({
        passport_id: creds.passportId,
        clinician_id: creds.clinician.id,
        status: "in_progress",
        content_data: { reportDate: new Date().toISOString().slice(0, 10) },
      })
      .select()
      .single();
    if (error) throw error;
    fbaId = data.id;
  }
  console.log("  fba_id:", fbaId);

  console.log("== Item bank ==");
  const { data: instrumentRows, error: bankError } = await supabase
    .from("fba_instruments")
    .select("items")
    .eq("instrument_type", "afls")
    .eq("is_active", true);
  if (bankError) throw bankError;

  // Pooled across ALL domains, not just one -- `scores` is flat by task
  // code regardless of which domain it belongs to, and no single
  // domain has 5+ max-4 items, so this spreads the hand-check across
  // whichever domains actually have the tasks (still all visible on
  // one results-grid screen).
  const allItems = instrumentRows.flatMap((row) => row.items);
  const max2 = allItems.filter((i) => i.maxScore === 2);
  const max4 = allItems.filter((i) => i.maxScore === 4);
  if (max2.length < 3 || max4.length < 5) {
    throw new Error(`Not enough items to cover every tier -- max2=${max2.length}, max4=${max4.length}`);
  }

  const scores = {};
  // 0-2 scale: cover 0 (red), 1 (light green), 2 (dark green).
  scores[max2[0].id] = 0;
  scores[max2[1].id] = 1;
  scores[max2[2].id] = 2;
  // 0-4 scale: cover 0 (red), 1/2/3 (light green), 4 (dark green).
  scores[max4[0].id] = 0;
  scores[max4[1].id] = 1;
  scores[max4[2].id] = 2;
  scores[max4[3].id] = 3;
  scores[max4[4].id] = 4;
  // NA on one more item, distinct from everything already used.
  const used = new Set(Object.keys(scores));
  const naCandidate = allItems.find((i) => !used.has(i.id));
  if (naCandidate) scores[naCandidate.id] = "NA";
  // Everything else stays unscored deliberately -- the dashed-empty
  // state needs a hand-check too.

  console.log("== AFLS assessment ==");
  const { data: existing } = await supabase.from("afls_assessments").select("id").eq("fba_id", fbaId).maybeSingle();
  let assessmentId = existing?.id;
  if (assessmentId) {
    const { error } = await supabase.from("afls_assessments").update({ scores }).eq("id", assessmentId);
    if (error) throw error;
  } else {
    const { data, error } = await supabase
      .from("afls_assessments")
      .insert({ fba_id: fbaId, assessor_name: "Test Clinician", scores })
      .select("id")
      .single();
    if (error) throw error;
    assessmentId = data.id;
  }
  console.log("  assessment_id:", assessmentId);
  console.log("  scores:", JSON.stringify(scores, null, 2));

  console.log("\n== Done ==");
  console.log(JSON.stringify({ fbaId, assessmentId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
