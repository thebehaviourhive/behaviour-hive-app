// Signs in with a real session (same cookie shape the app itself sets,
// per print-to-pdf.mjs's own established pattern) against the DEPLOYED
// app, and screenshots a page at one or more viewport sizes -- so
// Daniel can actually see a real rendered screen rather than a tool
// screenshot only visible to the model.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/zzscreenshot-dashboard.mjs <email> <password> <path> <outPrefix>

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const [, , email, password, path, outPrefix] = process.argv;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const projectRef = new globalThis.URL(URL).hostname.split(".")[0];
const DEPLOYED_ORIGIN = "https://behaviour-hive-app.vercel.app";

async function main() {
  const supabase = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const cookieValue = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64");
  const domain = new globalThis.URL(DEPLOYED_ORIGIN).hostname;

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    { name: `sb-${projectRef}-auth-token`, value: cookieValue, domain, path: "/" },
  ]);

  const page = await context.newPage();

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${DEPLOYED_ORIGIN}${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1000);

  // A brand-new account lands on /consent first (real first-login gate,
  // not something to bypass) -- click through it via the real page,
  // same as any first-time user would.
  if (page.url().includes("/consent")) {
    await page.click("#data-consent", { force: true });
    await page.click('button:has-text("Accept and continue")');
    await page.waitForTimeout(1200);
    if (!page.url().endsWith(path)) {
      await page.goto(`${DEPLOYED_ORIGIN}${path}`, { waitUntil: "networkidle" });
      await page.waitForTimeout(1000);
    }
  }
  await page.waitForSelector(".animate-pulse", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outPrefix}-desktop.png`, fullPage: true });
  console.log("wrote", `${outPrefix}-desktop.png`);

  await page.setViewportSize({ width: 375, height: 812 });
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForSelector(".animate-pulse", { state: "detached", timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `${outPrefix}-mobile.png`, fullPage: true });
  console.log("wrote", `${outPrefix}-mobile.png`);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
