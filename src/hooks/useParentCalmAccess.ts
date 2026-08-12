"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapCalmCardRow, type CalmCard } from "@/lib/calmCards/types";

interface RawCalmCardRow {
  id: string;
  title: string;
  steps: string[] | null;
  door_type: CalmCard["doorType"];
  trigger_tags: string[] | null;
}

// THE single source of truth for the Calm button's live/locked state and
// its card set, for the parent track. Mounted at the nav level (Stage 2A)
// so the fetch fires as early as every parent screen loads -- "prefetch
// on nav mount" (constraint 2C's instant-feeling-load ask), given this
// codebase has no cross-component data cache (no SWR/react-query
// anywhere) to de-dupe a second mount's fetch: the Calm flow screens
// mounting this same hook again do re-fetch, but it's one small RPC call
// against already-warm auth/connection state, not a cold start.
//
// isLive is derived purely from get_my_child_calm_cards' row count (see
// migration 0053's own comment: "zero rows = locked state, any rows =
// live") -- no separate "is there a completed FBA" check needed, since
// the RPC's own WHERE clause already requires status = 'completed' AND
// is_published = true.
export function useParentCalmAccess() {
  const [passportId, setPassportId] = useState<string | null>(null);
  const [childName, setChildName] = useState<string | null>(null);
  const [cards, setCards] = useState<CalmCard[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setIsLoading(true);
    const supabase = createClient();

    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (!user || !isMounted) {
        if (isMounted) setIsLoading(false);
        return;
      }

      const { data: passport } = await supabase
        .from("passports")
        .select("id, child_name")
        .eq("user_id", user.id)
        .maybeSingle();

      if (!isMounted) return;
      if (!passport) {
        setIsLoading(false);
        return;
      }
      setPassportId(passport.id);
      setChildName(passport.child_name ?? null);

      const { data: cardRows, error } = await supabase.rpc("get_my_child_calm_cards", {
        p_passport_id: passport.id,
      });

      if (!isMounted) return;
      if (error) {
        console.error("Failed to load calm cards:", error);
        setIsLoading(false);
        return;
      }
      setCards(
        ((cardRows ?? []) as RawCalmCardRow[]).map((row) =>
          mapCalmCardRow({
            id: row.id,
            fba_id: "",
            strategy_ref: "",
            title: row.title,
            steps: row.steps,
            door_type: row.door_type,
            trigger_tags: row.trigger_tags,
            is_published: true,
            created_at: "",
            updated_at: "",
          })
        )
      );
      setIsLoading(false);
    });

    return () => {
      isMounted = false;
    };
  }, []);

  return { passportId, childName, cards, isLive: cards.length > 0, isLoading };
}
