// Extends the seeded history further back (days 40-100 ago) so the
// PREVIOUS-period comparison for 30/90-day ranges also clears the
// density threshold -- proving comparePeriods() actually unlocks with
// two genuinely rich periods, not just one.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-progress-extend.mjs

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

function stateForDay(dayOfWeek, dayIndex) {
  const cycle = dayIndex % 10;
  if (dayOfWeek === 1) return cycle < 5 ? "unsettled" : "settled"; // rougher period than the recent one
  if (dayOfWeek === 3) return "settled";
  if (cycle === 6) return "unsettled";
  return "settled";
}

async function main() {
  const rows_checkins = [];
  const rows_updates = [];

  for (let i = 40; i < 100; i++) {
    const d = daysAgo(i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue;
    const state = stateForDay(dow, i);
    const iso = d.toISOString();
    rows_checkins.push({
      passport_id: creds.passportId,
      user_id: creds.parent.id,
      checked_in_at: iso,
      submitted_at: iso,
      sleep_quality: "slept_through",
      regulation_state: state,
      morning_stressors: [],
    });
    rows_updates.push({
      passport_id: creds.passportId,
      teacher_id: creds.teacher.id,
      settled_state: state,
      energy_level: 3,
      flags: state === "settled" ? [] : ["Tired"],
      submitted_at: new Date(d.getTime() + 8 * 3600 * 1000).toISOString(),
    });
  }

  const { error: e1 } = await supabase.from("morning_checkins").insert(rows_checkins);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("teacher_updates").insert(rows_updates);
  if (e2) throw e2;

  console.log(`Extended with ${rows_checkins.length} more check-ins/updates (days 40-99 ago).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
