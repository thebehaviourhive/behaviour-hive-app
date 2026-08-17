"use client";

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// Single source for every dashboard's Messages badge (Change 3) -- one
// cheap RPC call (get_messages_awaiting_action_count), refreshed on
// dashboard load same as every other stat on these pages -- no realtime
// infrastructure. Entirely self-scoped server-side (auth.uid()), so a
// clinician calling this from their dashboard automatically excludes
// their read-only parent<->teacher viewing-only traffic -- nothing
// role-specific needed here.
//
// null while loading (so callers/CountBadge never flash a "0"); 0 once
// loaded is a genuine zero, which CountBadge also renders as nothing --
// the distinction only matters if a future caller needs to tell "still
// loading" apart from "actually zero".
export function useMessagesAwaitingActionCount(userId: string | null) {
  const [count, setCount] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (!userId) return;
    const supabase = createClient();
    const { data, error } = await supabase.rpc("get_messages_awaiting_action_count");
    if (error) {
      console.error("Failed to load messages awaiting action count:", error);
      return;
    }
    setCount(data ?? 0);
  }, [userId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
  }, [refresh]);

  return count;
}
