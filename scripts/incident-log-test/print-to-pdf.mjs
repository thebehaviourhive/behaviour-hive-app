// Headless PDF generation for layout/pagination review -- NOT the
// acceptance gate (that's a real device, per instruction). Signs in via
// a real session (same auth-token cookie shape the app itself sets),
// navigates to the incident print page, and calls page.pdf() so
// pagination/layout can be reviewed without a browser print dialog.
//
// Run with: node --env-file=.env.local scripts/incident-log-test/print-to-pdf.mjs <email> <password> <url> <outPath>

import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const [, , email, password, path, outPath] = process.argv;

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const projectRef = new globalThis.URL(URL).hostname.split(".")[0];

async function main() {
  const supabase = createClient(URL, ANON_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;

  const cookieValue = "base64-" + Buffer.from(JSON.stringify(data.session)).toString("base64");

  const browser = await chromium.launch();
  const context = await browser.newContext();
  await context.addCookies([
    {
      name: `sb-${projectRef}-auth-token`,
      value: cookieValue,
      domain: "localhost",
      path: "/",
    },
  ]);

  const page = await context.newPage();
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  // Give the RPC + body-map SVG fetches a moment past networkidle.
  await page.waitForTimeout(1500);

  await page.pdf({ path: outPath, format: "A4", printBackground: true, margin: { top: "10mm", bottom: "10mm", left: "10mm", right: "10mm" } });
  console.log("PDF written to", outPath);

  await browser.close();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
