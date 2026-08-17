"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { hasConsented } from "@/lib/hasConsented";

export function useRequireRole(role: string) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);

  useEffect(() => {
    let isMounted = true;

    async function checkAccess() {
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!isMounted) return;

      if (!user) {
        router.replace("/login");
        return;
      }

      const userRole = user.app_metadata?.role;
      if (userRole !== role) {
        router.replace(getPostAuthRedirect(userRole));
        return;
      }

      // CRITICAL BUG fix: role alone was being treated as "onboarded" by
      // every page that gates on it -- nothing here previously verified
      // consent had actually been confirmed, which is what let a user
      // reach any role-gated page (via any path: a stray Back button, a
      // deep link, a force-quit reopen) without ever ticking the consent
      // checkbox. This is the one gate every role-protected page in the
      // app already goes through, so fixing it here closes every path at
      // once rather than just the one where the bug was first found.
      const consented = await hasConsented(supabase, user.id);
      if (!isMounted) return;
      if (!consented) {
        router.replace("/consent");
        return;
      }

      setUser(user);
      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router, role]);

  return { user, isReady };
}
