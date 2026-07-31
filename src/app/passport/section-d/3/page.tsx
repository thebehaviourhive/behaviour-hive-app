"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionD } from "@/hooks/usePassportSectionD";
import { getPassportProgressPercent } from "@/lib/passportProgress";

const AFTER_DISTRESS_OPTIONS = [
  { value: "Abandon Activity/Task" },
  { value: "Practice Skills Needed" },
  { value: "Reassure" },
  { value: "Reconnect" },
  { value: "Record The Behaviour" },
  { value: "Reduce Future Demands" },
  { value: "Repair the Relationship" },
  { value: "Return To the Activity" },
  { value: "Review Behaviour" },
  { value: "Other" },
];

export default function PassportSectionDPage3() {
  const router = useRouter();
  const { record, isReady, save } = usePassportSectionD();

  const [afterDistress, setAfterDistress] = useState<string[]>([]);
  const [afterDistressOther, setAfterDistressOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setAfterDistress(record.after_distress ?? []);
    setAfterDistressOther(record.after_distress_other ?? "");
  }, [isReady, record]);

  function toggleOption(value: string) {
    setAfterDistress((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      after_distress: afterDistress.length > 0 ? afterDistress : null,
      after_distress_other: afterDistress.includes("Other")
        ? afterDistressOther || null
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

    router.push("/passport/section-d/2");
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

    router.push("/passport/section-d/4");
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
            What Helps After Distress?
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 4 of 4"
            stepLabel="Step 3 of 4"
            percent={getPassportProgressPercent(8)}
          />

          <p className="mb-3 text-sm text-black/60">
            How do you support recovery, connection and learning? Select
            which options feel right in the moment.
          </p>

          <PillMultiSelect
            options={AFTER_DISTRESS_OPTIONS}
            selected={afterDistress}
            onToggle={toggleOption}
          />

          {afterDistress.includes("Other") && (
            <TextField
              label="Please specify"
              type="text"
              value={afterDistressOther}
              onChange={(e) => setAfterDistressOther(e.target.value)}
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
