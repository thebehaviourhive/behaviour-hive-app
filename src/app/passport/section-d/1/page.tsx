"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionD } from "@/hooks/usePassportSectionD";
import { getPassportProgressPercent } from "@/lib/passportProgress";

const BEFORE_BEHAVIOUR_OPTIONS = [
  { value: "Calm Tone" },
  { value: "Check Understanding" },
  { value: "Choice-making" },
  { value: "Clear Routines" },
  { value: "Extra Time" },
  { value: "Give Access to Interests" },
  { value: "Low-arousal Environment" },
  { value: "Movement Breaks" },
  { value: "Predictability" },
  { value: "Prepare for Change" },
  { value: "Reduced Language" },
  { value: "Sensory Supports" },
  { value: "Use First/Then" },
  { value: "Use Timers or Countdowns" },
  { value: "Use Visual Cues" },
  { value: "Other" },
];

export default function PassportSectionDPage1() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionD();

  const [beforeBehaviour, setBeforeBehaviour] = useState<string[]>([]);
  const [beforeBehaviourOther, setBeforeBehaviourOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  if (isReady && !hasHydrated) {
    setHasHydrated(true);
    setBeforeBehaviour(record.before_behaviour ?? []);
    setBeforeBehaviourOther(record.before_behaviour_other ?? "");
  }

  function toggleOption(value: string) {
    setBeforeBehaviour((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      before_behaviour: beforeBehaviour.length > 0 ? beforeBehaviour : null,
      before_behaviour_other: beforeBehaviour.includes("Other")
        ? beforeBehaviourOther || null
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

    router.push("/passport/section-c");
  }

  async function handleNext() {
    setError(null);
    setIsSaving(true);
    const saveError = await save(buildUpdates());
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/passport/section-d/2");
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
            What Helps Before a Behaviour Happens?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 4 of 4"
            stepLabel="Step 1 of 4"
            percent={getPassportProgressPercent(6)}
          />

          <p className="mb-3 text-sm text-black/60">
            Before things get hard, it helps when...
          </p>

          <PillMultiSelect
            options={BEFORE_BEHAVIOUR_OPTIONS}
            selected={beforeBehaviour}
            onToggle={toggleOption}
          />

          {beforeBehaviour.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={beforeBehaviourOther}
              onChange={(e) => setBeforeBehaviourOther(e.target.value)}
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
