"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionB } from "@/hooks/usePassportSectionB";

const OKAY_SIGNAL_OPTIONS = [
  { value: "Calm body" },
  { value: "Chatting" },
  { value: "Engaged" },
  { value: "Focused" },
  { value: "Joining in" },
  { value: "Playful" },
  { value: "Smiling" },
  { value: "Other" },
];

export default function PassportSectionBPage1() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionB();

  const [okaySignals, setOkaySignals] = useState<string[]>([]);
  const [okaySignalsOther, setOkaySignalsOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setOkaySignals(record.okay_signals ?? []);
    setOkaySignalsOther(record.okay_signals_other ?? "");
  }, [isReady, record]);

  function toggleSignal(value: string) {
    setOkaySignals((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      okay_signals: okaySignals.length > 0 ? okaySignals : null,
      okay_signals_other: okaySignals.includes("Other")
        ? okaySignalsOther || null
        : null,
    };
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

    router.push("/passport/section-b/2");
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
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <BrandMark />
          <h1 className="font-heading text-2xl font-semibold text-brand-neutral-black">
            How I show I am okay
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 2 of 4"
            stepLabel="Step 1 of 3"
            percent={33}
          />

          <p className="mb-3 text-sm text-black/60">You might see me...</p>

          <PillMultiSelect
            options={OKAY_SIGNAL_OPTIONS}
            selected={okaySignals}
            onToggle={toggleSignal}
          />

          {okaySignals.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={okaySignalsOther}
              onChange={(e) => setOkaySignalsOther(e.target.value)}
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
