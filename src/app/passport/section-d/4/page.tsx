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
import { createClient } from "@/lib/supabase/client";
import { logActivity } from "@/lib/logActivity";

// Vocabulary refresh (2026-08): specific observable behaviour, replacing
// the original broad modality categories (Touch, Sound, Proprioception,
// ...). Deliberately a different vocabulary than the ABC Incident
// Logger's own sensory-signals block (roleConfig.ts's
// SENSORY_SOUGHT_OPTIONS/SENSORY_AVOIDED_OPTIONS) even though the two
// lists happen to share most entries -- this is a one-time profile
// field, that's a per-incident one; kept as separate constants
// deliberately, not a shared import, so either can evolve without
// silently changing the other.
const OTHER_SENSORY_OPTION = "Other, please describe";

// The avoided list previously stored a bare "Other" (no companion
// wording) -- a legacy value distinct from the new OTHER_SENSORY_OPTION
// string. Both are treated as "the Other pill" for deciding whether to
// show the free-text box, so a legacy record's existing description
// isn't hidden just because its stored option text predates this
// refresh; the sought list never had an Other option pre-refresh, so
// only ever sees the new string, but the same check costs nothing to
// share.
function isOtherSelected(selected: string[]): boolean {
  return selected.includes(OTHER_SENSORY_OPTION) || selected.includes("Other");
}

const SENSORY_SOUGHT_OPTIONS = [
  { value: "Movement (vestibular)" },
  { value: "Deep pressure" },
  { value: "Rough housing" },
  { value: "Touching everything" },
  { value: "Messy play" },
  { value: "Fidgeting" },
  { value: "Rubbing their skin" },
  { value: "Chewing items" },
  { value: "Mouthing items" },
  { value: "Vocal stimming" },
  { value: "Seeking noise" },
  { value: "Staring at moving items" },
  { value: "Seeking light" },
  { value: "Smelling things" },
  { value: "Holding urine or bowels" },
  { value: "Overeating" },
  { value: OTHER_SENSORY_OPTION },
];

const SENSORY_AVOIDS_OPTIONS = [
  { value: "Covering ears" },
  { value: "Fleeing crowded areas" },
  { value: "Refusing specific clothing" },
  { value: "Not wanting to be touched" },
  { value: "Wanting to be clean" },
  { value: "Eating selective foods (textures, temperatures, colours)" },
  { value: "Avoiding swings" },
  { value: "Anxious on uneven surfaces" },
  { value: "Motion sickness" },
  { value: "Avoiding eye contact" },
  { value: "Covering eyes" },
  { value: "Avoiding certain smells" },
  { value: "Using bathroom often" },
  { value: OTHER_SENSORY_OPTION },
];

// A selected value the CURRENT option list doesn't contain -- i.e. a
// legacy selection from before this vocabulary refresh -- still needs
// to render as a pill (visible and removable), not silently vanish
// from PillMultiSelect (which only ever renders entries from `options`).
// Appending it as an extra, unlabelled-as-such option achieves that
// without touching PillMultiSelect itself, which is shared by seven
// other passport-section pages this task has no reason to affect.
function withLegacySelections(
  options: { value: string }[],
  selected: string[]
): { value: string }[] {
  const known = new Set(options.map((o) => o.value));
  const legacy = selected.filter((v) => !known.has(v));
  return [...options, ...legacy.map((value) => ({ value }))];
}

export default function PassportSectionDPage4() {
  const router = useRouter();
  const { user, passportId, record, isReady, save } = usePassportSectionD();

  const [sensorySeeks, setSensorySeeks] = useState<string[]>([]);
  const [sensorySeeksOther, setSensorySeeksOther] = useState("");
  const [sensoryAvoids, setSensoryAvoids] = useState<string[]>([]);
  const [sensoryAvoidsOther, setSensoryAvoidsOther] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [hasHydrated, setHasHydrated] = useState(false);

  if (isReady && !hasHydrated) {
    setHasHydrated(true);
    setSensorySeeks(record.sensory_seeks ?? []);
    setSensorySeeksOther(record.sensory_seeks_other ?? "");
    setSensoryAvoids(record.sensory_avoids ?? []);
    setSensoryAvoidsOther(record.sensory_avoids_other ?? "");
  }

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
      sensory_seeks_other: isOtherSelected(sensorySeeks) ? sensorySeeksOther || null : null,
      sensory_avoids: sensoryAvoids.length > 0 ? sensoryAvoids : null,
      sensory_avoids_other: isOtherSelected(sensoryAvoids) ? sensoryAvoidsOther || null : null,
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
                options={withLegacySelections(SENSORY_SOUGHT_OPTIONS, sensorySeeks)}
                selected={sensorySeeks}
                onToggle={toggleSeeks}
              />

              {isOtherSelected(sensorySeeks) && (
                <TextField
                  label="Please specify"
                  type="text"
                  value={sensorySeeksOther}
                  onChange={(e) => setSensorySeeksOther(e.target.value)}
                  className="mt-1"
                />
              )}
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
                options={withLegacySelections(SENSORY_AVOIDS_OPTIONS, sensoryAvoids)}
                selected={sensoryAvoids}
                onToggle={toggleAvoids}
              />

              {isOtherSelected(sensoryAvoids) && (
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
