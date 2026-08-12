"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { ABC_ROLE_CONFIG } from "@/components/abc-logger/roleConfig";
import { setPendingLogReminder } from "@/lib/calmCards/logReminder";
import { useWakeLock } from "@/hooks/useWakeLock";
import { cardsForDoor, orderCardsForDeck, tagsForDoor } from "@/lib/calmCards/flow";
import type { CalmCard, CalmCardDoorType } from "@/lib/calmCards/types";
import { CalmDoorScreen } from "./CalmDoorScreen";
import { CalmChipScreen } from "./CalmChipScreen";
import { CalmCardCarousel } from "./CalmCardCarousel";
import { CalmSafetyFooter } from "./CalmSafetyFooter";
import { CalmEscalationScreen } from "./CalmEscalationScreen";
import { CalmLogNudgeSheet } from "./CalmLogNudgeSheet";

type FlowStep =
  | { kind: "door" }
  | { kind: "chips"; door: CalmCardDoorType }
  | { kind: "carousel"; door: CalmCardDoorType; tags: string[] }
  | { kind: "escalation" };

// Best-effort "behaviour if a chip was selected" prefill (constraint
// 3C) -- exact-matched against the PARENT's own behaviour option
// vocabulary specifically (Calm is parent-only in v1, per constraint 2),
// since a chip tag is free-form (this FBA's own trigger/setting-event/
// target-behaviour text, or a clinician's free-add) and will only ever
// line up with ABCLogger's fixed option list by literal coincidence.
// No match is a perfectly normal, silent outcome -- ABCLogger's own
// "time" default (always "now") already satisfies the other half of
// the brief's "time; behaviour if a chip was selected" on its own,
// with no extra work needed here.
function matchBehaviourTag(tags: string[]): string | null {
  const options = ABC_ROLE_CONFIG.parent.behaviour.options;
  return tags.find((t) => options.includes(t)) ?? null;
}

