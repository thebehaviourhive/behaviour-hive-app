"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { useMyPassport } from "@/hooks/useMyPassport";
import { logActivity } from "@/lib/logActivity";

type SleepQuality = "slept_through" | "woke_briefly" | "very_restless" | "barely_slept";
type RegulationState = "settled" | "unsettled" | "dysregulated";

interface OptionSpec<T extends string> {
  value: T;
  label: string;
  emoji: string;
  borderClass: string;
  emojiBgClass: string;
}

const SLEEP_OPTIONS: OptionSpec<SleepQuality>[] = [
  {
    value: "slept_through",
    label: "Slept through / Well rested",
    emoji: "😴",
    borderClass: "border-green-500",
    emojiBgClass: "bg-green-100",
  },
  {
    value: "woke_briefly",
    label: "Woke up briefly",
    emoji: "🌙",
    borderClass: "border-amber-500",
    emojiBgClass: "bg-amber-100",
  },
  {
    value: "very_restless",
    label: "Very restless / Up multiple times",
    emoji: "😣",
    borderClass: "border-orange-500",
    emojiBgClass: "bg-orange-100",
  },
  {
    value: "barely_slept",
    label: "Barely slept",
    emoji: "😢",
    borderClass: "border-red-500",
    emojiBgClass: "bg-red-100",
  },
];

const REGULATION_OPTIONS: OptionSpec<RegulationState>[] = [
  {
    value: "settled",
    label: "Settled and Calm",
    emoji: "😊",
    borderClass: "border-green-500",
    emojiBgClass: "bg-green-100",
  },
  {
    value: "unsettled",
    label: "A bit unsettled / Anxious",
    emoji: "😟",
    borderClass: "border-amber-500",
    emojiBgClass: "bg-amber-100",
  },
  {
    value: "dysregulated",
    label: "Highly dysregulated / Upset",
    emoji: "😢",
    borderClass: "border-red-500",
    emojiBgClass: "bg-red-100",
  },
];

const STRESSOR_OPTIONS = [
  "Didn't eat breakfast",
  "Rushed / Running late",
  "Refused uniform / Sensory issue",
  "Missed medication",
  "Family friction / Argument",
  "Tired / Groggy",
];
const NO_DISRUPTIONS = "No disruptions (Smooth morning)";

// Gives the tap a moment to visibly register (selection ring) before the
// slide transition starts, so auto-advance reads as a confirmed choice
// rather than an accidental jump.
const ADVANCE_DELAY_MS = 220;

