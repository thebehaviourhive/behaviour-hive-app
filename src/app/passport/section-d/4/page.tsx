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
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/logActivity";

const SENSORY_OPTIONS = [
  { value: "Touch" },
  { value: "Sound" },
  { value: "Visual Stimulus" },
  { value: "Smell" },
  { value: "Taste/Mouth Feel" },
  { value: "Deep Pressure" },
  { value: "Movement (Vestibular)" },
  { value: "Proprioception" },
  { value: "Interoception" },
];

const SENSORY_AVOIDS_OPTIONS = [...SENSORY_OPTIONS, { value: "Other" }];

export default function PassportSectionDPage4() {
  const router = useRouter();
  const { user, passportId, record, isReady, save } = usePassportSectionD();

  const [sensorySeeks, setSensorySeeks] = useState<string[]>([]);
  const [sensoryAvoids, setSensoryAvoids] = useState<string[]>([]);
  const [sensoryAvoidsOther, setSensoryAvoidsOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setSensorySeeks(record.sensory_seeks ?? []);
    setSensoryAvoids(record.sensory_avoids ?? []);
    setSensoryAvoidsOther(record.sensory_avoids_other ?? "");
  }, [isReady, record]);

  function toggleSeeks(value: string) {
    setSensorySeeks((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function toggleAvoids(value: string) {
    setSensoryAvoids((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  function buildUpdates() {
    return {
      sensory_seeks: sensorySeeks.length > 0 ? sensorySeeks : null,
      sensory_avoids: sensoryAvoids.length > 0 ? sensoryAvoids : null,
      sensory_avoids_other: sensoryAvoids.includes("Other")
        ? sensoryAvoidsOther || null
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

    router.push("/passport/section-d/3");
  }

  async function handleFinish() {
    setError(null);
    setIsSaving(true);

    const saveError = await save({
      ...buildUpdates(),
      section_d_complete: true,
    });

    if (saveError) {
      setIsSaving(false);
      setError(saveError);
      return;
    }

    if (passportId) {
      const supabase = createClient();
      const { error: passportError } = await supabase
        .from("passports")
        .update({ passport_status: "complete" })
        .eq("id", passportId);

      if (passportError) {
        setIsSaving(false);
        setError(passportError.message);
        return;
      }

      if (user) {
        logActivity({
          passportId,
          actorId: user.id,
          eventType: "passport_updated",
          eventDescription: "Passport completed",
        });
      }
    }

    setIsSaving(false);
    router.push("/passport/dashboard");
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
            Sensory Supports
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 4 of 4"
            stepLabel="Step 4 of 4"
            percent={getPassportProgressPercent(9)}
          />

          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-brand-neutral-black">
                Sensory areas sought
              </label>
              <p className="text-xs text-black/60">
                Select the sensory areas your child seeks. (e.g. Your child
                rocks back and forth to calm themselves)
              </p>
              <PillMultiSelect
                options={SENSORY_OPTIONS}
                selected={sensorySeeks}
                onToggle={toggleSeeks}
              />
            </div>

            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-brand-neutral-black">
                Sensory areas avoided
              </label>
              <p className="text-xs text-black/60">
                Select the sensory areas your child avoids. (e.g. Your child
                does not like loud noises)
              </p>
              <PillMultiSelect
                options={SENSORY_AVOIDS_OPTIONS}
                selected={sensoryAvoids}
                onToggle={toggleAvoids}
              />

              {sensoryAvoids.includes("Other") && (
                <TextField
                  label="Please specify"
                  type="text"
                  value={sensoryAvoidsOther}
                  onChange={(e) => setSensoryAvoidsOther(e.target.value)}
                  className="mt-1"
                />
              )}
            </div>
          </div>

          {error && (
            <p role="alert" className="mt-4 text-sm font-medium text-red-600">
              {error}
            </p>
          )}

          <Button
            type="button"
            onClick={handleFinish}
            disabled={isSaving}
            className="mt-6"
          >
            {isSaving ? "Saving…" : "Finish"}
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
