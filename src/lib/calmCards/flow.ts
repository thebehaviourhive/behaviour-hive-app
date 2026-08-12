import type { CalmCard, CalmCardDoorType } from "./types";

// Pure logic for the live flow (Stage 2C) -- no fetching, no React,
// mirroring the rest of this app's lib/<feature>/ modules (e.g.
// lib/progress). Consumed by CalmFlow.tsx.

export function cardsForDoor(cards: CalmCard[], door: CalmCardDoorType): CalmCard[] {
  return cards.filter((c) => c.doorType === door);
}

// Chip source for the narrowing step: the union of tags actually present
// on this door's published cards -- "the child's OWN trigger/behaviour
// tags", never an invented/global tag list. "Not sure" is added by the
// caller (CalmFlow), not here -- this stays a pure data derivation.
export function tagsForDoor(cards: CalmCard[], door: CalmCardDoorType): string[] {
  const doorCards = cardsForDoor(cards, door);
  return Array.from(new Set(doorCards.flatMap((c) => c.triggerTags))).sort();
}

// Selecting a chip narrows, it never hides: cards matching at least one
// selected tag sort first, but every card in the door still appears
// (append, not filter) -- a real situation might not match any single
// tag exactly, and the deck must never come up empty because of an
// over-specific selection. Ties keep their original (creation) order,
// via Array#sort's guaranteed stability.
export function orderCardsForDeck(cards: CalmCard[], door: CalmCardDoorType, selectedTags: string[]): CalmCard[] {
  const doorCards = cardsForDoor(cards, door);
  if (selectedTags.length === 0) return doorCards;

  const matches = (card: CalmCard) => card.triggerTags.some((t) => selectedTags.includes(t));
  return [...doorCards].sort((a, b) => Number(matches(b)) - Number(matches(a)));
}
