"use client";

import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { createClient } from "@/lib/supabase/client";
import { useRequireRole } from "@/hooks/useRequireRole";
import { getChildFirstName } from "@/lib/childDisplayName";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import { logActivity } from "@/lib/logActivity";
import { usePassportClinicalContent } from "@/hooks/usePassportClinicalContent";
import { useStrategyFeedbackCap } from "@/hooks/useStrategyFeedbackCap";
import { rateStrategyContent, type StrategyFeedbackRating } from "@/lib/strategyFeedback";

type SettledState = "settled" | "unsettled" | "dysregulated";

interface SettledOption {
  value: SettledState;
  label: string;
  borderClass: string;
  bgClass: string;
  textClass: string;
}

const SETTLED_OPTIONS: SettledOption[] = [
  {
    value: "settled",
    label: "Settled and Regulated",
    borderClass: "border-green-500",
    bgClass: "bg-green-50",
    textClass: "text-green-800",
  },
  {
    value: "unsettled",
    label: "Unsettled and Anxious",
    borderClass: "border-amber-500",
    bgClass: "bg-amber-50",
    textClass: "text-amber-800",
  },
  {
    value: "dysregulated",
    label: "Highly Dysregulated",
    borderClass: "border-red-500",
    bgClass: "bg-red-50",
    textClass: "text-red-800",
  },
];

const FLAG_OPTIONS = [
  "Routine Disruption",
  "Peer Friction",
  "Demand Avoidance",
  "High Anxiety",
  "Food Refusal",
  "Fatigued",
];
const NO_FLAGS = "No flags today";

const ADVANCE_DELAY_MS = 220;

