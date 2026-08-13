// Captures every Parent Guide screenshot except the pre-login onboarding
// screens (see capture-onboarding.mjs). Sequences live DB writes between
// screenshots so the daily card's four states, the morning check-in
// wizard, and the "approve a school" flow are all captured from the real
// running app, not faked.
//
// Run with: node --env-file=.env.local scripts/demo/capture-parent.mjs [phase]
// phase is one of: building, daily, abc, team, help, all (default: all)
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { launchPage, login, shot, goto, waitForText, freezeClock } from "./lib.mjs";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

function todayAt(hour, minute = 0) {
  const d = new Date();
  d.setHours(hour, minute, 0, 0);
  return d.toISOString();
}

function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

async function ensureInProgressAccount() {
  const email = "demo.parent.progress@thebehaviourhive.com";
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
  let user = list?.users?.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: creds.demoPassword,
      email_confirm: true,
      user_metadata: { full_name: "Emer Walshe" },
      app_metadata: { role: "parent" },
    });
    if (error) throw error;
    user = data.user;
  }

  // Section A only -- section B/C/D left untouched so the dashboard shows
  // the real "resume where you left off" state.
  await supabase.from("passports").upsert(
    {
      user_id: user.id,
      child_name: "Jack Walshe",
      date_of_birth: "2019-05-02",
      school: "Elmwood National School",
      diagnoses: ["ADHD (Attention Deficit Hyperactivity Disorder)"],
      section_a_complete: true,
      passport_status: "in_progress",
    },
    { onConflict: "user_id" }
  );

  return { email };
}

async function ensureSecondInstitution() {
  const { data: existing } = await supabase
    .from("institutions")
    .select("*")
    .eq("institution_code", "GRNF-DEMO")
    .maybeSingle();
  if (existing) return existing;
  const { data, error } = await supabase
    .from("institutions")
    .insert({ name: "Greenfield National School", institution_code: "GRNF-DEMO", status: "verified" })
    .select()
    .single();
  if (error) throw error;
  return data;
}

// Undoes the school-approval this script's own "approve a school" capture
// performs, so the script can be re-run from scratch without the
// Greenfield approval already being in place (which would break the
// "approve a school" screenshot's before/after contrast).
async function resetSecondInstitutionApproval() {
  const institution = await ensureSecondInstitution();
  await supabase
    .from("passport_institution_links")
    .delete()
    .eq("passport_id", creds.parentHero.passportId)
    .eq("institution_id", institution.id);
}

async function phaseBuilding(page) {
  const inProgress = await ensureInProgressAccount();

  console.log("== Building the passport ==");
  await login(page, inProgress.email, creds.demoPassword);
  await waitForText(page, "Good");

  await goto(page, "/passport/section-a");
  await waitForText(page, "About Your Child");
  await shot(page, "parent-2.1-section-a");

  await goto(page, "/passport/section-b/1");
  await waitForText(page, "okay");
  await shot(page, "parent-2.2-section-b");

  await goto(page, "/passport/section-c");
  await waitForText(page, "Communicates", { exact: false });
  await shot(page, "parent-2.3-section-c");

  await goto(page, "/passport/section-d/1");
  await waitForText(page, "Before a Behaviour", { exact: false });
  await shot(page, "parent-2.4-section-d");

  await goto(page, "/parent-dashboard");
  await waitForText(page, "Get started");
  await shot(page, "parent-2.5-resume-progress");

  console.log("== Finished dossier + editing ==");
  await login(page, creds.parentHero.email, creds.demoPassword);
  await waitForText(page, "Good");

  await goto(page, "/passport/dashboard");
  await waitForText(page, "Behavioural Passport");
  await shot(page, "parent-2.6-dossier-top");
  await shot(page, "parent-2.7-dossier-full", { fullPage: true });

  await goto(page, "/passport/section-b/1");
  await waitForText(page, "okay");
  await shot(page, "parent-2.8-editing-section");
}

