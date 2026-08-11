"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { insertWithOfflineRetry } from "@/lib/waitForReconnect";
import { useInstrumentItems } from "@/hooks/useInstrumentItems";
import { getChildDisplayName } from "@/lib/childDisplayName";
import { resolveInstructionText } from "@/lib/fba/resolveInstruction";
import { INSTRUMENT_LABELS, type InstrumentResponsesData, type MyInstrumentRequest } from "@/lib/fba/types";

// The Name/Date header block's two fields (MAS and, per this brief,
// QABF too), stored as two extra keys inside the same responses_data
// blob as the real items -- deliberately namespaced so they can never
// collide with a real item id ("mas-1".."mas-16", "qabf-1".."qabf-25").
// instrumentScoring.ts only ever looks up responses by iterating the
// ITEM BANK, never the other way round, so these two extra keys are
// simply invisible to scoring -- no scoring-code change needed.
const HEADER_KEYS = { name: "header-name", date: "header-date" } as const;

// The QABF's real scale is ['X','0','1','2','3'] -- stored values, not
// display labels. Respondents see ONLY the written label, never the
// stored value itself -- no "0 —", "1 —", "X —" prefix -- the number/
// letter is a clinical scoring detail that belongs on clinician-facing
// surfaces (results, charts, the report), not in front of the person
// answering. The X option gets its own dedicated "Doesn't apply"
// treatment below rather than going through this map. Any future
// instrument sharing this exact scale shape gets the same wording;
// anything else falls back to its own raw scale label unchanged.
const EXCLUDED_ANSWER = "X";
const NUMERIC_SCALE_LABELS: Record<string, string> = {
  "0": "Never",
  "1": "Rarely",
  "2": "Sometimes",
  "3": "Often",
};

