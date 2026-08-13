// Captures every screenshot for the standalone "Strategy Effectiveness"
// (Closing the Loop) feature guide. See capture-calm-guide.mjs's header
// comment for how this fits alongside the other new capture scripts.
//
// Run with: node --env-file=.env.local scripts/demo/capture-effectiveness-guide.mjs [phase]
// phase is one of: rating, teacherEod, parentCounter, clinician, county, all
import { readFileSync } from "node:fs";
import { launchPage, login, shot, goto, waitForText } from "./lib.mjs";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));

async function phaseRating(page) {
  console.log("== The Calm exit rating (shared with the Calm guide) ==");
  await login(page, creds.parentHero.email, creds.demoPassword);
  await goto(page, "/calm");
  await waitForText(page, "Calm Cards");
  await page.getByRole("button", { name: /Something's building/ }).click();
  await waitForText(page, "What's going on?");
  await page.getByRole("button", { name: "Show me" }).click();
  await page.waitForTimeout(500);
  await page.getByRole("button", { name: "Leave Calm" }).click();
  await waitForText(page, "help?");
  await shot(page, "effectiveness-1.1-calm-rating-ask");
  await page.getByRole("button", { name: "Helped", exact: true }).click();
  await page.waitForTimeout(300);
}

async function phaseTeacherEod(page) {
  console.log("== Teacher EOD strategy-rating step ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, `/teacher/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Classroom Profile");
  await page.getByRole("button", { name: "Complete EOD Update" }).click();
  await waitForText(page, "How is");

  await page.getByRole("button", { name: "Green", exact: false }).first().click();
  await page.getByRole("button", { name: "4", exact: true }).click();
  await page.getByRole("button", { name: "No flags today" }).click();
  await page.getByRole("button", { name: "Continue" }).click();
  await page.waitForTimeout(300);
  await page.getByRole("button", { name: "Submit Update" }).click();
  await waitForText(page, "strategies today?");
  await shot(page, "effectiveness-1.2-teacher-eod-chips");

  // Rate one, to show the reveal + checkmark state too.
  const firstChip = page.getByRole("button", { name: /Give a 2-minute transition warning/ });
  if (await firstChip.isVisible().catch(() => false)) {
    await firstChip.click();
    await page.waitForTimeout(300);
    await shot(page, "effectiveness-1.3-teacher-eod-rating-reveal");
    await page.getByRole("button", { name: "Helped", exact: true }).click();
    await page.waitForTimeout(300);
  }
}

async function phaseParentCounter(page) {
  console.log("== Parent-visible 'Helped N times' counter ==");
  await login(page, creds.parentHero.email, creds.demoPassword);
  await goto(page, "/passport/dashboard#clinical-team");
  await waitForText(page, "From your Clinical Team");
  await shot(page, "effectiveness-1.4-helped-counter", { fullPage: true, hideFixedNav: true });
}

async function phaseClinician(page) {
  console.log("== Clinician: strategy-type tagging, Effectiveness, Strategy Insights + drill-down ==");
  await login(page, creds.clinician.email, creds.demoPassword);

  await goto(page, `/clinician/fba/${creds.featureWorld.fbaId}/section/12`);
  await waitForText(page, "Recommendations");
  await shot(page, "effectiveness-2.1-strategy-type-tagging", { fullPage: true, hideFixedNav: true });

  await goto(page, `/clinician/passport/${creds.parentHero.passportId}?tab=effectiveness`);
  await waitForText(page, "Home");
  await shot(page, "effectiveness-2.2-clinical-file-effectiveness", { fullPage: true, hideFixedNav: true });

  await goto(page, "/clinician/insights");
  await waitForText(page, "Strategy Insights");
  await shot(page, "effectiveness-2.3-strategy-insights-list", { fullPage: true, hideFixedNav: true });

  await page.getByRole("button", { name: /Transition warning/ }).click();
  await page.waitForTimeout(400);
  await shot(page, "effectiveness-2.4-strategy-insights-drilldown");

  await goto(page, "/more");
  await waitForText(page, "Operating Area");
  await shot(page, "effectiveness-2.5-operating-area");
}

async function phaseCounty(page) {
  console.log("== The passport county question ==");
  await login(page, creds.parentHero.email, creds.demoPassword);
  await goto(page, "/passport/section-a");
  await waitForText(page, "county");
  await shot(page, "effectiveness-2.6-passport-county-question", { fullPage: true, hideFixedNav: true });
}

const PHASES = {
  rating: phaseRating,
  teacherEod: phaseTeacherEod,
  parentCounter: phaseParentCounter,
  clinician: phaseClinician,
  county: phaseCounty,
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
  console.log("\nEffectiveness guide capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
