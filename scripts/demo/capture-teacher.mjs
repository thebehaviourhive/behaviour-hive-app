// Captures every Teacher Guide screenshot. Run with:
//   node --env-file=.env.local scripts/demo/capture-teacher.mjs [phase]
// phase is one of: linking, dashboard, passport, eod, abc, students, more, all
import { readFileSync, copyFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { launchPage, login, shot, goto, waitForText, SCREENSHOT_DIR } from "./lib.mjs";
import path from "node:path";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// A pupil that is NOT yet linked to the teacher, so AddChildSheet's code
// entry can be captured as a genuine first-time success, not a re-add.
async function ensureUnlinkedPupil() {
  const email = "demo.parent.brennan@thebehaviourhive.com";
  const { data: list } = await supabase.auth.admin.listUsers({ perPage: 200 });
  let user = list?.users?.find((u) => u.email === email);
  if (!user) {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password: creds.demoPassword,
      email_confirm: true,
      user_metadata: { full_name: "Orla Brennan" },
      app_metadata: { role: "parent" },
    });
    if (error) throw error;
    user = data.user;
  }

  const { data: passport } = await supabase
    .from("passports")
    .upsert(
      {
        user_id: user.id,
        child_name: "Leo Brennan",
        date_of_birth: "2018-02-20",
        school: "Elmwood National School",
        diagnoses: ["Dyslexia"],
        section_a_complete: true,
        passport_status: "in_progress",
        passport_code: "LEO-4821",
        passport_code_active: true,
      },
      { onConflict: "user_id" }
    )
    .select()
    .single();

  // passport_institution_links has no real unique constraint on
  // (passport_id, institution_id) -- upsert's onConflict silently can't
  // target it, so this checks-then-writes by hand instead.
  const { data: existingLink } = await supabase
    .from("passport_institution_links")
    .select("id")
    .eq("passport_id", passport.id)
    .eq("institution_id", creds.institutionId)
    .maybeSingle();
  if (existingLink) {
    await supabase
      .from("passport_institution_links")
      .update({ approved_by_parent: true, parent_approved_at: new Date().toISOString() })
      .eq("id", existingLink.id);
  } else {
    const { error: linkError } = await supabase.from("passport_institution_links").insert({
      passport_id: passport.id,
      institution_id: creds.institutionId,
      approved_by_parent: true,
      parent_approved_at: new Date().toISOString(),
    });
    if (linkError) throw linkError;
  }
  // Idempotency: remove any existing teacher link, so this can be
  // re-captured as a fresh "first time" add every run.
  await supabase.from("passport_access").delete().eq("passport_id", passport.id).eq("teacher_id", creds.teacher.id);

  return passport;
}

async function phaseLinking(page) {
  console.log("== Role select (reused from the parent capture) + linking a pupil ==");
  copyFileSync(
    path.join(SCREENSHOT_DIR, "parent-1.3-role-select.png"),
    path.join(SCREENSHOT_DIR, "teacher-1.1-role-select.png")
  );
  console.log("  ✓ teacher-1.1-role-select (reused)");

  await ensureUnlinkedPupil();
  await login(page, creds.teacher.email, creds.demoPassword);
  await waitForText(page, "Good");

  await goto(page, "/teacher/students");
  await waitForText(page, "My Students");
  await page.getByLabel("Add a child").click();
  await waitForText(page, "Add a Child");
  await shot(page, "teacher-1.2-add-child-code-entry");

  await page.getByPlaceholder("e.g. SAM-4821").fill("LEO-4821");
  await page.getByRole("button", { name: "Add child to dashboard" }).click();
  await waitForText(page, "has been added to your dashboard");
  await shot(page, "teacher-1.3-add-child-success");
}

async function phaseDashboard(page) {
  console.log("== Dashboard + morning grid ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await waitForText(page, "Good");
  await shot(page, "teacher-2.1-dashboard-full");
  await shot(page, "teacher-2.2-stats-row");

  await goto(page, "/teacher/dashboard");
  await waitForText(page, "Good");
  const morningGrid = page.getByText("Awaiting").first();
  await morningGrid.scrollIntoViewIfNeeded().catch(() => {});
  await shot(page, "teacher-2.3-morning-grid");

  // Red-card detail bottom sheet, with the heads-up note (Zara Kelly).
  await page.getByText("Zara").click();
  await waitForText(page, "Morning Check-in");
  await shot(page, "teacher-2.4-red-card-detail");

  await goto(page, "/teacher/morning-updates");
  await waitForText(page, "Morning");
  await shot(page, "teacher-2.5-view-all-morning");
}

async function phasePassport(page) {
  console.log("== Child passport view + strategy ledger ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, `/teacher/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Classroom Profile");
  await shot(page, "teacher-3.1a-child-passport-summary");

  await page.getByRole("button", { name: "Behaviour Signals" }).click();
  await waitForText(page, "The Smoke Signals");
  await shot(page, "teacher-3.1-child-passport-behaviour-signals");

  await page.getByRole("button", { name: "+ Add to Ledger" }).click();
  await waitForText(page, "Add to Ledger");
  await shot(page, "teacher-3.2-strategy-ledger-add");
}

async function phaseEod(page) {
  console.log("== EOD wizard (Noah Fitzgerald -- no existing update today) ==");
  await login(page, creds.teacher.email, creds.demoPassword);

  const noah = creds.otherParents.find((p) => p.key === "fitzgerald");
  await supabase
    .from("teacher_updates")
    .delete()
    .eq("passport_id", noah.passportId)
    .gte("submitted_at", new Date().toISOString().slice(0, 10));

  await goto(page, `/teacher/eod/${noah.passportId}`);
  await waitForText(page, "Step 1 of 4");
  await shot(page, "teacher-4.1-eod-step1-settled");

  await page.getByText("Settled and Regulated").click();
  await waitForText(page, "Step 2 of 4");
  await shot(page, "teacher-4.2-eod-step2-energy");

  await page.getByRole("button", { name: "4", exact: true }).click();
  await waitForText(page, "Step 3 of 4");
  await shot(page, "teacher-4.3-eod-step3-flags");

  await page.getByText("No flags today").click();
  await page.getByRole("button", { name: "Continue" }).click();
  await waitForText(page, "Step 4 of 4");
  await shot(page, "teacher-4.4-eod-step4-headsup");

  await page.getByRole("button", { name: "Submit Update" }).click();
  await page.waitForTimeout(1500);
}

async function phaseAbc(page) {
  console.log("== ABC passport-select ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, "/teacher/abc-log");
  await waitForText(page, "Add Log");
  await shot(page, "teacher-5.1-abc-passport-select");
}

async function phaseStudents(page) {
  console.log("== Students page with search ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, "/teacher/students");
  await waitForText(page, "My Students");
  await page.getByPlaceholder("Search by first name").fill("Al");
  await page.waitForTimeout(400);
  await shot(page, "teacher-6.1-students-search");
}

async function phaseMore(page) {
  console.log("== More tab ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, "/more");
  await waitForText(page, "More");
  await shot(page, "teacher-7.1-more-tab");
}

const PHASES = {
  linking: phaseLinking,
  dashboard: phaseDashboard,
  passport: phasePassport,
  eod: phaseEod,
  abc: phaseAbc,
  students: phaseStudents,
  more: phaseMore,
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
  console.log("\nTeacher capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
