import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

export const BASE_URL = process.env.DEMO_BASE_URL || "http://localhost:3100";
export const SCREENSHOT_DIR = path.resolve(
  fileURLToPath(new URL("../../docs/user-guides/screenshots/", import.meta.url))
);
mkdirSync(SCREENSHOT_DIR, { recursive: true });

export async function launchPage() {
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    colorScheme: "light",
    locale: "en-IE",
    timezoneId: "Europe/Dublin",
  });
  const page = await context.newPage();
  return { browser, context, page };
}

// Freezes the in-page Date to a fixed instant so time-of-day-dependent UI
// (the daily card's before/after-1pm branch, "today" queries) can be
// captured deterministically regardless of when this script actually
// runs. Safe to call multiple times on the same page -- each call wins
// for every navigation after it, so re-freezing to a new time before a
// later page.goto() is the intended way to move between captures.
export async function freezeClock(page, { hour, minute = 0 }) {
  const target = new Date();
  target.setHours(hour, minute, 0, 0);
  await page.addInitScript((iso) => {
    const fixed = new Date(iso).getTime();
    const RealDate = Date;
    class FakeDate extends RealDate {
      constructor(...args) {
        if (args.length === 0) {
          super(fixed);
        } else {
          super(...args);
        }
      }
      static now() {
        return fixed;
      }
    }
    // eslint-disable-next-line no-global-assign
    Date = FakeDate;
  }, target.toISOString());
}

export async function login(page, email, password) {
  // The proxy redirects an already-authenticated session away from
  // /login, which matters here since one script switches between
  // several demo accounts in the same browser context -- clear the
  // previous session's cookies first so /login is reachable again.
  await page.context().clearCookies();
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  await page.getByLabel("Email address").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // The redirect away from /login happens client-side, after the auth
  // call resolves -- networkidle alone can fire before that redirect
  // lands, leaving a subsequent goto() racing an unauthenticated
  // session. Waiting for the URL to actually leave /login is the real
  // signal that login succeeded.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"), { timeout: 20000 });
  await page.waitForLoadState("networkidle");
}

// Next.js's route-level loading.tsx (a full-screen BrandMark spinner) can
// still be on screen right when networkidle fires, and most pages here
// are client components with their own isReady/isLoading gate on top of
// that -- so every capture waits for a piece of text that can only be
// true of the REAL settled content, never the transitional states.
export async function waitForText(page, text, opts = {}) {
  await page
    .getByText(text, { exact: opts.exact ?? false })
    .first()
    .waitFor({ state: "visible", timeout: opts.timeout ?? 15000 });
}

export async function shot(page, name, opts = {}) {
  const target = path.join(SCREENSHOT_DIR, `${name}.png`);
  await page.waitForTimeout(300); // let transitions/fonts settle

  // fullPage screenshots of a long, scrollable page stitch multiple
  // scroll positions together -- any `position: fixed` element (the
  // bottom nav, on every one of these app shells) gets captured once
  // per stitch, so it appears to "float" duplicated partway down the
  // image. Opt-in only (existing callers are unaffected) since some
  // fullPage shots elsewhere in this pipeline may rely on a sticky
  // header/footer being visible at its natural position and are short
  // enough never to hit this artifact in the first place.
  let restoreFixedNav = null;
  if (opts.fullPage && opts.hideFixedNav) {
    restoreFixedNav = await page.evaluate(() => {
      const style = document.createElement("style");
      style.textContent = "*{position:static !important;}";
      document.head.appendChild(style);
      return true;
    });
  }

  await page.screenshot({ path: target, fullPage: Boolean(opts.fullPage) });

  if (restoreFixedNav) {
    await page.evaluate(() => {
      const style = document.head.querySelector("style:last-of-type");
      if (style?.textContent.includes("position:static")) style.remove();
    });
  }

  console.log("  ✓", name);
  return target;
}

export async function goto(page, url) {
  await page.goto(`${BASE_URL}${url}`, { waitUntil: "networkidle" });
}
