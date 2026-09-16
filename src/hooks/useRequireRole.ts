"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { getPostAuthRedirect } from "@/lib/roleRedirect";
import { hasConsented } from "@/lib/hasConsented";

interface UseRequireRoleOptions {
  // Named for what it grants, not what it skips -- a page passing this
  // is declaring "I am part of onboarding itself, reachable before
  // consent is recorded", not quietly opting out of a check. Onboarding
  // restructure, Sept 2026: only /clinician/specialty passes this
  // (picking a specialty is now the clinician's own "joining" moment,
  // gated BEFORE consent, matching institution-code entry for staff).
  // Every other call site -- every dashboard, every deeper page,
  // /teacher/join-institution, /clinician/verify, /passport/welcome,
  // /passport/claim -- omits it and keeps the full gate. If you're
  // adding a second call site here, that's the one thing to get right:
  // this must never reach a page an unconsented user shouldn't see.
  allowBeforeConsent?: boolean;
}

export function useRequireRole(role: string | string[], options?: UseRequireRoleOptions) {
  const router = useRouter();
  const [user, setUser] = useState<User | null>(null);
  const [isReady, setIsReady] = useState(false);
  const allowBeforeConsent = options?.allowBeforeConsent ?? false;

  // A caller passing an inline array literal (e.g. useRequireRole(["class_teacher", "sna"]))
  // gets a new array reference every render -- using that directly as a dependency
  // would re-fire this effect (and its network calls) every render, forever.
  // Joining to a string gives a value that's stable across renders as long as the
  // actual allowed roles don't change, which is all the effect needs to depend on.
  const allowedRoles = Array.isArray(role) ? role : [role];
  const roleKey = allowedRoles.join(",");

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
      if (!userRole || !roleKey.split(",").includes(userRole)) {
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
      //
      // allowBeforeConsent is the one deliberate exception to that --
      // see the option's own doc comment above for exactly which page
      // uses it and why.
      if (!allowBeforeConsent) {
        const consented = await hasConsented(supabase, user.id);
        if (!isMounted) return;
        if (!consented) {
          router.replace("/consent");
          return;
        }
      }

      setUser(user);
      setIsReady(true);
    }

    checkAccess();
    return () => {
      isMounted = false;
    };
  }, [router, roleKey, allowBeforeConsent]);

  return { user, isReady };
}
