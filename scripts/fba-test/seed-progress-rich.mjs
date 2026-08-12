// Seeds ~35 days of realistic morning_checkins + teacher_updates for the
// fbatest.parent/teacher passport, for live-verifying the Progress
// feature (Stage A): rich enough to clear the density threshold at all
// four ranges and exercise a real day-of-week pattern (Mondays skewed
// tougher, Wednesdays skewed better) and a genuine streak.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-progress-rich.mjs

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
function isoDate(d) {
  return d.toISOString().slice(0, 10);
}

function stateForDay(dayOfWeek, dayIndex) {
  // Monday(1) skewed tough, Wednesday(3) skewed settled, otherwise mostly
  // settled with occasional unsettled/rare dysregulated -- deterministic
  // (seeded by dayIndex, not Math.random()) so re-running produces the
  // exact same distribution for repeatable verification.
  const cycle = dayIndex % 10;
  if (dayOfWeek === 1) return cycle < 6 ? "unsettled" : cycle === 9 ? "dysregulated" : "settled";
  if (dayOfWeek === 3) return "settled";
  if (cycle === 7) return "unsettled";
  if (cycle === 8 && dayOfWeek === 5) return "dysregulated";
  return "settled";
}

async function main() {
  const rows_checkins = [];
  const rows_updates = [];

  // Last 3 days deliberately left OUT to leave today/yesterday free for
  // a live "current streak" check-in during verification, and so the
  // 7-day range still clears the >=4-day threshold (4 of the last 7).
  for (let i = 3; i < 38; i++) {
    const d = daysAgo(i);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // weekdays only -- school days
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
    // Afternoon EOD -- usually mirrors morning, occasionally recovers
    // (a settled afternoon after an unsettled morning), never invented
    // beyond the two real states this table supports.
    const afternoonState = state === "dysregulated" && i % 4 === 0 ? "unsettled" : state;
    rows_updates.push({
      passport_id: creds.passportId,
      teacher_id: creds.teacher.id,
      settled_state: afternoonState,
      energy_level: 3,
      flags: afternoonState === "settled" ? [] : ["Tired"],
      submitted_at: new Date(d.getTime() + 8 * 3600 * 1000).toISOString(),
    });
  }

  const { error: e1 } = await supabase.from("morning_checkins").insert(rows_checkins);
  if (e1) throw e1;
  const { error: e2 } = await supabase.from("teacher_updates").insert(rows_updates);
  if (e2) throw e2;

  console.log(`Seeded ${rows_checkins.length} morning check-ins and ${rows_updates.length} teacher updates.`);
  console.log("Date range:", isoDate(daysAgo(37)), "to", isoDate(daysAgo(3)));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
