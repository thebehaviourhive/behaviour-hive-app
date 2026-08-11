// Throwaway seed for the AFLS Results Display redesign verification.
// Run AFTER seed.mjs. Temporarily patches the (shared, global)
// fba_instruments AFLS item text with realistic full-sentence phrasing
// for a real legibility check -- the original generated placeholder
// text ("Self-Management Item 1", etc., from migration 0040) is saved
// to .afls-item-backup.json and restored by restore-afls-items.mjs.
//
// Creates an fba_reports + fba_afls_data row with deliberately mixed
// coverage: one fully-scored mixed domain, one all-independent, one
// partial, one heavy-N/A, one fully unscored, per the verify checklist.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-afls-results.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync, writeFileSync } from "node:fs";

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));
const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Representative, realistic-length AFLS-style item phrasing (generic
// adaptive/daily-living-skills wording, not copied from any specific
// published instrument) -- long enough to stress-test wrap/legibility.
const REALISTIC_TEXT = {
  "Self-Management": [
    "Follows a visual or written daily schedule with minimal prompting",
    "Transitions between activities without significant distress",
    "Tolerates changes to routine when given advance warning",
    "Manages personal belongings and keeps them organised",
    "Requests a break when feeling overwhelmed, using words or a chosen signal",
    "Completes a multi-step task independently once instructions are given",
    "Recognises and names their own emotional state in the moment",
    "Uses a calming strategy independently when distressed",
  ],
  "Basic Communication": [
    "Initiates communication to request a preferred item or activity",
    "Responds appropriately when their name is called",
    "Uses appropriate greetings when meeting familiar people",
    "Asks for help using words, signs, or an AAC device",
    "Answers simple yes/no questions accurately",
    "Follows a two-step verbal instruction without repetition",
    "Comments spontaneously on something of interest",
    "Waits for their turn in a conversation without interrupting",
  ],
  Dressing: [
    "Puts on a pullover top independently, front facing the right way",
    "Fastens buttons on a shirt or cardigan without assistance",
    "Selects weather-appropriate clothing when given options",
    "Puts on socks and shoes independently, including fastenings",
    "Removes clothing items independently before bathing",
    "Manages a zip on a jacket or trousers without help",
    "Distinguishes the front and back of clothing correctly",
    "Dresses within a reasonable time frame without prompting",
  ],
  Toileting: [
    "Indicates the need to use the toilet before an accident occurs",
    "Uses the toilet independently, including wiping",
    "Washes and dries hands thoroughly after toileting",
    "Manages clothing before and after using the toilet",
    "Uses public or unfamiliar toilets with minimal support",
    "Stays dry overnight without needing a reminder",
    "Flushes the toilet and leaves the area tidy",
    "Recognises and responds to the physical sensation of needing the toilet",
  ],
  Grooming: [
    "Brushes teeth thoroughly for an appropriate length of time",
    "Washes hands and face independently when prompted",
    "Brushes or combs hair independently",
    "Applies deodorant appropriately once introduced to puberty",
    "Trims or files nails with supervision",
    "Blows and wipes their own nose when needed",
    "Recognises when grooming is needed (e.g. messy hair, dirty face)",
    "Maintains grooming routines without ongoing reminders",
  ],
  Bathing: [
    "Washes their body thoroughly and in the correct order",
    "Washes and rinses hair independently",
    "Regulates water temperature safely with supervision",
    "Dries themselves thoroughly after bathing",
    "Tolerates the sensory experience of showering or bathing",
    "Uses bathing products (soap, shampoo) in appropriate amounts",
    "Manages getting in and out of the bath or shower safely",
    "Completes a full bathing routine within a reasonable time",
  ],
  "Health/Safety & First Aid": [
    "Recognises unsafe situations and responds appropriately",
    "Knows their own name, address, and an emergency contact",
    "Understands the concept of stranger danger in context",
    "Follows basic pedestrian safety rules when crossing roads",
    "Takes prescribed medication with supervision and no resistance",
    "Reports pain, injury, or illness to a trusted adult",
    "Understands and follows fire/emergency evacuation procedures",
    "Uses tools and equipment safely under supervision",
  ],
  "Nighttime Routines": [
    "Settles into bed independently at an appropriate time",
    "Follows a consistent bedtime routine with minimal prompting",
    "Falls asleep independently without a parent present",
    "Sleeps through the night without frequent waking",
    "Manages nighttime toileting independently if needed",
    "Tolerates the bedroom environment (lighting, sound) calmly",
    "Uses a comfort object or strategy to self-soothe at bedtime",
    "Wakes and gets up independently at a consistent time",
  ],
};

async function main() {
  console.log("== Backing up + patching AFLS item text for a realistic legibility check ==");
  const { data: rows, error: fetchError } = await supabase
    .from("fba_instruments")
    .select("id, items")
    .eq("instrument_type", "afls")
    .eq("is_active", true);
  if (fetchError) throw fetchError;

  writeFileSync(new URL("./.afls-item-backup.json", import.meta.url), JSON.stringify(rows, null, 2));
  console.log(`  backed up ${rows.length} rows to .afls-item-backup.json`);

  for (const row of rows) {
    const domain = row.items[0]?.category;
    const realistic = REALISTIC_TEXT[domain];
    if (!realistic) continue;
    const patchedItems = row.items.map((item, i) => ({ ...item, text: realistic[i] ?? item.text }));
    const { error } = await supabase.from("fba_instruments").update({ items: patchedItems }).eq("id", row.id);
    if (error) throw error;
  }
  console.log("  patched item text for all 8 domains");

  console.log("== FBA report ==");
  const { data: existingFba } = await supabase
    .from("fba_reports")
    .select("id")
    .eq("passport_id", creds.passportId)
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

  console.log("== Mixed AFLS scores (per the verify checklist) ==");
  const { data: instrumentRows } = await supabase
    .from("fba_instruments")
    .select("items")
    .eq("instrument_type", "afls")
    .eq("is_active", true);
  const idsByDomain = {};
  for (const row of instrumentRows) {
    const domain = row.items[0]?.category;
    if (domain) idsByDomain[domain] = row.items.map((i) => i.id);
  }

  function scoresFor(domain, pattern) {
    const ids = idsByDomain[domain] ?? [];
    return ids.map((itemId, i) => ({ itemId, score: pattern[i % pattern.length] })).filter((s) => s.score !== null);
  }

  const scoresData = {
    // Fully scored, mixed states.
    "Self-Management": scoresFor("Self-Management", ["independent", "assisted", "independent", "unable", "independent", "assisted", "na", "independent"]),
    // Fully independent.
    "Basic Communication": scoresFor("Basic Communication", ["independent"]),
    // Partial: half scored, half unscored.
    Dressing: scoresFor("Dressing", ["independent", "assisted", "unable", "independent", null, null, null, null]),
    // Heavy N/A.
    Toileting: scoresFor("Toileting", ["na", "na", "na", "na", "na", "independent", "na", "assisted"]),
    // Fully unscored -- no entry at all for this domain.
    Grooming: [],
    // Mixed, unable-heavy.
    Bathing: scoresFor("Bathing", ["unable", "assisted", "unable", "independent", "unable", "assisted", "unable", "na"]),
    "Health/Safety & First Aid": scoresFor("Health/Safety & First Aid", ["independent", "independent", "assisted", "na", "independent", "unable", "assisted", "independent"]),
    "Nighttime Routines": scoresFor("Nighttime Routines", ["assisted", "independent", "na", "unable", "independent", "assisted", "independent", "na"]),
  };

  const summary =
    "Overall a mixed profile: strong independence in communication and self-management, with more significant support needs in bathing and several unscored items in Grooming pending a follow-up observation session at home.";

  const { data: existingAfls } = await supabase.from("fba_afls_data").select("id").eq("fba_id", fbaId).maybeSingle();
  if (existingAfls) {
    const { error } = await supabase
      .from("fba_afls_data")
      .update({ scores_data: scoresData, summary })
      .eq("id", existingAfls.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("fba_afls_data").insert({ fba_id: fbaId, scores_data: scoresData, summary });
    if (error) throw error;
  }
  console.log("  AFLS scores + summary written");

  console.log("\n== Done ==");
  console.log(JSON.stringify({ fbaId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
