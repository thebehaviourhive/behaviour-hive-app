// Captures every Clinician Guide screenshot, including the real
// getting-verified flow (specialty select -> credentials form -> pending
// -> manual approve -> unlocked dashboard), mirroring the actual
// production review gate.
//
// Run with: node --env-file=.env.local scripts/demo/capture-clinician.mjs [phase]
// phase is one of: verify, connect, dashboard, case, log, help, all
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { launchPage, login, shot, goto, waitForText } from "./lib.mjs";

const creds = JSON.parse(readFileSync(new URL("./.demo-credentials.json", import.meta.url)));

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function resetClinicianProfile() {
  // Idempotency + lets this phase be re-run as a genuine "not submitted
  // yet" flow every time -- clinician_access (the Alfie link) is
  // untouched since it references auth.users, not this row.
  await supabase.from("clinician_government_id").delete().eq(
    "clinician_id",
    (await supabase.from("clinicians").select("id").eq("user_id", creds.clinician.id).maybeSingle()).data?.id ?? "00000000-0000-0000-0000-000000000000"
  );
  await supabase.from("clinicians").delete().eq("user_id", creds.clinician.id);
}

async function phaseVerify(page) {
  console.log("== Getting verified (live flow) ==");
  await resetClinicianProfile();
  await login(page, creds.clinician.email, creds.demoPassword);
  await page.waitForURL(/\/clinician\/specialty/, { timeout: 15000 });
  await waitForText(page, "Select your clinical specialty");
  await shot(page, "clinician-1.1-specialty-select");

  await page.getByRole("button", { name: "Behavioural Psychologist" }).click();
  await page.waitForURL(/\/clinician\/dashboard/, { timeout: 15000 });
  await waitForText(page, "Verify your credentials to unlock");

  await page.getByRole("link", { name: "Submit Credentials" }).click();
  await page.waitForURL(/\/clinician\/verify/);
  await waitForText(page, "Verify your credentials");
  await shot(page, "clinician-1.2-credentials-form");

  await page.getByLabel("Full Name").fill("Dr. Emma Walsh");
  await page.getByLabel("PSI Membership Number").fill("PSI-88214");
  await page.getByLabel("CORU Registration Number").fill("PSY123456");
  await page.getByLabel("BACB Certification Number").fill("1-24-88214");
  await page.getByLabel("Government ID").fill("PA1234567");
  await page.getByText(/Garda Vetting clearance/).click();
  await page.getByText(/professional indemnity insurance/).click();
  await page.getByRole("button", { name: "Submit Credentials" }).click();
  await page.waitForURL(/\/clinician\/dashboard/, { timeout: 15000 });
  await waitForText(page, "credentials are being reviewed");
  await shot(page, "clinician-1.3-pending-verification");

  console.log("== Manual approval (service role, mirrors the real review gate) ==");
  const { error } = await supabase.rpc("approve_clinician", { clinician_email: creds.clinician.email });
  if (error) throw error;

  await goto(page, "/clinician/dashboard");
  await waitForText(page, "Good");
  await shot(page, "clinician-1.4-unlocked-dashboard");

  await goto(page, "/more");
  await waitForText(page, "My Clinician Code", { timeout: 15000 }).catch(async () => {
    // Fallback wording check in case the exact label differs.
    await waitForText(page, "Clinician Code");
  });
  await shot(page, "clinician-1.5-my-clinician-code");
}

async function phaseDashboard(page) {
  console.log("== Dashboard, stats, review cadence, activity feed ==");
  await login(page, creds.clinician.email, creds.demoPassword);
  await waitForText(page, "Good");
  await shot(page, "clinician-3.1-dashboard-full");
  await shot(page, "clinician-3.2-stats-row");

  await goto(page, "/more");
  await waitForText(page, "review", { exact: false });
  await shot(page, "clinician-3.3-review-cadence");

  await goto(page, "/clinician/activity");
  await waitForText(page, "Activity");
  await shot(page, "clinician-3.4-activity-feed");
}

async function phaseCase(page) {
  console.log("== Caseload + clinical profile ==");
  await login(page, creds.clinician.email, creds.demoPassword);
  await goto(page, "/clinician/passports");
  await waitForText(page, "Passports");
  await shot(page, "clinician-4.1-caseload-list");

  await goto(page, `/clinician/passport/${creds.parentHero.passportId}`);
  await waitForText(page, "Clinical File");
  await shot(page, "clinician-4.2-clinical-profile");
}

async function phaseLog(page) {
  console.log("== Add Log -> select case -> ABC + FBA/BSP coming soon ==");
  await login(page, creds.clinician.email, creds.demoPassword);
  await goto(page, "/clinician/log");
  await waitForText(page, "Add Log");
  await shot(page, "clinician-5.1-add-log-select");

  await page.getByText("Alfie Byrne", { exact: true }).click();
  await waitForText(page, "ABC Log");
  await shot(page, "clinician-5.2-log-type-select");

  await page.getByText("ABC Log", { exact: true }).click();
  await waitForText(page, "Log an Incident");
  await shot(page, "clinician-5.3-abc-flow");
  await page.keyboard.press("Escape").catch(() => {});

  await goto(page, "/clinician/log");
  await waitForText(page, "Add Log");
  await page.getByText("Alfie Byrne", { exact: true }).click();
  await waitForText(page, "FBA Log");
  await page.getByText("FBA Log", { exact: true }).click();
  await waitForText(page, "Advanced clinical logging modules");
  await shot(page, "clinician-5.4-fba-bsp-coming-soon");
}

const PHASES = {
  verify: phaseVerify,
  dashboard: phaseDashboard,
  case: phaseCase,
  log: phaseLog,
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
  console.log("\nClinician capture complete:", toRun.join(", "));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
