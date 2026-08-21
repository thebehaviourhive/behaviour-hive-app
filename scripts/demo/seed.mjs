// Phase 1 demo-world seed script for the user-guide screenshot pipeline.
// Run with: node --env-file=.env.local scripts/demo/seed.mjs
//
// Creates a coherent demo world across all three tracks:
//   - Parent Sarah Murphy, child Alfie Byrne (fully filled passport)
//   - Teacher Aoife Ryan at "Elmwood National School", linked to 6 pupils
//     (Alfie + 5 more) in mixed morning-checkin states
//   - Clinician Dr. Emma Walsh (unverified at first -- verified later by
//     capture.mjs, mirroring the real manual-review flow), linked to Alfie
//   - ABC logs, strategy ledger entries, and activity_log history for Alfie
//
// Everything uses demo.*@thebehaviourhive.com addresses so it's instantly
// recognisable as demo data and never collides with a real account.
// Alfie's morning check-in and the teacher's afternoon update are NOT
// seeded here -- capture.mjs seeds those live, interleaved with
// screenshots, so the daily card's four states can each be captured for
// real.

import { createClient } from "@supabase/supabase-js";
import { writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !ANON_KEY) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or NEXT_PUBLIC_SUPABASE_ANON_KEY.");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = "DemoTrial-2026!";

function daysAgo(n, hour = 10, minute = 0) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

async function createUser({ email, fullName, role }) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: DEMO_PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: fullName },
    app_metadata: { role },
  });
  if (error) {
    // Idempotent re-runs: if the user already exists, look it up instead.
    if (error.message?.includes("already been registered") || error.status === 422) {
      const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
      const existing = list?.users?.find((u) => u.email === email);
      if (existing) return existing;
    }
    throw new Error(`createUser(${email}): ${error.message}`);
  }
  return data.user;
}

async function upsert(table, row, conflictCols) {
  const { data, error } = await supabase
    .from(table)
    .upsert(row, conflictCols ? { onConflict: conflictCols } : undefined)
    .select()
    .single();
  if (error) throw new Error(`${table} upsert: ${error.message}`);
  return data;
}

async function insert(table, row) {
  const { data, error } = await supabase.from(table).insert(row).select().single();
  if (error) throw new Error(`${table} insert: ${error.message}`);
  return data;
}

// upsert() needs a real unique/exclusion constraint backing its onConflict
// target -- institution_staff and passport_institution_links only have
// plain (non-unique) indexes, so this does the same "idempotent insert"
// job by hand: select on the match columns first, insert only if nothing
// found.
async function insertIfNotExists(table, match, row) {
  let query = supabase.from(table).select("*");
  for (const [col, val] of Object.entries(match)) {
    query = query.eq(col, val);
  }
  const { data: existing, error: selectError } = await query.maybeSingle();
  if (selectError) throw new Error(`${table} select: ${selectError.message}`);
  if (existing) return existing;
  return insert(table, row);
}

