"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  ABC_ROLE_CONFIG,
  ABC_ROLE_DISPLAY_LABEL,
  PERCEIVED_FUNCTION_OPTIONS,
  type ABCLoggerRole,
} from "./roleConfig";
import { loadDraft, saveDraft, clearDraft, type ABCDraft } from "./draftStorage";
import { logActivity } from "@/lib/logActivity";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";

const TOTAL_STEPS = 4;

interface ABCLoggerProps {
  passportId: string;
  childName: string;
  role: ABCLoggerRole;
  onComplete: () => void;
  onDismiss: () => void;
}

function nowDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function nowTime(): string {
  return new Date().toTimeString().slice(0, 5);
}

function blankDraft(role: ABCLoggerRole): ABCDraft {
  return {
    role,
    step: 1,
    incidentDate: nowDate(),
    incidentTime: nowTime(),
    durationMinutes: "",
    intensity: null,
    antecedents: [],
    antecedentOther: "",
    behaviours: [],
    behaviourOther: "",
    consequences: [],
    consequenceOther: "",
    generalNotes: "",
    perceivedFunction: null,
    isDraft: false,
    syncStatus: "synced",
    savedAt: new Date().toISOString(),
  };
}

// Golden Brown (#D78825) at intensity 1 fading to Prussian Blue (#004F71)
// at intensity 5 -- a computed gradient rather than five hardcoded hexes,
// since the five stops are just linear steps between two brand colors.
function intensityColor(level: number): string {
  const t = (level - 1) / 4;
  const from = { r: 0xd7, g: 0x88, b: 0x25 };
  const to = { r: 0x00, g: 0x4f, b: 0x71 };
  const r = Math.round(from.r + (to.r - from.r) * t);
  const g = Math.round(from.g + (to.g - from.g) * t);
  const b = Math.round(from.b + (to.b - from.b) * t);
  return `rgb(${r}, ${g}, ${b})`;
}

