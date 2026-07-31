"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BrandMark } from "@/components/ui/BrandMark";
import { Button } from "@/components/ui/Button";
import { Textarea } from "@/components/ui/Textarea";
import { TextField } from "@/components/ui/TextField";
import { PillMultiSelect } from "@/components/ui/PillMultiSelect";
import { PassportProgress } from "@/components/ui/PassportProgress";
import { usePassportSectionC } from "@/hooks/usePassportSectionC";
import { getPassportProgressPercent } from "@/lib/passportProgress";

const COMMUNICATION_METHOD_OPTIONS = [
  { value: "AAC Device" },
  { value: "Eye Gaze" },
  { value: "Facial Expression" },
  { value: "Formal Sign Language (ISL/BSL)" },
  { value: "Gesturing (Pointing)" },
  { value: "Makaton" },
  { value: "Objects of Reference" },
  { value: "PECS" },
  { value: "Verbal (fluent)" },
  { value: "Verbal (single words)" },
  { value: "Visual Choice Boards" },
  { value: "Vocalisations and Sounds" },
  { value: "Other" },
];

export default function PassportSectionCPage() {
  const router = useRouter();
  const { childName, record, isReady, save } = usePassportSectionC();

  const [communicationMethods, setCommunicationMethods] = useState<string[]>([]);
  const [communicationMethodsOther, setCommunicationMethodsOther] = useState("");
  const [showsHappy, setShowsHappy] = useState("");
  const [showsAnxious, setShowsAnxious] = useState("");
  const [phrasesToAvoid, setPhrasesToAvoid] = useState("");

  const [touched, setTouched] = useState({
    showsHappy: false,
    showsAnxious: false,
    phrasesToAvoid: false,
  });

  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (!isReady) return;
    setCommunicationMethods(record.communication_methods ?? []);
    setCommunicationMethodsOther(record.communication_methods_other ?? "");
    setShowsHappy(record.shows_happy ?? "");
    setShowsAnxious(record.shows_anxious ?? "");
    setPhrasesToAvoid(record.phrases_to_avoid ?? "");
  }, [isReady, record]);

  function toggleMethod(value: string) {
    setCommunicationMethods((prev) =>
      prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]
    );
  }

  const displayName = childName || "your child";
  const canContinue =
    showsHappy.trim().length > 0 &&
    showsAnxious.trim().length > 0 &&
    phrasesToAvoid.trim().length > 0;

  function buildUpdates() {
    return {
      communication_methods:
        communicationMethods.length > 0 ? communicationMethods : null,
      communication_methods_other: communicationMethods.includes("Other")
        ? communicationMethodsOther || null
        : null,
      shows_happy: showsHappy || null,
      shows_anxious: showsAnxious || null,
      phrases_to_avoid: phrasesToAvoid || null,
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

    router.push("/passport/section-b/3");
  }

  async function handleSaveAndContinue() {
    if (!canContinue) {
      setTouched({ showsHappy: true, showsAnxious: true, phrasesToAvoid: true });
      return;
    }

    setError(null);
    setIsSaving(true);
    const saveError = await save({
      ...buildUpdates(),
      section_c_complete: true,
    });
    setIsSaving(false);

    if (saveError) {
      setError(saveError);
      return;
    }

    router.push("/passport/section-d/1");
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
            How my Child Communicates
          </h1>
        </div>

        <div className="rounded-3xl border border-black/5 bg-white p-6 shadow-sm">
          <PassportProgress
            sectionLabel="Section 3 of 4"
            percent={getPassportProgressPercent(5)}
          />

          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-2">
              <label className="text-sm font-semibold text-brand-neutral-black">
                Main communication methods
              </label>
              <PillMultiSelect
                options={COMMUNICATION_METHOD_OPTIONS}
                selected={communicationMethods}
                onToggle={toggleMethod}
              />

              {communicationMethods.includes("Other") && (
                <TextField
                  label="Please specify"
                  type="text"
                  value={communicationMethodsOther}
                  onChange={(e) => setCommunicationMethodsOther(e.target.value)}
                  className="mt-1"
                />
              )}
            </div>

            <div>
              <Textarea
                label={`How ${displayName} shows they are happy`}
                placeholder="e.g. Smiling, seeking physical contact, jumping, vocalising with a rising tone, looking for a favourite toy"
                required
                value={showsHappy}
                onChange={(e) => setShowsHappy(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, showsHappy: true }))}
              />
              {touched.showsHappy && !showsHappy.trim() && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  This field is required
                </p>
              )}
            </div>

            <div>
              <Textarea
                label={`How ${displayName} shows they are anxious`}
                placeholder="e.g. Hand flapping, withdrawing, going quiet, repeating phrases, avoiding eye contact"
                required
                value={showsAnxious}
                onChange={(e) => setShowsAnxious(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, showsAnxious: true }))}
              />
              {touched.showsAnxious && !showsAnxious.trim() && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  This field is required
                </p>
              )}
            </div>

            <div>
              <Textarea
                label={`Phrases or approaches to avoid with ${displayName}`}
                placeholder="e.g. Saying calm down, using sarcasm, giving too many instructions at once, rhetorical questions"
                required
                value={phrasesToAvoid}
                onChange={(e) => setPhrasesToAvoid(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, phrasesToAvoid: true }))}
              />
              {touched.phrasesToAvoid && !phrasesToAvoid.trim() && (
                <p className="mt-1 text-xs font-medium text-red-600">
                  This field is required
                </p>
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
            onClick={handleSaveAndContinue}
            disabled={!canContinue || isSaving}
            className="mt-6"
          >
            {isSaving ? "Saving…" : "Save and continue"}
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