export default function TeacherEodPage() {
  const router = useRouter();
  const params = useParams<{ passportId: string }>();
  const passportId = params.passportId;
  const { user, isReady } = useRequireRole("class_teacher");

  const [childName, setChildName] = useState("this child");
  const [isLoading, setIsLoading] = useState(true);
  const [alreadySubmittedToday, setAlreadySubmittedToday] = useState(false);
  const [confirmedReplace, setConfirmedReplace] = useState(false);

  const [step, setStep] = useState(1);
  const [settledState, setSettledState] = useState<SettledState | null>(null);
  const [energyLevel, setEnergyLevel] = useState<number | null>(null);
  const [flags, setFlags] = useState<string[]>([]);
  const [headsUp, setHeadsUp] = useState("");

  const [status, setStatus] = useState<"idle" | "saving" | "waiting-for-connection">("idle");
  const [error, setError] = useState<string | null>(null);
  const [showSuccess, setShowSuccess] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Stage 2's optional step 5: "did you use any of [child]'s strategies
  // today?" -- reuses the same role-scoped RPC every other clinical-team
  // surface reads through (a teacher viewer only ever gets strategy_school/
  // strategy_shared/trigger/setting_event back, enforced at the RPC
  // level, not filtered here), and the ask-cap hook from migration 0056.
  const { items: clinicalItems } = usePassportClinicalContent(passportId);
  const ratableStrategies = clinicalItems.filter(
    (item) => item.itemType === "strategy_school" || item.itemType === "strategy_shared"
  );
  const { isEligible: underAskCap, recordPrompt } = useStrategyFeedbackCap(passportId, user?.id ?? "");
  // Optimistic for the "Step X of Y" label only -- assumes 5 whenever
  // there's anything ratable, regardless of whether the cap-check query
  // has resolved yet (it's a fast background fetch well ahead of step
  // 4, so this only ever mismatches in the rare case the cap was
  // already hit, where the flow still correctly skips straight to
  // success at the real decision point below).
  const hasStrategiesToRate = ratableStrategies.length > 0;
  const totalSteps = hasStrategiesToRate ? 5 : 4;
  const [ratedStrategyIds, setRatedStrategyIds] = useState<string[]>([]);
  const [expandedStrategyId, setExpandedStrategyId] = useState<string | null>(null);
  const MAX_STRATEGY_RATINGS = 2;

  useEffect(() => {
    if (!user || !passportId) return;
    let isMounted = true;

    async function load() {
      const supabase = createClient();
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const [{ data: passport }, { data: existingUpdate }] = await Promise.all([
        supabase.from("passports").select("child_name").eq("id", passportId).maybeSingle(),
        supabase
          .from("teacher_updates")
          .select("id")
          .eq("passport_id", passportId)
          .eq("teacher_id", user!.id)
          .gte("submitted_at", startOfToday.toISOString())
          .limit(1)
          .maybeSingle(),
      ]);

      if (!isMounted) return;
      setChildName(getChildFirstName(passport?.child_name));
      setAlreadySubmittedToday(Boolean(existingUpdate));
      setIsLoading(false);
    }

    load();
    return () => {
      isMounted = false;
    };
  }, [user, passportId]);

  useEffect(() => {
    if (!showSuccess) return;
    const raf = requestAnimationFrame(() => setSuccessVisible(true));
    return () => cancelAnimationFrame(raf);
  }, [showSuccess]);

  function selectSettledState(value: SettledState) {
    setSettledState(value);
    setTimeout(() => setStep(2), ADVANCE_DELAY_MS);
  }

  function selectEnergyLevel(value: number) {
    setEnergyLevel(value);
    setTimeout(() => setStep(3), ADVANCE_DELAY_MS);
  }

  function toggleFlag(value: string) {
    if (value === NO_FLAGS) {
      setFlags([NO_FLAGS]);
      return;
    }
    setFlags((prev) => {
      const withoutBypass = prev.filter((v) => v !== NO_FLAGS);
      return withoutBypass.includes(value)
        ? withoutBypass.filter((v) => v !== value)
        : [...withoutBypass, value];
    });
  }

  async function handleSubmit() {
    if (!user || !passportId) return;
    setError(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    const supabase = createClient();
    const result = await insertWithOfflineRetry(
      () =>
        supabase.from("teacher_updates").insert({
          passport_id: passportId,
          teacher_id: user.id,
          settled_state: settledState,
          energy_level: energyLevel,
          flags: flags.filter((f) => f !== NO_FLAGS),
          heads_up: headsUp.trim() || null,
        }),
      setStatus,
      controller.signal
    );

    if (result === "cancelled") {
      setStatus("idle");
      return;
    }

    if (result) {
      setStatus("idle");
      setError(result);
      return;
    }

    logActivity({
      passportId,
      actorId: user.id,
      eventType: "afternoon_update",
      eventDescription: "End of day update from Teacher",
    });

    // The core EOD submission is complete and saved at this point,
    // exactly as before this step existed -- "the wizard's existing
    // flow and speed otherwise untouched". Step 5 is purely additive
    // from here: shown only when there's something to rate AND the
    // ask-cap isn't already hit, and recordPrompt() fires the moment
    // it's actually shown (an ask, whether or not the teacher goes on
    // to rate anything).
    if (hasStrategiesToRate && underAskCap) {
      recordPrompt();
      setStep(5);
      return;
    }

    finishAndRedirect();
  }

  function finishAndRedirect() {
    setShowSuccess(true);
    setTimeout(() => {
      router.push("/teacher/dashboard");
    }, 1000);
  }

  function handleCancelSubmit() {
    abortControllerRef.current?.abort();
  }

  function handleRateStrategy(itemId: string, rating: StrategyFeedbackRating) {
    if (!user) return;
    // Fire-and-forget -- same posture as the parent Calm rating (see
    // strategyFeedback.ts): one tap records and the UI moves on, no
    // confirmation screen, no waiting on the write.
    rateStrategyContent({ passportId, strategyContentId: itemId, rating, raterId: user.id });
    setRatedStrategyIds((prev) => [...prev, itemId]);
    setExpandedStrategyId(null);
  }

  if (!isReady || isLoading) {
    return null;
  }

  if (alreadySubmittedToday && !confirmedReplace) {
    return (
      <div className="flex min-h-full flex-1 flex-col items-center justify-center gap-5 bg-brand-off-white/40 px-6 text-center">
        <span aria-hidden className="text-4xl">
          ⚠️
        </span>
        <p className="text-base text-brand-neutral-black">
          You have already submitted an update for {childName} today.
          Submitting again will replace your previous note.
        </p>
        <div className="flex w-full max-w-sm flex-col gap-3">
          <button
            type="button"
            onClick={() => setConfirmedReplace(true)}
            className="w-full rounded-2xl bg-brand-golden-brown py-3.5 text-base font-semibold text-white"
          >
            Submit New Update
          </button>
          <button
            type="button"
            onClick={() => router.push("/teacher/dashboard")}
            className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue"
          >
            Cancel
          </button>
        </div>
      </div>
    );
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
          Update sent!
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-full flex-1 flex-col bg-brand-off-white/40">
      <header className="flex flex-col gap-1 px-4 pt-6 pb-2">
        <p className="text-xs font-medium text-black/40">Step {step} of {totalSteps}</p>
        <p className="text-sm font-semibold text-brand-neutral-black">{childName}</p>
      </header>

      <div className="relative flex-1 overflow-hidden">
        <div
          className="flex h-full transition-transform duration-300 ease-out"
          style={{ transform: `translateX(-${(step - 1) * 100}%)` }}
        >
          <StepPanel>
            <StepQuestion>How is {childName} doing right now?</StepQuestion>
            <div className="flex flex-col gap-3">
              {SETTLED_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => selectSettledState(option.value)}
                  className={`w-full rounded-2xl border-l-4 bg-white p-5 text-left text-base font-semibold shadow-sm transition-all active:scale-[0.99] ${option.borderClass} ${
                    settledState === option.value ? "ring-2 ring-brand-prussian-blue/40" : ""
                  }`}
                >
                  <span
                    className={`mb-1 inline-block rounded-full px-2.5 py-0.5 text-xs font-bold ${option.bgClass} ${option.textClass}`}
                  >
                    {option.value === "settled"
                      ? "Green"
                      : option.value === "unsettled"
                        ? "Amber"
                        : "Red"}
                  </span>
                  <span className="block text-brand-neutral-black">{option.label}</span>
                </button>
              ))}
            </div>
          </StepPanel>

          <StepPanel>
            <StepQuestion>Energy level today</StepQuestion>
            <div className="flex items-center justify-between gap-2">
              {[1, 2, 3, 4, 5].map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => selectEnergyLevel(level)}
                  className={`flex h-16 flex-1 items-center justify-center rounded-2xl border-2 font-heading text-2xl font-bold shadow-sm transition-all active:scale-[0.97] ${
                    energyLevel === level
                      ? "border-brand-prussian-blue bg-brand-prussian-blue text-white"
                      : "border-black/10 bg-white text-brand-neutral-black"
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>
          </StepPanel>

          <StepPanel>
            <StepQuestion>Any flags noticed today?</StepQuestion>
            <div className="flex flex-wrap gap-2">
              {FLAG_OPTIONS.map((option) => (
                <FlagChip
                  key={option}
                  label={option}
                  isSelected={flags.includes(option)}
                  onClick={() => toggleFlag(option)}
                />
              ))}
              <FlagChip
                label={NO_FLAGS}
                isSelected={flags.includes(NO_FLAGS)}
                isBypass
                onClick={() => toggleFlag(NO_FLAGS)}
              />
            </div>
            <button
              type="button"
              onClick={() => setStep(4)}
              disabled={flags.length === 0}
              className="mt-auto w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-40"
            >
              Continue
            </button>
          </StepPanel>

          <StepPanel>
            <StepQuestion>Anything the parent should know before pick-up?</StepQuestion>
            <AutoGrowTextarea value={headsUp} onChange={setHeadsUp} />

            {error && (
              <p role="alert" className="mt-3 text-sm font-medium text-red-600">
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={handleSubmit}
              disabled={status !== "idle"}
              className="mt-auto w-full rounded-2xl bg-brand-golden-brown py-3.5 font-heading text-base font-bold text-white transition-colors disabled:cursor-not-allowed disabled:opacity-60"
            >
              {status === "waiting-for-connection"
                ? "Waiting for connection…"
                : status === "saving"
                  ? "Sending…"
                  : "Submit Update"}
            </button>

            {status === "waiting-for-connection" && (
              <button
                type="button"
                onClick={handleCancelSubmit}
                className="mt-2 w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60"
              >
                Cancel
              </button>
            )}
          </StepPanel>

          {/* Step 5, Stage 2's optional addition -- only ever present
              (as a child at all) when there's something to rate, which
              is the exact same condition totalSteps/the header label
              above are derived from, so the slide-track math and the
              "Step X of Y" label never disagree with how many panels
              actually exist. */}
          {hasStrategiesToRate && (
            <StepPanel>
              <StepQuestion>Did you use any of {childName}&apos;s strategies today?</StepQuestion>
              <div className="flex flex-col gap-2.5">
                {ratableStrategies.map((item) => {
                  const isRated = ratedStrategyIds.includes(item.id);
                  const isExpanded = expandedStrategyId === item.id;
                  const isCapped = !isRated && ratedStrategyIds.length >= MAX_STRATEGY_RATINGS;
                  return (
                    <div key={item.id}>
                      <button
                        type="button"
                        disabled={isRated || isCapped}
                        onClick={() => setExpandedStrategyId(isExpanded ? null : item.id)}
                        className={`w-full rounded-2xl border-2 px-4 py-3 text-left text-sm font-semibold transition-colors disabled:cursor-not-allowed ${
                          isRated
                            ? "border-green-200 bg-green-50 text-green-800"
                            : isCapped
                              ? "border-black/5 bg-black/[0.02] text-black/30"
                              : isExpanded
                                ? "border-brand-prussian-blue bg-brand-pastel-blue/20 text-brand-prussian-blue"
                                : "border-black/10 bg-white text-brand-neutral-black"
                        }`}
                      >
                        {item.title || "Untitled strategy"}
                        {isRated ? " ✓" : ""}
                      </button>
                      {isExpanded && (
                        <div className="mt-2 flex gap-1.5">
                          <button
                            type="button"
                            onClick={() => handleRateStrategy(item.id, "helped")}
                            className="flex-1 rounded-xl bg-brand-prussian-blue py-2.5 text-xs font-semibold text-white"
                          >
                            Helped
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateStrategy(item.id, "partly")}
                            className="flex-1 rounded-xl border-2 border-brand-prussian-blue py-2.5 text-xs font-semibold text-brand-prussian-blue"
                          >
                            A little
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRateStrategy(item.id, "not")}
                            className="flex-1 rounded-xl border-2 border-black/10 py-2.5 text-xs font-semibold text-black/60"
                          >
                            Not this time
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <div className="mt-auto flex flex-col gap-2 pt-4">
                {ratedStrategyIds.length > 0 && (
                  <button
                    type="button"
                    onClick={finishAndRedirect}
                    className="w-full rounded-2xl bg-brand-golden-brown py-3.5 font-heading text-base font-bold text-white"
                  >
                    Continue
                  </button>
                )}
                <button
                  type="button"
                  onClick={finishAndRedirect}
                  className="w-full rounded-2xl border-2 border-black/10 py-3 text-sm font-semibold text-black/60"
                >
                  Skip
                </button>
              </div>
            </StepPanel>
          )}
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

function FlagChip({
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
      placeholder="Optional — anything the parent should know before pick-up? e.g. Fire alarm went off at 1pm, he recovered well but might need a quiet evening."
      className="w-full resize-none overflow-hidden rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
    />
  );
}
