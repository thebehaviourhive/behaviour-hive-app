// Stage 3 seed extension: run AFTER seed.mjs. Adds morning_checkins +
// teacher_updates across the same 8-day window as the existing ABC logs
// (for Daily Patterns panel verification), and creates a fba_reports
// draft row with content_data populated for all 14 sections so the
// finalize flow, reader view, extraction, and PDF export all have real
// content to render -- not just the bare minimum to pass the completion
// gate. Status is deliberately left as "in_progress": finalizing is done
// live through the clinician UI, since that's the exact flow under test.
//
// Run with: node --env-file=.env.local scripts/fba-test/seed-stage3.mjs

import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const creds = JSON.parse(readFileSync(new URL("./.credentials.json", import.meta.url)));

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function daysAgoIso(n, hour, minute) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function main() {
  console.log("== Morning check-ins (parent, days ago 8..1) ==");
  const { data: existingCheckins } = await supabase
    .from("morning_checkins")
    .select("id")
    .eq("passport_id", creds.passportId)
    .limit(1);
  if (existingCheckins?.length) {
    console.log("  (already seeded, skipping)");
  } else {
    const states = ["settled", "settled", "unsettled", "settled", "dysregulated", "settled", "unsettled", "settled"];
    for (let i = 8; i >= 1; i--) {
      const state = states[8 - i];
      const { error } = await supabase.from("morning_checkins").insert({
        passport_id: creds.passportId,
        user_id: creds.parent.id,
        checked_in_at: daysAgoIso(i, 7, 30),
        submitted_at: daysAgoIso(i, 7, 30),
        sleep_quality: state === "dysregulated" ? "very_restless" : "slept_through",
        regulation_state: state,
        morning_stressors: state === "dysregulated" ? ["Change of routine"] : [],
        heads_up: i === 5 ? "Big change of routine this morning -- new bus driver." : null,
      });
      if (error) throw new Error(`morning_checkins insert: ${error.message}`);
    }
    console.log("  seeded 8 morning check-ins");
  }

  console.log("== Teacher EOD updates (teacher, days ago 8..1) ==");
  const { data: existingUpdates } = await supabase
    .from("teacher_updates")
    .select("id")
    .eq("passport_id", creds.passportId)
    .limit(1);
  if (existingUpdates?.length) {
    console.log("  (already seeded, skipping)");
  } else {
    const states = ["settled", "unsettled", "settled", "settled", "dysregulated", "unsettled", "settled", "settled"];
    const flagSets = [
      [],
      ["Struggled at transitions"],
      [],
      ["Struggled at transitions"],
      ["Struggled at transitions", "Sensory seeking"],
      ["Sensory seeking"],
      [],
      [],
    ];
    for (let i = 8; i >= 1; i--) {
      const idx = 8 - i;
      const { error } = await supabase.from("teacher_updates").insert({
        passport_id: creds.passportId,
        teacher_id: creds.teacher.id,
        submitted_at: daysAgoIso(i, 15, 45),
        settled_state: states[idx],
        energy_level: 3,
        flags: flagSets[idx],
        heads_up: i === 6 ? "Really good afternoon after a rocky start." : null,
      });
      if (error) throw new Error(`teacher_updates insert: ${error.message}`);
    }
    console.log("  seeded 8 teacher EOD updates");
  }

  console.log("== FBA report (draft, rich content_data) ==");
  const { data: existingFba } = await supabase
    .from("fba_reports")
    .select("id, content_data")
    .eq("passport_id", creds.passportId)
    .maybeSingle();

  const contentData = {
    reportDate: new Date().toISOString().slice(0, 10),
    clinicalOverview:
      "Test Child FBA presents with escape- and sensory-maintained behaviours occurring primarily during task demands and unstructured, high-stimulation periods. Assessment drew on direct observation, ABC data across home and school, and indirect caregiver/teacher report.",
    introductionHistory:
      "Referral was made following an increase in vocal outbursts and physical aggression at school over the preceding term, alongside more frequent dysregulated mornings reported at home.",
    targetBehaviours: [
      {
        title: "Vocal outbursts",
        description: "Shouting, screaming, or crying that disrupts the current activity for 1-5 minutes.",
      },
      {
        title: "Physical aggression",
        description: "Hitting, grabbing, or throwing objects toward another person during task demands.",
      },
    ],
    triggers: [
      { title: "Task demand placed", description: "Non-preferred academic or self-care task requested." },
      { title: "Denied access to item or activity", description: "Preferred item/activity withheld or ends." },
    ],
    settingEvents: [
      { title: "Poor sleep", description: "Behaviours are markedly more frequent following a restless night." },
      { title: "Change of routine", description: "Unplanned schedule changes increase baseline anxiety." },
    ],
    hypothesisedFunctions:
      "Behaviours most consistently function to escape or delay non-preferred task demands, with a secondary sensory/self-regulation function evident during unstructured or high-stimulation periods.",
    consentAssentSocialValidity:
      "Consent obtained from parent/guardian prior to assessment. Assent was sought throughout via choice-making during direct observation sessions. Findings were shared informally with the family at each stage.",
    recommendationsHome: [
      { title: "Visual first-then board", details: ["Use a first-then visual before non-preferred tasks.", "Pair with a preferred activity immediately after."] },
    ],
    recommendationsSchool: [
      { title: "Movement breaks", details: ["Offer a 2-minute movement break before extended seated tasks.", "Pre-warn transitions 5 minutes ahead."] },
    ],
    recommendationsShared: [
      { title: "Consistent language", details: ["Use the same first-then phrasing across home and school.", "Log any escalation using the shared ABC tool."] },
    ],
    conclusion:
      "This assessment supports an escape-maintained function as primary, with sensory/self-regulation as a secondary contributing function. Recommendations above should be trialled for 6-8 weeks with review via a follow-up ABC data pull.",
  };

  let fbaId;
  if (existingFba) {
    fbaId = existingFba.id;
    const { error } = await supabase
      .from("fba_reports")
      .update({ content_data: { ...existingFba.content_data, ...contentData }, status: "in_progress" })
      .eq("id", fbaId);
    if (error) throw new Error(`fba_reports update: ${error.message}`);
    console.log("  updated existing fba_reports row:", fbaId);
  } else {
    const { data, error } = await supabase
      .from("fba_reports")
      .insert({
        passport_id: creds.passportId,
        clinician_id: creds.clinician.id,
        status: "in_progress",
        content_data: contentData,
      })
      .select()
      .single();
    if (error) throw new Error(`fba_reports insert: ${error.message}`);
    fbaId = data.id;
    console.log("  created fba_reports row:", fbaId);
  }

  console.log("== AFLS data (partial scores across a couple of domains) ==");
  const { data: instrumentRows } = await supabase
    .from("fba_instruments")
    .select("items")
    .eq("instrument_type", "afls")
    .eq("is_active", true);
  const scoresData = {};
  if (instrumentRows?.length) {
    const byDomain = {};
    for (const row of instrumentRows) {
      for (const item of row.items) {
        const domain = item.category ?? "Other";
        byDomain[domain] = byDomain[domain] ? [...byDomain[domain], item] : [item];
      }
    }
    const domains = Object.keys(byDomain).slice(0, 2);
    for (const domain of domains) {
      scoresData[domain] = byDomain[domain].map((item, idx) => ({
        itemId: item.id,
        score: idx % 3 === 0 ? "independent" : idx % 3 === 1 ? "assisted" : "unable",
      }));
    }
  }
  const { data: existingAfls } = await supabase.from("fba_afls_data").select("id").eq("fba_id", fbaId).maybeSingle();
  if (existingAfls) {
    const { error } = await supabase
      .from("fba_afls_data")
      .update({ scores_data: scoresData, summary: "Broadly independent in communication; more support needed for community/safety domains." })
      .eq("id", existingAfls.id);
    if (error) throw new Error(`fba_afls_data update: ${error.message}`);
  } else {
    const { error } = await supabase.from("fba_afls_data").insert({
      fba_id: fbaId,
      scores_data: scoresData,
      summary: "Broadly independent in communication; more support needed for community/safety domains.",
    });
    if (error) throw new Error(`fba_afls_data insert: ${error.message}`);
  }
  console.log(`  scored ${Object.keys(scoresData).length} AFLS domain(s)`);

  console.log("\n== Stage 3 seed complete ==");
  console.log(JSON.stringify({ fbaId }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
