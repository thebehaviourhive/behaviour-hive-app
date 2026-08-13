// Captures the pre-login onboarding screens: register, OTP entry,
// role select, consent. These can't use the already-seeded accounts
// (Sarah Murphy etc. are already past this point), so this creates two
// small throwaway accounts of its own:
//   - a REAL live signup through the UI (register -> OTP screen), never
//     completed since there's no real inbox to read the code from
//   - an admin-created account with no role/consent set yet, so it lands
//     naturally on /role-select then /consent when logged in
//
// Run with: node --env-file=.env.local scripts/demo/capture-onboarding.mjs
import { createClient } from "@supabase/supabase-js";
import { launchPage, shot, goto, waitForText } from "./lib.mjs";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEMO_PASSWORD = "DemoTrial-2026!";

async function deleteIfExists(email) {
  const { data } = await supabase.auth.admin.listUsers({ perPage: 200 });
  const existing = data?.users?.find((u) => u.email === email);
  if (existing) await supabase.auth.admin.deleteUser(existing.id);
}

async function main() {
  // Idempotency: this script does a REAL signUp() each run to capture the
  // register screen honestly, so the throwaway register-demo account is
  // deleted and recreated fresh every time rather than accumulating one
  // more never-verified account per run.
  await deleteIfExists("demo.onboarding.register@thebehaviourhive.com");

  const { browser, page } = await launchPage();

  console.log("== Register + OTP entry (real live signup, not completed) ==");
  await goto(page, "/register");
  await waitForText(page, "Create your account");
  await page.getByLabel("Full name").fill("Grace Devlin");
  await page.getByLabel("Email address").fill("demo.onboarding.register@thebehaviourhive.com");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await shot(page, "parent-1.1-register");

  await page.getByRole("button", { name: "Create account" }).click();
  await page.waitForURL(/\/verify-email/);
  await waitForText(page, "Check your email");
  await shot(page, "parent-1.2-otp-entry");

  console.log("== Role select + consent (admin-seeded account, no role yet) ==");
  // Idempotency: this account's whole purpose is to be freshly
  // role-less, and the flow below sets its role -- delete and recreate
  // every run rather than reusing one that's now past role-select.
  await deleteIfExists("demo.onboarding.roleselect@thebehaviourhive.com");
  {
    const { error } = await supabase.auth.admin.createUser({
      email: "demo.onboarding.roleselect@thebehaviourhive.com",
      password: DEMO_PASSWORD,
      email_confirm: true,
      user_metadata: { full_name: "Grace Devlin" },
      // Deliberately no app_metadata.role -- getPostAuthRedirect(undefined)
      // sends a freshly-verified user to /role-select, same as a real
      // first login after completing the OTP step above.
    });
    if (error) throw error;
  }

  await goto(page, "/login");
  await waitForText(page, "Welcome back");
  await page.getByLabel("Email address").fill("demo.onboarding.roleselect@thebehaviourhive.com");
  await page.getByLabel("Password").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/role-select/);
  await waitForText(page, "Who are you?");
  await shot(page, "parent-1.3-role-select");

  await page.getByRole("button", { name: /Parent or carer/ }).click();
  await page.getByRole("button", { name: /^Continue/ }).click();
  await page.waitForURL(/\/consent/);
  await waitForText(page, "Your data, your rules");
  await shot(page, "parent-1.4-consent");

  await browser.close();
  console.log("\nOnboarding capture complete.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
