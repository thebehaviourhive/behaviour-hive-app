"use client";

import { useEffect, useState } from "react";
import { BottomSheet } from "@/components/ui/BottomSheet";
import { createClient } from "@/lib/supabase/client";
import { useMessageRecipientCandidates } from "@/hooks/useMessageRecipientCandidates";
import { useMessageCategories } from "@/hooks/useMessageCategories";
import { fetchApprovedInstitutionPhone } from "@/lib/messages/institutionPhone";
import { buildStrategyUpdateRecipientIds } from "@/lib/messages/strategyUpdateRecipients";
import { STRATEGY_UPDATE_BODY_TEMPLATE } from "@/lib/messages/messageBodyTokens";
import { ComposeMessageSheet } from "@/components/messages/ComposeMessageSheet";

// Stage 3B's "Notify the team?" moment. Never automatic -- mounted at
// each material-change touchpoint (FBA finalize, Calm Card publish) AND
// as the Clinical File tab's standing manual [Send strategy update]
// affordance (skipAsk), so the offer is never lost just because a
// clinician tapped "Not now" once. Both entry points funnel into the
// exact same prefilled compose flow -- one implementation, per the
// established "no duplicate implementations" rule.
export function StrategyUpdatePrompt({
  isOpen,
  onClose,
  passportId,
  skipAsk = false,
  onSent,
}: {
  isOpen: boolean;
  onClose: () => void;
  passportId: string;
  // The manual Clinical File button already IS the "yes" -- no need to
  // ask again.
  skipAsk?: boolean;
  onSent?: () => void;
}) {
  const [step, setStep] = useState<"ask" | "compose">(skipAsk ? "compose" : "ask");
  const [childName, setChildName] = useState("this child");
  const [institutionPhone, setInstitutionPhone] = useState<string | null>(null);
  const { candidates } = useMessageRecipientCandidates(isOpen ? passportId : null);
  const { categories } = useMessageCategories("clinician");

  useEffect(() => {
    if (!isOpen) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStep(skipAsk ? "compose" : "ask");
  }, [isOpen, skipAsk]);

  useEffect(() => {
    if (!isOpen) return;
    let isMounted = true;
    async function load() {
      const supabase = createClient();
      const [{ data: passport }, phone] = await Promise.all([
        supabase.from("passports").select("child_name").eq("id", passportId).maybeSingle(),
        fetchApprovedInstitutionPhone(supabase, passportId),
      ]);
      if (!isMounted) return;
      setChildName(passport?.child_name ?? "this child");
      setInstitutionPhone(phone);
    }
    load();
    return () => {
      isMounted = false;
    };
  }, [isOpen, passportId]);

  if (step === "ask") {
    return (
      <BottomSheet isOpen={isOpen} onClose={onClose}>
        <h2 className="font-heading text-xl font-semibold text-brand-neutral-black">
          Notify the team about the updated strategies?
        </h2>
        <p className="mt-2 text-sm text-brand-neutral-black/60">
          {childName}&apos;s parent and actively-linked teachers will get a message they can read and acknowledge.
        </p>
        <button
          type="button"
          onClick={() => setStep("compose")}
          className="mt-4 w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white"
        >
          Send update
        </button>
        <button
          type="button"
          onClick={onClose}
          className="mt-2 w-full py-2 text-center text-sm font-semibold text-brand-neutral-black/50"
        >
          Not now
        </button>
      </BottomSheet>
    );
  }

  const strategyCategoryId = categories.find((category) => category.label === "Strategy update")?.id;
  if (!strategyCategoryId) return null;

  return (
    <ComposeMessageSheet
      isOpen={isOpen}
      onClose={onClose}
      passportId={passportId}
      childName={childName}
      candidates={candidates}
      categories={categories}
      institutionPhone={institutionPhone}
      onSent={() => onSent?.()}
      initialCategoryId={strategyCategoryId}
      initialRecipientIds={buildStrategyUpdateRecipientIds(candidates)}
      initialBody={STRATEGY_UPDATE_BODY_TEMPLATE}
      strategyUpdate
    />
  );
}
