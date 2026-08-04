"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionB } from "@/hooks/usePassportSectionB";
import { getPassportProgressPercent } from "@/lib/passportProgress";

const HARD_TRIGGER_OPTIONS = [
  { value: "Crowds" },
  { value: "Denied Access" },
  { value: "Difficult Tasks" },
  { value: "Group Work" },
  { value: "Hunger" },
  { value: "Illness" },
  { value: "Losing" },
  { value: "Noise" },
  { value: "Plans Changing" },
  { value: "Sensory Overload" },
  { value: "Tiredness" },
  { value: "Transitions" },
  { value: "Unclear Instructions" },
  { value: "Unfamiliar people or places" },
  { value: "Waiting" },
  { value: "Other" },
];

export default function PassportSectionBPage3() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionB();

  const [hardTriggers, setHardTriggers] = useState<string[]>([]);
  const [hardTriggersOther, setHardTriggersOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  if (isReady && !hasHydrated) {
    setHasHydrated(true);
    setHardTriggers(record.hard_triggers ?? []);
    setHardTriggersOther(record.hard_triggers_other ?? "");
  }

  function toggleTrigger(value: string) {
    setHardTriggers((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      hard_triggers: hardTriggers.length > 0 ? hardTriggers : null,
      hard_triggers_other: hardTriggers.includes("Other")
        ? hardTriggersOther || null
        : null,
    };
  }

  async function handleBack() {
    setError(null);
    setIsSaving(true);
    const saveError = await save(buildUpdates());
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/passport/section-b/2");
  }

  async function handleNext() {
    setError(null);
    setIsSaving(true);
    const saveError = await save({ ...buildUpdates(), section_b_complete: true });
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/passport/section-c");
  }

  async function handleSaveAndExit() {
    setError(null);
    setIsSaving(true);
    const saveError = await save(buildUpdates());
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/parent-dashboard");
  }

  if (!isReady) {
    return null;
  }

  return (
    <main className="flex min-h-full flex-1 items-center justify-center bg-brand-off-white/40 px-4 py-10">
      <div className="w-full max-w-sm">
        <button
          type="button"
          onClick={handleBack}
          disabled={isSaving}
          aria-label="Back"
          className="mb-2 text-2xl leading-none text-brand-prussian-blue disabled:opacity-50"
        >
          ‹
        </button>

        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            What can make things hard for my child
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 2 of 4"
            stepLabel="Step 3 of 3"
            percent={getPassportProgressPercent(4)}
          />

          <p className="mb-3 text-sm text-black/60">
            These are things that can make it hard for your child to cope or
            stay regulated.
          </p>

          <PillMultiSelect
            options={HARD_TRIGGER_OPTIONS}
            selected={hardTriggers}
            onToggle={toggleTrigger}
          />

          {hardTriggers.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={hardTriggersOther}
              onChange={(e) => setHardTriggersOther(e.target.value)}
              className="mt-4"
            />
          )}

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleNext}
            disabled={isSaving}
            className="mt-6"
          >
            {isSaving ? "Saving…" : "Next"}
          </Button>

          <button
            type="button"
            onClick={handleSaveAndExit}
            disabled={isSaving}
            className="mt-4 w-full text-center text-sm font-semibold text-black/50 disabled:opacity-50"
          >
            Save and exit
          </button>
        </div>
      </div>
    </main>
  );
}