async function main() {
  // Populated by the "feature-guide world" phase below, either freshly
  // (first run) or by re-querying (idempotent re-run where that phase
  // detects it's already seeded) -- either way, capture scripts get a
  // real value here, never undefined.
  let featureWorldIds = null;

  console.log("== Creating institution ==");
  const { data: existingInst } = await supabase
    .from("institutions")
    .select("*")
    .eq("institution_code", "ELMW-DEMO")
    .maybeSingle();
  const institution =
    existingInst ??
    (await insert("institutions", {
      name: "Elmwood National School",
      institution_code: "ELMW-DEMO",
      status: "verified",
    }));
  console.log("institution:", institution.id);

  console.log("== Creating auth users ==");
  const teacher = await createUser({
    email: "demo.teacher.ryan@thebehaviourhive.com",
    fullName: "Aoife Ryan",
    role: "class_teacher",
  });
  const clinician = await createUser({
    email: "demo.clinician.walsh@thebehaviourhive.com",
    fullName: "Dr. Emma Walsh",
    role: "clinician",
  });

  const parentDefs = [
    { key: "murphy", email: "demo.parent.murphy@thebehaviourhive.com", fullName: "Sarah Murphy" },
    { key: "kelly", email: "demo.parent.kelly@thebehaviourhive.com", fullName: "Niamh Kelly" },
    {
      key: "fitzgerald",
      email: "demo.parent.fitzgerald@thebehaviourhive.com",
      fullName: "Conor Fitzgerald",
    },
    { key: "oconnor", email: "demo.parent.oconnor@thebehaviourhive.com", fullName: "Laura O'Connor" },
    { key: "doyle", email: "demo.parent.doyle@thebehaviourhive.com", fullName: "Padraig Doyle" },
    { key: "nolan", email: "demo.parent.nolan@thebehaviourhive.com", fullName: "Sinead Nolan" },
  ];

  const parents = {};
  for (const def of parentDefs) {
    parents[def.key] = await createUser({ email: def.email, fullName: def.fullName, role: "parent" });
    console.log(`parent ${def.key}:`, parents[def.key].id);
  }

  console.log("== Linking teacher to institution ==");
  await insertIfNotExists(
    "institution_staff",
    { institution_id: institution.id, user_id: teacher.id },
    { institution_id: institution.id, user_id: teacher.id, role: "class_teacher" }
  );

  console.log("== Creating passports ==");

  // Alfie Byrne -- the hero child, fully filled passport.
  const alfie = await upsert(
    "passports",
    {
      user_id: parents.murphy.id,
      child_name: "Alfie Byrne",
      date_of_birth: "2018-03-14",
      school: "Elmwood National School",
      important_people: "Mam (Sarah), Dad (Mark), his big sister Ruth, and his dog Buddy.",
      diagnoses: ["ASD (Autism Spectrum Disorder)", "Anxiety"],
      diagnosis_other: null,
      section_a_complete: true,
      passport_status: "complete",
    },
    "user_id"
  );

  await upsert(
    "passport_section_b",
    {
      passport_id: alfie.id,
      user_id: parents.murphy.id,
      okay_signals: ["Chatting", "Playful", "Deep Focus", "Smiling", "Interacting"],
      okay_signals_other: null,
      hard_signals: ["Covering Ears", "Pacing", "Repeating Questions", "Becoming Quiet"],
      hard_signals_other: null,
      hard_triggers: ["Noise", "Transitions", "Unclear Instructions", "Crowds"],
      hard_triggers_other: null,
      section_b_complete: true,
    },
    "user_id"
  );

  await upsert(
    "passport_section_c",
    {
      passport_id: alfie.id,
      user_id: parents.murphy.id,
      communication_methods: ["Verbal (fluent)", "Visual Choice Boards"],
      communication_methods_other: null,
      shows_happy:
        "He gets very chatty and starts telling long, detailed stories — usually about dinosaurs or his dog Buddy. He'll often want a high-five.",
      shows_anxious:
        "He goes quiet and starts repeating the same question over and over. Sometimes he'll cover his ears even if there isn't loud noise.",
      phrases_to_avoid:
        "\"Calm down\" and \"you're overreacting\" — he responds much better to being asked what he needs.",
      section_c_complete: true,
    },
    "user_id"
  );

  await upsert(
    "passport_section_d",
    {
      passport_id: alfie.id,
      user_id: parents.murphy.id,
      before_behaviour: ["Give Access to Interests", "Prepare for Change", "Use Visual Cues", "Predictability"],
      before_behaviour_other: null,
      during_distress: ["Give Space", "Use a Calm Tone", "Reduce Demands", "Has a Preferred Adult"],
      during_distress_other: null,
      after_distress: ["Reassure", "Reconnect", "Return To the Activity"],
      after_distress_other: null,
      sensory_seeks: ["Deep Pressure", "Movement (Vestibular)"],
      sensory_avoids: ["Sound", "Touch"],
      sensory_avoids_other: null,
      section_d_complete: true,
    },
    "user_id"
  );
  console.log("Alfie Byrne passport:", alfie.id);

  // The other 5 pupils -- section A only, enough to look real on the roster.
  const pupilDefs = [
    {
      key: "kelly",
      child_name: "Zara Kelly",
      dob: "2017-11-02",
      diagnoses: ["ADHD (Attention Deficit Hyperactivity Disorder)"],
    },
    {
      key: "fitzgerald",
      child_name: "Noah Fitzgerald",
      dob: "2018-06-21",
      diagnoses: ["ASD (Autism Spectrum Disorder)"],
    },
    {
      key: "oconnor",
      child_name: "Mia O'Connor",
      dob: "2017-09-09",
      diagnoses: ["Dyspraxia"],
    },
    {
      key: "doyle",
      child_name: "Cian Doyle",
      dob: "2018-01-30",
      diagnoses: ["No Formal Diagnosis"],
    },
    {
      key: "nolan",
      child_name: "Ruby Nolan",
      dob: "2017-12-15",
      diagnoses: ["ASD (Autism Spectrum Disorder)", "ADHD (Attention Deficit Hyperactivity Disorder)"],
    },
  ];

  const pupilPassports = {};
  for (const p of pupilDefs) {
    pupilPassports[p.key] = await upsert(
      "passports",
      {
        user_id: parents[p.key].id,
        child_name: p.child_name,
        date_of_birth: p.dob,
        school: "Elmwood National School",
        important_people: null,
        diagnoses: p.diagnoses,
        diagnosis_other: null,
        section_a_complete: true,
        passport_status: "in_progress",
      },
      "user_id"
    );
    console.log(`${p.child_name} passport:`, pupilPassports[p.key].id);
  }

  const allPupils = { murphy: alfie, ...pupilPassports };

  console.log("== Approving institution + granting teacher access for all 6 ==");
  for (const key of Object.keys(allPupils)) {
    const passport = allPupils[key];
    await insertIfNotExists(
      "passport_institution_links",
      { passport_id: passport.id, institution_id: institution.id },
      {
        passport_id: passport.id,
        institution_id: institution.id,
        approved_by_parent: true,
        parent_approved_at: daysAgo(10),
      }
    );
    await upsert(
      "passport_access",
      {
        passport_id: passport.id,
        teacher_id: teacher.id,
        institution_id: institution.id,
        is_active: true,
        linked_at: daysAgo(10),
      },
      "passport_id,teacher_id"
    );
  }

  console.log("== Clinician profile (created pending on first run only) ==");
  // insertIfNotExists, not upsert(): a plain upsert re-applies
  // verification_status: "pending" on EVERY run, silently un-verifying
  // the demo clinician if seed.mjs is ever re-run after
  // video/prepare.mjs (or capture-clinician.mjs's live flow) has
  // verified it -- a real footgun for anyone re-seeding before a demo.
  // This only sets the pending default the first time the row is
  // created; an existing row (verified or not) is left untouched.
  await insertIfNotExists(
    "clinicians",
    { user_id: clinician.id },
    {
      user_id: clinician.id,
      specialty: "behavioural_psychologist",
      verification_status: "pending",
      review_cadence_days: 30,
    }
  );

  console.log("== Linking Dr. Emma Walsh to Alfie ==");
  await upsert(
    "clinician_access",
    {
      passport_id: alfie.id,
      clinician_id: clinician.id,
      is_active: true,
      linked_at: daysAgo(8),
    },
    "passport_id,clinician_id"
  );

  console.log("== Seeding mixed morning check-ins (today) ==");
  const { data: existingCheckins } = await supabase
    .from("morning_checkins")
    .select("id")
    .eq("passport_id", pupilPassports.kelly.id)
    .gte("checked_in_at", todayAt(0, 0).slice(0, 10));
  if (existingCheckins?.length) {
    console.log("  (already seeded today, skipping)");
  } else {
  // Zara Kelly -- RED, with a written heads-up note.
  await insert("morning_checkins", {
    passport_id: pupilPassports.kelly.id,
    user_id: parents.kelly.id,
    checked_in_at: todayAt(8, 15),
    submitted_at: todayAt(8, 15),
    sleep_quality: "barely_slept",
    regulation_state: "dysregulated",
    morning_stressors: ["Family friction / Argument", "Rushed / Running late"],
    heads_up:
      "Zara had a rough start this morning — there was a bit of an argument getting out the door and she didn't eat breakfast. She was still upset at drop-off, so she might need some extra check-ins today.",
  });
  // Noah Fitzgerald -- AMBER.
  await insert("morning_checkins", {
    passport_id: pupilPassports.fitzgerald.id,
    user_id: parents.fitzgerald.id,
    checked_in_at: todayAt(8, 5),
    submitted_at: todayAt(8, 5),
    sleep_quality: "woke_briefly",
    regulation_state: "unsettled",
    morning_stressors: ["Refused uniform / Sensory issue"],
    heads_up: null,
  });
  // Mia O'Connor -- GREEN.
  await insert("morning_checkins", {
    passport_id: pupilPassports.oconnor.id,
    user_id: parents.oconnor.id,
    checked_in_at: todayAt(7, 50),
    submitted_at: todayAt(7, 50),
    sleep_quality: "slept_through",
    regulation_state: "settled",
    morning_stressors: [],
    heads_up: null,
  });
  // Cian Doyle -- GREEN.
  await insert("morning_checkins", {
    passport_id: pupilPassports.doyle.id,
    user_id: parents.doyle.id,
    checked_in_at: todayAt(8, 0),
    submitted_at: todayAt(8, 0),
    sleep_quality: "slept_through",
    regulation_state: "settled",
    morning_stressors: [],
    heads_up: null,
  });
  // Ruby Nolan -- AWAITING (no check-in). Alfie -- also none yet (seeded
  // live by capture.mjs so the daily-card states can be captured for real).
  }

  console.log("== Seeding ABC logs, strategy ledger, and activity_log for Alfie ==");
  const { data: existingAbc } = await supabase
    .from("abc_logs")
    .select("id")
    .eq("passport_id", alfie.id)
    .limit(1);
  if (existingAbc?.length) {
    console.log("  (already seeded, skipping)");
  } else {
  const abc1 = await insert("abc_logs", {
    passport_id: alfie.id,
    logged_by: parents.murphy.id,
    logged_by_role: "parent",
    incident_date: daysAgo(6).slice(0, 10),
    incident_time: "16:20",
    duration_minutes: 10,
    intensity: 3,
    antecedents: ["Too loud or busy"],
    behaviours: ["Cried or screamed"],
    consequences: ["Comforted them"],
    general_notes:
      "Happened at a birthday party — lots of noise and kids running around. He recovered after about ten minutes in a quiet room.",
    created_at: daysAgo(6, 16, 30),
  });
  const abc2 = await insert("abc_logs", {
    passport_id: alfie.id,
    logged_by: teacher.id,
    logged_by_role: "class_teacher",
    incident_date: daysAgo(4).slice(0, 10),
    incident_time: "11:10",
    duration_minutes: 5,
    intensity: 2,
    antecedents: ["Transition to new activity"],
    behaviours: ["Vocal outburst"],
    consequences: ["Task removed or delayed"],
    perceived_function: "escape",
    created_at: daysAgo(4, 11, 15),
  });
  const abc3 = await insert("abc_logs", {
    passport_id: alfie.id,
    logged_by: clinician.id,
    logged_by_role: "clinician",
    incident_date: daysAgo(2).slice(0, 10),
    incident_time: "14:00",
    duration_minutes: 8,
    intensity: 3,
    antecedents: ["Sensory overload"],
    behaviours: ["Vocal outburst"],
    consequences: ["Planned ignoring"],
    perceived_function: "sensory",
    clinical_notes:
      "Consistent with the sensory-seeking pattern noted in the initial assessment; recommend continued use of noise-reducing headphones during assembly.",
    created_at: daysAgo(2, 14, 10),
  });

  console.log("== Seeding strategy ledger for Alfie ==");
  const win1 = await insert("strategy_ledger", {
    passport_id: alfie.id,
    submitted_by: teacher.id,
    entry_type: "win",
    description:
      "Alfie used his visual choice board to ask for a break during maths today instead of getting upset — big progress!",
    environment: "school",
    created_at: daysAgo(5, 13, 0),
  });
  const obs1 = await insert("strategy_ledger", {
    passport_id: alfie.id,
    submitted_by: teacher.id,
    entry_type: "observation",
    description:
      "Noticed Alfie gets more unsettled right before lunch on PE days. Might be worth a snack top-up beforehand.",
    environment: "school",
    created_at: daysAgo(3, 12, 30),
  });

  console.log("== Seeding activity_log history for Alfie ==");
  const activityRows = [
    {
      passport_id: alfie.id,
      actor_id: parents.murphy.id,
      event_type: "passport_shared",
      event_description: "Passport code generated",
      created_at: daysAgo(10, 9, 0),
    },
    {
      passport_id: alfie.id,
      actor_id: teacher.id,
      event_type: "team_linked",
      event_description: "Aoife Ryan linked to passport",
      created_at: daysAgo(10, 9, 30),
    },
    {
      passport_id: alfie.id,
      actor_id: parents.murphy.id,
      event_type: "passport_updated",
      event_description: "Passport completed",
      created_at: daysAgo(9, 20, 0),
    },
    {
      passport_id: alfie.id,
      actor_id: clinician.id,
      event_type: "team_linked",
      event_description: "Dr. Emma Walsh linked to passport",
      created_at: daysAgo(8, 9, 0),
    },
    {
      passport_id: alfie.id,
      actor_id: parents.murphy.id,
      event_type: "abc_logged",
      event_description: "ABC incident logged by Parent",
      created_at: abc1.created_at,
    },
    {
      passport_id: alfie.id,
      actor_id: teacher.id,
      event_type: "strategy_logged",
      event_description: "Strategy ledger entry added by Teacher",
      created_at: win1.created_at,
    },
    {
      passport_id: alfie.id,
      actor_id: teacher.id,
      event_type: "abc_logged",
      event_description: "ABC incident logged by Teacher",
      created_at: abc2.created_at,
    },
    {
      passport_id: alfie.id,
      actor_id: teacher.id,
      event_type: "strategy_logged",
      event_description: "Strategy ledger entry added by Teacher",
      created_at: obs1.created_at,
    },
    {
      passport_id: alfie.id,
      actor_id: clinician.id,
      event_type: "abc_logged",
      event_description: "ABC incident logged by Behavioural Psychologist",
      created_at: abc3.created_at,
    },
    {
      passport_id: alfie.id,
      actor_id: clinician.id,
      event_type: "clinician_logged",
      event_description: "ABC incident logged by Behavioural Psychologist",
      created_at: abc3.created_at,
    },
  ];
  for (const row of activityRows) {
    await insert("activity_log", row);
  }
  }

  console.log("== Phase: feature-guide world (FBA, Calm Cards, ratings, Progress history, counties) ==");
  // Idempotency for this whole phase keyed on Alfie already having a
  // completed FBA -- everything below (calm cards, ratings, 30 days of
  // history) hangs off that one FBA, so its existence is the single
  // signal a re-run needs.
  const { data: existingFba } = await supabase
    .from("fba_reports")
    .select("id")
    .eq("passport_id", alfie.id)
    .eq("status", "completed")
    .maybeSingle();

  if (existingFba) {
    console.log("  (feature-guide world already seeded, skipping -- re-querying ids for capture scripts)");
    const { data: cards } = await supabase
      .from("fba_calm_cards")
      .select("id, door_type")
      .eq("fba_id", existingFba.id)
      .eq("is_published", true);
    const { data: sparse } = await supabase
      .from("passports")
      .select("id")
      .eq("child_name", "Freddie Brennan")
      .maybeSingle();
    featureWorldIds = {
      fbaId: existingFba.id,
      calmCardTransitionId: cards?.find((c) => c.door_type === "prevention")?.id ?? null,
      calmCardCalmToneId: cards?.find((c) => c.door_type === "deescalation")?.id ?? null,
      sparseChild: { email: "demo.parent.brennan@thebehaviourhive.com", passportId: sparse?.id ?? null, childName: "Freddie Brennan" },
    };
  } else {
    console.log("== Regions + counties ==");
    const { data: dublin, error: dublinError } = await supabase
      .from("regions")
      .select("id")
      .eq("country_code", "IE")
      .eq("name", "Dublin")
      .single();
    if (dublinError) throw dublinError;
    await supabase.from("passports").update({ county_id: dublin.id }).eq("id", alfie.id);
    await supabase.from("clinicians").update({ operating_counties: [dublin.id] }).eq("user_id", clinician.id);

    console.log("== Strategy types lookup ==");
    const typeLabels = ["Visual schedule", "Transition warning", "Calm adult response", "Choice-making", "Sensory/movement break"];
    const { data: types, error: typesError } = await supabase.from("strategy_types").select("id, label").in("label", typeLabels);
    if (typesError) throw typesError;
    const typeId = Object.fromEntries(types.map((t) => [t.label, t.id]));

    console.log("== Building Alfie's FBA content ==");
    const homeEntries = [
      {
        id: randomUUID(),
        title: "Visual transition timer",
        details: [
          "Show the 5-minute visual timer before ending a preferred activity.",
          "Pair with a calm verbal countdown at the 2-minute and 1-minute marks.",
        ],
        strategyType: typeId["Transition warning"],
      },
      {
        id: randomUUID(),
        title: "Offer two calm-down choices",
        details: [
          "When Alfie is getting overwhelmed, offer two concrete choices: quiet corner or headphones.",
          "Avoid open-ended 'what do you need?' in the moment -- too much to process while dysregulated.",
        ],
        strategyType: typeId["Choice-making"],
      },
      {
        id: randomUUID(),
        title: "Morning visual schedule",
        details: [
          "Use the laminated morning schedule card at breakfast.",
          "Let Alfie tick off each step himself as he completes it.",
        ],
        // Deliberately untagged -- exercises the "Untagged" grouping honestly.
      },
    ];
    const schoolEntries = [
      {
        id: randomUUID(),
        title: "Give a 2-minute transition warning",
        details: [
          "Before ending an activity, give a spoken 2-minute warning plus the visual timer.",
          "Avoid surprise transitions during PE and art -- these are his hardest transitions.",
        ],
        strategyType: typeId["Transition warning"],
      },
      {
        id: randomUUID(),
        title: "Offer a sensory break card",
        details: ["Alfie can show his break card to request 5 minutes in the quiet corner without asking verbally."],
        strategyType: typeId["Sensory/movement break"],
      },
    ];
    const sharedEntries = [
      {
        id: randomUUID(),
        title: "Calm, low tone during distress",
        details: ["Speak slowly, one short sentence at a time.", "Wait for him to respond before saying anything else."],
        strategyType: typeId["Calm adult response"],
      },
    ];

    const contentData = {
      reportDate: daysAgo(21).slice(0, 10),
      residence: "Lives at home with both parents",
      clinicalOverview:
        "Alfie presents with a well-documented pattern of escape-motivated and sensory-driven behaviour, most reliably triggered by unplanned transitions and sensory overload (noise, crowding). Baseline regulation is otherwise strong, with clear, teachable early-warning signals.",
      assessmentMethods: [
        "File review of documents",
        "Review of school and home incidents",
        "Open-Ended Functional Assessment Interview",
        "ABC Data Monitoring",
        "Home and School In-Person Observations",
      ],
      introductionHistory:
        "Alfie is an 8-year-old boy attending Elmwood National School, referred following a pattern of vocal outbursts and shutdowns around classroom transitions. Diagnosed with ASD and anxiety. Parents and teacher both describe a consistent, predictable trigger pattern.",
      targetBehaviours: [
        {
          id: randomUUID(),
          name: "Vocal outburst / shutdown during transitions",
          operationalDefinition:
            "Raised-volume vocalisations, repeated questioning, or complete withdrawal (covering ears, refusing to move) lasting 2 minutes or more.",
          howItPresents: "Most often at the end of a preferred activity, or when a transition is introduced without warning.",
        },
      ],
      coVaryingBehaviours: "Increased repetitive questioning tends to precede a full outburst by several minutes.",
      precursors: "Increased volume of speech, repeating the same question, covering ears.",
      triggers: [
        { id: randomUUID(), title: "Unplanned transitions", description: "Any change of activity introduced without advance warning." },
        { id: randomUUID(), title: "Sensory overload", description: "Loud or crowded environments, particularly assembly and the yard at break time." },
      ],
      settingEvents: [
        { id: randomUUID(), title: "Poor sleep the night before", description: "Reduces Alfie's tolerance for the same triggers the next day." },
      ],
      openEndedInterviewNotes: "Interview conducted with both parents and class teacher separately; accounts were highly consistent.",
      onSiteObservations: "Two classroom observations conducted, both during a PE-to-classroom transition.",
      communityParticipation: "Attends a Saturday football club; transitions there are supported by the same visual-timer approach.",
      abcRangeStart: daysAgo(30).slice(0, 10),
      abcRangeEnd: daysAgo(1).slice(0, 10),
      hypothesisedFunctions:
        "Primary function: escape from non-preferred transitions. Secondary function: sensory (noise/crowding) escape/avoidance.",
      consentAssentSocialValidity: "Consent obtained from both parents. Alfie was informed at an age-appropriate level and assented to the observations.",
      recommendationsHome: homeEntries,
      recommendationsSchool: schoolEntries,
      recommendationsShared: sharedEntries,
      conclusion:
        "Alfie's behaviour is highly predictable and responsive to advance warning and choice. Consistent use of the strategies above across home and school is expected to reduce both frequency and intensity of outbursts.",
      signOffName: "Dr. Emma Walsh",
      signOffCredentials: "Behavioural Psychologist",
      signOffDate: daysAgo(20).slice(0, 10),
    };

    console.log("== Creating + completing the FBA ==");
    const fbaReport = await insert("fba_reports", {
      passport_id: alfie.id,
      clinician_id: clinician.id,
      status: "in_progress",
      content_data: contentData,
    });
    // Trigger-stamped completed_at fires on this UPDATE (set_fba_reports_completed_at).
    await supabase.from("fba_reports").update({ status: "completed" }).eq("id", fbaReport.id);
    console.log("Alfie's FBA:", fbaReport.id);

    console.log("== Approving extraction as the parent (real RPC, real auth.uid()) ==");
    // approve_fba_strategies() checks owns_passport(), which resolves via
    // auth.uid() -- service role has none, so this must run as a
    // genuinely-authenticated parent session, not the admin client used
    // for everything else in this script.
    const parentClient = createClient(SUPABASE_URL, ANON_KEY);
    const { error: signInError } = await parentClient.auth.signInWithPassword({
      email: "demo.parent.murphy@thebehaviourhive.com",
      password: DEMO_PASSWORD,
    });
    if (signInError) throw signInError;
    const { data: extractedCount, error: approveError } = await parentClient.rpc("approve_fba_strategies", {
      p_fba_id: fbaReport.id,
    });
    if (approveError) throw approveError;
    console.log(`  extracted ${extractedCount} clinical content items`);
    await parentClient.auth.signOut();

    const { data: extracted, error: extractedError } = await supabase
      .from("passport_clinical_content")
      .select("id, item_type, content")
      .eq("source_document_type", "fba_report")
      .eq("source_document_id", fbaReport.id);
    if (extractedError) throw extractedError;
    const findExtracted = (itemType, entryId) =>
      extracted.find((r) => r.item_type === itemType && r.content?.source_entry_id === entryId);
    const schoolTransition = findExtracted("strategy_school", schoolEntries[0].id);
    const schoolSensory = findExtracted("strategy_school", schoolEntries[1].id);
    if (!schoolTransition || !schoolSensory) throw new Error("Extraction didn't produce the expected school strategy rows.");

    console.log("== Publishing Calm Cards (both doors, mixed publish states) ==");
    // homeEntries[0] -> published prevention-door card (gets ratings).
    const calmCardTransition = await insert("fba_calm_cards", {
      fba_id: fbaReport.id,
      strategy_ref: `recommendationsHome:${homeEntries[0].id}`,
      title: homeEntries[0].title,
      steps: [
        "Show the 5-minute visual timer where Alfie can see it.",
        "Give a calm verbal countdown at 2 minutes and 1 minute.",
        "Offer a hand for the transition if he reaches for it.",
      ],
      door_type: "prevention",
      trigger_tags: ["Transition", "Noise"],
      is_published: true,
      strategy_type_id: typeId["Transition warning"],
    });
    // sharedEntries[0] -> published deescalation-door card (sparse ratings, for the Early-signal state).
    const calmCardCalmTone = await insert("fba_calm_cards", {
      fba_id: fbaReport.id,
      strategy_ref: `recommendationsShared:${sharedEntries[0].id}`,
      title: sharedEntries[0].title,
      steps: ["Get down to his eye level.", "Speak slowly, one short sentence at a time.", "Wait for him to respond before saying anything else."],
      door_type: "deescalation",
      trigger_tags: ["Overwhelm", "Meltdown"],
      is_published: true,
      strategy_type_id: typeId["Calm adult response"],
    });
    // schoolEntries[1] -> a SECOND published deescalation-door card, so
    // that door's carousel actually has 2+ cards -- a 1-card deck has
    // nothing meaningful to show as swipe dots.
    await insert("fba_calm_cards", {
      fba_id: fbaReport.id,
      strategy_ref: `recommendationsSchool:${schoolEntries[1].id}`,
      title: schoolEntries[1].title,
      steps: [
        "Show the break card and ask if he wants to use it.",
        "Let him lead the way to the quiet corner.",
        "Give him 5 minutes before checking in.",
      ],
      door_type: "deescalation",
      trigger_tags: ["Overwhelm", "Sensory"],
      is_published: true,
      strategy_type_id: typeId["Sensory/movement break"],
    });
    // homeEntries[2] (untagged) -> unpublished draft card, so the editor shows both toggle states.
    const calmCardUntagged = await insert("fba_calm_cards", {
      fba_id: fbaReport.id,
      strategy_ref: `recommendationsHome:${homeEntries[2].id}`,
      title: homeEntries[2].title,
      steps: ["Lay the schedule card out at breakfast.", "Let Alfie tick off each step himself."],
      door_type: "prevention",
      trigger_tags: ["Morning routine"],
      is_published: false,
    });
    // homeEntries[1] deliberately gets NO card at all -- the section 12
    // editor's "+ Add Calm Card" retro-add affordance stays visible there.

    console.log("== Seeding strategy ratings (both contexts, mixed volume) ==");
    const rating = (overrides) => ({
      passport_id: alfie.id,
      context: "calm_episode",
      rater_role: "parent",
      rater_id: parents.murphy.id,
      created_at: daysAgo(Math.floor(Math.random() * 18) + 1, 17, 0),
      ...overrides,
    });
    // Home side of "Transition warning" -- via the linked calm card.
    for (const r of ["helped", "helped", "helped", "partly"]) {
      await insert("strategy_feedback", rating({ calm_card_id: calmCardTransition.id, rating: r }));
    }
    // School side of the SAME type ("Transition warning") -- combines
    // with the home ratings above under one ranked row in Strategy
    // Insights, matching the brief's own "Home X% / School Y%" shape.
    for (const r of ["helped", "helped", "helped", "not"]) {
      await insert(
        "strategy_feedback",
        rating({
          strategy_content_id: schoolTransition.id,
          context: "eod",
          rater_role: "teacher",
          rater_id: teacher.id,
          rating: r,
        })
      );
    }
    // A second, school-only type ("Sensory/movement break") -- gives the
    // ranked list a second real row.
    for (const r of ["helped", "helped", "partly", "not"]) {
      await insert(
        "strategy_feedback",
        rating({
          strategy_content_id: schoolSensory.id,
          context: "eod",
          rater_role: "teacher",
          rater_id: teacher.id,
          rating: r,
        })
      );
    }
    // "Calm adult response" -- deliberately sparse (n=2, below the n=3
    // confidence threshold) so the Early-signal state is real, not staged.
    for (const r of ["helped", "partly"]) {
      await insert("strategy_feedback", rating({ calm_card_id: calmCardCalmTone.id, rating: r }));
    }
    // homeEntries[2] ("Morning visual schedule") is deliberately untagged
    // -- rating it via its own (unpublished) card is what makes Strategy
    // Insights' "Untagged" bucket a real, populated row rather than a
    // theoretical one. A card doesn't need to be published for a direct
    // seed-time rating to be valid here (only the live parent-facing
    // Calm flow requires publish; this mirrors what a rating on it would
    // look like once it eventually is published).
    for (const r of ["helped", "helped", "partly"]) {
      await insert("strategy_feedback", rating({ calm_card_id: calmCardUntagged.id, rating: r }));
    }

    console.log("== Seeding activity_log for the FBA completion ==");
    await insert("activity_log", {
      passport_id: alfie.id,
      actor_id: clinician.id,
      event_type: "fba_completed",
      event_description: "Functional Behaviour Assessment completed by Dr. Emma Walsh",
      created_at: contentData.signOffDate,
    });

    console.log("== Seeding 30 days of Progress history for Alfie ==");
    // A repeating-but-varied regulation pattern, not a flat line -- and
    // deliberate gap days (no entry at all) so the trends chart's own
    // gap-breaking is exercised honestly rather than showing a
    // suspiciously-perfect 30-for-30 streak.
    const PATTERN = ["settled", "settled", "unsettled", "settled", "settled", "dysregulated", "settled", "settled", "unsettled", "settled"];
    for (let i = 29; i >= 1; i--) {
      if (i % 11 === 0) continue; // gap day: no morning check-in, no EOD, nothing
      const state = PATTERN[i % PATTERN.length];
      await insert("morning_checkins", {
        passport_id: alfie.id,
        user_id: parents.murphy.id,
        checked_in_at: daysAgo(i, 8, 10),
        submitted_at: daysAgo(i, 8, 10),
        sleep_quality: state === "dysregulated" ? "barely_slept" : state === "unsettled" ? "woke_briefly" : "slept_through",
        regulation_state: state,
        morning_stressors: state === "dysregulated" ? ["Rushed / Running late"] : [],
        heads_up: null,
      });
      if (i % 4 !== 0) {
        // Not every day gets an EOD update either -- honest partial coverage.
        await insert("teacher_updates", {
          passport_id: alfie.id,
          teacher_id: teacher.id,
          settled_state: state,
          energy_level: state === "dysregulated" ? 2 : state === "unsettled" ? 3 : 4,
          flags: state === "unsettled" ? ["Peer Friction"] : [],
          heads_up: null,
          submitted_at: daysAgo(i, 15, 30),
        });
      }
      if (state === "dysregulated" || (state === "unsettled" && i % 3 === 0)) {
        // Rough days plausibly also produce an ABC entry -- this is what
        // the strategy marker (from passport_clinical_content, seeded
        // above via the FBA extraction) sits alongside on the chart.
        await insert("abc_logs", {
          passport_id: alfie.id,
          logged_by: i % 2 === 0 ? parents.murphy.id : teacher.id,
          logged_by_role: i % 2 === 0 ? "parent" : "class_teacher",
          incident_date: daysAgo(i).slice(0, 10),
          incident_time: "13:45",
          duration_minutes: 8,
          intensity: state === "dysregulated" ? 4 : 2,
          antecedents: ["Transition to new activity"],
          behaviours: ["Vocal outburst"],
          consequences: ["Task removed or delayed"],
          perceived_function: "escape",
          created_at: daysAgo(i, 13, 50),
        });
      }
    }

    console.log("== Seeding a second, sparse child (honest unlock-ladder state) ==");
    const sparseParent = await createUser({
      email: "demo.parent.brennan@thebehaviourhive.com",
      fullName: "Ciara Brennan",
      role: "parent",
    });
    const freddie = await upsert(
      "passports",
      {
        user_id: sparseParent.id,
        child_name: "Freddie Brennan",
        date_of_birth: "2019-05-02",
        school: null,
        important_people: null,
        diagnoses: ["No Formal Diagnosis"],
        diagnosis_other: null,
        section_a_complete: true,
        passport_status: "in_progress",
        county_id: dublin.id,
      },
      "user_id"
    );
    // Only 3 check-ins across the last 30 days -- genuinely sparse, not
    // staged-empty, so the Progress unlock-ladder messaging is real.
    for (const i of [2, 11, 24]) {
      await insert("morning_checkins", {
        passport_id: freddie.id,
        user_id: sparseParent.id,
        checked_in_at: daysAgo(i, 8, 30),
        submitted_at: daysAgo(i, 8, 30),
        sleep_quality: "slept_through",
        regulation_state: "settled",
        morning_stressors: [],
        heads_up: null,
      });
    }
    console.log("Freddie Brennan (sparse) passport:", freddie.id);

    // Stash the new ids for the capture scripts.
    featureWorldIds = {
      fbaId: fbaReport.id,
      calmCardTransitionId: calmCardTransition.id,
      calmCardCalmToneId: calmCardCalmTone.id,
      sparseChild: { email: "demo.parent.brennan@thebehaviourhive.com", passportId: freddie.id, childName: "Freddie Brennan" },
    };
  }

  const credentials = {
    demoPassword: DEMO_PASSWORD,
    institutionId: institution.id,
    institutionCode: institution.institution_code,
    teacher: { id: teacher.id, email: "demo.teacher.ryan@thebehaviourhive.com", fullName: "Aoife Ryan" },
    clinician: {
      id: clinician.id,
      email: "demo.clinician.walsh@thebehaviourhive.com",
      fullName: "Dr. Emma Walsh",
    },
    parentHero: {
      id: parents.murphy.id,
      email: "demo.parent.murphy@thebehaviourhive.com",
      fullName: "Sarah Murphy",
      childName: "Alfie Byrne",
      passportId: alfie.id,
    },
    otherParents: parentDefs
      .filter((d) => d.key !== "murphy")
      .map((d) => ({ ...d, id: parents[d.key].id, passportId: pupilPassports[d.key].id })),
    featureWorld: featureWorldIds,
  };
  writeFileSync(
    new URL("./.demo-credentials.json", import.meta.url),
    JSON.stringify(credentials, null, 2)
  );

  console.log("\n== Seed complete ==");
  console.log("Credentials written to scripts/demo/.demo-credentials.json");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
