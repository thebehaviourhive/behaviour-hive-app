"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionB } from "@/hooks/usePassportSectionB";
import { getPassportProgressPercent } from "@/lib/passportProgress";

const HARD_SIGNAL_OPTIONS = [
  { value: "Becoming Quiet" },
  { value: "Covering Ears" },
  { value: "Crying" },
  { value: "Grabbing" },
  { value: "Increasing Movement" },
  { value: "Moving Away" },
  { value: "Pacing" },
  { value: "Refusing" },
  { value: "Repeating Questions" },
  { value: "Screaming" },
  { value: "Shouting" },
  { value: "Other" },
];

export default function PassportSectionBPage2() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionB();

  const [hardSignals, setHardSignals] = useState<string[]>([]);
  const [hardSignalsOther, setHardSignalsOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setHardSignals(record.hard_signals ?? []);
    setHardSignalsOther(record.hard_signals_other ?? "");
  }, [isReady, record]);

  function toggleSignal(value: string) {
    setHardSignals((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      hard_signals: hardSignals.length > 0 ? hardSignals : null,
      hard_signals_other: hardSignals.includes("Other")
        ? hardSignalsOther || null
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

    router.push("/passport/section-b/1");
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

    router.push("/passport/section-b/3");
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
            How my child shows they are finding things hard
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 2 of 4"
            stepLabel="Step 2 of 3"
            percent={getPassportProgressPercent(3)}
          />

          <p className="mb-3 text-sm text-black/60">
            You might see your child...
          </p>

          <PillMultiSelect
            options={HARD_SIGNAL_OPTIONS}
            selected={hardSignals}
            onToggle={toggleSignal}
          />

          {hardSignals.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={hardSignalsOther}
              onChange={(e) => setHardSignalsOther(e.target.value)}
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