// The recipient's blind completion flow. Full-screen, not a bottom
// sheet -- deliberately distinct from ABCLogger's 85vh sheet, since the
// brief calls for "clean, distraction-free" and this can run to 25
// items, not a 4-step log. Never shows a score, a result, or anything
// that could be traced back to the FBA itself -- only the instrument's
// own question text and this recipient's own answers.
export function QuestionnaireFlow({
  request,
  track,
  onClose,
  onComplete,
}: {
  request: MyInstrumentRequest;
  track: "parent" | "teacher";
  onClose: () => void;
  onComplete: () => void;
}) {
  const { items, isLoading: isLoadingItems, loadError: itemsError } = useInstrumentItems(request.instrumentType);
  const [answers, setAnswers] = useState<InstrumentResponsesData>({});
  const [isLoadingExisting, setIsLoadingExisting] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [showThankYou, setShowThankYou] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  // Loads this recipient's own saved progress -- allowed by their own
  // unconditional SELECT policy on fba_instrument_requests (Stage 1),
  // scoped to this one row by id.
  useEffect(() => {
    let isMounted = true;
    const supabase = createClient();
    supabase
      .from("fba_instrument_requests")
      .select("responses_data")
      .eq("id", request.id)
      .maybeSingle()
      .then(({ data, error }) => {
        if (!isMounted) return;
        if (error) {
          console.error("Failed to load saved responses:", error);
          setLoadError("Couldn't load your questionnaire.");
          setIsLoadingExisting(false);
          return;
        }
        setAnswers((data?.responses_data as InstrumentResponsesData) ?? {});
        setIsLoadingExisting(false);
      });
    return () => {
      isMounted = false;
    };
  }, [request.id]);

  const hasHeaderBlock = request.instrumentType === "mas" || request.instrumentType === "qabf";

  // MAS/QABF only: pre-fills the header block's Name/Date once the
  // recipient's saved progress has actually loaded (so resuming an
  // in-progress questionnaire never overwrites what they already typed
  // there) -- `?? ` in the merge below only fills a key that's
  // genuinely absent, not one the recipient has since cleared to an
  // empty string.
  const hasPrefilledHeaderRef = useRef(false);
  useEffect(() => {
    if (isLoadingExisting || hasPrefilledHeaderRef.current) return;
    hasPrefilledHeaderRef.current = true;
    if (!hasHeaderBlock) return;

    let isMounted = true;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!isMounted) return;
      const fullName = (user?.user_metadata?.full_name as string | undefined) ?? "";
      const today = new Date().toISOString().slice(0, 10);
      setAnswers((prev) => ({
        ...prev,
        [HEADER_KEYS.name]: prev[HEADER_KEYS.name] ?? fullName,
        [HEADER_KEYS.date]: prev[HEADER_KEYS.date] ?? today,
      }));
    });
    return () => {
      isMounted = false;
    };
  }, [isLoadingExisting, hasHeaderBlock]);

  // Body scroll lock for the lifetime of this full-screen takeover --
  // same idiom as ABCLogger, including the iOS Safari rubber-band fix.
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

  function setAnswer(itemId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [itemId]: value }));
  }

  const isRatingInstrument = request.instrumentType !== "open_ended";
  const totalItems = items?.length ?? 0;
  const answeredCount = items
    ? items.filter((item) => (answers[item.id] ?? "").trim() !== "").length
    : 0;
  const allAnswered = totalItems > 0 && answeredCount === totalItems;

  async function persist(status: "in_progress" | "completed"): Promise<string | null> {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const supabase = createClient();
    return insertWithOfflineRetry(
      () =>
        supabase
          .from("fba_instrument_requests")
          .update({ responses_data: answers, status })
          .eq("id", request.id),
      (status) => setIsSaving(status === "saving" || status === "waiting-for-connection"),
      controller.signal
    );
  }

  async function handleSaveAndExit() {
    setSaveError(null);
    const error = await persist("in_progress");
    setIsSaving(false);
    if (error === "cancelled") return;
    if (error) {
      setSaveError(error);
      return;
    }
    onClose();
  }

  async function handleSubmit() {
    setSaveError(null);
    const error = await persist("completed");
    setIsSaving(false);
    if (error === "cancelled") return;
    if (error) {
      setSaveError(error);
      return;
    }
    setShowThankYou(true);
    setTimeout(onComplete, 1600);
  }

  const childLabel = track === "teacher" ? getChildDisplayName(request.childName) : request.childName;
  // The respondent's own name-display rule -- a teacher recipient gets
  // the same shortened form here as everywhere else on their track.
  const resolvedInstruction = resolveInstructionText(request.instruction, childLabel);

  if (isLoadingItems || isLoadingExisting) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-white">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-brand-pastel-blue border-t-brand-prussian-blue" />
      </div>
    );
  }

  if (itemsError || loadError || !items) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-white px-6 text-center">
        <p className="text-sm text-red-600">{itemsError ?? loadError}</p>
        <button type="button" onClick={onClose} className="text-sm font-semibold text-brand-prussian-blue">
          Close
        </button>
      </div>
    );
  }

  if (showThankYou) {
    return (
      <div className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-3 bg-white px-8 text-center">
        <span aria-hidden className="text-4xl">
          ✅
        </span>
        <p className="font-heading text-lg font-semibold text-brand-prussian-blue">Thank you!</p>
        <p className="max-w-xs text-sm text-brand-neutral-black/70">
          Your insights help {request.clinicianName} support {childLabel}.
        </p>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[100] flex flex-col bg-white">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-black/5 px-4 pt-6 pb-4">
        <button
          type="button"
          onClick={handleSaveAndExit}
          aria-label="Save and exit"
          className="flex h-8 w-8 flex-shrink-0 items-center justify-center text-2xl leading-none text-brand-prussian-blue"
        >
          ‹
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold text-brand-prussian-blue">
            {INSTRUMENT_LABELS[request.instrumentType]}
          </p>
          <p className="truncate text-xs text-brand-neutral-black/50">About {childLabel}</p>
        </div>
        {isRatingInstrument && (
          <p className="flex-shrink-0 text-xs font-semibold text-brand-neutral-black/50">
            {answeredCount} of {totalItems}
          </p>
        )}
      </header>

      {isRatingInstrument && (
        <div className="h-1.5 w-full flex-shrink-0 bg-black/10">
          <div
            className="h-full bg-brand-prussian-blue transition-all"
            style={{ width: `${totalItems > 0 ? (answeredCount / totalItems) * 100 : 0}%` }}
          />
        </div>
      )}

      <main className="flex-1 overflow-y-auto px-4 py-5">
        <div className="flex flex-col gap-6">
          {resolvedInstruction && (
            <div className="rounded-r-xl border-l-4 border-brand-golden-brown bg-brand-safe-ivory/30 p-4">
              <p className="text-sm leading-relaxed text-brand-neutral-black">{resolvedInstruction}</p>
            </div>
          )}

          {hasHeaderBlock && (
            <div className="flex flex-col gap-4 rounded-2xl border border-black/10 bg-brand-off-white/40 p-4">
              <div>
                <label htmlFor="header-name" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
                  Name
                </label>
                <input
                  id="header-name"
                  type="text"
                  value={answers[HEADER_KEYS.name] ?? ""}
                  onChange={(e) => setAnswer(HEADER_KEYS.name, e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              </div>
              <div>
                <label htmlFor="header-date" className="mb-1.5 block text-sm font-semibold text-brand-neutral-black">
                  Date
                </label>
                <input
                  id="header-date"
                  type="date"
                  value={answers[HEADER_KEYS.date] ?? ""}
                  onChange={(e) => setAnswer(HEADER_KEYS.date, e.target.value)}
                  className="w-full rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              </div>
            </div>
          )}

          {/* No category heading, on purpose -- revealing which
              function (Attention/Escape/...) an item measures would
              prime the respondent and undermine the instrument's
              validity. Items render in plain numbered-item-bank order;
              categories still exist on every item for scoring, they're
              just never SHOWN here. */}
          {(items ?? []).map((item) => (
            <div key={item.id}>
              <p className="mb-3 text-base font-medium text-brand-neutral-black">{item.text}</p>
              {item.answer_type === "free_text" ? (
                <textarea
                  value={answers[item.id] ?? ""}
                  onChange={(e) => setAnswer(item.id, e.target.value)}
                  rows={4}
                  placeholder="Your answer…"
                  className="w-full resize-none rounded-2xl border border-black/10 bg-white px-4 py-3.5 text-base text-brand-neutral-black placeholder:text-black/30 focus:border-brand-prussian-blue focus:outline-none focus:ring-2 focus:ring-brand-pastel-blue"
                />
              ) : (
                <div className="flex flex-col gap-2">
                  {(item.scale ?? [])
                    .filter((option) => option !== EXCLUDED_ANSWER)
                    .map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => setAnswer(item.id, option)}
                        className={`w-full rounded-2xl border py-3.5 text-base font-semibold transition-colors ${
                          answers[item.id] === option
                            ? "border-brand-prussian-blue bg-brand-pastel-blue/30 text-brand-prussian-blue"
                            : "border-black/10 bg-white text-brand-neutral-black"
                        }`}
                      >
                        {NUMERIC_SCALE_LABELS[option] ?? option}
                      </button>
                    ))}

                  {/* The X/"doesn't apply" option, when the scale has
                      one -- visually separated (extra top margin) and
                      styled distinctly from the numeric options
                      (dashed border, muted/amber instead of filled), so
                      it never reads as just another point on the same
                      scale. */}
                  {(item.scale ?? []).includes(EXCLUDED_ANSWER) && (
                    <button
                      type="button"
                      onClick={() => setAnswer(item.id, EXCLUDED_ANSWER)}
                      className={`mt-1 w-full rounded-2xl border-2 border-dashed py-3 text-sm font-semibold transition-colors ${
                        answers[item.id] === EXCLUDED_ANSWER
                          ? "border-brand-golden-brown bg-brand-golden-brown/10 text-brand-golden-brown"
                          : "border-black/15 text-brand-neutral-black/50"
                      }`}
                    >
                      Doesn&apos;t apply
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </main>

      {saveError && (
        <p role="alert" className="px-4 pb-2 text-sm font-medium text-red-600">
          {saveError}
        </p>
      )}

      <div className="flex flex-shrink-0 flex-col gap-2 border-t border-black/5 p-4">
        <button
          type="button"
          onClick={handleSubmit}
          disabled={isSaving || (isRatingInstrument && !allAnswered)}
          className="w-full rounded-2xl bg-brand-prussian-blue py-3.5 text-base font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40"
        >
          {isSaving ? "Submitting…" : "Submit"}
        </button>
        <button
          type="button"
          onClick={handleSaveAndExit}
          disabled={isSaving}
          className="w-full rounded-2xl border-2 border-brand-prussian-blue py-3.5 text-base font-semibold text-brand-prussian-blue disabled:opacity-40"
        >
          Save &amp; continue later
        </button>
      </div>
    </div>
  );
}