export function ABCLogger({
  passportId,
  childName,
  role,
  onComplete,
  onDismiss,
}: ABCLoggerProps) {
  const config = ABC_ROLE_CONFIG[role];

  // A synchronous localStorage read, computed once as each piece of
  // initial state resolves -- this component is always mounted fresh per
  // passport (never kept alive across a passportId change), so there's no
  // later re-check to do, which means the recovery check belongs in these
  // initializers rather than a mount effect that would just be setting
  // this same state a moment after render anyway.
  const [draft, setDraft] = useState<ABCDraft>(() => blankDraft(role));
  const [pendingDraft, setPendingDraft] = useState<ABCDraft | null>(() => loadDraft(passportId));
  const [showRecoveryBanner, setShowRecoveryBanner] = useState<boolean>(
    () => loadDraft(passportId) !== null
  );
  const [isAutosaveEnabled, setIsAutosaveEnabled] = useState<boolean>(
    () => loadDraft(passportId) === null
  );
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [localSaveMessage, setLocalSaveMessage] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);

  useEffect(() => {
    if (!isAutosaveEnabled) return;
    saveDraft(passportId, { ...draft, savedAt: new Date().toISOString() });
  }, [draft, isAutosaveEnabled, passportId]);

  // Locks the page behind the modal for as long as this component is
  // mounted -- which is exactly the modal's open lifetime, since both
  // parent pages conditionally render <ABCLogger /> and unmount it on
  // either onComplete or onDismiss. overflow-hidden alone doesn't
  // reliably stop scroll on iOS Safari (the page can still rubber-band
  // underneath a fixed overlay), so the body is additionally pinned with
  // position: fixed at its current scroll offset -- which is also why
  // that offset has to be restored afterward instead of just clearing
  // the styles, or closing the modal would jump the page back to the top.
  useEffect(() => {
    const scrollY = window.scrollY;
    const body = document.body;
    const previous = {
      overflow: body.style.overflow,
      position: body.style.position,
      top: body.style.top,
      width: body.style.width,
    };

    body.style.overflow = "hidden";
    body.style.position = "fixed";
    body.style.top = `-${scrollY}px`;
    body.style.width = "100%";

    return () => {
      body.style.overflow = previous.overflow;
      body.style.position = previous.position;
      body.style.top = previous.top;
      body.style.width = previous.width;
      window.scrollTo(0, scrollY);
    };
  }, []);

  function updateDraft(patch: Partial<ABCDraft>) {
    setDraft((prev) => ({ ...prev, ...patch }));
  }

  function toggleChip(field: "antecedents" | "behaviours" | "consequences", option: string) {
    setDraft((prev) => {
      const current = prev[field];
      const next = current.includes(option)
        ? current.filter((item) => item !== option)
        : [...current, option];
      return { ...prev, [field]: next };
    });
  }

  function handleResumeDraft() {
    if (!pendingDraft) return;
    setDraft(pendingDraft);
    setPendingDraft(null);
    setShowRecoveryBanner(false);
    setIsAutosaveEnabled(true);
  }

  function handleDiscardDraft() {
    clearDraft(passportId);
    setDraft(blankDraft(role));
    setPendingDraft(null);
    setShowRecoveryBanner(false);
    setIsAutosaveEnabled(true);
  }

  const isStepValid = (() => {
    switch (draft.step) {
      case 1:
        return Boolean(draft.incidentDate && draft.incidentTime && draft.intensity !== null);
      case 2:
        return (
          draft.antecedents.length > 0 &&
          (!draft.antecedents.includes("Other") || draft.antecedentOther.trim() !== "")
        );
      case 3:
        return (
          draft.behaviours.length > 0 &&
          (!draft.behaviours.includes("Other") || draft.behaviourOther.trim() !== "")
        );
      case 4:
        return (
          draft.consequences.length > 0 &&
          (!draft.consequences.includes("Other") || draft.consequenceOther.trim() !== "")
        );
      default:
        return false;
    }
  })();

  function handleBack() {
    if (draft.step === 1) {
      onDismiss();
      return;
    }
    updateDraft({ step: draft.step - 1 });
  }

  function handleNext() {
    if (!isStepValid) return;
    if (draft.step < TOTAL_STEPS) {
      updateDraft({ step: draft.step + 1 });
    } else {
      handleSubmit();
    }
  }

  async function handleSubmit() {
    setSubmitError(null);
    setIsSubmitting(true);

    const supabase = createClient();

    try {
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setIsSubmitting(false);
        setSubmitError("Your session has expired. Please sign in again.");
        return;
      }

      const { error } = await supabase.from("abc_logs").insert({
        passport_id: passportId,
        logged_by: user.id,
        logged_by_role: role,
        incident_date: draft.incidentDate,
        incident_time: draft.incidentTime,
        duration_minutes: draft.durationMinutes ? Number(draft.durationMinutes) : null,
        intensity: draft.intensity,
        antecedents: draft.antecedents,
        antecedent_other: draft.antecedents.includes("Other")
          ? draft.antecedentOther.trim() || null
          : null,
        behaviours: draft.behaviours,
        behaviour_other: draft.behaviours.includes("Other")
          ? draft.behaviourOther.trim() || null
          : null,
        consequences: draft.consequences,
        consequence_other: draft.consequences.includes("Other")
          ? draft.consequenceOther.trim() || null
          : null,
        general_notes: draft.generalNotes.trim() || null,
        perceived_function: draft.perceivedFunction,
      });

      if (error) {
        setIsSubmitting(false);

        // Confirmed live (by forcing an actual fetch failure and inspecting
        // the result): supabase-js never lets a network-level failure
        // propagate as a thrown exception here -- it catches it internally
        // and returns it through this same { error } path, with the fetch
        // TypeError's message intact and no real Postgres error code. A
        // genuine server-side rejection (RLS, a constraint) always carries
        // a real code, so that's the distinguishing signal, backed up by
        // navigator.onLine as a second, independent check.
        const looksOffline =
          !navigator.onLine || (!error.code && error.message?.includes("Failed to fetch"));

        if (looksOffline) {
          saveDraft(passportId, {
            ...draft,
            isDraft: true,
            syncStatus: "pending",
            savedAt: new Date().toISOString(),
          });
          setLocalSaveMessage("Saved locally. Will sync when connection is restored.");
          setTimeout(onDismiss, 1400);
          return;
        }

        setSubmitError("Something went wrong. Please try again.");
        return;
      }

      clearDraft(passportId);

      let roleLabel: string = ABC_ROLE_DISPLAY_LABEL[role];
      if (role === "clinician") {
        const { data: clinicianRow } = await supabase
          .from("clinicians")
          .select("specialty")
          .eq("user_id", user.id)
          .maybeSingle();
        if (clinicianRow?.specialty) {
          roleLabel =
            CLINICIAN_SPECIALTY_LABEL[clinicianRow.specialty as ClinicianSpecialty] ?? roleLabel;
        }
      }

      logActivity({
        passportId,
        actorId: user.id,
        eventType: "abc_logged",
        eventDescription: `ABC incident logged by ${roleLabel}`,
      });
      setIsSubmitting(false);
      setShowSuccess(true);
      setTimeout(onComplete, 900);
    } catch {
      // Belt-and-braces: covers a truly thrown exception from somewhere
      // other than the insert call itself (e.g. auth.getUser()), treated
      // the same way as a confirmed offline insert failure above.
      saveDraft(passportId, {
        ...draft,
        isDraft: true,
        syncStatus: "pending",
        savedAt: new Date().toISOString(),
      });
      setIsSubmitting(false);
      setLocalSaveMessage("Saved locally. Will sync when connection is restored.");
      setTimeout(onDismiss, 1400);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col justify-end bg-black/50">
      <div className="relative flex h-[85vh] flex-col rounded-t-2xl bg-white shadow-lg">
        <div className="mx-auto mt-3 h-1.5 w-12 flex-shrink-0 rounded-full bg-black/10" />

        {showSuccess && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-t-2xl bg-white">
            <span aria-hidden className="text-4xl">
              ✅
            </span>
            <p className="font-heading text-lg font-semibold text-brand-prussian-blue">
              Log saved!
            </p>
          </div>
        )}

        {localSaveMessage && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-t-2xl bg-white px-8 text-center">
            <span aria-hidden className="text-4xl">
              💾
            </span>
            <p className="text-sm font-medium text-brand-neutral-black">{localSaveMessage}</p>
          </div>
        )}

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-4">
          <div className="flex items-start justify-between">
            <div>
              <h2 className="font-heading text-xl font-bold text-brand-prussian-blue">
                Log an Incident
              </h2>
              <p className="text-sm text-brand-neutral-black/60">For {childName}</p>
            </div>
            <p className="font-accent text-xs text-brand-neutral-black/60">
              Step {draft.step} of {TOTAL_STEPS}
            </p>
          </div>

          {showRecoveryBanner && (
            <div className="mt-4 rounded-xl border border-brand-golden-brown/30 bg-brand-safe-ivory/40 p-4">
              <p className="text-sm text-brand-neutral-black">
                You have an unfinished ABC log.
              </p>
              <div className="mt-2 flex gap-4">
                <button
                  type="button"
                  onClick={handleResumeDraft}
                  className="text-sm font-bold text-brand-prussian-blue"
                >
                  Resume
                </button>
                <button
                  type="button"
                  onClick={handleDiscardDraft}
                  className="text-sm font-bold text-brand-golden-brown"
                >
                  Discard
                </button>
              </div>
            </div>
          )}

          <div className="mt-5">
            {draft.step === 1 && (
              <StepContext draft={draft} updateDraft={updateDraft} intensityLabel={config.intensityLabel} />
            )}
            {draft.step === 2 && (
              <StepChips
                title={config.antecedent.label}
                helper={config.antecedent.helper}
                options={config.antecedent.options}
                selected={draft.antecedents}
                onToggle={(option) => toggleChip("antecedents", option)}
                otherValue={draft.antecedentOther}
                onOtherChange={(value) => updateDraft({ antecedentOther: value })}
              />
            )}
            {draft.step === 3 && (
              <StepChips
                title={config.behaviour.label}
                helper={config.behaviour.helper}
                options={config.behaviour.options}
                selected={draft.behaviours}
                onToggle={(option) => toggleChip("behaviours", option)}
                otherValue={draft.behaviourOther}
                onOtherChange={(value) => updateDraft({ behaviourOther: value })}
              />
            )}
            {draft.step === 4 && (
              <StepConsequence
                config={config}
                draft={draft}
                onToggleConsequence={(option) => toggleChip("consequences", option)}
                updateDraft={updateDraft}
              />
            )}
          </div>

          {submitError && (
            <p role="alert" className="mt-4 text-sm font-medium text-brand-golden-brown">
              {submitError}
            </p>
          )}
        </div>

        <div className="flex flex-shrink-0 gap-3 border-t border-black/5 p-4">
          <button
            type="button"
            onClick={handleBack}
            disabled={isSubmitting}
            className="flex-1 rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue disabled:opacity-40"
          >
            Back
          </button>
          <button
            type="button"
            onClick={handleNext}
            disabled={!isStepValid || isSubmitting}
            className="flex-1 rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
          >
            {draft.step < TOTAL_STEPS
              ? "Next"
              : isSubmitting
                ? "Saving…"
                : "Save ABC Log"}
          </button>
        </div>
      </div>
    </div>
  );
}

