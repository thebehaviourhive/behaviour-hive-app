"use client";

import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import {
  ABC_ROLE_CONFIG,
  ABC_ROLE_DISPLAY_LABEL,
  OTHER_OPTION,
  PERCEIVED_FUNCTION_OPTIONS,
  PERCEIVED_FUNCTION_QUESTION,
  SENSORY_SOUGHT_OPTIONS,
  SENSORY_AVOIDED_OPTIONS,
  type ABCLoggerRole,
} from "./roleConfig";
import { loadDraft, saveDraft, clearDraft, type ABCDraft } from "./draftStorage";
import { logActivity } from "@/lib/logActivity";
import { CLINICIAN_SPECIALTY_LABEL, type ClinicianSpecialty } from "@/lib/clinicianSpecialties";
import { friendlyAccessLapsedMessage } from "@/lib/temporaryAccessTime";

const TOTAL_STEPS = 4;

interface ABCLoggerProps {
  passportId: string;
  childName: string;
  role: ABCLoggerRole;
  // newLogId is optional-to-consume -- every existing caller's () => void
  // handler stays valid as-is (a callback with fewer params is always
  // assignable where more are expected). The Calm log-nudge (Stage 3C)
  // is the one caller that reads it, to backfill calm_episodes.abc_log_id.
  onComplete: (newLogId?: string) => void;
  onDismiss: () => void;
  // Stage 3A: the confirmation step's optional "Also send a message
  // about this?" affordance -- parent/teacher only (clinician-authored
  // logs are clinical workspace activity, excluded by the brief).
  // Omit this prop and the confirmation screen behaves exactly as
  // before (checkmark, auto-dismiss); passing it is what turns that
  // screen into one that waits for an explicit tap instead. Declining
  // (tapping Done) still leads to the exact same onComplete(newLogId)
  // call the timeout used to make -- logging itself is unaffected
  // either way.
  onOfferMessage?: (newLogId: string) => void;
  // Calm log-nudge prefill (Stage 3C) -- seeds the initial draft with
  // "now" already being blankDraft()'s own default, so only the fields
  // Calm actually knows in advance (a pre-selected door/tag reads as a
  // behaviour guess) are worth overriding. Deliberately NOT routed
  // through draftStorage/the resume-banner mechanism -- that's for
  // recovering an interrupted session, a different concept from a
  // fresh prefill, and repurposing it would show a "Resume/Discard"
  // banner instead of silently prefilling.
  initialPrefill?: Partial<Pick<ABCDraft, "behaviours">>;
}

// Must derive from local date components, not toISOString() (always UTC) --
// between local midnight and 1am during BST the UTC date is still
// "yesterday", which previously paired a correct local incident TIME
// (nowTime(), already local) with the wrong incident DATE.
function nowDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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
    sensorySought: [],
    sensorySoughtOther: "",
    sensoryAvoided: [],
    sensoryAvoidedOther: "",
    generalNotes: "",
    perceivedFunction: null,
    perceivedFunctionOther: "",
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

type MultiSelectField = "antecedents" | "behaviours" | "consequences" | "sensorySought" | "sensoryAvoided";

