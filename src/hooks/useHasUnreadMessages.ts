"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// The nav icon's "new" dot (migration 0170) -- deliberately separate
// from useMessagesAwaitingActionCount()'s own numbered badge. "Awaiting
// your action" and "unread" are different claims (a message can be read
// and still awaiting your reply -- awaiting is not a subset of unread),
// so this is its own signal, not a repurposing of that count.
//
// A plain client query, not a new RPC -- message_recipients' own SELECT
// policy (can_view_message(message_id)) already lets a caller see their
// own recipient rows, so `recipient_id = auth.uid()` needs no
// SECURITY DEFINER wrapper the way the awaiting-action count's own
// multi-CTE logic did.
export function useHasUnreadMessages(userId: string | null): boolean {
  const [hasUnread, setHasUnread] = useState(false);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { count, error } = await supabase
      .from("message_recipients")
      .select("id", { count: "exact", head: true })
      .eq("recipient_id", userId)
      .is("read_at", null);
    if (error) {
      console.error("Failed to load unread message state:", error);
      return;
    }
    setHasUnread((count ?? 0) > 0);
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return hasUnread;
}
