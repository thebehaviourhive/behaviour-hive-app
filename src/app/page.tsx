import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { hasConsented } from "@/lib/hasConsented";

export default async function RootPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/register");
  }

  const role = user.app_metadata?.role;

  // CRITICAL BUG fix: this is the app's PWA start_url, so a force-quit
  // reopen (and, previously, the privacy policy page's own Back button)
  // lands here first -- it used to redirect straight to the role's
  // dashboard on role alone, with no check that consent had ever been
  // confirmed. A role-having, not-yet-consented user now goes to
  // /consent instead of skipping past it.
  if (role && !(await hasConsented(supabase, user.id))) {
    redirect("/consent");
  }

  redirect(getPostAuthRedirect(role));
}
