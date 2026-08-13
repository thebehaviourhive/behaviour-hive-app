// Shared Calm Card types + strategy_ref helpers -- used by both the
// clinician authoring UX (Stage 1B) and the parent-facing flow (Stage 2).
//
// strategy_ref format: "<group>:<entryId>", where group is one of
// Section 12's three StrategyEntry arrays and entryId is that entry's
// own client-generated id (see RecommendationsSection.tsx). This is an
// application-level reference only -- fba_calm_cards.strategy_ref has no
// DB-level foreign key into the nested JSONB array element it names
// (content_data is one opaque jsonb column), matching how
// passport_clinical_content already has no natural per-item key either.
export type RecommendationGroup = "recommendationsHome" | "recommendationsSchool" | "recommendationsShared";

export function buildStrategyRef(group: RecommendationGroup, entryId: string): string {
  return `${group}:${entryId}`;
}

export function parseStrategyRef(ref: string): { group: RecommendationGroup; entryId: string } | null {
  const separatorIndex = ref.indexOf(":");
  if (separatorIndex === -1) return null;
  const group = ref.slice(0, separatorIndex);
  const entryId = ref.slice(separatorIndex + 1);
  if (group !== "recommendationsHome" && group !== "recommendationsSchool" && group !== "recommendationsShared") {
    return null;
  }
  return { group, entryId };
}

export type CalmCardDoorType = "prevention" | "deescalation";

// Parent-facing door names (constraint 1B: "labelled with the parent-facing
// door names ... so the clinician authors for the right moment") --
// the SAME copy the parent sees at Tap 1 in Stage 2, deliberately
// authored once here rather than duplicated between the clinician editor
// and the parent flow.
export const DOOR_TYPE_LABELS: Record<CalmCardDoorType, string> = {
  prevention: "Something's building",
  deescalation: "It's happening now",
};

export interface CalmCard {
  id: string;
  fbaId: string;
  strategyRef: string;
  title: string;
  steps: string[];
  doorType: CalmCardDoorType;
  triggerTags: string[];
  isPublished: boolean;
  // Optional tag into strategy_types (migration 0055) -- its own column,
  // independent of whatever tag the linked FBA strategy carries. The
  // editor pre-fills from the linked strategy's tag when strategy_ref
  // resolves, but this is a real, separately-editable selection from
  // there, not a derived/read-only value.
  strategyTypeId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface RawCalmCardRow {
  id: string;
  fba_id: string;
  strategy_ref: string;
  title: string;
  steps: string[] | null;
  door_type: CalmCardDoorType;
  trigger_tags: string[] | null;
  is_published: boolean;
  strategy_type_id: string | null;
  created_at: string;
  updated_at: string;
}

export function mapCalmCardRow(row: RawCalmCardRow): CalmCard {
  return {
    id: row.id,
    fbaId: row.fba_id,
    strategyRef: row.strategy_ref,
    title: row.title,
    steps: row.steps ?? [],
    doorType: row.door_type,
    triggerTags: row.trigger_tags ?? [],
    isPublished: row.is_published,
    strategyTypeId: row.strategy_type_id ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// Max steps enforced client-side too (constraint: "max 3 steps"), not
// just by the DB check constraint (jsonb_array_length between 2 and 3) --
// this lets the editor block a 4th step before the user even tries to
// save, rather than only failing on submit.
export const MIN_STEPS = 2;
export const MAX_STEPS = 3;
export const STEP_CHAR_LIMIT = 60;
export const TITLE_CHAR_LIMIT = 60;
