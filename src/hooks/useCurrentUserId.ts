"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Baseline audit, 26 Sept 2026 -- CentreSidebar/CentreBottomNav/
// CareSidebar/CareBottomNav need a userId to feed useMessagesAwaitingActionCount/
// useHasUnreadMessages (both self-scoped, both require the caller's own
// id explicitly), the same way PrincipalSidebar/PrincipalBottomNav do --
// but neither track has a PrincipalSupportAlertProvider-equivalent
// context to read one from (deliberately: there's no Support Button
// poll to share it with). A plain one-shot resolution, not a poll --
// unlike the 5-second get_my_support_alert_status() interval that
// context exists to de-duplicate, this is a single getUser() call per
// mounted component, matching the same one-shot shape every hook it
// feeds already uses.
export function useCurrentUserId(): string | null {
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (isMounted) setUserId(data.user?.id ?? null);
    });
    return () => {
      isMounted = false;
    };
  }, []);

  return userId;
}
