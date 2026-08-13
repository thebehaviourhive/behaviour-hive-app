// Renders the three guide HTML files to PDF via Playwright's print-to-PDF,
// so the real Baloo 2 / Nunito Sans fonts load exactly as they do in the
// app. Run with: node docs/user-guides/render.mjs
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DIR = path.dirname(fileURLToPath(import.meta.url));

const FOOTER_TEMPLATE = `
  <div style="width:100%; font-size:8px; font-family: Arial, sans-serif; color:#8a8a8c; display:flex; justify-content:space-between; padding: 0 14mm; box-sizing:border-box;">
    <span>The Behaviour Hive &middot; Trial Programme</span>
    <span class="pageNumber"></span>
  </div>
`;

const GUIDES = [
  { html: "parent-guide.html", pdf: "parent-guide.pdf" },
  { html: "teacher-guide.html", pdf: "teacher-guide.pdf" },
  { html: "clinician-guide.html", pdf: "clinician-guide.pdf" },
  // Standalone, feature-scoped guides (not a role guide) -- same
  // shared.css design language, same render pipeline.
  { html: "calm-button-guide.html", pdf: "calm-button-guide.pdf" },
  { html: "progress-guide.html", pdf: "progress-guide.pdf" },
  { html: "strategy-effectiveness-guide.html", pdf: "strategy-effectiveness-guide.pdf" },
];

async function main() {
  const browser = await chromium.launch();
  for (const guide of GUIDES) {
    const page = await browser.newPage();
    const filePath = "file://" + path.join(DIR, guide.html);
    await page.goto(filePath, { waitUntil: "networkidle" });
    // Let @font-face finish loading before printing.
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(300);

    const outPath = path.join(DIR, guide.pdf);
    await page.pdf({
      path: outPath,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: FOOTER_TEMPLATE,
      margin: { top: "12mm", bottom: "16mm", left: "0mm", right: "0mm" },
    });
    console.log("✓", guide.pdf);
    await page.close();
  }
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