export default function MorningCheckinPage() {
  const router = useRouter();
  const { user, isReady } = useRequireRole("parent");
  const {
    passportId,
    childName: resolvedChildName,
    isLoading: isLoadingPassport,
  } = useMyPassport(user?.id);
  const childName = resolvedChildName || "your child";

  const [step, setStep] = useState(1);
  const [sleepQuality, setSleepQuality] = useState<SleepQuality | null>(null);
  const [regulationState, setRegulationState] = useState<RegulationState | null>(null);
  const [stressors, setStressors] = useState<string[]>([]);
  const [headsUp, setHeadsUp] = useState("");

  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);

  useEffect(() => {
    if (!showSuccess) return;
    const raf = requestAnimationFrame(() => setSuccessVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [showSuccess]);

  function selectSleepQuality(value: SleepQuality) {
    setSleepQuality(value);
    setTimeout(() => setStep(2), ADVANCE_DELAY_MS);
  }

  function selectRegulationState(value: RegulationState) {
    setRegulationState(value);
    setTimeout(() => setStep(3), ADVANCE_DELAY_MS);
  }

  function toggleStressor(value: string) {
    if (value === NO_DISRUPTIONS) {
      setStressors([NO_DISRUPTIONS]);
      return;
    }
    setStressors((prev) => {
      const withoutBypass = prev.filter((v) => v !== NO_DISRUPTIONS);
      return withoutBypass.includes(value)
        ? withoutBypass.filter((v) => v !== value)
        : [...withoutBypass, value];
    });
  }

  async function handleSubmit() {
    if (!user) return;
    setError(null);
    setIsSubmitting(true);

    const supabase = createClient();
    const { error: insertError } = await supabase.from("morning_checkins").insert({
      user_id: user.id,
      passport_id: passportId,
      sleep_quality: sleepQuality,
      regulation_state: regulationState,
      morning_stressors: stressors,
      heads_up: headsUp.trim() || null,
    });

    setIsSubmitting(false);

    if (insertError) {
      setError(insertError.message);
      return;
    }

    if (passportId) {
      logActivity({
        passportId,
        actorId: user.id,
        eventType: "morning_checkin",
        eventDescription: "Morning check-in sent",
      });
    }

    setShowSuccess(true);
    setTimeout(() => {
      router.push("/parent-dashboard");
    }, 1000);
  }

  if (!isReady || isLoadingPassport) {
    return null;
  }

  if (showSuccess) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-4 bg-brand-off-white/40 px-4">
        <span
          aria-hidden
          className={`flex h-20 w-20 items-center justify-center rounded-full bg-green-100 text-4xl transition-all duration-300 ${
            successVisible ? "scale-100 opacity-100" : "scale-50 opacity-0"
          }`}
        >
          ✅
        </span>
        <p className="font-heading text-lg font-semibold text-brand-neutral-black">
          Sent to your teacher!
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex flex-col gap-1 px-4 pt-6 pb-2">
        <p className="text-xs font-medium text-black/40">Step {step} of 4</p>
        <p className="text-sm font-semibold text-brand-neutral-black">{childName}</p>
        {/* PRD 3, Stage 4 -- school-wide by design (has_child_access(),
            unchanged since Stage 1), same one-line copy as PassportProgress. */}
        <p className="text-xs text-black/40">
          Everyone working with your child at school can read this.
        </p>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${(step - 1) * 100}%)` }}
        >
          <StepPanel>
            <StepQuestion>How did {childName} sleep last night?</StepQuestion>
            <div className="flex flex-col gap-3">
              {SLEEP_OPTIONS.map((option) => (
                <OptionCard
                  key={option.value}
                  emoji={option.emoji}
                  borderClass={option.borderClass}
                  emojiBgClass={option.emojiBgClass}
                  label={option.label}
                  isSelected={sleepQuality === option.value}
                  onClick={() => selectSleepQuality(option.value)}
                />
              ))}
            </div>
          </StepPanel>

          <StepPanel>
            <StepQuestion>How settled is {childName} right now?</StepQuestion>
            <div className="flex flex-col gap-3">
              {REGULATION_OPTIONS.map((option) => (
                <OptionCard
                  key={option.value}
                  emoji={option.emoji}
                  borderClass={option.borderClass}
                  emojiBgClass={option.emojiBgClass}
                  label={option.label}
                  isSelected={regulationState === option.value}
                  onClick={() => selectRegulationState(option.value)}
                />
              ))}
            </div>
          </StepPanel>

          <StepPanel>
            <StepQuestion>Did anything disrupt the morning routine?</StepQuestion>
            <p className="-mt-3 mb-4 text-sm text-black/50">
              Tap all that apply, or tap No disruptions for a smooth morning.
            </p>
            <div className="flex flex-wrap gap-2">
              {STRESSOR_OPTIONS.map((option) => (
                <StressorChip
                  key={option}
                  label={option}
                  isSelected={stressors.includes(option)}
                  onClick={() => toggleStressor(option)}
                />
              ))}
              <StressorChip
                label={NO_DISRUPTIONS}
                isSelected={stressors.includes(NO_DISRUPTIONS)}
                isBypass
                onClick={() => toggleStressor(NO_DISRUPTIONS)}
              />
            </div>
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={stressors.length === 0}
              className="mt-auto w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </StepPanel>

          <StepPanel>
            <StepQuestion>Anything else the teacher should know today?</StepQuestion>
            <AutoGrowTextarea value={headsUp} onChange={setHeadsUp} />

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="mt-auto w-full rounded-2xl bg-brand-golden-brown py-3.5 font-heading text-base font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {isSubmitting ? "Sending…" : "Send to teacher"}
            </button>
          </StepPanel>
        </div>
      </div>
    </div>
  );
}

function StepPanel({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-full w-full flex-shrink-0 flex-col overflow-y-auto px-4 pb-8 pt-2">
      {children}
    </div>
  );
}

function StepQuestion({ children }: { children: ReactNode }) {
  return (
    <h1 className="mb-5 font-heading text-2xl font-semibold leading-snug text-brand-neutral-black">
      {children}
    </h1>
  );
}

function OptionCard({
  emoji,
  borderClass,
  emojiBgClass,
  label,
  isSelected,
  onClick,
}: {
  emoji: string;
  borderClass: string;
  emojiBgClass: string;
  label: string;
  isSelected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-2xl border-l-4 bg-white p-5 text-left shadow-sm transition-all active:scale-[0.99] ${borderClass} ${
        isSelected ? "ring-2 ring-brand-prussian-blue/40" : ""
      }`}
    >
      <span
        aria-hidden
        className={`flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-xl ${emojiBgClass}`}
      >
        {emoji}
      </span>
      <span className="text-base font-semibold text-brand-neutral-black">{label}</span>
    </button>
  );
}

function StressorChip({
  label,
  isSelected,
  isBypass,
  onClick,
}: {
  label: string;
  isSelected: boolean;
  isBypass?: boolean;
  onClick: () => void;
}) {
  if (isBypass) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors ${
          isSelected
            ? "border-green-500 bg-green-100 text-green-800"
            : "border-green-200 bg-green-50 text-green-700"
        }`}
      >
        {label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-4 py-2.5 text-sm font-semibold transition-colors ${
        isSelected
          ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
          : "border-black/10 bg-white text-black/60"
      }`}
    >
      {label}
    </button>
  );
}

function AutoGrowTextarea({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

  return (
    <textarea
      ref={ref}
      rows={4}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder="Optional — e.g. Grandma is doing pick-up today, or hamster died last night."
      className="w-full resize-none overflow-hidden rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
    />
  );
}