// Orchestrates Tap 1 (door) -> optional Tap 2 (chips) -> carousel ->
// (deliberate tap only) escalation, as one component with local step
// state -- same pattern ABCLogger already uses for its own multi-step
// flow, rather than separate routes (keeps selections in memory with
// zero risk of losing them to a page navigation).
//
// Wake lock is active for the WHOLE flow (door screen through carousel),
// not just the carousel -- "during the flow" (constraint 2C) reads most
// naturally as the whole /calm session, and there's no cost to starting
// it a screen early.
export function CalmFlow({
  passportId,
  userId,
  cards,
  childName,
}: {
  passportId: string;
  userId: string;
  cards: CalmCard[];
  childName: string;
}) {
  const router = useRouter();
  const [step, setStep] = useState<FlowStep>({ kind: "door" });
  const [isLogNudgeOpen, setIsLogNudgeOpen] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [pendingEpisodeId, setPendingEpisodeId] = useState<string | null>(null);
  // Accumulated client-side across the whole session, written to
  // calm_episodes exactly once when the session ends (either path) --
  // not one DB write per card shown (see migration 0054's header
  // comment on why this is a single-write substrate, not a live log).
  const cardsShownRef = useRef<string[]>([]);
  useWakeLock(true);

  function selectDoor(door: CalmCardDoorType) {
    const tags = tagsForDoor(cards, door);
    // Skip the chip screen entirely when there's nothing to narrow by --
    // "optional Tap 2" means optional, not "always shown but skippable".
    setStep(tags.length > 0 ? { kind: "chips", door } : { kind: "carousel", door, tags: [] });
  }

  async function recordEpisode(door: CalmCardDoorType, tags: string[], reachedSafety: boolean): Promise<string | null> {
    const supabase = createClient();
    const { data, error } = await supabase.rpc("record_calm_episode", {
      p_passport_id: passportId,
      p_door_type: door,
      p_tags_selected: tags,
      p_cards_shown: cardsShownRef.current,
      p_reached_safety: reachedSafety,
    });
    if (error) {
      // Never blocks the flow itself -- calm_episodes is silent substrate
      // (constraint 3D), and the safety path in particular must never be
      // gated on a write succeeding.
      console.error("Failed to record calm episode:", error);
      return null;
    }
    return data as string;
  }

  // Escalation is reached ONLY from CalmSafetyFooter's onClick below --
  // there is no other call site for this function anywhere in this
  // component, and it is never invoked from carousel swipe/advance
  // logic (that logic doesn't know this function exists).
  async function handleReachSafety(door: CalmCardDoorType, tags: string[]) {
    await recordEpisode(door, tags, true);
    setStep({ kind: "escalation" });
  }

  // "Leaving the flow normally" -- the explicit back/close affordance
  // below, not a route-change/beforeunload guess (those are unreliable
  // in an SPA and this is a "gentle", non-critical nudge, not something
  // worth chasing a hard-to-catch exit event for).
  async function handleLeave(door: CalmCardDoorType | null, tags: string[]) {
    if (!door) {
      router.push("/parent-dashboard");
      return;
    }
    setIsLeaving(true);
    const episodeId = await recordEpisode(door, tags, false);
    setIsLeaving(false);
    setPendingEpisodeId(episodeId);
    setIsLogNudgeOpen(true);
  }

  function handleLogIt(tags: string[]) {
    setIsLogNudgeOpen(false);
    const behaviour = matchBehaviourTag(tags);
    const params = new URLSearchParams({ logIncident: "1" });
    if (pendingEpisodeId) params.set("calmEpisodeId", pendingEpisodeId);
    if (behaviour) params.set("behaviour", behaviour);
    router.push(`/passport/dashboard?${params.toString()}`);
  }

  function handleNotNow() {
    setIsLogNudgeOpen(false);
    if (pendingEpisodeId) setPendingLogReminder(userId, pendingEpisodeId);
    router.push("/parent-dashboard");
  }

  const currentDoorAndTags: [CalmCardDoorType | null, string[]] =
    step.kind === "chips" ? [step.door, []] : step.kind === "carousel" ? [step.door, step.tags] : [null, []];

  const backButton = step.kind !== "escalation" && (
    <button
      type="button"
      onClick={() => handleLeave(...currentDoorAndTags)}
      disabled={isLeaving}
      aria-label="Leave Calm"
      className="mb-2 flex h-8 w-8 items-center justify-center text-brand-neutral-black/40 disabled:opacity-40"
    >
      <ChevronLeft size={22} />
    </button>
  );

  if (step.kind === "door") {
    return (
      <div className="flex h-full flex-col">
        {backButton}
        <div className="flex-1">
          <CalmDoorScreen childName={childName} onSelectDoor={selectDoor} />
        </div>
        <CalmLogNudgeSheet isOpen={isLogNudgeOpen} onLogIt={() => handleLogIt(currentDoorAndTags[1])} onNotNow={handleNotNow} />
      </div>
    );
  }

  if (step.kind === "chips") {
    return (
      <div className="flex h-full flex-col">
        {backButton}
        <div className="flex-1">
          <CalmChipScreen
            availableTags={tagsForDoor(cards, step.door)}
            onProceed={(tags) => setStep({ kind: "carousel", door: step.door, tags })}
          />
        </div>
        <CalmLogNudgeSheet isOpen={isLogNudgeOpen} onLogIt={() => handleLogIt(currentDoorAndTags[1])} onNotNow={handleNotNow} />
      </div>
    );
  }

  if (step.kind === "escalation") {
    return <CalmEscalationScreen />;
  }

  const deck = orderCardsForDeck(cards, step.door, step.tags);
  const doorCards = cardsForDoor(cards, step.door);

  if (doorCards.length === 0) {
    // Edge case: the button is live (some card exists somewhere) but
    // this specific door has none -- graceful, not a dead end.
    return (
      <div className="flex h-full flex-col">
        {backButton}
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p className="text-base text-brand-neutral-black/70">
            No Calm Cards for this moment yet -- try the other door.
          </p>
          <button
            type="button"
            onClick={() => setStep({ kind: "door" })}
            className="rounded-full border-2 border-calm-ink px-6 py-2.5 text-sm font-semibold text-calm-ink"
          >
            Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {backButton}
      <div className="min-h-0 flex-1">
        <CalmCardCarousel
          cards={deck}
          childName={childName}
          onCardShown={(cardId) => {
            if (!cardsShownRef.current.includes(cardId)) cardsShownRef.current.push(cardId);
          }}
          footer={<CalmSafetyFooter onTap={() => handleReachSafety(step.door, step.tags)} />}
        />
      </div>
      <CalmLogNudgeSheet isOpen={isLogNudgeOpen} onLogIt={() => handleLogIt(currentDoorAndTags[1])} onNotNow={handleNotNow} />
    </div>
  );
}
