// Captures every screenshot for the standalone "[Child]'s Progress"
// feature guide. See capture-calm-guide.mjs's header comment for how
// this fits alongside the other new, feature-scoped capture scripts.
//
// Run with: node --env-file=.env.local scripts/demo/capture-progress-guide.mjs [phase]
// phase is one of: parent, teacher, clinician, sparse, all
import { readFileSync } from "node:fs";
import { launchPage, login, shot, goto, waitForText } from "./lib.mjs";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));

async function phaseParent(page) {
  console.log("== Parent entry points + the full Progress surface ==");
  await login(page, creds.parentHero.email, creds.demoPassword);

  await goto(page, "/more");
  await waitForText(page, "Progress");
  await shot(page, "progress-1.1-more-entry");

  await goto(page, "/passport/progress");
  await waitForText(page, "Progress");
  await shot(page, "progress-1.2-mosaic", { fullPage: true, hideFixedNav: true });

  // Series chips + weekday view + streaks are all further down the same
  // page -- scroll captures instead of re-navigating.
  await page.getByRole("button", { name: "By weekday" }).click();
  await page.waitForTimeout(400);
  await shot(page, "progress-1.3-by-weekday", { fullPage: true, hideFixedNav: true });

  await page.getByRole("button", { name: "Over time" }).click();
  await page.waitForTimeout(400);
  // Toggle School regulation off, to show the toggle interaction itself
  // (it's off by default for parents anyway -- this documents turning
  // it ON, the more informative direction for the guide).
  const schoolChip = page.getByRole("button", { name: /School regulation/ });
  if (await schoolChip.isEnabled().catch(() => false)) {
    await schoolChip.click();
    await page.waitForTimeout(300);
  }
  await shot(page, "progress-1.4-trends-toggles", { fullPage: true, hideFixedNav: true });
}

async function phaseTeacher(page) {
  console.log("== Teacher: Progress tab inside the pupil's passport ==");
  await login(page, creds.teacher.email, creds.demoPassword);
  await goto(page, `/teacher/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Classroom Profile");
  await page.getByRole("button", { name: "Progress" }).click();
  await waitForText(page, "Progress");
  await shot(page, "progress-2.1-teacher-tab", { fullPage: true, hideFixedNav: true });
}

async function phaseClinician(page) {
  console.log("== Clinician: custom range + the clinician-only function chart ==");
  await login(page, creds.clinician.email, creds.demoPassword);
  await goto(page, `/clinician/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Clinical File");
  await page.getByRole("button", { name: "Progress", exact: true }).click();
  await waitForText(page, "Progress");

  await page.getByRole("button", { name: "Custom" }).click();
  // getByLabel proved unreliable here -- CustomDateRangeInputs' <label>
  // wraps its <input> without a `for`/`id` pair, and label-text
  // association timing raced with this render in practice (confirmed
  // present via a plain count() query even while getByLabel timed out
  // waiting for "visible"). Positional selectors on the two native date
  // inputs are exactly as specific here (this is the only date-input
  // pair on the page) and don't depend on that association at all.
  const dateInputs = page.locator("input[type=date]");
  await dateInputs.first().waitFor({ state: "visible", timeout: 15000 });
  const today = new Date();
  const start = new Date(today);
  start.setDate(start.getDate() - 29);
  const toIso = (d) => d.toISOString().slice(0, 10);
  await dateInputs.nth(0).fill(toIso(start));
  await dateInputs.nth(1).fill(toIso(today));
  await page.waitForTimeout(500);
  await shot(page, "progress-3.1-clinician-custom-range", { fullPage: true, hideFixedNav: true });
}

async function phaseSparse(page) {
  console.log("== Sparse child: the honest unlock-ladder state ==");
  await login(page, creds.featureWorld.sparseChild.email, creds.demoPassword);
  await goto(page, "/passport/progress");
  await waitForText(page, "Progress");
  await shot(page, "progress-1.5-sparse-unlock-ladder", { fullPage: true, hideFixedNav: true });
}

const PHASES = { parent: phaseParent, teacher: phaseTeacher, clinician: phaseClinician, sparse: phaseSparse };

async function main() {
  const requested = process.argv[2] || "all";
  const toRun = requested === "all" ? Object.keys(PHASES) : [requested];

  const { browser, page } = await launchPage();
  for (const name of toRun) {
    if (!PHASES[name]) throw new Error(`Unknown phase: ${name}`);
    await PHASES[name](page);
  }
  await browser.close();
  console.log("\nProgress guide capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
