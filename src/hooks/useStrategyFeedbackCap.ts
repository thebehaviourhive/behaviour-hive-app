"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

// "At most 3x/child/week" (constraint 2), counting ASKS not ratings --
// see migration 0056's own header comment for why a skip still needs
// to count. Rolling 7-day window, not a calendar week, matching this
// app's own established rolling-window convention (e.g. the Progress
// feature's "7 days" range).
const CAP = 3;
const WINDOW_DAYS = 7;

export function useStrategyFeedbackCap(passportId: string, teacherId: string) {
  const [isEligible, setIsEligible] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    supabase
      .from("strategy_feedback_prompts")
      .select("id", { count: "exact", head: true })
      .eq("passport_id", passportId)
      .eq("teacher_id", teacherId)
      .gte("prompted_at", since)
      .then(({ count, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to check strategy-feedback ask cap:", error);
          // Fails closed -- an ask cap that silently over-asks on error
          // is exactly the "nag limits are hard requirements" failure
          // mode the brief warns against; a rare skipped step 5 is the
          // safe direction to fail in, not an uncapped one.
          setIsEligible(false);
          setIsLoading(false);
          return;
        }
        setIsEligible((count ?? 0) < CAP);
        setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, [passportId, teacherId]);

  // Called exactly once, the moment the step is actually shown to the
  // teacher -- an ask, not a rating. Fire-and-forget: this is a
  // rate-limit counter, not signal, so a failed write here shouldn't
  // block or alarm the teacher either.
  async function recordPrompt() {
    const supabase = createClient();
    const { error } = await supabase
      .from("strategy_feedback_prompts")
      .insert({ passport_id: passportId, teacher_id: teacherId });
    if (error) console.error("Failed to record strategy-feedback prompt:", error);
  }

  return { isEligible, isLoading, recordPrompt };
}
