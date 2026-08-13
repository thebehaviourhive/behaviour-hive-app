"use client";

import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { useStrategyEffectiveness } from "@/hooks/useStrategyEffectiveness";
import { ClinicalTeamSection } from "./ClinicalTeamSection";

// Matches passport/dashboard/page.tsx's own CARD_CLASSNAME (duplicated,
// not imported -- that constant isn't exported, and this mirrors how
// small style constants are already duplicated per-surface elsewhere in
// this codebase, e.g. the regulation-state labels).
const CARD_CLASSNAME =
  "rounded-2xl border border-brand-off-white/50 bg-white p-5 shadow-[0_4px_20px_rgba(0,79,113,0.05)]";

// Self-contained, same philosophy as QuestionnairePromptCard/
// FbaCompletedPromptCard: fetches its own data, hides itself entirely
// (not just an empty state) when there's no clinical content yet, so
// existing passports render unchanged until something is approved into
// them. Fails silently on error for the same reason those two do --
// this is bonus context on an already-dense dashboard, not core content.
export function ParentClinicalTeamCard({ passportId }: { passportId: string }) {
  const { items, isLoading, loadError } = usePassportClinicalContent(passportId);
  // Independent load, never blocks/hides this card on its own -- an
  // effectiveness-fetch error just means no counters render this time,
  // same "bonus context, not core content" posture as this whole card.
  const { helpedCounts } = useStrategyEffectiveness(passportId);

  if (isLoading || loadError || items.length === 0) {
    return null;
  }

  return (
    <section className={CARD_CLASSNAME}>
      <h2 className="mb-4 font-heading text-xl font-bold text-brand-prussian-blue">
        From your Clinical Team
      </h2>
      <ClinicalTeamSection items={items} viewerRole="parent" helpedCounts={helpedCounts} />
    </section>
  );
}