async function phaseDaily(page) {
  console.log("== Daily card journey ==");
  await login(page, creds.parentHero.email, creds.demoPassword);

  // Idempotency: clear today's check-in/update for Alfie so the four
  // states can be captured in order every time this phase runs.
  await supabase
    .from("morning_checkins")
    .delete()
    .eq("passport_id", creds.parentHero.passportId)
    .gte("checked_in_at", startOfToday());
  await supabase
    .from("teacher_updates")
    .delete()
    .eq("passport_id", creds.parentHero.passportId)
    .gte("submitted_at", startOfToday());

  await freezeClock(page, { hour: 9, minute: 5 });
  await goto(page, "/parent-dashboard");
  await waitForText(page, "Good");
  await shot(page, "parent-3.2-daily-card-not-checked-in");

  console.log("== Morning check-in wizard (live) ==");
  await page.getByRole("link", { name: /How was.*morning/i }).click();
  await page.waitForURL(/\/morning-checkin/);
  await waitForText(page, "Step 1 of 4");
  await shot(page, "parent-4.1-morning-step1-sleep");

  await page.getByText("Slept through / Well rested").click();
  await waitForText(page, "Step 2 of 4");
  await shot(page, "parent-4.2-morning-step2-regulation");

  await page.getByText("Settled and Calm").click();
  await waitForText(page, "Step 3 of 4");
  await shot(page, "parent-4.3-morning-step3-stressors");

  await page.getByText("No disruptions (Smooth morning)").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Step 4 of 4");
  await shot(page, "parent-4.4-morning-step4-headsup");

  await page.getByRole("button", { name: "Send to teacher" }).click();
  await page.waitForURL(/\/parent-dashboard/, { timeout: 10000 });
  await waitForText(page, "Good");
  await shot(page, "parent-3.3-daily-card-checked-in");
  await shot(page, "parent-3.1-dashboard-full");
  await shot(page, "parent-3.8-quick-actions");

  console.log("== Afternoon update ==");
  await freezeClock(page, { hour: 15, minute: 5 });
  await goto(page, "/parent-dashboard");
  await waitForText(page, "Good");
  await shot(page, "parent-3.4-daily-card-waiting");

  await supabase.from("teacher_updates").insert({
    passport_id: creds.parentHero.passportId,
    teacher_id: creds.teacher.id,
    settled_state: "settled",
    energy_level: 4,
    flags: [],
    heads_up:
      "Great day! Alfie used his visual choice board twice without any prompting. He's a bit tired after PE so an early night might help.",
    submitted_at: todayAt(15, 0),
  });
  await supabase.from("activity_log").insert({
    passport_id: creds.parentHero.passportId,
    actor_id: creds.teacher.id,
    event_type: "afternoon_update",
    event_description: "End of day update from Teacher",
    created_at: todayAt(15, 0),
  });

  await goto(page, "/parent-dashboard");
  await waitForText(page, "Good");
  await shot(page, "parent-3.5-daily-card-afternoon-update");
  await shot(page, "parent-5.1-afternoon-update-closeup");
  await shot(page, "parent-3.6-recent-activity-card");
  await shot(page, "parent-3.9-your-team-card", { fullPage: true });

  await goto(page, "/parent-dashboard/activity");
  await waitForText(page, "Activity");
  await shot(page, "parent-3.7-activity-page");
}

async function phaseAbc(page) {
  console.log("== ABC log flow ==");
  await login(page, creds.parentHero.email, creds.demoPassword);

  await goto(page, "/passport/dashboard?logIncident=1");
  await waitForText(page, "Log an Incident", { timeout: 30000 });
  await shot(page, "parent-6.1-abc-step1");

  await page.getByRole("button", { name: "3", exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await waitForText(page, "What happened right before?");
  await shot(page, "parent-6.2-abc-step2");

  await page.getByText("Too loud or busy", { exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await waitForText(page, "What did they do?");
  await page.getByText("Cried or screamed", { exact: true }).click();
  await page.getByRole("button", { name: "Next" }).click();
  await waitForText(page, "What happened next?");
  await page.getByText("Comforted them", { exact: true }).click();
  await page.getByRole("button", { name: "Save ABC Log" }).click();
  await page.waitForTimeout(1500);
}

async function phaseTeam(page) {
  console.log("== Connecting your team ==");
  await resetSecondInstitutionApproval();
  await login(page, creds.parentHero.email, creds.demoPassword);

  await goto(page, "/passport/dashboard");
  await waitForText(page, "Behavioural Passport");
  await page.getByLabel("Share passport").click();
  await waitForText(page, "Share Alfie");
  await page.waitForTimeout(1000); // let the passport code finish generating
  await shot(page, "parent-7.1-share-sheet");

  await page.getByPlaceholder("e.g. BHPS0000").fill("GRNF-DEMO");
  await page.getByRole("button", { name: "Approve school access" }).click();
  await page.waitForTimeout(800);
  await shot(page, "parent-7.2-approve-school");

  await goto(page, "/passport/dashboard");
  await waitForText(page, "Manage Access");
  await page.getByText("Manage Access").scrollIntoViewIfNeeded();
  await shot(page, "parent-7.3-manage-access");

  await page.getByText("Clinical Team").scrollIntoViewIfNeeded();
  await shot(page, "parent-7.4-revoke-buttons");
}

async function phaseHelp(page) {
  console.log("== Help & Support ==");
  await goto(page, "/forgot-password");
  await waitForText(page, "Reset your password");
  await shot(page, "parent-8.1-forgot-password");

  await login(page, creds.parentHero.email, creds.demoPassword);
  await goto(page, "/more");
  await waitForText(page, "More");
  await shot(page, "parent-8.2-more-tab");
}

const PHASES = {
  building: phaseBuilding,
  daily: phaseDaily,
  abc: phaseAbc,
  team: phaseTeam,
  help: phaseHelp,
};

async function main() {
  const requested = process.argv[2] || "all";
  const toRun = requested === "all" ? Object.keys(PHASES) : [requested];

  const { browser, page } = await launchPage();
  for (const name of toRun) {
    if (!PHASES[name]) throw new Error(`Unknown phase: ${name}`);
    await PHASES[name](page);
  }
  await browser.close();
  console.log("\nParent capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
