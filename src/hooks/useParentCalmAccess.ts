"use client";

import { useEffect, useReducer } from "react";
import { createClient } from "@/lib/supabase/client";
import { mapCalmCardRow, type CalmCard } from "@/lib/calmCards/types";

interface RawCalmCardRow {
  id: string;
  title: string;
  steps: string[] | null;
  door_type: CalmCard["doorType"];
  trigger_tags: string[] | null;
}

type CalmAccessStatus = "idle" | "loading" | "ready";

interface CalmAccessState {
  status: CalmAccessStatus;
  passportId: string | null;
  childName: string | null;
  cards: CalmCard[];
}

// REGRESSION FIX (flicker): src/app/layout.tsx -- the one shared root
// layout -- renders no <BottomNav> at all; every individual page.tsx
// (parent-dashboard, passport/dashboard, more, calm, ...) renders its
// OWN <BottomNav> instance instead. With no shared App Router layout
// segment to preserve it, CalmNavButton (and this hook) remounts fresh
// on every single in-app navigation -- confirmed via git log/grep, not
// something the recent Calm exit-button change touched (that commit's
// only file was CalmFlow.tsx). This hook's old per-mount useState reset
// to "unknown" on every one of those remounts, which CalmNavButton then
// rendered as the LOCKED shell until the fetch resolved: the flicker.
// This was always latent -- the exit button just made leaving/
// re-entering Calm easy enough that navigating around it became common
// enough to notice.
//
// The fix is a module-level singleton, not a per-component cache: it
// survives every one of those remounts for the lifetime of the tab,
// reset only by a genuine hard reload -- deliberately NOT persisted to
// localStorage (this app's iOS PWA storage history is exactly why the
// brief rules that out). Every mount still revalidates in the
// background (stale-while-revalidate), so a locked -> live transition
// (a clinician publishing a card while the parent's tab is already
// open) surfaces on the parent's next navigation with no explicit event
// wiring required for the common case -- see revalidateParentCalmAccess
// below for the one place this app also fires it explicitly.
let state: CalmAccessState = { status: "idle", passportId: null, childName: null, cards: [] };
let inFlight: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: CalmAccessState) {
  state = next;
  listeners.forEach((listener) => listener());
}

// De-duped: a second caller while a fetch is already in flight (e.g.
// two mounted consumers during a route transition, or a deliberate
// revalidateParentCalmAccess() firing right as an idle-triggered fetch
// starts) awaits the SAME request rather than firing a second one.
function fetchCalmAccess(): Promise<void> {
  if (inFlight) return inFlight;

  // Only the session's genuinely first-ever fetch flips status to
  // "loading" -- a background revalidation of an already-"ready" cache
  // leaves status alone, so consumers keep rendering the last-known-
  // correct state throughout (stale-while-revalidate). Nothing must
  // ever regress to the neutral placeholder just because a background
  // refetch started.
  if (state.status === "idle") setState({ ...state, status: "loading" });

  inFlight = (async () => {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      setState({ status: "ready", passportId: null, childName: null, cards: [] });
      return;
    }

    // get_my_passports() (Stage 5 Step 3) -- sees a claimed passport
    // correctly, unlike a raw .eq("user_id", ...) lookup. First result
    // only; no multi-child switcher here yet.
    const { data: myPassports } = await supabase.rpc("get_my_passports");
    const passport = ((myPassports ?? []) as { passport_id: string; child_name: string }[])[0];

    if (!passport) {
      setState({ status: "ready", passportId: null, childName: null, cards: [] });
      return;
    }

    const { data: cardRows, error } = await supabase.rpc("get_my_child_calm_cards", {
      p_passport_id: passport.passport_id,
    });

    if (error) {
      console.error("Failed to load calm cards:", error);
      // A transient network error mid-session must never downgrade an
      // already-confirmed live (or locked) state back to an unknown or
      // wrong one -- keep whatever the cache already knew. Only lands
      // as "ready, locked" here if this is genuinely the session's
      // first fetch and it failed, since there's nothing else to fall
      // back to in that case.
      setState(
        state.status === "ready"
          ? state
          : { status: "ready", passportId: passport.passport_id, childName: passport.child_name ?? null, cards: [] }
      );
      return;
    }

    const cards = ((cardRows ?? []) as RawCalmCardRow[]).map((row) =>
      mapCalmCardRow({
        id: row.id,
        fba_id: "",
        strategy_ref: "",
        title: row.title,
        steps: row.steps,
        door_type: row.door_type,
        trigger_tags: row.trigger_tags,
        is_published: true,
        // Not returned by get_my_child_calm_cards (predates
        // migration 0055) -- the parent Calm flow never reads a
        // card's strategy type, this is purely a placeholder to
        // satisfy mapCalmCardRow's shared input shape.
        strategy_type_id: null,
        created_at: "",
        updated_at: "",
      })
    );
    setState({ status: "ready", passportId: passport.passport_id, childName: passport.child_name ?? null, cards });
  })().finally(() => {
    inFlight = null;
  });

  return inFlight;
}

// Exported so a genuinely access-changing moment (the parent completing
// the unlock sheet's own "link a clinician" journey -- see
// passport/dashboard's onClinicianConnected) can force an immediate
// revalidate rather than waiting for the next natural navigation/mount.
// Harmless to call speculatively: de-duped against any fetch already
// in flight, and a no-op in effect if nothing has actually changed.
export function revalidateParentCalmAccess(): void {
  fetchCalmAccess();
}

// THE single source of truth for the Calm button's live/locked state
// and its card set, for the parent track -- a module-level cache (see
// above), not per-mount state, so every one of BottomNav's per-page
// remounts reads the SAME already-known answer instantly instead of
// resetting to "locked" and flickering once a fresh fetch resolves.
//
// isLive is derived purely from get_my_child_calm_cards' row count (see
// migration 0053's own comment: "zero rows = locked state, any rows =
// live") -- no separate "is there a completed FBA" check needed, since
// the RPC's own WHERE clause already requires status = 'completed' AND
// is_published = true.
export function useParentCalmAccess() {
  const [, forceRender] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    listeners.add(forceRender);
    // Silent background revalidation on every mount -- invisible unless
    // the answer actually changed, since the cache keeps rendering its
    // last-known-correct state throughout. This is what makes a
    // locked->live transition (a clinician publishing a card while the
    // parent's tab is already open) surface on the very next
    // navigation, with no restart and no explicit event wiring needed
    // for the common case.
    fetchCalmAccess();
    return () => {
      listeners.delete(forceRender);
    };
  }, [forceRender]);

  return {
    passportId: state.passportId,
    childName: state.childName,
    cards: state.cards,
    isLive: state.status === "ready" && state.cards.length > 0,
    // "unknown yet" (idle/loading -- the session's first-ever fetch,
    // still in flight) is a genuinely distinct third state, never
    // folded into "assume locked". CalmNavButton reads this
    // specifically to render a neutral placeholder instead of either
    // real pill; calm/page.tsx keeps its existing "block until known"
    // full-page gate unchanged, since that semantic (isLoading = "we
    // don't have a definitive answer yet") is exactly preserved here.
    isLoading: state.status !== "ready",
  };
}
