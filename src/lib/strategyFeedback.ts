import { createClient } from "@/lib/supabase/client";

// Shared across both rating capture surfaces (Stage 2): the parent's
// Calm episode rating (Calm Card, context='calm_episode') and the
// teacher's EOD rating (passport_clinical_content strategy, context=
// 'eod'). See migration 0055 for the table/policy definitions this
// mirrors exactly.
export type StrategyFeedbackRating = "helped" | "partly" | "not";

// Parent path: rate a Calm Card. Deliberately a bare `.insert()`, NOT
// chained with `.select()` -- unlike the teacher path, the parent DOES
// have a SELECT policy on strategy_feedback (their own child's rows),
// so return=representation would actually work here, but there's
// nothing for the caller to do with the row back (one-tap-and-move-on,
// no confirmation screen), so this stays symmetric with the teacher
// helper below rather than fetching data nobody reads.
export async function rateCalmCard(input: {
  passportId: string;
  calmCardId: string;
  rating: StrategyFeedbackRating;
  raterId: string;
  calmEpisodeId: string | null;
}): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.from("strategy_feedback").insert({
    passport_id: input.passportId,
    calm_card_id: input.calmCardId,
    context: "calm_episode",
    rating: input.rating,
    rater_role: "parent",
    rater_id: input.raterId,
    calm_episode_id: input.calmEpisodeId,
  });
  if (error) {
    console.error("Failed to record calm card rating:", error);
    return { error: "Couldn't save that." };
  }
  return { error: null };
}

// Teacher path: rate a school/shared strategy from passport_clinical_content.
// MUST stay a bare `.insert()` with no chained `.select()` --
// strategy_feedback deliberately has NO teacher SELECT policy
// (constraint: "teachers no SELECT"), and Postgres raises the same
// "new row violates row-level security policy" error for a successful
// INSERT's own RETURNING clause when the written row doesn't satisfy
// the table's SELECT policy, not only when the WITH CHECK itself
// fails. Chaining .select() here would make every otherwise-valid
// teacher rating fail -- confirmed live during Stage 1 verification
// (see migration 0055's commit message for the full debugging trail).
export async function rateStrategyContent(input: {
  passportId: string;
  strategyContentId: string;
  rating: StrategyFeedbackRating;
  raterId: string;
}): Promise<{ error: string | null }> {
  const supabase = createClient();
  const { error } = await supabase.from("strategy_feedback").insert({
    passport_id: input.passportId,
    strategy_content_id: input.strategyContentId,
    context: "eod",
    rating: input.rating,
    rater_role: "teacher",
    rater_id: input.raterId,
  });
  if (error) {
    console.error("Failed to record strategy rating:", error);
    return { error: "Couldn't save that." };
  }
  return { error: null };
}