export function ABCLogger({
  passportId,
  childName,
  role,
  onComplete,
  onDismiss,
  onOfferMessage,
  initialPrefill,
}: ABCLoggerProps) {
  const config = ABC_ROLE_CONFIG[role];

  // A synchronous localStorage read, computed once as each piece of
  // initial state resolves -- this component is always mounted fresh per
  // passport (never kept alive across a passportId change), so there's no
  // later re-check to do, which means the recovery check belongs in these
  // initializers rather than a mount effect that would just be setting
  // this same state a moment after render anyway.
  const [draft, setDraft] = useState<ABCDraft>(() => ({ ...blankDraft(role), ...initialPrefill }));
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
  const [savedLogId, setSavedLogId] = useState<string | null>(null);
  // The confirmation step only waits for an explicit tap when there's
  // something to tap -- clinician-authored logs (no onOfferMessage
  // passed at all) keep the original auto-dismiss behaviour untouched.
  const canOfferMessage = role !== "clinician" && Boolean(onOfferMessage);

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

  function toggleChip(field: MultiSelectField, option: string) {
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
          (!draft.antecedents.includes(OTHER_OPTION) || draft.antecedentOther.trim() !== "")
        );
      case 3:
        return (
          draft.behaviours.length > 0 &&
          (!draft.behaviours.includes(OTHER_OPTION) || draft.behaviourOther.trim() !== "")
        );
      case 4:
        return (
          draft.consequences.length > 0 &&
          (!draft.consequences.includes(OTHER_OPTION) || draft.consequenceOther.trim() !== "") &&
          // Sensory signals and the "Why" question are both optional in
          // full, but same rule as every other step here: picking
          // "Other (please describe)" within either still means the
          // description text isn't optional -- an unlabelled "Other"
          // isn't useful data, whether the surrounding section itself
          // was required or not.
          (!draft.sensorySought.includes(OTHER_OPTION) || draft.sensorySoughtOther.trim() !== "") &&
          (!draft.sensoryAvoided.includes(OTHER_OPTION) || draft.sensoryAvoidedOther.trim() !== "") &&
          (draft.perceivedFunction !== "other" || draft.perceivedFunctionOther.trim() !== "")
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

      // Client-generated id (abc_logs.id defaults to gen_random_uuid(), but
      // supplying our own is equally valid and means the caller learns the
      // new row's id without needing .select() -- see the note below on
      // why chaining .select() here is off the table. The Calm log-nudge
      // (Stage 3C) is the one caller that needs this, to backfill
      // calm_episodes.abc_log_id.
      const newLogId = crypto.randomUUID();

      // DO NOT chain .select() onto this insert. `authenticated` only has a
      // column-level SELECT grant on abc_logs that excludes clinical_notes
      // (migration 0021, replacing an earlier table-level grant that a
      // column REVOKE couldn't override). Adding .select() makes PostgREST
      // execute the insert with `Prefer: return=representation`, which
      // needs SELECT on every returned column -- a bare `RETURNING *` would
      // hit clinical_notes and fail with a confusing permission error, even
      // though this insert never touches that column. Reads go through
      // get_abc_logs() (SECURITY DEFINER) instead, never this table
      // directly.
      const { error } = await supabase.from("abc_logs").insert({
        id: newLogId,
        passport_id: passportId,
        logged_by: user.id,
        logged_by_role: role,
        incident_date: draft.incidentDate,
        incident_time: draft.incidentTime,
        duration_minutes: draft.durationMinutes ? Number(draft.durationMinutes) : null,
        intensity: draft.intensity,
        antecedents: draft.antecedents,
        antecedent_other: draft.antecedents.includes(OTHER_OPTION)
          ? draft.antecedentOther.trim() || null
          : null,
        behaviours: draft.behaviours,
        behaviour_other: draft.behaviours.includes(OTHER_OPTION)
          ? draft.behaviourOther.trim() || null
          : null,
        consequences: draft.consequences,
        consequence_other: draft.consequences.includes(OTHER_OPTION)
          ? draft.consequenceOther.trim() || null
          : null,
        sensory_sought: draft.sensorySought.length > 0 ? draft.sensorySought : null,
        sensory_sought_other: draft.sensorySought.includes(OTHER_OPTION)
          ? draft.sensorySoughtOther.trim() || null
          : null,
        sensory_avoided: draft.sensoryAvoided.length > 0 ? draft.sensoryAvoided : null,
        sensory_avoided_other: draft.sensoryAvoided.includes(OTHER_OPTION)
          ? draft.sensoryAvoidedOther.trim() || null
          : null,
        general_notes: draft.generalNotes.trim() || null,
        perceived_function: draft.perceivedFunction,
        perceived_function_other:
          draft.perceivedFunction === "other" ? draft.perceivedFunctionOther.trim() || null : null,
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

        // PRD 1, Stage 3: the mid-session design's reactive half, on the
        // one write path a temporary-access holder is most likely to be
        // mid-way through when a cut-off passes. An INSERT's own RLS
        // refusal is never silent the way an UPDATE's is (CLAUDE.md's
        // own first gotcha is specifically about UPDATE) -- a genuine
        // WITH CHECK failure always carries a real error here, already
        // caught by the branch above; this only decides which MESSAGE to
        // show for it. Matches the same RLS-shaped signal this app's own
        // adversarial suite already tests against, not a new heuristic.
        const looksLikeAccessRefusal = /permission|row-level security|policy/i.test(error.message ?? "");
        setSubmitError(looksLikeAccessRefusal ? friendlyAccessLapsedMessage("This log") : "Something went wrong. Please try again.");
        return;
      }

      clearDraft(passportId);

      let roleLabel: string = ABC_ROLE_DISPLAY_LABEL[role];
      if (role === "clinician") {
        const { data: clinicianRow, error: specialtyError } = await supabase
          .from("clinicians")
          .select("specialty")
          .eq("user_id", user.id)
          .maybeSingle();
        if (specialtyError) {
          console.error("Failed to load clinician specialty for activity log:", specialtyError);
        }
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
      setSavedLogId(newLogId);
      setShowSuccess(true);
      // Clinician (nothing to offer): unchanged, auto-dismisses after
      // 900ms exactly as before. Parent/teacher: the screen now shows a
      // genuine choice (send a message, or Done) instead of a timer --
      // an auto-dismiss racing a button someone might be reading would
      // undermine the choice, so it's replaced with an explicit tap
      // either way. Declining is still exactly one tap (Done), calling
      // the same onComplete(newLogId) the timeout used to.
      if (!canOfferMessage) {
        setTimeout(() => onComplete(newLogId), 900);
      }
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
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 rounded-t-2xl bg-white px-8 text-center">
            <span aria-hidden className="text-4xl">
              ✅
            </span>
            <p className="font-heading text-lg font-semibold text-brand-prussian-blue">
              Log saved!
            </p>
            {canOfferMessage && savedLogId && (
              <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
                <button
                  type="button"
                  onClick={() => {
                    onOfferMessage?.(savedLogId);
                    onComplete(savedLogId);
                  }}
                  className="w-full rounded-2xl bg-brand-prussian-blue py-3 text-sm font-semibold text-white"
                >
                  Also send a message about this
                </button>
                <button
                  type="button"
                  onClick={() => onComplete(savedLogId)}
                  className="w-full py-2 text-sm font-semibold text-brand-neutral-black/50"
                >
                  Done
                </button>
              </div>
            )}
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
                alwaysShowDetail
                detailHelper="Add a little more detail if helpful — e.g. 'removed TV remote'"
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
                onToggleSensory={(field, option) => toggleChip(field, option)}
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
  alwaysShowDetail = false,
  detailHelper,
}: {
  title: string;
  helper: string;
  options: string[];
  selected: string[];
  onToggle: (option: string) => void;
  otherValue: string;
  onOtherChange: (value: string) => void;
  // Antecedent/Consequence: the free-text box is always visible and
  // genuinely optional, doubling as both "describe Other" (when Other's
  // selected, still required, same as before) and general extra detail
  // (when it's not). Behaviour step doesn't set this -- its "Other" box
  // stays exactly as it was, gated behind selecting Other.
  alwaysShowDetail?: boolean;
  detailHelper?: string;
}) {
  const isOtherSelected = selected.includes(OTHER_OPTION);
  const showDetailBox = alwaysShowDetail || isOtherSelected;

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

      {showDetailBox && (
        <div className="mt-3">
          {alwaysShowDetail && detailHelper && (
            <p className="mb-1.5 text-xs text-brand-neutral-black/50">{detailHelper}</p>
          )}
          <input
            type="text"
            value={otherValue}
            onChange={(e) => onOtherChange(e.target.value)}
            placeholder={isOtherSelected ? "Please describe..." : "Optional"}
            className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        </div>
      )}
    </div>
  );
}

function StepConsequence({
  config,
  draft,
  onToggleConsequence,
  onToggleSensory,
  updateDraft,
}: {
  config: (typeof ABC_ROLE_CONFIG)[ABCLoggerRole];
  draft: ABCDraft;
  onToggleConsequence: (option: string) => void;
  onToggleSensory: (field: "sensorySought" | "sensoryAvoided", option: string) => void;
  updateDraft: (patch: Partial<ABCDraft>) => void;
}) {
  const [isSensoryExpanded, setIsSensoryExpanded] = useState(false);

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
        alwaysShowDetail
        detailHelper="Add a little more detail if helpful — e.g. 'removed TV remote'"
      />

      {/* Sensory signals -- new, optional, collapsed by default. Deliberately
          distinct from the passport's own Section D "Sensory areas sought/
          avoided" (a one-time profile field, broader modality categories) --
          this captures specific observable behaviour around THIS incident,
          which the helper copy below says explicitly so the two don't read
          as the same question asked twice. */}
      <div className="rounded-xl border border-black/10">
        <button
          type="button"
          onClick={() => setIsSensoryExpanded((prev) => !prev)}
          className="flex w-full items-center justify-between gap-2 px-4 py-3 text-left"
        >
          <span className="text-sm font-semibold text-brand-neutral-black">
            Sensory signals (optional)
          </span>
          <ChevronDown
            className={`h-4 w-4 flex-shrink-0 text-brand-neutral-black/40 transition-transform ${isSensoryExpanded ? "rotate-180" : ""}`}
          />
        </button>

        {isSensoryExpanded && (
          <div className="flex flex-col gap-5 border-t border-black/5 px-4 pb-4 pt-4">
            <p className="text-sm text-brand-neutral-black/60">
              What sensory-seeking or avoiding did you notice around this incident?
            </p>

            <StepChips
              title="Sensory areas sought"
              helper="Select any that applied around this incident."
              options={SENSORY_SOUGHT_OPTIONS}
              selected={draft.sensorySought}
              onToggle={(option) => onToggleSensory("sensorySought", option)}
              otherValue={draft.sensorySoughtOther}
              onOtherChange={(value) => updateDraft({ sensorySoughtOther: value })}
            />

            <StepChips
              title="Sensory areas avoided"
              helper="Select any that applied around this incident."
              options={SENSORY_AVOIDED_OPTIONS}
              selected={draft.sensoryAvoided}
              onToggle={(option) => onToggleSensory("sensoryAvoided", option)}
              otherValue={draft.sensoryAvoidedOther}
              onOtherChange={(value) => updateDraft({ sensoryAvoidedOther: value })}
            />
          </div>
        )}
      </div>

      {/* "Why do you think this happened?" -- perceived_function. Available
          to every role now (previously teacher/SNA/clinician only). The
          helper copy is deliberately honest about protection model (i):
          this stays clinician-only to read back, regardless of who
          authors the log, so nobody -- including the person answering --
          is told or shown something that later turns out untrue. */}
      <div>
        <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
          {PERCEIVED_FUNCTION_QUESTION.label}
        </label>
        <p className="mb-3 text-sm text-brand-neutral-black/60">{PERCEIVED_FUNCTION_QUESTION.helper}</p>
        <div className="flex flex-wrap gap-2">
          {PERCEIVED_FUNCTION_OPTIONS.map((option) => (
            <ChipButton
              key={option.value}
              label={option.label}
              isSelected={draft.perceivedFunction === option.value}
              onClick={() =>
                updateDraft({
                  perceivedFunction: draft.perceivedFunction === option.value ? null : option.value,
                  // Clears any leftover "other" text the moment that
                  // option is deselected -- otherwise switching away from
                  // "Other" and back to null would silently resubmit
                  // stale text alongside a null perceived_function.
                  ...(option.value === "other" && draft.perceivedFunction === "other"
                    ? { perceivedFunctionOther: "" }
                    : {}),
                })
              }
            />
          ))}
        </div>
        {draft.perceivedFunction === "other" && (
          <input
            type="text"
            value={draft.perceivedFunctionOther}
            onChange={(e) => updateDraft({ perceivedFunctionOther: e.target.value })}
            placeholder="Please describe..."
            className="mt-3 w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
        )}
      </div>

      {/* Parent-only, pre-existing free-text box -- unaffected by this
          refresh, never had a per-role "either/or" with perceivedFunction
          to begin with in spirit (only in implementation, which is what
          split this out to its own config field). */}
      {config.notesLabel && (
        <div>
          <label className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
            {config.notesLabel}
          </label>
          <textarea
            value={draft.generalNotes}
            onChange={(e) => updateDraft({ generalNotes: e.target.value })}
            rows={3}
            placeholder="Optional"
            className="w-full rounded-xl border border-black/10 px-4 py-3 text-sm text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
          />
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