function StepContext({
  draft,
  updateDraft,
  intensityLabel,
}: {
  draft: ABCDraft;
  updateDraft: (patch: Partial<ABCDraft>) => void;
  intensityLabel: string;
}) {
  return (
    <div className="flex flex-col gap-5">
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Date
        </label>
        <input
          type="date"
          value={draft.incidentDate}
          onChange={(e) => updateDraft({ incidentDate: e.target.value })}
          className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          Time
        </label>
        <input
          type="time"
          value={draft.incidentTime}
          onChange={(e) => updateDraft({ incidentTime: e.target.value })}
          className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      <div>
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          How long did it last? (minutes)
        </label>
        <input
          type="number"
          inputMode="numeric"
          min={0}
          value={draft.durationMinutes}
          onChange={(e) => updateDraft({ durationMinutes: e.target.value })}
          placeholder="Optional"
          className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-brand-neutral-black">
          {intensityLabel}
        </label>
        <div className="flex gap-2">
          {[1, 2, 3, 4, 5].map((level) => {
            const isSelected = draft.intensity === level;
            return (
              <button
                key={level}
                type="button"
                onClick={() => updateDraft({ intensity: level })}
                style={{ backgroundColor: intensityColor(level) }}
                className={`flex h-14 flex-1 items-center justify-center rounded-xl text-lg font-bold text-white transition-opacity ${
                  isSelected ? "opacity-100 ring-2 ring-brand-neutral-black ring-offset-2" : "opacity-45"
                }`}
              >
                {level}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function StepChips({
  title,
  helper,
  options,
  selected,
  onToggle,
  otherValue,
  onOtherChange,
}: {
  title: string;
  helper: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
}) {
  return (
    <div>
      <label className="block text-sm font-semibold text-brand-neutral-black">{title}</label>
      <p className="mt-1 text-sm text-brand-neutral-black/60">{helper}</p>

      <div className="mt-4 flex flex-wrap gap-2">
        {options.map((option) => (
          <ChipButton
            key={option}
            label={option}
            isSelected={selected.includes(option)}
            onClick={() => onToggle(option)}
          />
        ))}
      </div>

      {selected.includes("Other") && (
        <input
          type="text"
          value={otherValue}
          onChange={(e) => onOtherChange(e.target.value)}
          placeholder="Please describe..."
          className="mt-3 w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
        />
      )}
    </div>
  );
}

function StepConsequence({
  config,
  draft,
  onToggleConsequence,
  updateDraft,
}: {
  config: (typeof ABC_ROLE_CONFIG)[ABCLoggerRole];
  draft: ABCDraft;
  onToggleConsequence: (option: string) => void;
  updateDraft: (patch: Partial<ABCDraft>) => void;
}) {
  return (
    <div className="flex flex-col gap-5">
      <StepChips
        title={config.consequence.label}
        helper={config.consequence.helper}
        options={config.consequence.options}
        selected={draft.consequences}
        onToggle={onToggleConsequence}
        otherValue={draft.consequenceOther}
        onOtherChange={(value) => updateDraft({ consequenceOther: value })}
      />

      {config.step4Extra.type === "notes" ? (
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
            {config.step4Extra.label}
          </label>
          <textarea
            value={draft.generalNotes}
            onChange={(e) => updateDraft({ generalNotes: e.target.value })}
            rows={3}
            placeholder="Optional"
            className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
      ) : (
        <div>
          <label className="mb-2 block text-sm font-semibold text-brand-neutral-black">
            {config.step4Extra.label}
          </label>
          <div className="flex flex-wrap gap-2">
            {PERCEIVED_FUNCTION_OPTIONS.map((option) => (
              <ChipButton
                key={option.value}
                label={option.label}
                isSelected={draft.perceivedFunction === option.value}
                onClick={() =>
                  updateDraft({
                    perceivedFunction: draft.perceivedFunction === option.value ? null : option.value,
                  })
                }
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ChipButton({
  label,
  isSelected,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-4 py-2 text-sm transition-colors ${
        isSelected
          ? "border border-brand-prussian-blue bg-brand-pastel-blue text-brand-prussian-blue"
          : "border border-transparent bg-brand-off-white text-brand-neutral-black"
      }`}
    >
      {label}
    </button>
  );
}
