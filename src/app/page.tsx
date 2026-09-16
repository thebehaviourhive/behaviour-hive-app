import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { resolveOnboardingDestination } from "@/lib/resolveOnboardingDestination";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/register");
  }

  // This is the app's PWA start_url, so a force-quit reopen lands here
  // first -- resolveOnboardingDestination() is the single source of
  // truth for "role -> joined? -> consented? -> dashboard", shared with
  // src/lib/supabase/proxy.ts so the two never drift out of sync again.
  redirect(await resolveOnboardingDestination(supabase, user));
}
