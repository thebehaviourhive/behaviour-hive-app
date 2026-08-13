// Captures every screenshot for the standalone "Calm Button" feature
// guide. Distinct from capture-parent/-teacher/-clinician.mjs (those
// cover the three ORIGINAL role guides) -- this and its two siblings
// (capture-progress-guide.mjs, capture-effectiveness-guide.mjs) are new,
// feature-scoped capture scripts, all writing into the same
// docs/user-guides/screenshots/ directory with a `calm-*` prefix so
// nothing collides.
//
// Run with: node --env-file=.env.local scripts/demo/capture-calm-guide.mjs [phase]
// phase is one of: locked, live, clinician, all
import { readFileSync } from "node:fs";
import { launchPage, login, shot, goto, waitForText } from "./lib.mjs";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));
const kelly = creds.otherParents.find((p) => p.key === "kelly"); // Zara Kelly -- no FBA, so Calm stays locked.

async function phaseLocked(page) {
  console.log("== Locked Calm state + unlock sheet (a child with no FBA yet) ==");
  await login(page, kelly.email, creds.demoPassword);
  await goto(page, "/parent-dashboard");
  await waitForText(page, "Good");
  await shot(page, "calm-1.1-nav-locked");

  await page.getByRole("button", { name: "Calm (locked)" }).click();
  await waitForText(page, "Unlock the Calm button");
  await shot(page, "calm-1.2-unlock-sheet");
}

async function phaseLive(page) {
  console.log("== Live Calm flow: nav, doors, tags, carousel, safety, rating, log nudge, reminder ==");
  await login(page, creds.parentHero.email, creds.demoPassword);
  await goto(page, "/parent-dashboard");
  await waitForText(page, "Good");
  await shot(page, "calm-1.3-nav-live");

  await page.getByRole("link", { name: "Calm" }).click();
  await page.waitForURL(/\/calm/);
  await waitForText(page, "Calm Cards");
  await shot(page, "calm-1.4-doors");

  await page.getByRole("button", { name: /Something's building/ }).click();
  await waitForText(page, "What's going on?");
  await shot(page, "calm-1.5-tag-chips");

  await page.getByRole("button", { name: "Show me" }).click();
  await page.waitForTimeout(500);
  await shot(page, "calm-1.6-carousel");

  // Live safety path -- "None of this helping?" is always available,
  // never gated on a threshold (constraint 3A).
  await page.getByRole("button", { name: /None of this helping/ }).click();
  await waitForText(page, "immediate danger");
  await shot(page, "calm-1.7-safety-screen");

  // Second pass through "It's happening now" (deescalation door, which
  // now has 2 published cards for real swipe dots), leaving normally
  // this time to reach the rating ask and log nudge.
  await goto(page, "/calm");
  await waitForText(page, "Calm Cards");
  await page.getByRole("button", { name: /It's happening now/ }).click();
  await waitForText(page, "What's going on?");
  await page.getByRole("button", { name: "Show me" }).click();
  await page.waitForTimeout(500);

  await page.getByRole("button", { name: "Leave Calm" }).click();
  await waitForText(page, "help?");
  await shot(page, "calm-1.8-rating-ask");

  await page.getByRole("button", { name: "Helped", exact: true }).click();
  await waitForText(page, "log what happened");
  await shot(page, "calm-1.9-log-nudge");

  await page.getByRole("button", { name: "Not now" }).click();
  await page.waitForURL(/\/parent-dashboard/);
  await waitForText(page, "Good");
  await shot(page, "calm-1.10-dashboard-reminder");
}

async function phaseClinician(page) {
  console.log("== Clinician: Calm Card editor, publish states, Calm-live tag, red notice ==");
  await login(page, creds.clinician.email, creds.demoPassword);

  await goto(page, `/clinician/fba/${creds.featureWorld.fbaId}/section/12`);
  await waitForText(page, "Recommendations");
  await shot(page, "calm-2.1-calm-card-editor", { fullPage: true, hideFixedNav: true });

  await goto(page, `/clinician/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Clinical File");
  await shot(page, "calm-2.2-calm-live-tag");

  console.log("== Firing the red notice via the real safety path (separate context, doesn't disturb this session) ==");
  const { browser: parentBrowser, page: parentPage } = await launchPage();
  await login(parentPage, creds.parentHero.email, creds.demoPassword);
  await goto(parentPage, "/calm");
  await waitForText(parentPage, "Calm Cards");
  await parentPage.getByRole("button", { name: /Something's building/ }).click();
  await waitForText(parentPage, "What's going on?");
  await parentPage.getByRole("button", { name: "Show me" }).click();
  await parentPage.waitForTimeout(500);
  await parentPage.getByRole("button", { name: /None of this helping/ }).click();
  await waitForText(parentPage, "immediate danger");
  await parentBrowser.close();

  await goto(page, "/clinician/dashboard");
  await waitForText(page, "used the emergency escalation");
  // A re-run of this phase (or an earlier unacknowledged notice from
  // manual testing) can leave more than one stacked notice -- clear all
  // of them before shooting, so the guide shows exactly one, genuine
  // instance rather than a pile-up that reads as a bug.
  const staleCount = await page.getByRole("button", { name: "Acknowledge" }).count();
  for (let i = 1; i < staleCount; i++) {
    await page.getByRole("button", { name: "Acknowledge" }).first().click();
    await page.waitForTimeout(400);
  }
  await shot(page, "calm-2.3-red-notice");

  await page.getByRole("button", { name: "Acknowledge" }).click();
  await page.waitForTimeout(500);
  console.log("  (acknowledged)");
}

const PHASES = { locked: phaseLocked, live: phaseLive, clinician: phaseClinician };

async function main() {
  const requested = process.argv[2] || "all";
  const toRun = requested === "all" ? Object.keys(PHASES) : [requested];

  const { browser, page } = await launchPage();
  for (const name of toRun) {
    if (!PHASES[name]) throw new Error(`Unknown phase: ${name}`);
    await PHASES[name](page);
  }
  await browser.close();
  console.log("\nCalm guide capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
