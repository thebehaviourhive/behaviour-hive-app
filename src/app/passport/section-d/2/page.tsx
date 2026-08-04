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

const DURING_DISTRESS_OPTIONS = [
  { value: "Don't Negotiate" },
  { value: "Give Space" },
  { value: "Has a Preferred Adult" },
  { value: "Limit Audience" },
  { value: "Lower Expectations" },
  { value: "Negotiate" },
  { value: "Prioritise Safety" },
  { value: "Reduce Demands" },
  { value: "Stay Predictable" },
  { value: "Support Regulation" },
  { value: "Use a Calm Tone" },
  { value: "Use Simple Language" },
  { value: "Use Visuals" },
  { value: "Other" },
];

export default function PassportSectionDPage2() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionD();

  const [duringDistress, setDuringDistress] = useState<string[]>([]);
  const [duringDistressOther, setDuringDistressOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  if (isReady && !hasHydrated) {
    setHasHydrated(true);
    setDuringDistress(record.during_distress ?? []);
    setDuringDistressOther(record.during_distress_other ?? "");
  }

  function toggleOption(value: string) {
    setDuringDistress((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      during_distress: duringDistress.length > 0 ? duringDistress : null,
      during_distress_other: duringDistress.includes("Other")
        ? duringDistressOther || null
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

    router.push("/passport/section-d/1");
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

    router.push("/passport/section-d/3");
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
            What Helps During Distress?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 4 of 4"
            stepLabel="Step 2 of 4"
            percent={getPassportProgressPercent(7)}
          />

          <p className="mb-3 text-sm text-black/60">
            How do you regulate your child during times of distress...
          </p>

          <PillMultiSelect
            options={DURING_DISTRESS_OPTIONS}
            selected={duringDistress}
            onToggle={toggleOption}
          />

          {duringDistress.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={duringDistressOther}
              onChange={(e) => setDuringDistressOther(e.target.value)}
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
